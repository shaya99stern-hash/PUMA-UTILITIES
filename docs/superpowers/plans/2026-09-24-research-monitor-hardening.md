# Puma Research + Monitor Hardening Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Harden Puma’s existing discovery/research backend, make research saves explicit and evidence-safe, and make authorized Monitor alerts drill into their exact building context without changing the product architecture.

**Architecture:** Keep the existing Next.js App Router, research graph/runner, local `Workspace`, and `buildMonitorAlerts` authorization boundary. Add one pure/injectable discovery service so partial upstream failures can be tested without HTTP/network dependence, strengthen the existing projection merge where manual and verified data collide, then wire compact diagnostics/save summaries into the existing V4 UI.

**Tech Stack:** Node >=20.9.0, TypeScript 5.9.2, Next.js 16.2.12, React 19.2.3, `tsx --test`, GitHub Actions.

**Spec:** `docs/superpowers/specs/2026-09-24-research-monitor-hardening-design.md`

## Global Constraints

- Do not replace the research graph or runner architecture.
- Do not add fabricated web scraping, contact guessing, or fake integrations.
- Do not auto-save research into CRM.
- Do not treat missing, blocked, redacted, ambiguous, or unavailable source data as a negative finding.
- Do not allow public research evidence to enter client-authorized monitoring.
- Do not redesign the entire Puma shell or CRM in this phase.
- Do not introduce a new external database or deployment dependency.
- Only `VERIFIED`/`SUPPORTED` research claims at the existing trust threshold may project to `verified-public` CRM facts.
- Only Client-stage companies with `client-authorized` readings may produce Monitor alerts.
- Preserve existing request-size, task-count, crawl-depth, concurrency, result-count, and research-budget bounds.

## Review Focus

1. **One discovery query fails while others work:** return trustworthy candidates from successful searches plus a warning; never fail the whole request. Covered in Task 1.
2. **Every discovery query fails:** return an operational error, not an empty “no companies found” success. Covered in Task 1.
3. **Verified research matches a manually entered contact/property:** keep the manual value/status manual unless a deliberate user action changes it; never relabel it `verified-public`. Covered in Task 2.
4. **The same research is saved twice:** second save must produce zero duplicate additions while preserving the same company identity. Covered in Task 2.
5. **An alert points at one property while another property exists:** render/link only the alert’s own `companyId` + `propertyId` and carry the authorized meter/read-period context. Covered in Task 4.

---

### Task 1: Partial-failure-tolerant discovery service

**Files:**
- Create: `lib/research/discovery-service.ts`
- Modify: `app/api/research/discover/route.ts`
- Create: `tests/research-monitor-hardening.test.ts`
- Modify: `package.json`

**Interfaces:**
- Consumes: `parseDiscoveryGeographies`, `aggregateDiscoveryCandidates`, `searchWeb(query, { limit, signal })`.
- Produces: `discoverCompanies(input, options)` returning `{ markets, queries, candidates, warnings, diagnostics }`, where diagnostics contains exact attempt/success/failure counts and successful backends.
- HTTP route returns status `502` only when every attempted search failed; partial success remains `200` with warnings.

- [ ] **Step 1: Add the new focused test file to `npm test` before implementation**

Update the `test` script in `package.json` so `tests/research-monitor-hardening.test.ts` runs immediately after `tests/research-productization.test.ts`.

- [ ] **Step 2: Write failing service tests for partial and total search failure**

Create `tests/research-monitor-hardening.test.ts` with these imports and tests:

```ts
import assert from 'node:assert/strict';
import test from 'node:test';
import { discoverCompanies } from '../lib/research/discovery-service';

const hit = {
  title: 'Reliable Property Group | Portfolio',
  url: 'https://reliable.example/portfolio',
  snippet: 'Owner-operator multifamily portfolio. Owns and manages communities.',
};

test('discovery keeps successful candidates when one query fails', async () => {
  let calls = 0;
  const outcome = await discoverCompanies(
    { geography: 'NJ, NY', minBuildings: 20, maxBuildings: 100, count: 10 },
    {
      search: async (query) => {
        calls += 1;
        if (calls === 1) throw new Error('temporary upstream failure');
        return { query, results: [hit], backend: 'duckduckgo-html' as const };
      },
    },
  );

  assert.equal(outcome.diagnostics.attempted, 4);
  assert.equal(outcome.diagnostics.failed, 1);
  assert.equal(outcome.diagnostics.succeeded, 3);
  assert.equal(outcome.warnings.length, 1);
  assert.ok(outcome.candidates.some((candidate) => candidate.website === 'https://reliable.example'));
});

test('discovery reports all searches failed instead of pretending no candidates exist', async () => {
  const outcome = await discoverCompanies(
    { geography: 'NJ', minBuildings: 20, maxBuildings: 100, count: 10 },
    { search: async () => { throw new Error('upstream unavailable'); } },
  );

  assert.equal(outcome.diagnostics.attempted, 2);
  assert.equal(outcome.diagnostics.succeeded, 0);
  assert.equal(outcome.diagnostics.failed, 2);
  assert.equal(outcome.candidates.length, 0);
  assert.equal(outcome.allFailed, true);
});
```

- [ ] **Step 3: Run the focused test and verify the intended red failure**

Run:

```bash
npx tsx --test tests/research-monitor-hardening.test.ts
```

Expected: FAIL because `../lib/research/discovery-service` does not exist yet.

- [ ] **Step 4: Implement the injectable discovery service**

Create `lib/research/discovery-service.ts` with this public shape and bounded behavior:

```ts
import { aggregateDiscoveryCandidates, parseDiscoveryGeographies, type DiscoverySearchHit } from './discovery-ranking';
import { searchWeb, type WebSearchResponse } from './web-search';

export type DiscoveryInput = {
  geography?: string;
  minBuildings?: number;
  maxBuildings?: number;
  count?: number;
};

export type DiscoveryDiagnostics = {
  attempted: number;
  succeeded: number;
  failed: number;
  backends: Array<WebSearchResponse['backend']>;
};

type SearchFunction = typeof searchWeb;

export async function discoverCompanies(
  input: DiscoveryInput,
  options: { search?: SearchFunction; signal?: AbortSignal } = {},
) {
  const search = options.search ?? searchWeb;
  const markets = parseDiscoveryGeographies(input.geography ?? 'NJ');
  const minBuildings = bounded(input.minBuildings, 20, 1, 1000);
  const maxBuildings = bounded(input.maxBuildings, 100, minBuildings, 5000);
  const count = bounded(input.count, 10, 1, 20);
  const querySpecs = markets.flatMap((geography) => [
    { geography, query: `real estate owner operator self managed portfolio ${minBuildings} ${maxBuildings} buildings ${geography}` },
    { geography, query: `multifamily commercial real estate owner principal owns manages portfolio properties ${geography}` },
  ]);

  const settled = await Promise.all(querySpecs.map(async (spec) => {
    try {
      const response = await search(spec.query, {
        limit: Math.min(20, Math.max(10, count * 2)),
        signal: options.signal,
      });
      return { ok: true as const, spec, response };
    } catch {
      return { ok: false as const, spec };
    }
  }));

  const successes = settled.filter((item): item is Extract<(typeof settled)[number], { ok: true }> => item.ok);
  const failures = settled.filter((item) => !item.ok);
  const hits: DiscoverySearchHit[] = successes.flatMap(({ spec, response }) =>
    response.results.map((result) => ({ geography: spec.geography, result })),
  );

  return {
    markets,
    queries: querySpecs.map((item) => item.query),
    candidates: aggregateDiscoveryCandidates(hits, count),
    warnings: failures.map((item) => `${item.spec.geography} discovery source was temporarily unavailable.`),
    diagnostics: {
      attempted: querySpecs.length,
      succeeded: successes.length,
      failed: failures.length,
      backends: [...new Set(successes.map((item) => item.response.backend))],
    } satisfies DiscoveryDiagnostics,
    allFailed: successes.length === 0 && failures.length > 0,
  };
}

function bounded(value: unknown, fallback: number, min: number, max: number): number {
  return typeof value === 'number' && Number.isFinite(value)
    ? Math.max(min, Math.min(max, Math.floor(value)))
    : fallback;
}
```

Do not return raw upstream exception text to the browser. The warning communicates operational degradation without leaking backend details or turning source failure into a factual finding.

- [ ] **Step 5: Make the route delegate to the service and distinguish all-failed from no-candidate**

Replace the duplicated market/query fanout in `app/api/research/discover/route.ts` with:

```ts
import { discoverCompanies } from '@/lib/research/discovery-service';

// after body parse
const outcome = await discoverCompanies({
  geography: typeof input.geography === 'string' ? input.geography : 'NJ',
  minBuildings: input.minBuildings as number | undefined,
  maxBuildings: input.maxBuildings as number | undefined,
  count: input.count as number | undefined,
}, { signal: request.signal });

if (outcome.allFailed) {
  return NextResponse.json({
    error: 'Lead discovery sources are temporarily unavailable.',
    warnings: outcome.warnings,
    diagnostics: outcome.diagnostics,
  }, { status: 502, headers: { 'Cache-Control': 'no-store' } });
}

return NextResponse.json({
  ...outcome,
  note: 'Discovery ranks repeated first-party domains across the selected markets. Discovery score is only a routing signal; deep research still verifies portfolio size, ownership/management, contacts, property facts, utilities and rates.',
}, { headers: { 'Cache-Control': 'no-store' } });
```

Retain the existing `MAX_BODY_BYTES` check, JSON parsing behavior, and 400 handling for invalid state codes.

- [ ] **Step 6: Run focused tests**

Run:

```bash
npx tsx --test tests/research-monitor-hardening.test.ts
```

Expected: PASS for both discovery tests.

- [ ] **Step 7: Commit Task 1**

```bash
git add package.json tests/research-monitor-hardening.test.ts lib/research/discovery-service.ts app/api/research/discover/route.ts
git commit -m "feat: harden lead discovery failures"
```

---

### Task 2: Idempotent, manual-data-safe research projection

**Files:**
- Modify: `tests/research-monitor-hardening.test.ts`
- Modify: `lib/research/workspace-projection.ts`

**Interfaces:**
- Consumes: `mergeResearchRunIntoWorkspace(workspace, result)` and current `EvidenceStatus` values including `user-entered`.
- Produces: the same `ResearchMergeSummary` shape and stable `companyId`, while repeat saves produce zero new additions and manually entered values are never silently relabeled as verified-public.

- [ ] **Step 1: Add a failing test that repeat save is idempotent**

Append a fixture helper and test using a company + person + property + utility claims. The test must save the same result twice and pin identity/count behavior:

```ts
import { addClaim, addEvidence, createResearchGraph, upsertEntity } from '../lib/research/graph';
import { emptyWorkspace } from '../lib/workspace';
import { mergeResearchRunIntoWorkspace } from '../lib/research/workspace-projection';
import type { ResearchRunResult } from '../lib/research/runner';

function projectionResult(): ResearchRunResult {
  const graph = createResearchGraph();
  upsertEntity(graph, { id: 'company:stable', kind: 'company', label: 'Stable Property Group', geography: 'NJ' });
  upsertEntity(graph, { id: 'person:stable', kind: 'person', label: 'Jane Owner', geography: 'NJ' });
  upsertEntity(graph, { id: 'property:stable', kind: 'property', label: '10 Main St, Newark, NJ 07102', geography: 'NJ' });
  const evidenceId = addEvidence(graph, {
    id: 'evidence:stable',
    sourceId: 'company-first-party-web',
    url: 'https://stable.example/portfolio',
    observedAt: '2026-09-24T10:00:00.000Z',
    authority: 'first-party',
    excerpt: 'Jane Owner; 10 Main St',
  });
  addClaim(graph, { id:'website', subjectId:'company:stable', fact:'company.website', value:'https://stable.example', state:'SUPPORTED', confidence:.9, evidenceIds:[evidenceId], observedAt:'2026-09-24T10:00:00.000Z' });
  addClaim(graph, { id:'dm', subjectId:'company:stable', fact:'person.decisionMaker', objectEntityId:'person:stable', state:'SUPPORTED', confidence:.9, evidenceIds:[evidenceId], observedAt:'2026-09-24T10:00:00.000Z' });
  addClaim(graph, { id:'role', subjectId:'person:stable', fact:'person.title', value:'Owner', state:'SUPPORTED', confidence:.9, evidenceIds:[evidenceId], observedAt:'2026-09-24T10:00:00.000Z' });
  addClaim(graph, { id:'manager', subjectId:'property:stable', fact:'property.manager', objectEntityId:'company:stable', state:'SUPPORTED', confidence:.9, evidenceIds:[evidenceId], observedAt:'2026-09-24T10:00:00.000Z' });
  return { graph, rootEntityId:'company:stable', tasksExecuted:3, complete:3, blocked:0, failed:0, results:[], rootCompleteness:.7, stopReason:'source-exhausted' };
}

test('saving equivalent research twice preserves identity and adds no duplicates', () => {
  const first = mergeResearchRunIntoWorkspace(emptyWorkspace(), projectionResult());
  const second = mergeResearchRunIntoWorkspace(first.workspace, projectionResult());

  assert.equal(second.summary.companyId, first.summary.companyId);
  assert.equal(second.workspace.companies.length, 1);
  assert.equal(second.workspace.properties.length, 1);
  assert.equal(second.workspace.companies[0].people.length, 1);
  assert.equal(second.summary.createdCompany, false);
  assert.equal(second.summary.peopleAdded, 0);
  assert.equal(second.summary.propertiesAdded, 0);
  assert.equal(second.summary.utilitiesAdded, 0);
  assert.equal(second.summary.parcelsAdded, 0);
  assert.equal(second.summary.tariffsAdded, 0);
});
```

Use the exact `addEvidence` signature exposed by `lib/research/graph.ts`; if it returns `void`, use the literal ID `evidence:stable` after insertion instead of assigning its return value. This is an API-shape adjustment, not a semantic change to the fixture.

- [ ] **Step 2: Add a failing test for user-entered contact/property preservation**

Append:

```ts
test('verified research does not silently relabel matching user-entered CRM values', () => {
  const workspace = emptyWorkspace();
  const first = mergeResearchRunIntoWorkspace(workspace, projectionResult());
  const company = first.workspace.companies[0];
  company.people = [{
    id: 'manual-person',
    name: 'Jane Owner',
    role: 'Manually entered role',
    email: 'manual@example.com',
    status: 'user-entered',
  }];
  const property = first.workspace.properties[0];
  property.address = { value: 'Manual address text', status: 'user-entered' };
  property.units = { value: 77, status: 'user-entered' };

  const merged = mergeResearchRunIntoWorkspace(first.workspace, projectionResult());
  const savedCompany = merged.workspace.companies.find((item) => item.id === company.id)!;
  const savedProperty = merged.workspace.properties.find((item) => item.id === property.id)!;

  assert.deepEqual(savedCompany.people, company.people);
  assert.equal(savedProperty.address.value, 'Manual address text');
  assert.equal(savedProperty.address.status, 'user-entered');
  assert.equal(savedProperty.units?.value, 77);
  assert.equal(savedProperty.units?.status, 'user-entered');
});
```

- [ ] **Step 3: Run focused tests and verify the safety test exposes the current merge bug if present**

Run:

```bash
npx tsx --test tests/research-monitor-hardening.test.ts
```

Expected before the fix: the manual-contact/property test fails if research projection spreads verified-public values over matching user-entered values.

- [ ] **Step 4: Protect user-entered people during merge**

Change `mergePeople` in `lib/research/workspace-projection.ts` to preserve a matching manual record exactly:

```ts
function mergePeople(existing: Person[], incoming: Person[]): Person[] {
  const map = new Map(existing.map((item) => [normalizeLabel(item.name), item]));
  for (const item of incoming) {
    const key = normalizeLabel(item.name);
    const current = map.get(key);
    if (current?.status === 'user-entered') {
      map.set(key, current);
      continue;
    }
    map.set(key, current ? { ...current, ...item, id: current.id } : item);
  }
  return [...map.values()];
}
```

This deliberately avoids attaching research provenance/status to a manually maintained person merely because the normalized name matches.

- [ ] **Step 5: Protect user-entered property evidence values during merge**

Replace `mergeProperties` with field-aware preservation:

```ts
function mergeProperties(existing: Property[], incoming: Property[]): Property[] {
  const next = [...existing];
  for (const property of incoming) {
    const index = next.findIndex((item) =>
      item.companyId === property.companyId && normalizeLabel(item.name) === normalizeLabel(property.name),
    );
    if (index < 0) {
      next.push(property);
      continue;
    }

    const current = next[index];
    next[index] = {
      ...current,
      ...property,
      id: current.id,
      createdAt: current.createdAt,
      address: current.address.status === 'user-entered' ? current.address : property.address,
      units: current.units?.status === 'user-entered' ? current.units : (property.units ?? current.units),
      grossSquareFeet: current.grossSquareFeet?.status === 'user-entered'
        ? current.grossSquareFeet
        : (property.grossSquareFeet ?? current.grossSquareFeet),
    };
  }
  return next;
}
```

Do not broaden this rule to inferred/unknown research data; trusted projection remains governed by the existing `trusted()` check.

- [ ] **Step 6: Run focused projection tests**

Run:

```bash
npx tsx --test tests/research-monitor-hardening.test.ts
```

Expected: discovery, idempotency, and manual-preservation tests all PASS.

- [ ] **Step 7: Commit Task 2**

```bash
git add tests/research-monitor-hardening.test.ts lib/research/workspace-projection.ts
git commit -m "fix: preserve manual CRM evidence on research save"
```

---

### Task 3: Find Leads diagnostics and save-to-company handoff

**Files:**
- Modify: `tests/research-monitor-hardening.test.ts`
- Modify: `app/components/puma-research-panel.tsx`
- Modify: `app/components/puma-workspace-app-v4.tsx` only if its `onSave` callback does not already return `merged.summary`.

**Interfaces:**
- Consumes: discovery payload `{ candidates, warnings, diagnostics }`, `ResearchRunResult`, and `onSave(result): ResearchMergeSummary`.
- Produces: partial-discovery warning UI, explicit deep-run stop diagnostics, save success summary, and direct `/clients/[companyId]` navigation.

- [ ] **Step 1: Add source-level UI regression assertions**

Append:

```ts
import { readFileSync } from 'node:fs';

test('Find Leads exposes partial discovery warnings and a direct saved-company handoff', () => {
  const panel = readFileSync(new URL('../app/components/puma-research-panel.tsx', import.meta.url), 'utf8');
  assert.match(panel, /warnings/);
  assert.match(panel, /stopReason/);
  assert.match(panel, /Save to Prospects/);
  assert.match(panel, /summary\.companyId/);
  assert.match(panel, /\/clients\//);
});
```

- [ ] **Step 2: Run the focused test and verify the new UI assertions fail**

Run:

```bash
npx tsx --test tests/research-monitor-hardening.test.ts
```

Expected: FAIL because the panel does not yet retain discovery warnings/save summary or render the company handoff.

- [ ] **Step 3: Extend panel state and discovery response typing**

In `app/components/puma-research-panel.tsx`, add:

```ts
import Link from 'next/link';

type DiscoveryDiagnostics = {
  attempted: number;
  succeeded: number;
  failed: number;
  backends: string[];
};

const [discoveryWarnings, setDiscoveryWarnings] = useState<string[]>([]);
const [discoveryDiagnostics, setDiscoveryDiagnostics] = useState<DiscoveryDiagnostics | null>(null);
const [saveSummary, setSaveSummary] = useState<ResearchMergeSummary | null>(null);
```

When starting discovery or deep research, clear stale `saveSummary`; when starting discovery, also clear stale warning/diagnostic state.

Parse the discovery payload as:

```ts
const payload = await response.json() as {
  candidates?: Candidate[];
  warnings?: string[];
  diagnostics?: DiscoveryDiagnostics;
  error?: string;
};
```

On success set both warning/diagnostic states. On HTTP failure, keep the server `error` as the primary message and do not present an empty candidate list as a valid no-results outcome.

- [ ] **Step 4: Make Save capture the merge summary and handle projection errors explicitly**

Replace the one-line save function with:

```ts
const save = () => {
  if (!result) return;
  try {
    const summary = onSave(result);
    setSaveSummary(summary);
    setStatus('saved');
    setError('');
  } catch (cause) {
    setStatus('idle');
    setError(cause instanceof Error ? cause.message : 'Could not save this research result.');
  }
};
```

Confirm `app/components/puma-workspace-app-v4.tsx` returns `merged.summary` from the callback:

```ts
<PumaResearchPanel onSave={(result) => {
  const merged = mergeResearchRunIntoWorkspace(workspace!, result);
  saveWorkspace(merged.workspace);
  setWorkspace(merged.workspace);
  return merged.summary;
}} />
```

Do not navigate automatically after saving; the user explicitly chooses the company handoff.

- [ ] **Step 5: Render compact partial-success and research-run diagnostics**

Near the candidate list, render a warning only when `discoveryWarnings.length > 0`:

```tsx
{discoveryWarnings.length > 0 && (
  <div className="pm-research-error" role="status">
    <strong>Partial discovery</strong>
    <span>{discoveryDiagnostics?.succeeded ?? 0} of {discoveryDiagnostics?.attempted ?? 0} searches completed. Results below come only from successful searches.</span>
  </div>
)}
```

In the dossier header, extend the existing run metadata with the server-provided stop reason:

```tsx
<p>
  {Math.round(result.rootCompleteness * 100)}% core completeness · {result.tasksExecuted} tasks ·
  {' '}{result.budgetUnitsSpent ?? 0}/{result.maxBudgetUnits ?? '—'} effort units ·
  {' '}{result.blocked} blocked · {result.failed} failed · stopped: {result.stopReason}
</p>
```

Do not convert blocked/failed counts into claims about the company.

- [ ] **Step 6: Render the save summary and direct company link**

Immediately after a successful save, render:

```tsx
{saveSummary && (
  <div className="pm-research-section pm-research-save-summary" role="status">
    <span>{saveSummary.createdCompany ? 'Prospect created' : 'Prospect updated'}</span>
    <div>
      <strong>Saved to Puma CRM</strong>
      <small>
        {saveSummary.peopleAdded} contacts · {saveSummary.propertiesAdded} buildings ·
        {' '}{saveSummary.utilitiesAdded} utilities · {saveSummary.parcelsAdded} parcels ·
        {' '}{saveSummary.tariffsAdded} tariffs added
      </small>
    </div>
    <Link href={`/clients/${encodeURIComponent(saveSummary.companyId)}`}>Open company</Link>
  </div>
)}
```

Keep `Save to Prospects` user-triggered; no `useEffect` or automatic persistence is added.

- [ ] **Step 7: Run focused UI tests**

Run:

```bash
npx tsx --test tests/research-monitor-hardening.test.ts
```

Expected: all tests through Task 3 PASS.

- [ ] **Step 8: Commit Task 3**

```bash
git add tests/research-monitor-hardening.test.ts app/components/puma-research-panel.tsx app/components/puma-workspace-app-v4.tsx
git commit -m "feat: connect research save to CRM handoff"
```

---

### Task 4: Authorized Monitor context and exact building drill-down

**Files:**
- Modify: `lib/types.ts`
- Modify: `lib/monitor.ts`
- Modify: `tests/monitor-alerts.test.ts`
- Modify: `tests/research-monitor-hardening.test.ts`
- Modify: `app/components/puma-workspace-app-v4.tsx`

**Interfaces:**
- Consumes: existing Client-stage + `client-authorized` reading gate.
- Produces: `MonitorAlert` with `readingId`, `meterLabel`, and optional `periodStart`, while preserving existing IDs/status/provenance; Monitor list links through `buildingDetailPath(alert.companyId, alert.propertyId)`.

- [ ] **Step 1: Strengthen runtime Monitor alert assertions before implementation**

In `tests/monitor-alerts.test.ts`, after the existing three-alert assertions, add:

```ts
assert.ok(alerts.every((alert) => alert.readingId === 'authorized-reading'));
assert.ok(alerts.every((alert) => alert.meterLabel === 'Authorized meter'));
assert.ok(alerts.every((alert) => alert.periodEnd === '2026-09-10T00:00:00.000Z'));
```

Also add a non-client regression:

```ts
test('authorized readings still cannot alert for a prospect-stage company', () => {
  const workspace = createReleaseOneWorkspace();
  const company = workspace.companies[0];
  company.stage = 'Research';
  assert.deepEqual(buildMonitorAlerts(workspace), []);
});
```

- [ ] **Step 2: Add a source-level exact-route assertion**

Append to `tests/research-monitor-hardening.test.ts`:

```ts
test('Monitor renders exact alert building drill-down and meter context', () => {
  const source = readFileSync(new URL('../app/components/puma-workspace-app-v4.tsx', import.meta.url), 'utf8');
  assert.match(source, /buildingDetailPath\(alert\.companyId, alert\.propertyId\)/);
  assert.match(source, /alert\.meterLabel/);
  assert.match(source, /alert\.periodEnd/);
});
```

- [ ] **Step 3: Run focused tests and verify the missing alert fields fail TypeScript/test compilation**

Run:

```bash
npx tsx --test tests/monitor-alerts.test.ts tests/research-monitor-hardening.test.ts
```

Expected: FAIL because `MonitorAlert` does not yet expose `readingId` or `meterLabel`, and the V4 Monitor list does not link each alert.

- [ ] **Step 4: Extend `MonitorAlert` with authorized-reading context**

In `lib/types.ts` change the alert type to:

```ts
export type MonitorAlert = {
  id: string;
  companyId: string;
  propertyId: string;
  meterId: string;
  readingId: string;
  meterLabel: string;
  kind: AlertKind;
  title: string;
  detail: string;
  periodStart?: string;
  periodEnd?: string;
  status: 'client-authorized';
  provenanceId?: string;
};
```

- [ ] **Step 5: Populate context only from the already-authorized reading**

In `lib/monitor.ts`, extend the `base` object inside the existing `.filter((reading) => reading.status === 'client-authorized')` loop:

```ts
const base = {
  companyId: company.id,
  propertyId: property.id,
  meterId: meter.id,
  readingId: reading.id,
  meterLabel: meter.label,
  periodStart: reading.periodStart,
  periodEnd: reading.periodEnd,
  status: 'client-authorized' as const,
  provenanceId: reading.provenanceId,
};
```

Do not move this construction outside the authorized-reading filter and do not add research/estimated data as alternate alert inputs.

- [ ] **Step 6: Make every V4 Monitor alert link to its exact building**

Replace the current plain alert article content with this structure while retaining the existing Puma classes:

```tsx
{alerts.map((alert) => {
  const property = workspace!.properties.find((item) => item.id === alert.propertyId);
  return (
    <article key={alert.id}>
      <Bell size={17} />
      <div>
        <strong>{alert.title}</strong>
        <span>{property?.name || 'Building'} · {alert.detail}</span>
        <small>
          {alert.meterLabel}
          {alert.periodStart || alert.periodEnd
            ? ` · ${[alert.periodStart, alert.periodEnd].filter(Boolean).join(' → ')}`
            : ''}
        </small>
      </div>
      <Link href={buildingDetailPath(alert.companyId, alert.propertyId)} aria-label={`Open ${property?.name || 'building'}`}>
        <ChevronRight size={18} />
      </Link>
    </article>
  );
})}
```

This route must be derived from the alert IDs, not the currently selected company/building state.

- [ ] **Step 7: Run Monitor + hardening tests**

Run:

```bash
npx tsx --test tests/monitor-alerts.test.ts tests/research-monitor-hardening.test.ts
```

Expected: PASS.

- [ ] **Step 8: Commit Task 4**

```bash
git add lib/types.ts lib/monitor.ts tests/monitor-alerts.test.ts tests/research-monitor-hardening.test.ts app/components/puma-workspace-app-v4.tsx
git commit -m "feat: add authorized monitor drill-down context"
```

---

### Task 5: Whole-branch regression and CI gate

**Files:**
- Modify only files proven necessary by the verification failures; do not perform unrelated cleanup.

**Interfaces:**
- Consumes: final branch head after Tasks 1–4.
- Produces: a branch where repository tests, TypeScript, and production Next build all pass and GitHub Actions is green on the exact final SHA.

- [ ] **Step 1: Run the complete repository test suite**

```bash
npm test
```

Expected: all configured Node/tsx tests PASS, including `tests/research-monitor-hardening.test.ts`.

- [ ] **Step 2: Run TypeScript independently**

```bash
npm run typecheck
```

Expected: exit code 0 with no TypeScript errors.

- [ ] **Step 3: Run the production build**

```bash
npm run build
```

Expected: test gate, typecheck gate, and Next.js production build all PASS.

- [ ] **Step 4: Inspect the final diff against merged `main`**

The intended product-code diff should be limited to:

```text
app/api/research/discover/route.ts
app/components/puma-research-panel.tsx
app/components/puma-workspace-app-v4.tsx
lib/research/discovery-service.ts
lib/research/workspace-projection.ts
lib/monitor.ts
lib/types.ts
package.json
tests/research-monitor-hardening.test.ts
tests/monitor-alerts.test.ts
```

plus the already committed design/plan documents. Any other product file requires a concrete test/build reason before it stays in the branch.

- [ ] **Step 5: Push/observe GitHub Actions on the final branch head**

Require the repository CI job to show all three gates green on the exact final SHA:

```text
Tests: success
TypeScript: success
Next build: success
```

Do not claim live/deployed behavior from CI alone. This phase is source/CI verification unless a later request explicitly adds deployment/browser verification.

- [ ] **Step 6: Final review checkpoint**

Re-read `docs/superpowers/specs/2026-09-24-research-monitor-hardening-design.md` against the final diff and verify:

```text
partial discovery survives
all-failed discovery errors
research remains bounded
auto-save is absent
repeat save is idempotent
user-entered evidence is preserved
save summary links to exact company
Monitor authorization gate is unchanged
Monitor links to exact alert building
public research cannot manufacture alerts
```

If all checks pass, report the final branch SHA and GitHub Actions run ID for the user to open/merge as the next PR.