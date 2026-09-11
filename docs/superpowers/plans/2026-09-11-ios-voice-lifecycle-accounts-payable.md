# Puma Utilities iOS, Voice, Lifecycle, and Accounts Payable Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the Puma Utilities PWA feel native on iPhone, repair the voice-note flow, reorganize Companies into the approved lifecycle views, and add an Accounts Payable foundation without disturbing existing CRM, monitoring, profile, Find Leads, or building behavior.

**Architecture:** Keep the existing Next.js 16 / React 19 local-workspace architecture. Add small pure helper modules for lifecycle grouping and AP calculations so behavior is testable, then update the existing `puma-workspace-app-v3.tsx` shell rather than rewriting the app. Keep voice capture client-side with a browser speech-recognition path plus the existing MediaRecorder/server-transcription path as fallback, and keep all existing local workspace data backward compatible.

**Tech Stack:** Next.js 16.2.12, React 19.2.3, TypeScript 5.9.2, `tsx --test`, Lucide React, Vercel.

**Spec:** `docs/superpowers/specs/2026-09-11-ios-voice-lifecycle-accounts-payable-design.md`

## Global Constraints

- Installed Home Screen icon stays unchanged.
- Existing company, building, notes, monitoring, profile, Find Leads, and bulk-selection behavior must remain available.
- `PipelineStage` gains `Not Interested` without invalidating existing stages.
- Accounts Payable is tracking only; it must not imply real payment processing or banking.
- Root document must not be the primary vertical scroll container on iPhone; the Puma app content region must own vertical scrolling.
- Intentional horizontal tab/chip strips must remain horizontally scrollable.
- Voice failures must surface explicit recoverable states instead of silently failing.
- No destructive migration of existing local workspace data.

---

### Task 1: Add lifecycle mapping and Accounts Payable domain helpers

**Files:**
- Modify: `lib/types.ts`
- Create: `lib/company-lifecycle.ts`
- Create: `lib/accounts-payable.ts`
- Create: `tests/company-lifecycle.test.ts`
- Create: `tests/accounts-payable.test.ts`
- Modify: `package.json`

**Interfaces:**
- Produces: `CompanyLifecycle = 'Prospects' | 'Contacted' | 'Not Interested' | 'Installations' | 'Active Clients'`
- Produces: `companyLifecycle(stage: PipelineStage): CompanyLifecycle`
- Produces: `AccountsPayableStatus`, `AccountsPayableItem`, and `Workspace.accountsPayable?: AccountsPayableItem[]`
- Produces: `summarizeAccountsPayable(items, now?)` returning `{ outstandingAmount, paidAmount, overdueCount }`

- [ ] **Step 1: Write failing lifecycle tests**

```ts
import test from 'node:test';
import assert from 'node:assert/strict';
import { companyLifecycle } from '../lib/company-lifecycle';

test('maps persisted pipeline stages into five company lifecycle views', () => {
  assert.equal(companyLifecycle('Target'), 'Prospects');
  assert.equal(companyLifecycle('Research'), 'Prospects');
  assert.equal(companyLifecycle('Qualified'), 'Prospects');
  assert.equal(companyLifecycle('Outreach'), 'Contacted');
  assert.equal(companyLifecycle('Follow-up'), 'Contacted');
  assert.equal(companyLifecycle('Pilot'), 'Contacted');
  assert.equal(companyLifecycle('Not Interested'), 'Not Interested');
  assert.equal(companyLifecycle('Installation'), 'Installations');
  assert.equal(companyLifecycle('Client'), 'Active Clients');
});
```

- [ ] **Step 2: Write failing AP summary tests**

```ts
import test from 'node:test';
import assert from 'node:assert/strict';
import { summarizeAccountsPayable } from '../lib/accounts-payable';

const items = [
  { id:'a', companyId:'c1', description:'August service', amount:500, currency:'USD', status:'Due', dueDate:'2026-09-01', createdAt:'2026-08-01', updatedAt:'2026-08-01' },
  { id:'b', companyId:'c1', description:'July service', amount:300, currency:'USD', status:'Paid', dueDate:'2026-08-01', paidAt:'2026-08-02', createdAt:'2026-07-01', updatedAt:'2026-08-02' },
] as const;

test('summarizes outstanding, paid and overdue accounts payable items', () => {
  assert.deepEqual(summarizeAccountsPayable(items, new Date('2026-09-11T12:00:00Z')), {
    outstandingAmount: 500,
    paidAmount: 300,
    overdueCount: 1,
  });
});
```

- [ ] **Step 3: Run the new tests and verify RED**

Run: `npx tsx --test tests/company-lifecycle.test.ts tests/accounts-payable.test.ts`
Expected: FAIL because the new modules/types do not exist.

- [ ] **Step 4: Add types and pure helpers**

`lib/types.ts` gains:

```ts
export type PipelineStage =
  | 'Target'
  | 'Research'
  | 'Qualified'
  | 'Outreach'
  | 'Follow-up'
  | 'Pilot'
  | 'Installation'
  | 'Client'
  | 'Not Interested'
  | 'Archived';

export type AccountsPayableStatus = 'Draft' | 'Due' | 'Paid' | 'Overdue' | 'Void';

export type AccountsPayableItem = {
  id: string;
  companyId: string;
  propertyId?: string;
  description: string;
  amount: number;
  currency: 'USD';
  status: AccountsPayableStatus;
  dueDate?: string;
  paidAt?: string;
  createdAt: string;
  updatedAt: string;
  note?: string;
};
```

and `Workspace` gains:

```ts
accountsPayable?: AccountsPayableItem[];
```

`lib/company-lifecycle.ts`:

```ts
import type { PipelineStage } from './types';

export type CompanyLifecycle = 'Prospects' | 'Contacted' | 'Not Interested' | 'Installations' | 'Active Clients';

export function companyLifecycle(stage: PipelineStage): CompanyLifecycle {
  if (stage === 'Client') return 'Active Clients';
  if (stage === 'Installation') return 'Installations';
  if (stage === 'Not Interested' || stage === 'Archived') return 'Not Interested';
  if (stage === 'Outreach' || stage === 'Follow-up' || stage === 'Pilot') return 'Contacted';
  return 'Prospects';
}
```

`lib/accounts-payable.ts` computes paid/outstanding/overdue without mutating records. Treat `Paid` and `Void` as non-outstanding; treat `Due`/`Overdue` items with a due date before `now` as overdue for summary purposes.

- [ ] **Step 5: Add the two tests to `npm test` and run them GREEN**

Update the `test` script to append `tests/company-lifecycle.test.ts tests/accounts-payable.test.ts`.

Run: `npm test`
Expected: PASS with all pre-existing tests plus the new tests.

- [ ] **Step 6: Commit**

```bash
git add lib/types.ts lib/company-lifecycle.ts lib/accounts-payable.ts tests/company-lifecycle.test.ts tests/accounts-payable.test.ts package.json
git commit -m "feat: add company lifecycle and accounts payable model"
```

---

### Task 2: Lock the iOS shell to the viewport and correct in-app Puma branding

**Files:**
- Modify: `app/ios-native.css`
- Modify: `app/components/puma-workspace-app-v3.tsx`
- Modify: `tests/ios-native-shell.test.ts`
- Create: `tests/puma-brand.test.ts`
- Modify: `package.json`

**Interfaces:**
- Consumes: existing `.pm-shell`, `.pm-content`, `.pm-page`, `.pm-brand-mark`, `.pm-filter-row`, `.pm-tabs`
- Produces: root viewport lock + `.pm-scroll-region` as the single primary vertical scroll container

- [ ] **Step 1: Extend the iOS regression test to require inner scrolling and root lock**

Assert the stylesheet includes all of:

```ts
assert.match(css, /html,\s*body\s*\{[^}]*height:\s*100%/s);
assert.match(css, /body\s*\{[^}]*overflow:\s*hidden/s);
assert.match(css, /\.pm-shell\s*\{[^}]*height:\s*100(?:svh|dvh)/s);
assert.match(css, /\.pm-scroll-region\s*\{[^}]*overflow-y:\s*auto/s);
assert.match(css, /\.pm-scroll-region\s*\{[^}]*overscroll-behavior-y:\s*none/s);
assert.match(css, /\.pm-filter-row[^}]*overflow-x:\s*auto/s);
assert.match(css, /\.pm-tabs[^}]*overflow-x:\s*auto/s);
```

- [ ] **Step 2: Add a branding regression test**

Read `puma-workspace-app-v3.tsx` and inline styles. Assert the in-app mark no longer uses `mix-blend-mode`, and `.pm-brand-mark` uses `background:var(--pm-bg)` or exact `#050607`.

- [ ] **Step 3: Run targeted tests and verify RED**

Run: `npx tsx --test tests/ios-native-shell.test.ts tests/puma-brand.test.ts`
Expected: FAIL on the missing inner scroll container and current brand treatment.

- [ ] **Step 4: Update the shell markup**

Wrap the route content in a dedicated content scroller inside the fixed shell:

```tsx
<main className="pm-shell">
  <AppBar ... />
  <div className="pm-scroll-region">
    <div className="pm-content">{content}</div>
  </div>
  <BottomNav ... />
  ...overlays
</main>
```

Do not place the fixed app bar, bottom nav, drawer, sheet, or toast inside `.pm-scroll-region`.

- [ ] **Step 5: Update `app/ios-native.css`**

Use a fixed-height application shell rather than document scrolling:

```css
html, body {
  width: 100%;
  height: 100%;
  overflow: hidden;
  overscroll-behavior: none;
  background: #050607;
}

body { margin: 0; }

.pm-shell {
  width: 100%;
  height: 100dvh;
  min-height: 100svh;
  overflow: hidden;
  overscroll-behavior: none;
  background: var(--pm-bg);
}

.pm-scroll-region {
  height: calc(100dvh - 58px - env(safe-area-inset-top));
  overflow-x: hidden;
  overflow-y: auto;
  overscroll-behavior-y: none;
  -webkit-overflow-scrolling: touch;
  padding-bottom: calc(88px + env(safe-area-inset-bottom));
}
```

Keep `.pm-filter-row` and `.pm-tabs` as the intentional `overflow-x:auto` regions.

- [ ] **Step 6: Remove the in-app logo blend hack**

Change `.pm-brand-mark` to use the Puma shell background and remove blend modes/filters that create a black tile or halo. Keep the existing Home Screen icon URL untouched. The visible in-app mark must sit on `var(--pm-bg)` and crop consistently in header, drawer, and bottom nav.

- [ ] **Step 7: Run targeted tests GREEN, then full tests**

Run:

```bash
npx tsx --test tests/ios-native-shell.test.ts tests/puma-brand.test.ts
npm test
```

Expected: both commands PASS.

- [ ] **Step 8: Commit**

```bash
git add app/ios-native.css app/components/puma-workspace-app-v3.tsx tests/ios-native-shell.test.ts tests/puma-brand.test.ts package.json
git commit -m "fix: make Puma shell native-feeling on iOS"
```

---

### Task 3: Make voice notes resilient without changing their destination semantics

**Files:**
- Modify: `lib/voice-notes.ts`
- Modify: `app/components/puma-workspace-app-v3.tsx`
- Modify: `tests/voice-notes.test.ts`
- Create: `tests/voice-fallback.test.ts`
- Modify: `package.json`

**Interfaces:**
- Consumes: `resolveVoiceDestination`, `/api/transcribe`, `addActivityNote`
- Produces: a browser speech-recognition adapter plus the existing MediaRecorder path
- Preserve destinations: property → company → Voice Inbox fallback order

- [ ] **Step 1: Add failing helper tests for transcript fallback decisions**

Add a pure helper to `lib/voice-notes.ts`:

```ts
export function chooseVoiceTranscript(input: {
  liveTranscript?: string;
  serverTranscript?: string;
}): string {
  return input.serverTranscript?.trim() || input.liveTranscript?.trim() || '';
}
```

Test server transcript wins when present, live speech transcript is used when server transcription is unavailable, and empty inputs return `''`.

- [ ] **Step 2: Run targeted tests and verify RED**

Run: `npx tsx --test tests/voice-notes.test.ts tests/voice-fallback.test.ts`
Expected: FAIL because `chooseVoiceTranscript` is absent.

- [ ] **Step 3: Implement the helper and normalize the state type**

Remove the duplicate legacy `'denied'` state from `VoicePhase`; retain `'permission-denied'`. Keep all existing state-machine events and transitions valid.

- [ ] **Step 4: Add a browser speech-recognition adapter in the component**

Inside `puma-workspace-app-v3.tsx`, define a narrow local browser type instead of adding a dependency:

```ts
type BrowserSpeechRecognition = {
  continuous: boolean;
  interimResults: boolean;
  lang: string;
  start(): void;
  stop(): void;
  abort(): void;
  onresult: ((event: any) => void) | null;
  onerror: ((event: any) => void) | null;
  onend: (() => void) | null;
};
```

Resolve `window.SpeechRecognition ?? window.webkitSpeechRecognition` through a guarded type assertion. When available, start it at the same user gesture that starts MediaRecorder; collect final transcript text in a ref. Stopping voice stops both systems.

- [ ] **Step 5: Merge live and server transcripts in `processAudio`**

Behavior:

1. If `/api/transcribe` succeeds, use server text.
2. If it returns 501 or fails but browser recognition produced text, open review with that text.
3. If neither produced text but audio was captured, open review with an empty editable note and a clear message such as `Recording captured. Add or edit the note before saving.`
4. Permission denied remains `permission-denied`; unsupported MediaRecorder with available browser recognition still permits a live-transcript-only session.

Do not silently set `error` merely because server transcription is not configured.

- [ ] **Step 6: Run voice tests GREEN and full suite**

Run:

```bash
npx tsx --test tests/voice-notes.test.ts tests/voice-fallback.test.ts
npm test
```

Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add lib/voice-notes.ts app/components/puma-workspace-app-v3.tsx tests/voice-notes.test.ts tests/voice-fallback.test.ts package.json
git commit -m "fix: make Puma voice notes resilient"
```

---

### Task 4: Replace Companies segmentation with the five approved lifecycle views

**Files:**
- Modify: `app/components/puma-workspace-app-v3.tsx`
- Create: `tests/company-lifecycle-ui.test.ts`
- Modify: `package.json`

**Interfaces:**
- Consumes: `companyLifecycle(stage)` from Task 1
- Produces: one horizontally scrollable lifecycle selector for `Prospects`, `Contacted`, `Not Interested`, `Installations`, `Active Clients`

- [ ] **Step 1: Write a failing source-level UI regression test**

Assert `puma-workspace-app-v3.tsx` contains all five lifecycle labels and no longer declares the old `Segment = 'prospects' | 'active'` model or `PIPELINE_FILTERS` row.

- [ ] **Step 2: Run targeted test and verify RED**

Run: `npx tsx --test tests/company-lifecycle-ui.test.ts`
Expected: FAIL against the current two-segment implementation.

- [ ] **Step 3: Replace component state**

Replace:

```ts
const [segment, setSegment] = useState<Segment>('prospects');
const [pipelineFilter, setPipelineFilter] = useState<PipelineFilter>('All');
```

with:

```ts
const [lifecycleView, setLifecycleView] = useState<CompanyLifecycle>('Prospects');
```

Build visible companies with:

```ts
const visibleCompanies = allCompanies
  .filter((company) => companyLifecycle(company.stage) === lifecycleView)
  .filter((company) => company.name.toLowerCase().includes(query.toLowerCase()) || (company.market ?? '').toLowerCase().includes(query.toLowerCase()));
```

- [ ] **Step 4: Replace the segmented + filter-row UI**

Use a single `.pm-lifecycle-tabs` horizontal strip. Each tab shows label and count. Keep Search directly below it. Company rows stay minimal and Select/bulk behavior remains unchanged.

- [ ] **Step 5: Make company detail lifecycle-aware**

On Overview, replace the old `Prospect`/`Active Client` binary status with `companyLifecycle(company.stage)`. Add a minimal lifecycle selector only if changing stage is already supported safely in the record; otherwise display the persisted lifecycle and do not invent a new editing interaction in this task.

- [ ] **Step 6: Run targeted and full tests**

Run:

```bash
npx tsx --test tests/company-lifecycle.test.ts tests/company-lifecycle-ui.test.ts tests/minimal-companies-ui.test.ts
npm test
```

Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add app/components/puma-workspace-app-v3.tsx tests/company-lifecycle-ui.test.ts package.json
git commit -m "feat: organize companies by lifecycle"
```

---

### Task 5: Add Accounts Payable route, drawer entry, and tracking UI

**Files:**
- Create: `app/accounts-payable/page.tsx`
- Modify: `app/components/puma-workspace-app-v3.tsx`
- Create: `tests/accounts-payable-routing.test.ts`
- Create: `tests/accounts-payable-ui.test.ts`
- Modify: `package.json`

**Interfaces:**
- Consumes: `Workspace.accountsPayable`, `summarizeAccountsPayable()`
- Produces: `PumaView` member `'accounts-payable'` and route `/accounts-payable`

- [ ] **Step 1: Write failing route/UI tests**

Routing test expects the page module to render:

```tsx
<PumaWorkspaceApp view="accounts-payable" />
```

UI test expects drawer ordering text `Find Leads` → `Accounts Payable` → `Settings`, plus page labels `Accounts Payable`, `Outstanding`, `Paid`, and `Overdue`.

- [ ] **Step 2: Run targeted tests and verify RED**

Run: `npx tsx --test tests/accounts-payable-routing.test.ts tests/accounts-payable-ui.test.ts`
Expected: FAIL because the route/view do not exist.

- [ ] **Step 3: Add the route**

`app/accounts-payable/page.tsx`:

```tsx
import PumaWorkspaceApp from '../components/puma-workspace-app';

export default function AccountsPayablePage() {
  return <PumaWorkspaceApp view="accounts-payable" />;
}
```

- [ ] **Step 4: Add the view and drawer entry**

Extend `PumaView` with `'accounts-payable'`. Add drawer link after Find Leads and before Settings. Use a Lucide receipt/wallet-style icon already available in the installed icon package; do not add a dependency.

- [ ] **Step 5: Build the AP page**

Use `workspace.accountsPayable ?? []`. Compute summary with `summarizeAccountsPayable`. Render a compact three-stat strip for outstanding amount, paid amount, overdue count, followed by a minimal list with company name, description, amount, due date, status. If no records exist, render `No accounts payable records yet.` without implying a broken integration.

Currency formatting:

```ts
new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(amount)
```

- [ ] **Step 6: Run AP tests and full suite**

Run:

```bash
npx tsx --test tests/accounts-payable.test.ts tests/accounts-payable-routing.test.ts tests/accounts-payable-ui.test.ts
npm test
```

Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add app/accounts-payable/page.tsx app/components/puma-workspace-app-v3.tsx tests/accounts-payable-routing.test.ts tests/accounts-payable-ui.test.ts package.json
git commit -m "feat: add accounts payable workspace"
```

---

### Task 6: Integration verification, review, preview, merge, and production verification

**Files:**
- Review all files changed in Tasks 1–5
- No new feature code unless verification exposes a regression

**Interfaces:**
- Consumes: all prior tasks
- Produces: verified preview and production deployment

- [ ] **Step 1: Run full local/CI-equivalent verification**

Run:

```bash
npm test
npm run typecheck
npm run build
```

Expected: zero failing tests, TypeScript exit 0, Next.js build exit 0.

- [ ] **Step 2: Review the branch diff against `main`**

Check specifically for:

- accidental changes to Find Leads behavior
- missing existing routes
- removed company/building/monitor/profile/bulk functionality
- dead imports/types after old segment/filter removal
- unsafe assumptions about optional `accountsPayable`
- voice state regressions or unhandled cleanup
- app-wide overflow returning through any CSS selector
- accidental change to the installed Home Screen icon

- [ ] **Step 3: Deploy/inspect the Vercel preview**

Verify HTTP 200 and expected shell markup for:

- `/`
- `/clients`
- at least one seeded company detail
- one building-list route and one building-detail route
- `/monitor`
- `/engine`
- `/accounts-payable`
- `/settings`

Also verify the production-like build serves the updated CSS and the transcription route still returns a controlled response when its server configuration is absent.

- [ ] **Step 4: Create PR and inspect the final patch**

Create a PR from `puma/ios-voice-lifecycle-ap` to `main`, inspect changed files and full diff, and confirm mergeability/CI status.

- [ ] **Step 5: Merge only after preview verification passes**

Use squash merge unless the repository's active workflow requires otherwise.

- [ ] **Step 6: Verify fresh production deployment**

Confirm the production deployment points to the merge commit, reaches READY, build logs show tests/typecheck/build passing, and fetch the same major routes from `https://puma-utilities.vercel.app`.

- [ ] **Step 7: Record the project-state checkpoint**

Update the running project summary with the production commit SHA, deployment ID, what changed, and any behavior still requiring physical-device verification (for example the exact iPhone rubber-band gesture and microphone permission UI).
