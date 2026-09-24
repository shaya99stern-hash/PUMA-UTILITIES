# Puma Lead Engine V2 — Foundation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace Puma’s browser-only persistence/request-time research foundation with an authenticated Supabase/Postgres control plane, durable research jobs, and a separately runnable Node worker while preserving the existing CRM and evidence semantics during migration.

**Architecture:** This is delivery slice 1 of the approved Lead Engine V2 architecture. Supabase supplies Postgres + owner authentication; Vercel stays the Next.js UI/control plane; research runs/tasks are durable rows leased atomically by a Node worker. Existing localStorage CRM remains readable during this slice and can be imported safely, but the broad CRM UI cutover is intentionally deferred to a separate plan.

**Tech Stack:** Node >=20.9.0, TypeScript 5.9.2, Next.js 16.2.12, React 19.2.3, Supabase Postgres/Auth, `@supabase/supabase-js`, `@supabase/ssr`, `tsx --test`, GitHub Actions.

**Spec:** `docs/superpowers/specs/2026-09-24-lead-engine-v2-design.md`

## Global Constraints

- Unknown data remains unknown; absence, failure, redaction, or ambiguity never becomes a negative fact.
- `user-entered` CRM values are never silently overwritten or relabeled by public research.
- Provider tokens and Supabase service-role credentials never reach browser JavaScript.
- All server-backed CRM/research writes require an authenticated Puma workspace or a dedicated worker service credential.
- The database schema must remain portable Postgres even though Supabase is the first managed host.
- Existing localStorage data must remain available until explicit import/cutover succeeds.
- Import is idempotent and never deletes server data.
- Research work is represented as durable runs/tasks; long-running work is not held open inside a single Vercel request.
- Worker leasing is atomic and recoverable after process crashes.
- Tests and CI never consume real paid provider credits.
- Do not add Apollo, ContactOut, Hunter, Browserless, Brave, or Exa adapters in this slice; their contracts depend on this foundation and are covered by later plans.

## Program sequence

This approved architecture is intentionally split into four separately reviewable plans/PRs:

1. **Foundation — this plan:** auth, Postgres schema, canonical workspace API, import path, durable research jobs, worker lease loop.
2. **Discovery Backbone:** multi-search provider fan-out, official/public national + NY/NJ/PA discovery, entity resolution, live Find Leads run progress.
3. **Enrichment + Browser:** Apollo, ContactOut official/assisted modes, Hunter, quota engine, generic Playwright/Browserless worker adapters.
4. **CRM Cutover + Operations:** server-backed Companies/Buildings/Monitor, evidence drill-down, refresh jobs, source health/settings, retirement of localStorage as source of truth.

Do not start plan 2 until this plan is merged and its production environment is configured.

## Review Focus

1. **Unauthenticated write request:** must return 401/redirect and must not create workspace/run data. Covered in Tasks 3 and 6.
2. **Same local workspace imported twice:** must create/update the same canonical entities without duplicates and preserve `user-entered` evidence. Covered in Task 4.
3. **Worker dies after leasing a task:** lease expiry must make the task available again without two workers owning it simultaneously. Covered in Task 5.
4. **Malformed/oversized workspace import:** must reject before persistence and leave canonical data untouched. Covered in Task 4.
5. **Supabase/config unavailable:** existing local PWA must fail clearly rather than erase browser data or pretend server persistence succeeded. Covered in Tasks 2, 4, and 7.

---

### Task 1: Add Supabase dependencies and environment contract

**Files:**
- Modify: `package.json`
- Modify: `package-lock.json`
- Create: `.env.example`
- Create: `lib/server/env.ts`
- Create: `tests/lead-engine-foundation.test.ts`

**Interfaces:**
- Produces: `serverEnv()` returning validated server-only configuration and `publicSupabaseEnv()` returning publishable client configuration.
- Later tasks consume: `SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY`, and `SUPABASE_SERVICE_ROLE_KEY`.

- [ ] **Step 1: Add the foundation test file to `npm test`**

Insert `tests/lead-engine-foundation.test.ts` after `tests/research-monitor-hardening.test.ts` in the existing test script.

- [ ] **Step 2: Write failing env-contract tests**

Create `tests/lead-engine-foundation.test.ts`:

```ts
import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { publicSupabaseEnv, serverEnv } from '../lib/server/env';

function withEnv(values: Record<string, string | undefined>, run: () => void) {
  const before = { ...process.env };
  Object.assign(process.env, values);
  try { run(); } finally {
    process.env = before;
  }
}

test('server env rejects a missing service-role secret', () => {
  withEnv({
    NEXT_PUBLIC_SUPABASE_URL: 'https://example.supabase.co',
    NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: 'sb_publishable_test',
    SUPABASE_SERVICE_ROLE_KEY: undefined,
  }, () => assert.throws(() => serverEnv(), /SUPABASE_SERVICE_ROLE_KEY/));
});

test('public env exposes only publishable Supabase settings', () => {
  withEnv({
    NEXT_PUBLIC_SUPABASE_URL: 'https://example.supabase.co',
    NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: 'sb_publishable_test',
    SUPABASE_SERVICE_ROLE_KEY: 'super-secret',
  }, () => assert.deepEqual(publicSupabaseEnv(), {
    url: 'https://example.supabase.co',
    publishableKey: 'sb_publishable_test',
  }));
});

test('.env.example never contains a real secret value', () => {
  const source = readFileSync(new URL('../.env.example', import.meta.url), 'utf8');
  assert.match(source, /SUPABASE_SERVICE_ROLE_KEY=/);
  assert.doesNotMatch(source, /eyJ[A-Za-z0-9_-]{20,}/);
});
```

- [ ] **Step 3: Run focused tests and verify red state**

```bash
npx tsx --test tests/lead-engine-foundation.test.ts
```

Expected: FAIL because `lib/server/env.ts` and `.env.example` do not exist.

- [ ] **Step 4: Add Supabase packages**

```bash
npm install @supabase/supabase-js@latest @supabase/ssr@latest
```

Do not add a browser automation dependency to the root Next.js app.

- [ ] **Step 5: Create the environment contract**

Create `.env.example`:

```dotenv
NEXT_PUBLIC_SUPABASE_URL=
NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY=
SUPABASE_SERVICE_ROLE_KEY=
PUMA_WORKER_TOKEN=
```

Create `lib/server/env.ts`:

```ts
function required(name: string): string {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`${name} is required.`);
  return value;
}

export function publicSupabaseEnv() {
  return {
    url: required('NEXT_PUBLIC_SUPABASE_URL'),
    publishableKey: required('NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY'),
  };
}

export function serverEnv() {
  return {
    ...publicSupabaseEnv(),
    serviceRoleKey: required('SUPABASE_SERVICE_ROLE_KEY'),
  };
}
```

- [ ] **Step 6: Run Task 1 tests**

```bash
npx tsx --test tests/lead-engine-foundation.test.ts
npm run typecheck
```

Expected: PASS.

- [ ] **Step 7: Commit Task 1**

```bash
git add package.json package-lock.json .env.example lib/server/env.ts tests/lead-engine-foundation.test.ts
git commit -m "build: add lead engine server foundation"
```

---

### Task 2: Create the portable Postgres schema, RLS, and atomic lease functions

**Files:**
- Create: `supabase/migrations/202609240001_lead_engine_foundation.sql`
- Modify: `tests/lead-engine-foundation.test.ts`

**Interfaces:**
- Produces CRM tables: `workspaces`, `companies`, `people`, `company_people`, `properties`, `company_properties`, `utilities`, `property_utilities`, `tariffs`, `activity_notes`, `follow_ups`, `pipeline_events`.
- Produces research tables: `research_runs`, `research_tasks`, `research_sources`, `research_evidence`, `research_claims`, `research_entities`, `entity_aliases`, `entity_links`, `source_health_events`.
- Produces provider-control tables: `provider_accounts`, `provider_quota_snapshots`, `provider_usage_events`, `provider_backoff_state`.
- Produces RPC: `lease_research_tasks(worker_name text, lease_seconds integer, max_tasks integer)`.

- [ ] **Step 1: Add failing migration contract tests**

Append:

```ts
test('foundation migration contains canonical CRM, research, provider and lease primitives', () => {
  const sql = readFileSync(new URL('../supabase/migrations/202609240001_lead_engine_foundation.sql', import.meta.url), 'utf8');
  for (const table of [
    'workspaces','companies','people','company_people','properties','company_properties',
    'utilities','property_utilities','tariffs','activity_notes','follow_ups','pipeline_events',
    'research_runs','research_tasks','research_sources','research_evidence','research_claims',
    'research_entities','entity_aliases','entity_links','source_health_events',
    'provider_accounts','provider_quota_snapshots','provider_usage_events','provider_backoff_state',
  ]) assert.match(sql, new RegExp(`create table(?: if not exists)? public\\.${table}\\b`, 'i'));
  assert.match(sql, /enable row level security/i);
  assert.match(sql, /create or replace function public\.lease_research_tasks/i);
  assert.match(sql, /for update skip locked/i);
});
```

- [ ] **Step 2: Verify the migration test is red**

```bash
npx tsx --test tests/lead-engine-foundation.test.ts
```

Expected: FAIL because the migration does not exist.

- [ ] **Step 3: Create the migration**

Use UUID primary keys, `workspace_id uuid not null references public.workspaces(id) on delete cascade`, timestamps with `timestamptz`, and JSONB only for flexible evidence/provider payloads rather than replacing normalized relationships.

The migration must begin with:

```sql
create extension if not exists pgcrypto;

create table if not exists public.workspaces (
  id uuid primary key default gen_random_uuid(),
  owner_user_id uuid not null references auth.users(id) on delete cascade,
  name text not null default 'Puma Utilities',
  local_import_completed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(owner_user_id)
);

create table if not exists public.companies (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  legacy_id text,
  name text not null,
  normalized_name text not null,
  stage text not null default 'Target',
  market text,
  website text,
  public_email text,
  public_phone text,
  headquarters jsonb not null default '{"status":"unknown"}'::jsonb,
  portfolio_buildings jsonb not null default '{"status":"unknown"}'::jsonb,
  portfolio_units jsonb not null default '{"status":"unknown"}'::jsonb,
  next_action text,
  notes text,
  last_contact_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(workspace_id, legacy_id)
);
```

Create the remaining CRM tables with the same workspace ownership, stable `legacy_id` import key where applicable, and explicit foreign keys.

Create durable research state using:

```sql
create type public.research_run_status as enum ('queued','running','partial','completed','failed','cancelled');
create type public.research_task_status as enum ('queued','leased','running','complete','blocked','failed','cancelled');

create table if not exists public.research_runs (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  kind text not null check (kind in ('discover','company-research','refresh')),
  status public.research_run_status not null default 'queued',
  input jsonb not null default '{}'::jsonb,
  summary jsonb not null default '{}'::jsonb,
  requested_by uuid references auth.users(id),
  started_at timestamptz,
  completed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.research_tasks (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  run_id uuid not null references public.research_runs(id) on delete cascade,
  source_id text not null,
  subject_type text not null,
  subject_key text not null,
  capability text not null,
  status public.research_task_status not null default 'queued',
  priority integer not null default 100,
  attempt_count integer not null default 0,
  max_attempts integer not null default 3,
  not_before timestamptz not null default now(),
  lease_owner text,
  lease_expires_at timestamptz,
  input jsonb not null default '{}'::jsonb,
  output jsonb not null default '{}'::jsonb,
  failure_class text,
  failure_message text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists research_tasks_queue_idx
  on public.research_tasks(status, not_before, priority, created_at);
```

Create the lease RPC exactly around `FOR UPDATE SKIP LOCKED`:

```sql
create or replace function public.lease_research_tasks(
  worker_name text,
  lease_seconds integer default 90,
  max_tasks integer default 1
)
returns setof public.research_tasks
language plpgsql
security definer
set search_path = public
as $$
begin
  return query
  with candidates as (
    select id
    from public.research_tasks
    where
      (status = 'queued' or (status = 'leased' and lease_expires_at < now()))
      and not_before <= now()
      and attempt_count < max_attempts
    order by priority asc, created_at asc
    for update skip locked
    limit greatest(1, least(max_tasks, 10))
  )
  update public.research_tasks t
  set status = 'leased',
      lease_owner = worker_name,
      lease_expires_at = now() + make_interval(secs => greatest(15, least(lease_seconds, 600))),
      attempt_count = attempt_count + 1,
      updated_at = now()
  from candidates c
  where t.id = c.id
  returning t.*;
end;
$$;
```

Enable RLS on every workspace-owned table. User-facing policies must only permit rows whose `workspace_id` belongs to `auth.uid()`. Worker access uses the Supabase service role, not a permissive public policy.

- [ ] **Step 4: Apply the migration to a development Supabase project/branch**

During execution, use an existing Puma Supabase project if the user identifies one. If none exists, ask which Supabase organization to use, retrieve/confirm project cost through the Supabase connector, then create the project. Do not guess an organization or create billable infrastructure without the required cost confirmation.

After migration, run Supabase security and performance advisors. RLS/security findings introduced by this migration must be resolved before Task 2 is considered complete.

- [ ] **Step 5: Run Task 2 verification**

```bash
npx tsx --test tests/lead-engine-foundation.test.ts
```

Expected: PASS.

- [ ] **Step 6: Commit Task 2**

```bash
git add supabase/migrations/202609240001_lead-engine-foundation.sql tests/lead-engine-foundation.test.ts
git commit -m "feat: add canonical lead engine schema"
```

---

### Task 3: Add Supabase auth clients and protect server-backed surfaces

**Files:**
- Create: `lib/server/supabase-admin.ts`
- Create: `lib/server/supabase-server.ts`
- Create: `lib/supabase-browser.ts`
- Create: `lib/server/current-workspace.ts`
- Create: `app/login/page.tsx`
- Create: `app/auth/callback/route.ts`
- Modify: `proxy.ts`
- Modify: `tests/lead-engine-foundation.test.ts`

**Interfaces:**
- Produces: `createServerSupabase()`, `createAdminSupabase()`, `createBrowserSupabase()`, `requireUser()`, `requireWorkspace()`.
- API routes in Tasks 4 and 6 consume `requireWorkspace()`.

- [ ] **Step 1: Add failing auth-boundary tests**

```ts
test('server auth helper owns workspace resolution and proxy protects server-backed routes', () => {
  const auth = readFileSync(new URL('../lib/server/current-workspace.ts', import.meta.url), 'utf8');
  const proxy = readFileSync(new URL('../proxy.ts', import.meta.url), 'utf8');
  assert.match(auth, /requireUser/);
  assert.match(auth, /requireWorkspace/);
  assert.match(proxy, /\/api\/workspace/);
  assert.match(proxy, /\/api\/lead-runs/);
  assert.match(proxy, /\/login/);
});
```

- [ ] **Step 2: Verify red state**

```bash
npx tsx --test tests/lead-engine-foundation.test.ts
```

- [ ] **Step 3: Implement server/browser Supabase factories**

`lib/server/supabase-admin.ts` must use only `SUPABASE_SERVICE_ROLE_KEY` and must contain `import 'server-only';`.

`lib/server/current-workspace.ts` must expose:

```ts
export async function requireUser() {
  const supabase = await createServerSupabase();
  const { data: { user }, error } = await supabase.auth.getUser();
  if (error || !user) throw new AuthRequiredError();
  return { supabase, user };
}

export async function requireWorkspace() {
  const { supabase, user } = await requireUser();
  const { data, error } = await supabase
    .from('workspaces')
    .select('id, owner_user_id, name, local_import_completed_at')
    .eq('owner_user_id', user.id)
    .single();
  if (error || !data) throw new Error('Puma workspace is not initialized.');
  return { supabase, user, workspace: data };
}
```

- [ ] **Step 4: Add owner login and callback**

Use Supabase passwordless email OTP/magic-link auth for the first single-owner implementation. The login page must not embed a privileged key. The callback exchanges the auth code and redirects to `/`.

- [ ] **Step 5: Extend `proxy.ts` without breaking canonical-host redirect**

Keep the existing production canonical-host behavior. Refresh Supabase auth cookies for all requests, and redirect unauthenticated page access to `/login` for `/clients`, `/engine`, `/monitor`, and `/settings`. API routes return 401 inside their route handlers rather than HTML redirects.

- [ ] **Step 6: Run tests/typecheck**

```bash
npx tsx --test tests/lead-engine-foundation.test.ts
npm run typecheck
```

- [ ] **Step 7: Commit Task 3**

```bash
git add lib/server/supabase-admin.ts lib/server/supabase-server.ts lib/supabase-browser.ts lib/server/current-workspace.ts app/login/page.tsx app/auth/callback/route.ts proxy.ts tests/lead-engine-foundation.test.ts
git commit -m "feat: add authenticated Puma server workspace"
```

---

### Task 4: Add canonical workspace repository and safe localStorage import

**Files:**
- Create: `lib/server/workspace-repository.ts`
- Create: `lib/server/workspace-import.ts`
- Create: `app/api/workspace/route.ts`
- Create: `app/api/workspace/import/route.ts`
- Create: `app/components/puma-workspace-migration.tsx`
- Modify: `app/components/puma-settings-hub.tsx`
- Modify: `tests/lead-engine-foundation.test.ts`

**Interfaces:**
- Produces: `getCanonicalWorkspace(workspaceId)`, `importLegacyWorkspace(workspaceId, workspace)`, HTTP `GET /api/workspace`, `POST /api/workspace/import`.
- Import consumes the existing `parseWorkspace()` contract and preserves all `user-entered` fields.

- [ ] **Step 1: Add pure import-plan tests before database code**

Refactor the import transformation into a pure function that can be unit-tested without Supabase:

```ts
export type WorkspaceImportPlan = {
  companies: Array<{ legacyId: string; name: string; payload: Company }>;
  properties: Array<{ legacyId: string; companyLegacyId: string; payload: Property }>;
  parcels: Parcel[];
  utilities: UtilityService[];
  tariffs: Tariff[];
};

export function buildWorkspaceImportPlan(workspace: Workspace): WorkspaceImportPlan;
```

Add tests proving:

```ts
test('workspace import plan preserves manual evidence and stable legacy ids', () => {
  const workspace = emptyWorkspace();
  workspace.companies.push({ /* complete Company fixture with id company_manual and user-entered person */ } as Company);
  const plan = buildWorkspaceImportPlan(workspace);
  assert.equal(plan.companies[0].legacyId, 'company_manual');
  assert.equal(plan.companies[0].payload.people[0].status, 'user-entered');
});
```

Also test that `parseWorkspace` rejection is propagated for malformed version/input.

- [ ] **Step 2: Verify the import tests fail before implementation**

```bash
npx tsx --test tests/lead-engine-foundation.test.ts
```

- [ ] **Step 3: Implement idempotent database import**

Use `(workspace_id, legacy_id)` unique constraints for imported entities. Upsert by stable legacy ID; never delete rows not present in the browser payload. For company/person/property field conflicts, an existing server row with `user-entered` evidence wins over incoming research-origin values.

The import endpoint must enforce:

```ts
const MAX_IMPORT_BYTES = 5_000_000;
if (Number(request.headers.get('content-length') ?? 0) > MAX_IMPORT_BYTES) {
  return NextResponse.json({ error: 'Workspace import is too large.' }, { status: 413 });
}
```

Parse the incoming JSON through `parseWorkspace()` before any write.

- [ ] **Step 4: Add a Settings migration surface**

Add a Settings row `Server Workspace`. The client component reads `loadWorkspace()`, calls `GET /api/workspace` to determine migration state, and offers one explicit `Import this device` action. It must show a confirmation summary (company/property/contact counts) before POSTing. It must never auto-import on page load.

- [ ] **Step 5: Run Task 4 tests**

```bash
npx tsx --test tests/lead-engine-foundation.test.ts
npm run typecheck
```

- [ ] **Step 6: Commit Task 4**

```bash
git add lib/server/workspace-repository.ts lib/server/workspace-import.ts app/api/workspace/route.ts app/api/workspace/import/route.ts app/components/puma-workspace-migration.tsx app/components/puma-settings-hub.tsx tests/lead-engine-foundation.test.ts
git commit -m "feat: add canonical workspace import"
```

---

### Task 5: Add durable research run/task repository and worker lease loop

**Files:**
- Create: `lib/research/jobs/types.ts`
- Create: `lib/research/jobs/repository.ts`
- Create: `workers/lead-engine/package.json`
- Create: `workers/lead-engine/src/worker.ts`
- Create: `workers/lead-engine/src/index.ts`
- Create: `workers/lead-engine/src/execute-task.ts`
- Modify: `tests/lead-engine-foundation.test.ts`
- Modify: `package.json`

**Interfaces:**
- Produces: `createResearchRun`, `getResearchRun`, `cancelResearchRun`, `leaseResearchTasks`, `completeResearchTask`, `failResearchTask`.
- Produces worker contract: one leased task in, one terminal/retry transition out.
- Slice 2 will register real discovery adapters through `executeTask`; this slice ships a `system.health` test task so the queue can be proven end-to-end without provider APIs.

- [ ] **Step 1: Define run/task types and failing repository tests**

Use:

```ts
export type ResearchRunStatus = 'queued'|'running'|'partial'|'completed'|'failed'|'cancelled';
export type ResearchTaskStatus = 'queued'|'leased'|'running'|'complete'|'blocked'|'failed'|'cancelled';

export type LeasedResearchTask = {
  id: string;
  runId: string;
  workspaceId: string;
  sourceId: string;
  subjectType: string;
  subjectKey: string;
  capability: string;
  input: Record<string, unknown>;
  attemptCount: number;
  maxAttempts: number;
  leaseOwner: string;
  leaseExpiresAt: string;
};
```

Repository code must accept an injected Supabase-like client so unit tests can assert RPC/table operations without a real database.

- [ ] **Step 2: Implement the repository around the lease RPC**

`leaseResearchTasks()` must call `rpc('lease_research_tasks', { worker_name, lease_seconds, max_tasks })`. `failResearchTask()` must either requeue with `not_before` when retryable and attempts remain, or mark `failed`.

- [ ] **Step 3: Create the standalone worker package**

`workers/lead-engine/package.json`:

```json
{
  "name": "puma-lead-engine-worker",
  "private": true,
  "type": "module",
  "scripts": {
    "start": "tsx src/index.ts",
    "typecheck": "tsc --noEmit"
  },
  "engines": { "node": ">=20.9.0" },
  "dependencies": {
    "@supabase/supabase-js": "latest",
    "tsx": "4.20.6",
    "typescript": "5.9.2"
  }
}
```

Worker loop behavior:

```ts
while (!signal.aborted) {
  const tasks = await leaseResearchTasks(client, workerName, 90, 2);
  if (!tasks.length) {
    await sleep(1500, signal);
    continue;
  }
  await Promise.all(tasks.map((task) => executeLeasedTask(client, task)));
}
```

`execute-task.ts` supports `sourceId === 'system-health'` in this slice and returns a deterministic successful payload. Unknown source IDs are blocked/failed explicitly rather than silently succeeding.

- [ ] **Step 4: Add root verification script for worker typecheck**

Add:

```json
"worker:typecheck": "cd workers/lead-engine && npm install --ignore-scripts && npm run typecheck"
```

Do not add the worker’s runtime dependencies to the Next.js bundle.

- [ ] **Step 5: Run Task 5 verification**

```bash
npx tsx --test tests/lead-engine-foundation.test.ts
npm run typecheck
npm run worker:typecheck
```

- [ ] **Step 6: Commit Task 5**

```bash
git add lib/research/jobs workers/lead-engine package.json tests/lead-engine-foundation.test.ts
git commit -m "feat: add durable research worker queue"
```

---

### Task 6: Add authenticated lead-run API endpoints

**Files:**
- Create: `app/api/lead-runs/route.ts`
- Create: `app/api/lead-runs/[runId]/route.ts`
- Modify: `tests/lead-engine-foundation.test.ts`

**Interfaces:**
- `POST /api/lead-runs` creates a durable run plus initial tasks and returns `202 { runId, status }`.
- `GET /api/lead-runs/:runId` returns only a run belonging to the current workspace.
- `DELETE /api/lead-runs/:runId` marks the run/tasks cancelled; it does not hard-delete evidence/history.

- [ ] **Step 1: Add route-source boundary tests**

```ts
test('lead-run routes require workspace auth and return asynchronous run ids', () => {
  const createSource = readFileSync(new URL('../app/api/lead-runs/route.ts', import.meta.url), 'utf8');
  const runSource = readFileSync(new URL('../app/api/lead-runs/[runId]/route.ts', import.meta.url), 'utf8');
  assert.match(createSource, /requireWorkspace/);
  assert.match(createSource, /status:\s*202/);
  assert.match(createSource, /runId/);
  assert.match(runSource, /requireWorkspace/);
  assert.match(runSource, /cancelResearchRun/);
});
```

- [ ] **Step 2: Implement bounded create input**

Accept only:

```ts
type CreateRunInput = {
  kind: 'discover' | 'company-research';
  markets?: string[];
  company?: { name: string; website?: string; state?: string };
  targetCount?: number;
};
```

Limit `markets` to 5, `targetCount` to 1–50, company name to 180 characters, and request body to 16 KiB. This endpoint queues work only; it does not call search providers directly.

- [ ] **Step 3: Seed a system-health task only for foundation verification**

Until slice 2 replaces task planning, every new run should include a low-cost `system-health` task so the end-to-end worker/run lifecycle can be verified without external providers. Keep the planner isolated in `lib/research/jobs/repository.ts` so slice 2 can replace the task set cleanly.

- [ ] **Step 4: Run Task 6 verification**

```bash
npx tsx --test tests/lead-engine-foundation.test.ts
npm run typecheck
```

- [ ] **Step 5: Commit Task 6**

```bash
git add app/api/lead-runs lib/research/jobs/repository.ts tests/lead-engine-foundation.test.ts
git commit -m "feat: expose durable lead research runs"
```

---

### Task 7: Expose foundation health without pretending providers are connected

**Files:**
- Modify: `app/components/puma-data-sources-settings.tsx`
- Create: `app/api/lead-engine/health/route.ts`
- Modify: `tests/lead-engine-foundation.test.ts`

**Interfaces:**
- Produces health payload with `database`, `auth`, `workerQueue`, and `providerPhase` fields.
- Must not label Apollo/ContactOut/Hunter/browser providers active before their adapters are configured in later slices.

- [ ] **Step 1: Add failing health UI tests**

```ts
test('data source settings distinguish foundation readiness from provider connectivity', () => {
  const settings = readFileSync(new URL('../app/components/puma-data-sources-settings.tsx', import.meta.url), 'utf8');
  assert.match(settings, /Lead Engine/);
  assert.match(settings, /Database/);
  assert.match(settings, /Worker queue/);
  assert.doesNotMatch(settings, /ContactOut.*Active/s);
});
```

- [ ] **Step 2: Implement authenticated health endpoint**

`GET /api/lead-engine/health` must call `requireWorkspace()`, perform a bounded database query, count runnable/leased tasks, and return:

```ts
{
  database: 'ready' | 'unavailable',
  auth: 'ready',
  workerQueue: { queued: number; leased: number; staleLeases: number },
  providerPhase: 'foundation-only'
}
```

Do not return secret values or raw connection errors.

- [ ] **Step 3: Update Data Sources settings**

Add a top `Lead Engine` status block using the health endpoint. Preserve the existing source rows for compatibility, but browser enrichment remains `Unavailable` until slice 3 really connects it.

- [ ] **Step 4: Run Task 7 verification**

```bash
npx tsx --test tests/lead-engine-foundation.test.ts
npm run typecheck
```

- [ ] **Step 5: Commit Task 7**

```bash
git add app/api/lead-engine/health/route.ts app/components/puma-data-sources-settings.tsx tests/lead-engine-foundation.test.ts
git commit -m "feat: expose lead engine foundation health"
```

---

### Task 8: Full verification and operational proof

**Files:**
- Modify only files needed to correct failures found by verification.

**Interfaces:**
- Produces evidence that the exact branch head passes repository CI and that a configured development environment can complete the auth → import → queue → lease → completion path.

- [ ] **Step 1: Run the full local/static verification suite**

```bash
npm test
npm run typecheck
npm run worker:typecheck
npm run build
```

Expected: all pass.

- [ ] **Step 2: Verify database security after migration**

Run Supabase security and performance advisors against the development project. Resolve any new high/critical security findings, missing RLS coverage, or function search-path warnings attributable to this migration.

- [ ] **Step 3: Exercise one development end-to-end run**

Using a test owner session:

1. Authenticate.
2. Confirm one workspace row exists for the owner.
3. Import a small local workspace fixture twice and confirm entity counts do not double.
4. `POST /api/lead-runs` and capture the returned run ID.
5. Start the Node worker with service-role credentials.
6. Confirm the `system-health` task transitions `queued -> leased -> complete`.
7. Confirm the parent run reaches `completed`.
8. Stop the worker after leasing a second synthetic task, let its lease expire, restart the worker, and confirm the task is reclaimed once rather than duplicated.

- [ ] **Step 4: Run fresh GitHub Actions on the exact branch head**

Do not claim the slice is ready until the workflow for the final SHA shows Tests, TypeScript, worker typecheck if added to CI, and Next build all successful.

- [ ] **Step 5: Whole-slice review**

Review specifically for:

- any service-role key reachable from client bundles,
- anonymous write paths,
- permissive RLS policies,
- destructive import behavior,
- duplicate entity creation on repeated imports,
- non-atomic task leasing,
- long-running work still happening inside Vercel routes,
- production UI claiming providers are active when they are not.

- [ ] **Step 6: Final commit for verification-only corrections, if needed**

Use a focused commit message describing the correction; do not combine unrelated feature work.

## Foundation slice completion gate

This plan is complete only when:

- owner authentication works;
- Postgres/RLS schema is applied and advisor-clean for introduced issues;
- a browser workspace can be explicitly imported twice without duplication or manual-evidence loss;
- `/api/lead-runs` returns immediately with durable run IDs;
- the standalone Node worker atomically leases and completes durable tasks;
- expired leases are recoverable;
- provider secrets remain server/worker-only;
- existing local CRM data remains available during the migration period;
- full repository CI is green on the exact final SHA.

After this slice merges, write and review `docs/superpowers/plans/2026-09-24-lead-engine-v2-discovery-backbone.md` against the now-real schema/worker interfaces before adding Brave, Exa, HUD, licensing, property, or other source adapters.
