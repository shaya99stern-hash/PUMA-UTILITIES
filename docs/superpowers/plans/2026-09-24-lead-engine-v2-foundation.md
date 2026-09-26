# Puma Lead Engine V2 — Foundation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give Puma an authenticated Postgres control plane, durable research runs/tasks, safe local-workspace import, and a separately runnable Node worker before adding new lead providers.

**Architecture:** Supabase provides Postgres + owner authentication; Vercel remains the Next.js UI/control plane; research work is queued in Postgres and atomically leased by a standalone Node worker. Existing localStorage CRM remains readable during this slice and is imported only through an explicit idempotent action. Full CRM screen cutover and provider adapters are separate plans.

**Tech Stack:** Node >=20.9.0, TypeScript 5.9.2, Next.js 16.2.12, React 19.2.3, Supabase Postgres/Auth, `@supabase/supabase-js`, `@supabase/ssr`, `tsx --test`, GitHub Actions.

**Spec:** `docs/superpowers/specs/2026-09-24-lead-engine-v2-design.md`

## Global Constraints

- Unknown stays unknown; source absence/failure/redaction/ambiguity never becomes a negative fact.
- Existing `user-entered` CRM values are never silently overwritten or relabeled by public research/import.
- `SUPABASE_SERVICE_ROLE_KEY` and future provider secrets never enter browser JavaScript.
- All server-backed CRM/research writes require an authenticated Puma workspace or worker service credential.
- Schema is portable Postgres even though Supabase is the first host.
- localStorage remains available until an explicit import/cutover succeeds.
- Import is idempotent and non-destructive.
- Long-running research does not execute inside one Vercel request.
- Worker leasing is atomic and crash-recoverable.
- CI does not require a live Supabase project or paid provider credits.
- This slice does not connect Brave, Exa, Apollo, ContactOut, Hunter, Browserless, or other new providers.

## Program Sequence

1. **Foundation — this plan:** auth, Postgres schema, workspace import, durable jobs, worker lease loop.
2. **Discovery Backbone:** multi-provider search, official/public datasets, entity resolution, live Find Leads progress.
3. **Enrichment + Browser:** Apollo, ContactOut official/assisted modes, Hunter, quotas, Playwright/Browserless adapters.
4. **CRM Cutover + Operations:** server-backed Companies/Buildings/Monitor, evidence drill-down, refresh jobs, source-health UI, removal of localStorage as source of truth after migration confidence.

## Review Focus

1. **Unauthenticated write:** return 401/redirect and persist nothing. Tasks 3 and 6.
2. **Same browser workspace imported twice:** no duplicates; manual evidence stays manual. Task 4.
3. **Worker dies after leasing:** expired lease is reclaimed once; simultaneous workers cannot lease the same task. Task 5.
4. **Malformed/oversized import:** reject before writes; canonical data unchanged. Task 4.
5. **Database/config unavailable:** show explicit unavailable state; never clear browser data or claim persistence succeeded. Tasks 1, 4, and 7.

---

### Task 1: Supabase dependencies and environment contract

**Files:**
- Modify: `package.json`
- Modify: `package-lock.json`
- Create: `.env.example`
- Create: `lib/server/env.ts`
- Create: `tests/lead-engine-foundation.test.ts`

**Interfaces:**
- Produces `publicSupabaseEnv(): { url: string; publishableKey: string }`.
- Produces `serverEnv(): { url: string; publishableKey: string; serviceRoleKey: string }`.
- All later server code uses `NEXT_PUBLIC_SUPABASE_URL` for the project URL; there is no separate `SUPABASE_URL` variable.

- [ ] **Step 1: Register the new test file**

Add `tests/lead-engine-foundation.test.ts` to the root `npm test` command immediately after `tests/research-monitor-hardening.test.ts`.

- [ ] **Step 2: Write failing environment tests**

```ts
import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { publicSupabaseEnv, serverEnv } from '../lib/server/env';

function withEnv(values: Record<string, string | undefined>, run: () => void) {
  const before = new Map(Object.keys(values).map((key) => [key, process.env[key]]));
  for (const [key, value] of Object.entries(values)) {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
  try { run(); } finally {
    for (const [key, value] of before) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  }
}

test('server env rejects a missing service role secret', () => {
  withEnv({
    NEXT_PUBLIC_SUPABASE_URL: 'https://example.supabase.co',
    NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: 'sb_publishable_test',
    SUPABASE_SERVICE_ROLE_KEY: undefined,
  }, () => assert.throws(() => serverEnv(), /SUPABASE_SERVICE_ROLE_KEY/));
});

test('public env returns only publishable settings', () => {
  withEnv({
    NEXT_PUBLIC_SUPABASE_URL: 'https://example.supabase.co',
    NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: 'sb_publishable_test',
    SUPABASE_SERVICE_ROLE_KEY: 'server-secret',
  }, () => assert.deepEqual(publicSupabaseEnv(), {
    url: 'https://example.supabase.co',
    publishableKey: 'sb_publishable_test',
  }));
});

test('.env.example contains names but no JWT-like secret', () => {
  const source = readFileSync(new URL('../.env.example', import.meta.url), 'utf8');
  assert.match(source, /SUPABASE_SERVICE_ROLE_KEY=/);
  assert.doesNotMatch(source, /eyJ[A-Za-z0-9_-]{20,}/);
});
```

- [ ] **Step 3: Prove RED**

```bash
npx tsx --test tests/lead-engine-foundation.test.ts
```

Expected: missing `lib/server/env.ts` / `.env.example`.

- [ ] **Step 4: Install Supabase packages**

```bash
npm install @supabase/supabase-js@latest @supabase/ssr@latest
```

Do not install Chromium/Playwright in the root Next.js package.

- [ ] **Step 5: Add `.env.example`**

```dotenv
NEXT_PUBLIC_SUPABASE_URL=
NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY=
SUPABASE_SERVICE_ROLE_KEY=
PUMA_WORKER_TOKEN=
```

- [ ] **Step 6: Implement `lib/server/env.ts`**

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

- [ ] **Step 7: Prove GREEN and commit**

```bash
npx tsx --test tests/lead-engine-foundation.test.ts
npm run typecheck
git add package.json package-lock.json .env.example lib/server/env.ts tests/lead-engine-foundation.test.ts
git commit -m "build: add lead engine server foundation"
```

---

### Task 2: Portable Postgres schema, RLS, and atomic leasing

**Files:**
- Create: `supabase/migrations/202609240001_lead_engine_foundation.sql`
- Modify: `tests/lead-engine-foundation.test.ts`

**Interfaces:**
- CRM tables: `workspaces`, `companies`, `people`, `company_people`, `properties`, `company_properties`, `utilities`, `property_utilities`, `tariffs`, `activity_notes`, `follow_ups`, `pipeline_events`.
- Research tables: `research_runs`, `research_tasks`, `research_sources`, `research_evidence`, `research_claims`, `research_entities`, `entity_aliases`, `entity_links`, `source_health_events`.
- Provider-control tables: `provider_accounts`, `provider_quota_snapshots`, `provider_usage_events`, `provider_backoff_state`.
- RPC: `lease_research_tasks(worker_name text, lease_seconds integer, max_tasks integer)`.

- [ ] **Step 1: Write the migration contract test**

```ts
test('foundation migration defines canonical tables, RLS and atomic leasing', () => {
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

- [ ] **Step 2: Prove RED**

```bash
npx tsx --test tests/lead-engine-foundation.test.ts
```

- [ ] **Step 3: Create the migration with canonical ownership**

Start with:

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

Every other CRM table must include `workspace_id`; imported top-level entities receive `legacy_id` and `unique(workspace_id, legacy_id)`. Relationship tables use foreign keys, not duplicated names.

Create durable run/task types and tables:

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

The remaining research tables store normalized entities/aliases/links and claim/evidence payloads with `workspace_id`, `run_id` where applicable, `source_id`, authority/confidence, observed time, and source URL/reference. Provider tables store enablement, quota snapshots, usage, and backoff metadata only; secret values never live there.

- [ ] **Step 4: Implement atomic lease RPC**

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

- [ ] **Step 5: Add RLS policies**

Enable RLS on every workspace-owned table. User policies must require ownership through `workspaces.owner_user_id = auth.uid()`. No anonymous insert/update/delete policy is permitted. The worker uses service-role access rather than a public bypass policy.

- [ ] **Step 6: Apply migration to a development Supabase environment**

If a Puma Supabase project already exists, use it. Otherwise, during execution ask which Supabase organization to use and complete the connector’s required cost check/confirmation before creating billable infrastructure. Never guess the organization.

After applying the migration, run Supabase security and performance advisors and correct migration-introduced high/critical security issues, missing RLS, or function search-path warnings.

- [ ] **Step 7: Prove GREEN and commit**

```bash
npx tsx --test tests/lead-engine-foundation.test.ts
git add supabase/migrations/202609240001_lead_engine_foundation.sql tests/lead-engine-foundation.test.ts
git commit -m "feat: add canonical lead engine schema"
```

---

### Task 3: Supabase auth clients and workspace boundary

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
- Produces `createServerSupabase()`, `createAdminSupabase()`, `createBrowserSupabase()`.
- Produces `requireUser()` and `requireWorkspace()` for all server-backed routes.

- [ ] **Step 1: Add failing boundary test**

```ts
test('server workspace helpers and proxy establish the authenticated boundary', () => {
  const auth = readFileSync(new URL('../lib/server/current-workspace.ts', import.meta.url), 'utf8');
  const proxy = readFileSync(new URL('../proxy.ts', import.meta.url), 'utf8');
  assert.match(auth, /requireUser/);
  assert.match(auth, /requireWorkspace/);
  assert.match(proxy, /\/login/);
});
```

- [ ] **Step 2: Prove RED**

```bash
npx tsx --test tests/lead-engine-foundation.test.ts
```

- [ ] **Step 3: Implement Supabase factories**

`lib/server/supabase-admin.ts` begins with `import 'server-only';` and uses only `serverEnv().serviceRoleKey`. `lib/supabase-browser.ts` uses only `publicSupabaseEnv()`.

`requireWorkspace()` uses the authenticated user:

```ts
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

- [ ] **Step 4: Add owner authentication**

Use Supabase passwordless email OTP/magic-link auth. Callback exchanges the code then redirects to `/`. No service-role value is rendered or serialized client-side.

- [ ] **Step 5: Extend `proxy.ts` safely**

Preserve the existing canonical Vercel-host redirect. Refresh Supabase session cookies. Protected page routes (`/clients`, `/engine`, `/monitor`, `/settings`) redirect unauthenticated users to `/login`; API routes enforce 401 inside route handlers rather than returning login HTML.

- [ ] **Step 6: Verify and commit**

```bash
npx tsx --test tests/lead-engine-foundation.test.ts
npm run typecheck
git add lib/server/supabase-admin.ts lib/server/supabase-server.ts lib/supabase-browser.ts lib/server/current-workspace.ts app/login/page.tsx app/auth/callback/route.ts proxy.ts tests/lead-engine-foundation.test.ts
git commit -m "feat: add authenticated Puma server workspace"
```

---

### Task 4: Canonical workspace repository and explicit localStorage import

**Files:**
- Create: `lib/server/workspace-import.ts`
- Create: `lib/server/workspace-repository.ts`
- Create: `app/api/workspace/route.ts`
- Create: `app/api/workspace/import/route.ts`
- Create: `app/components/puma-workspace-migration.tsx`
- Modify: `app/components/puma-settings-hub.tsx`
- Modify: `tests/lead-engine-foundation.test.ts`

**Interfaces:**
- Pure: `buildWorkspaceImportPlan(workspace: Workspace): WorkspaceImportPlan`.
- Server: `getCanonicalWorkspace(workspaceId)` and `importLegacyWorkspace(workspaceId, workspace)`.
- HTTP: `GET /api/workspace`, `POST /api/workspace/import`.

- [ ] **Step 1: Write import-plan tests**

Create a complete small `Workspace` fixture using existing `emptyWorkspace()` + current `Company`/`Property` types. Assert that stable browser IDs become stable `legacyId` keys and `user-entered` contact/property values remain unchanged in the plan.

Also assert malformed version input is rejected through existing `parseWorkspace()`.

- [ ] **Step 2: Prove RED**

```bash
npx tsx --test tests/lead-engine-foundation.test.ts
```

- [ ] **Step 3: Implement the pure import plan**

```ts
export type WorkspaceImportPlan = {
  companies: Array<{ legacyId: string; payload: Company }>;
  properties: Array<{ legacyId: string; companyLegacyId: string; payload: Property }>;
  parcels: Parcel[];
  utilities: UtilityService[];
  tariffs: Tariff[];
};

export function buildWorkspaceImportPlan(workspace: Workspace): WorkspaceImportPlan {
  return {
    companies: workspace.companies.map((company) => ({ legacyId: company.id, payload: company })),
    properties: workspace.properties.map((property) => ({
      legacyId: property.id,
      companyLegacyId: property.companyId,
      payload: property,
    })),
    parcels: workspace.parcels,
    utilities: workspace.utilities,
    tariffs: workspace.tariffs,
  };
}
```

- [ ] **Step 4: Implement idempotent database import**

Upsert imported entities by `(workspace_id, legacy_id)` and relationship records by stable parent/child identity. Never delete server rows absent from the browser payload. If a matching existing server value is explicitly `user-entered`, preserve it over research-origin incoming values.

- [ ] **Step 5: Bound and validate the import endpoint before writes**

```ts
const MAX_IMPORT_BYTES = 5_000_000;
const contentLength = Number(request.headers.get('content-length') ?? 0);
if (contentLength > MAX_IMPORT_BYTES) {
  return NextResponse.json({ error: 'Workspace import is too large.' }, { status: 413 });
}
const raw = await request.text();
if (raw.length > MAX_IMPORT_BYTES) {
  return NextResponse.json({ error: 'Workspace import is too large.' }, { status: 413 });
}
const workspace = parseWorkspace(JSON.parse(raw));
```

Call `requireWorkspace()` before persistence.

- [ ] **Step 6: Add explicit Settings migration UI**

Add a `Server Workspace` row. `puma-workspace-migration.tsx` reads current browser workspace, fetches server migration status, shows local company/property/contact counts, and requires an explicit `Import this device` click. It never imports automatically and never clears localStorage after success in this slice.

- [ ] **Step 7: Verify and commit**

```bash
npx tsx --test tests/lead-engine-foundation.test.ts
npm run typecheck
git add lib/server/workspace-import.ts lib/server/workspace-repository.ts app/api/workspace/route.ts app/api/workspace/import/route.ts app/components/puma-workspace-migration.tsx app/components/puma-settings-hub.tsx tests/lead-engine-foundation.test.ts
git commit -m "feat: add canonical workspace import"
```

---

### Task 5: Durable research repository and standalone worker lease loop

**Files:**
- Create: `lib/research/jobs/types.ts`
- Create: `lib/research/jobs/repository.ts`
- Create: `workers/lead-engine/package.json`
- Create: `workers/lead-engine/tsconfig.json`
- Create: `workers/lead-engine/src/index.ts`
- Create: `workers/lead-engine/src/worker.ts`
- Create: `workers/lead-engine/src/execute-task.ts`
- Modify: `package.json`
- Modify: `tests/lead-engine-foundation.test.ts`

**Interfaces:**
- Produces `createResearchRun`, `getResearchRun`, `cancelResearchRun`, `leaseResearchTasks`, `completeResearchTask`, `failResearchTask`.
- Worker consumes leased tasks and records exactly one completion/retry/failure transition.
- Foundation execution supports deterministic `sourceId = 'system-health'`; actual source adapters arrive in slice 2.

- [ ] **Step 1: Define exact job types**

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

- [ ] **Step 2: Write repository tests with an injected fake client**

Assert `leaseResearchTasks` calls RPC `lease_research_tasks` with `worker_name`, `lease_seconds`, `max_tasks`; assert a retryable failure requeues only while `attemptCount < maxAttempts`; assert cancellation never hard-deletes a run.

- [ ] **Step 3: Prove RED and implement repository**

```bash
npx tsx --test tests/lead-engine-foundation.test.ts
```

Repository functions must accept a Supabase-like client parameter so unit tests do not need network access.

- [ ] **Step 4: Create worker package**

`workers/lead-engine/package.json`:

```json
{
  "name": "puma-lead-engine-worker",
  "private": true,
  "type": "module",
  "scripts": { "start": "tsx src/index.ts", "typecheck": "tsc --noEmit" },
  "engines": { "node": ">=20.9.0" },
  "dependencies": {
    "@supabase/supabase-js": "latest",
    "tsx": "4.20.6",
    "typescript": "5.9.2"
  }
}
```

Worker loop:

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

`system-health` returns deterministic success. Unknown source IDs fail/block explicitly.

- [ ] **Step 5: Add root worker typecheck script**

```json
"worker:typecheck": "cd workers/lead-engine && npm install --ignore-scripts && npm run typecheck"
```

- [ ] **Step 6: Verify and commit**

```bash
npx tsx --test tests/lead-engine-foundation.test.ts
npm run typecheck
npm run worker:typecheck
git add lib/research/jobs workers/lead-engine package.json tests/lead-engine-foundation.test.ts
git commit -m "feat: add durable research worker queue"
```

---

### Task 6: Authenticated asynchronous lead-run API

**Files:**
- Create: `app/api/lead-runs/route.ts`
- Create: `app/api/lead-runs/[runId]/route.ts`
- Modify: `tests/lead-engine-foundation.test.ts`

**Interfaces:**
- `POST /api/lead-runs` -> `202 { runId, status }`.
- `GET /api/lead-runs/:runId` -> workspace-owned run + task summary.
- `DELETE /api/lead-runs/:runId` -> marks run/tasks cancelled; never deletes history.

- [ ] **Step 1: Add route-boundary tests**

```ts
test('lead-run routes require a workspace and return asynchronous ids', () => {
  const createSource = readFileSync(new URL('../app/api/lead-runs/route.ts', import.meta.url), 'utf8');
  const runSource = readFileSync(new URL('../app/api/lead-runs/[runId]/route.ts', import.meta.url), 'utf8');
  assert.match(createSource, /requireWorkspace/);
  assert.match(createSource, /status:\s*202/);
  assert.match(createSource, /runId/);
  assert.match(runSource, /requireWorkspace/);
  assert.match(runSource, /cancelResearchRun/);
});
```

- [ ] **Step 2: Prove RED**

```bash
npx tsx --test tests/lead-engine-foundation.test.ts
```

- [ ] **Step 3: Implement bounded input**

```ts
type CreateRunInput = {
  kind: 'discover' | 'company-research';
  markets?: string[];
  company?: { name: string; website?: string; state?: string };
  targetCount?: number;
};
```

Body <=16 KiB; markets <=5 valid two-letter codes; targetCount 1–50; company name 2–180 characters. Route only creates durable work; it never calls external search in-request.

- [ ] **Step 4: Seed foundation verification task**

Until slice 2 replaces task planning, a new run includes one `system-health` task so auth → queue → lease → completion is demonstrable without provider APIs.

- [ ] **Step 5: Verify and commit**

```bash
npx tsx --test tests/lead-engine-foundation.test.ts
npm run typecheck
git add app/api/lead-runs lib/research/jobs/repository.ts tests/lead-engine-foundation.test.ts
git commit -m "feat: expose durable lead research runs"
```

---

### Task 7: Honest foundation health in Settings

**Files:**
- Create: `app/api/lead-engine/health/route.ts`
- Modify: `app/components/puma-data-sources-settings.tsx`
- Modify: `tests/lead-engine-foundation.test.ts`

**Interfaces:**
- Health payload: `{ database, auth, workerQueue, providerPhase }`.
- Provider phase is `foundation-only`; UI must not display ContactOut/Apollo/Hunter/browser integrations as active.

- [ ] **Step 1: Add failing settings test**

```ts
test('settings distinguish engine foundation from provider connectivity', () => {
  const source = readFileSync(new URL('../app/components/puma-data-sources-settings.tsx', import.meta.url), 'utf8');
  assert.match(source, /Lead Engine/);
  assert.match(source, /Database/);
  assert.match(source, /Worker queue/);
  assert.doesNotMatch(source, /ContactOut.*Active/s);
});
```

- [ ] **Step 2: Implement authenticated health endpoint**

Use `requireWorkspace()`. Perform bounded queries only. Return:

```ts
{
  database: 'ready' | 'unavailable',
  auth: 'ready',
  workerQueue: { queued: number; leased: number; staleLeases: number },
  providerPhase: 'foundation-only'
}
```

Never expose raw credentials or database error details.

- [ ] **Step 3: Update Data Sources settings**

Add a top `Lead Engine` block showing database and queue state. Keep current source rows for compatibility. Browser enrichment stays unavailable until slice 3 actually configures it.

- [ ] **Step 4: Verify and commit**

```bash
npx tsx --test tests/lead-engine-foundation.test.ts
npm run typecheck
git add app/api/lead-engine/health/route.ts app/components/puma-data-sources-settings.tsx tests/lead-engine-foundation.test.ts
git commit -m "feat: expose lead engine foundation health"
```

---

### Task 8: Full verification and operational proof

**Files:**
- Change only files required to correct verification failures.

**Interfaces:**
- Proves the exact final branch head works through auth → import → run creation → lease → completion and remains secure.

- [ ] **Step 1: Run full repository verification**

```bash
npm test
npm run typecheck
npm run worker:typecheck
npm run build
```

- [ ] **Step 2: Run Supabase advisors**

Resolve migration-introduced missing RLS, security-definer/search-path issues, and high/critical security findings before completion.

- [ ] **Step 3: Exercise one development end-to-end path**

1. Authenticate as the test owner.
2. Confirm exactly one workspace row belongs to that user.
3. Import a small browser workspace twice; confirm canonical counts do not double.
4. `POST /api/lead-runs`; capture `runId`.
5. Start the Node worker with service-role credentials.
6. Confirm `system-health` moves `queued -> leased -> complete` and parent run reaches `completed`.
7. Lease a synthetic task, terminate worker before completion, allow lease expiry, restart worker, and confirm the task is reclaimed once.

- [ ] **Step 4: Run fresh GitHub Actions on the exact final SHA**

Do not call the slice ready until Tests, TypeScript, worker typecheck (once added to CI), and Next build pass for the exact head.

- [ ] **Step 5: Whole-slice review**

Check for service-role leakage, anonymous writes, permissive RLS, destructive import, repeated-import duplication, non-atomic leasing, long-running work inside Vercel routes, and UI claiming unconfigured providers are active.

## Completion Gate

Foundation is complete only when owner auth works, migration/RLS is advisor-clean for introduced issues, local workspace import is explicit/idempotent/manual-safe, lead-run creation is asynchronous/durable, worker leases are atomic/recoverable, secrets are server/worker-only, browser data remains available during migration, and full CI is green on the exact final SHA.

After this merges, write/review `docs/superpowers/plans/2026-09-24-lead-engine-v2-discovery-backbone.md` against the actual merged schema/worker interfaces before adding Brave, Exa, HUD, licensing, property, or other source adapters.
