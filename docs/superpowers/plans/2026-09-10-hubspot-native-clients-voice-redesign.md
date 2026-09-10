# Puma Utilities HubSpot-Native Clients + Voice Redesign Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Refactor Puma Utilities into a cleaner HubSpot-like mobile CRM flow with Home / Clients / Monitor navigation, first-class building drill-down, and a reliable microphone capture/transcription workflow.

**Architecture:** Keep the existing Next.js App Router and local workspace persistence, but split business rules for client segmentation/status mapping and voice routing/state into focused library modules so they can be tested independently. Keep the current `PumaWorkspaceApp` shell, simplify its presentation, add nested building routes, and add a server transcription endpoint that only activates when a provider secret is configured; otherwise the UI reports that transcription is unavailable instead of pretending it worked.

**Tech Stack:** Next.js 16 App Router, React 19, TypeScript 5.9, lucide-react, browser `MediaRecorder` / `getUserMedia`, optional server-side transcription endpoint, local workspace persistence, Vercel.

**Spec:** `docs/superpowers/specs/2026-09-10-hubspot-native-clients-voice-redesign.md`

## Global Constraints

- Bottom navigation must be exactly Home / Clients / Monitor.
- `Clients` is the umbrella workspace for prospects and active clients.
- Prospect filters must surface: All, Needs Outreach, Contacted, Follow-up, Negotiation, Installation.
- Active Clients are a separate top-level segment inside Clients.
- Keep black / near-black background, restrained orange accent, thin typography, subtle borders, little blur, minimal shadows.
- Interactive hit targets must be at least 44×44 px; main rows should target roughly 52–56 px minimum height.
- Preserve all existing workspace data and authorization boundaries.
- Unknown utility/meter data stays Unknown and must never become a negative finding.
- Do not claim live public-web scraping unless a real provider is connected and verified.
- Do not upload or retain microphone audio invisibly.

---

### Task 1: Client segmentation and prospect status mapping

**Files:**
- Create: `lib/client-presentation.ts`
- Create: `tests/client-presentation.test.ts`
- Modify: `package.json`

**Interfaces:**
- Consumes: existing `Company`, `PipelineStage`, and `Workspace` types from `lib/types.ts`.
- Produces:
  - `type ClientSegment = 'prospects' | 'active'`
  - `type ProspectStatus = 'All' | 'Needs Outreach' | 'Contacted' | 'Follow-up' | 'Negotiation' | 'Installation'`
  - `function clientSegmentFor(company: Company): ClientSegment`
  - `function prospectStatusFor(company: Company): Exclude<ProspectStatus, 'All'>`
  - `function matchesProspectStatus(company: Company, status: ProspectStatus): boolean`

- [ ] **Step 1: Write the failing tests**

```ts
import test from 'node:test';
import assert from 'node:assert/strict';
import { clientSegmentFor, prospectStatusFor, matchesProspectStatus } from '../lib/client-presentation';
import type { Company } from '../lib/types';

function company(stage: Company['stage']): Company {
  return {
    id: `company-${stage}`,
    name: stage,
    stage,
    people: [],
    provenance: [],
    createdAt: '2026-09-10T00:00:00.000Z',
    updatedAt: '2026-09-10T00:00:00.000Z',
  } as Company;
}

test('Client stage is shown under Active Clients', () => {
  assert.equal(clientSegmentFor(company('Client')), 'active');
});

test('research and target stages map to Needs Outreach', () => {
  assert.equal(prospectStatusFor(company('Target')), 'Needs Outreach');
  assert.equal(prospectStatusFor(company('Research')), 'Needs Outreach');
});

test('outreach maps to Contacted', () => {
  assert.equal(prospectStatusFor(company('Outreach')), 'Contacted');
});

test('follow-up maps to Follow-up', () => {
  assert.equal(prospectStatusFor(company('Follow-up')), 'Follow-up');
});

test('qualified and pilot map to Negotiation', () => {
  assert.equal(prospectStatusFor(company('Qualified')), 'Negotiation');
  assert.equal(prospectStatusFor(company('Pilot')), 'Negotiation');
});

test('installation maps to Installation', () => {
  assert.equal(prospectStatusFor(company('Installation')), 'Installation');
});

test('All matches every prospect but not active clients', () => {
  assert.equal(matchesProspectStatus(company('Research'), 'All'), true);
  assert.equal(matchesProspectStatus(company('Client'), 'All'), false);
});
```

- [ ] **Step 2: Run the new test and verify it fails**

Run: `npx tsx --test tests/client-presentation.test.ts`
Expected: FAIL because `lib/client-presentation.ts` does not exist.

- [ ] **Step 3: Implement the mapping module**

```ts
import type { Company } from './types';

export type ClientSegment = 'prospects' | 'active';
export type ProspectStatus = 'All' | 'Needs Outreach' | 'Contacted' | 'Follow-up' | 'Negotiation' | 'Installation';

export function clientSegmentFor(company: Company): ClientSegment {
  return company.stage === 'Client' ? 'active' : 'prospects';
}

export function prospectStatusFor(company: Company): Exclude<ProspectStatus, 'All'> {
  switch (company.stage) {
    case 'Target':
    case 'Research':
      return 'Needs Outreach';
    case 'Outreach':
      return 'Contacted';
    case 'Follow-up':
      return 'Follow-up';
    case 'Qualified':
    case 'Pilot':
      return 'Negotiation';
    case 'Installation':
      return 'Installation';
    case 'Client':
      return 'Contacted';
    case 'Archived':
      return 'Needs Outreach';
  }
}

export function matchesProspectStatus(company: Company, status: ProspectStatus): boolean {
  if (clientSegmentFor(company) !== 'prospects') return false;
  return status === 'All' || prospectStatusFor(company) === status;
}
```

- [ ] **Step 4: Add the new test to the repository test script**

Update `package.json` so `npm test` includes `tests/client-presentation.test.ts` in addition to the existing test files.

- [ ] **Step 5: Run tests**

Run: `npm test`
Expected: all existing tests plus the new client-presentation tests PASS.

- [ ] **Step 6: Commit**

```bash
git add lib/client-presentation.ts tests/client-presentation.test.ts package.json
git commit -m "feat: add client lifecycle presentation mapping"
```

---

### Task 2: Voice capture state and context routing

**Files:**
- Create: `lib/voice-notes.ts`
- Create: `tests/voice-notes.test.ts`
- Create: `app/api/transcribe/route.ts`
- Modify: `package.json`

**Interfaces:**
- Consumes: existing workspace note-writing path `addActivityNote` from `lib/client-workflow.ts`.
- Produces:
  - `type VoicePhase = 'idle' | 'requesting' | 'recording' | 'processing' | 'review' | 'saved' | 'permission-denied' | 'unsupported' | 'error'`
  - `type VoiceContext = { companyId?: string; propertyId?: string }`
  - `function resolveVoiceDestination(context: VoiceContext): 'property' | 'company' | 'inbox'`
  - `function nextVoicePhase(current: VoicePhase, event: VoiceEvent): VoicePhase`
  - POST `/api/transcribe` accepting `multipart/form-data` field `audio` and returning `{ transcript: string }` when provider configuration exists, otherwise HTTP 501 with `{ error: 'transcription_not_configured' }`.

- [ ] **Step 1: Write failing unit tests for context routing and phase transitions**

```ts
import test from 'node:test';
import assert from 'node:assert/strict';
import { nextVoicePhase, resolveVoiceDestination } from '../lib/voice-notes';

test('property context wins over company context', () => {
  assert.equal(resolveVoiceDestination({ companyId: 'c1', propertyId: 'p1' }), 'property');
});

test('company context saves to company when no property is selected', () => {
  assert.equal(resolveVoiceDestination({ companyId: 'c1' }), 'company');
});

test('no record context routes to voice inbox', () => {
  assert.equal(resolveVoiceDestination({}), 'inbox');
});

test('voice phase follows permission -> recording -> processing -> review -> saved', () => {
  let phase = nextVoicePhase('idle', 'START');
  assert.equal(phase, 'requesting');
  phase = nextVoicePhase(phase, 'PERMISSION_GRANTED');
  assert.equal(phase, 'recording');
  phase = nextVoicePhase(phase, 'STOP');
  assert.equal(phase, 'processing');
  phase = nextVoicePhase(phase, 'TRANSCRIPT_READY');
  assert.equal(phase, 'review');
  phase = nextVoicePhase(phase, 'SAVE');
  assert.equal(phase, 'saved');
});

test('permission denial is explicit', () => {
  assert.equal(nextVoicePhase('requesting', 'PERMISSION_DENIED'), 'permission-denied');
});
```

- [ ] **Step 2: Run the voice tests and verify they fail**

Run: `npx tsx --test tests/voice-notes.test.ts`
Expected: FAIL because `lib/voice-notes.ts` does not exist.

- [ ] **Step 3: Implement the pure state module**

```ts
export type VoicePhase = 'idle' | 'requesting' | 'recording' | 'processing' | 'review' | 'saved' | 'permission-denied' | 'unsupported' | 'error';
export type VoiceEvent = 'START' | 'PERMISSION_GRANTED' | 'PERMISSION_DENIED' | 'STOP' | 'TRANSCRIPT_READY' | 'SAVE' | 'CANCEL' | 'UNSUPPORTED' | 'FAIL';
export type VoiceContext = { companyId?: string; propertyId?: string };

export function resolveVoiceDestination(context: VoiceContext) {
  if (context.propertyId) return 'property' as const;
  if (context.companyId) return 'company' as const;
  return 'inbox' as const;
}

export function nextVoicePhase(current: VoicePhase, event: VoiceEvent): VoicePhase {
  if (event === 'PERMISSION_DENIED') return 'permission-denied';
  if (event === 'UNSUPPORTED') return 'unsupported';
  if (event === 'FAIL') return 'error';
  if (event === 'CANCEL') return 'idle';
  if (current === 'idle' && event === 'START') return 'requesting';
  if (current === 'requesting' && event === 'PERMISSION_GRANTED') return 'recording';
  if (current === 'recording' && event === 'STOP') return 'processing';
  if (current === 'processing' && event === 'TRANSCRIPT_READY') return 'review';
  if (current === 'review' && event === 'SAVE') return 'saved';
  return current;
}
```

- [ ] **Step 4: Implement the transcription endpoint with explicit configuration behavior**

`app/api/transcribe/route.ts` must:

```ts
import { NextResponse } from 'next/server';

export async function POST(request: Request) {
  const form = await request.formData();
  const audio = form.get('audio');
  if (!(audio instanceof File) || audio.size === 0) {
    return NextResponse.json({ error: 'audio_required' }, { status: 400 });
  }

  const endpoint = process.env.PUMA_TRANSCRIPTION_ENDPOINT;
  const token = process.env.PUMA_TRANSCRIPTION_TOKEN;
  if (!endpoint || !token) {
    return NextResponse.json({ error: 'transcription_not_configured' }, { status: 501 });
  }

  const upstream = new FormData();
  upstream.set('file', audio, audio.name || 'voice-note.webm');
  const response = await fetch(endpoint, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}` },
    body: upstream,
  });
  if (!response.ok) {
    return NextResponse.json({ error: 'transcription_failed' }, { status: 502 });
  }
  const payload = await response.json() as { transcript?: string; text?: string };
  const transcript = (payload.transcript ?? payload.text ?? '').trim();
  if (!transcript) return NextResponse.json({ error: 'empty_transcript' }, { status: 502 });
  return NextResponse.json({ transcript });
}
```

This is provider-agnostic; no credential is committed. Browser speech recognition may remain only as a secondary fallback in Task 4.

- [ ] **Step 5: Add the voice test file to `npm test` and run tests**

Run: `npm test`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add lib/voice-notes.ts tests/voice-notes.test.ts app/api/transcribe/route.ts package.json
git commit -m "feat: add reliable voice note state and transcription boundary"
```

---

### Task 3: Add nested building routes

**Files:**
- Create: `app/clients/[companyId]/buildings/page.tsx`
- Create: `app/clients/[companyId]/buildings/[propertyId]/page.tsx`
- Modify: `app/components/puma-workspace-app.tsx`
- Create: `tests/building-routing.test.ts`
- Modify: `package.json`

**Interfaces:**
- Produces two linkable routes:
  - `/clients/[companyId]/buildings`
  - `/clients/[companyId]/buildings/[propertyId]`
- Extend `PumaWorkspaceAppProps` with optional `propertyId?: string` and `subview?: 'company' | 'buildings' | 'building'`.

- [ ] **Step 1: Add a failing route-shape test**

```ts
import test from 'node:test';
import assert from 'node:assert/strict';

const buildingListPath = (companyId: string) => `/clients/${companyId}/buildings`;
const buildingDetailPath = (companyId: string, propertyId: string) => `/clients/${companyId}/buildings/${propertyId}`;

test('building routes are stable and nested under clients', () => {
  assert.equal(buildingListPath('c1'), '/clients/c1/buildings');
  assert.equal(buildingDetailPath('c1', 'p1'), '/clients/c1/buildings/p1');
});
```

- [ ] **Step 2: Create the App Router pages**

`app/clients/[companyId]/buildings/page.tsx`:

```tsx
import PumaWorkspaceApp from '@/app/components/puma-workspace-app';

export default async function BuildingsPage({ params }: { params: Promise<{ companyId: string }> }) {
  const { companyId } = await params;
  return <PumaWorkspaceApp view="clients" companyId={companyId} subview="buildings" />;
}
```

`app/clients/[companyId]/buildings/[propertyId]/page.tsx`:

```tsx
import PumaWorkspaceApp from '@/app/components/puma-workspace-app';

export default async function BuildingPage({ params }: { params: Promise<{ companyId: string; propertyId: string }> }) {
  const { companyId, propertyId } = await params;
  return <PumaWorkspaceApp view="clients" companyId={companyId} propertyId={propertyId} subview="building" />;
}
```

- [ ] **Step 3: Extend `PumaWorkspaceApp` props without changing existing route behavior**

Add:

```ts
type PumaWorkspaceAppProps = {
  view: PumaView;
  companyId?: string;
  propertyId?: string;
  subview?: 'company' | 'buildings' | 'building';
};
```

The existing `/clients/[companyId]` continues to render the company Overview by default.

- [ ] **Step 4: Add test to `npm test`, run tests and typecheck**

Run:

```bash
npm test
npm run typecheck
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add app/clients/[companyId]/buildings app/components/puma-workspace-app.tsx tests/building-routing.test.ts package.json
git commit -m "feat: add client building drill-down routes"
```

---

### Task 4: Refactor the app shell and Clients UX

**Files:**
- Modify: `app/components/puma-workspace-app.tsx`
- Modify: `app/globals.css`
- Modify: `lib/client-presentation.ts`
- Test: `tests/client-presentation.test.ts`

**Interfaces:**
- Consumes `clientSegmentFor`, `prospectStatusFor`, `matchesProspectStatus` from Task 1.
- Consumes building routes from Task 3.
- Produces the approved interaction hierarchy and mobile sizing.

- [ ] **Step 1: Replace naming and navigation labels**

In `VIEW_TITLES`, use:

```ts
const VIEW_TITLES: Record<PumaView, string> = {
  home: 'Puma Utilities',
  clients: 'Clients',
  monitor: 'Monitor',
  engine: 'Research Engine',
  settings: 'Settings',
};
```

Bottom nav labels must be exactly `Home`, `Clients`, `Monitor`. Side-menu labels must not use `CRM` or `Leads & CRM`.

- [ ] **Step 2: Replace the Clients index with two top-level segments**

Add state:

```ts
const [clientSegment, setClientSegment] = useState<ClientSegment>('prospects');
const [prospectStatus, setProspectStatus] = useState<ProspectStatus>('All');
```

Filter companies using `clientSegmentFor(company)` and `matchesProspectStatus(company, prospectStatus)`. Render a two-button segmented control `Prospects | Active Clients`. Render prospect chips only when `clientSegment === 'prospects'`.

Each row should show only:

```tsx
<strong>{company.name}</strong>
<small>{formatPortfolio(company)} · {company.market ?? 'Market unknown'}</small>
<span>{clientSegment === 'prospects' ? prospectStatusFor(company) : 'Active Client'}</span>
<span>{company.nextAction ?? `Last contact ${readableDate(company.lastContactAt)}`}</span>
```

Bulk selection is preserved but visually secondary.

- [ ] **Step 3: Add a clear `Find Leads` action**

Place a compact `Find Leads` button in the Clients header that routes to `/engine`. Its supporting copy must say the current release uses verified/public-source research inputs and must not claim that live web scraping is active unless a provider is actually connected.

- [ ] **Step 4: Replace the long company record with tabbed record navigation**

Add internal company tab state:

```ts
type CompanyTab = 'overview' | 'contacts' | 'buildings' | 'activity';
const [companyTab, setCompanyTab] = useState<CompanyTab>('overview');
```

The company header must show Back to Clients, company name, status, and compact call/email/stage actions. Below it render tabs `Overview`, `Contacts`, `Buildings`, `Activity`.

Overview shows only portfolio, status, next action, last contact, installation summary, and meter coverage summary.
Contacts shows decision makers and call/email actions.
Buildings tab uses a clear row/link to `/clients/${company.id}/buildings` and may show a short preview count.
Activity shows notes/calls/voice transcripts chronologically.
Move evidence/scoring into a secondary collapsed `Research details` disclosure on Overview.

- [ ] **Step 5: Implement building list and building detail rendering**

For `subview === 'buildings'`, render:

```tsx
<Link href={`/clients/${company.id}`}>Back to {company.name}</Link>
<h1>Buildings</h1>
```

Then one row per property with name, address, market/state, utility status, smart-meter status, and chevron to `/clients/${company.id}/buildings/${property.id}`.

For `subview === 'building'`, find the selected property by both `companyId` and `propertyId`; render address, water provider, meter capability/status, portal/data access, installation summary if relevant, property activity, and a clear Monitor handoff only when client-authorized data is present.

- [ ] **Step 6: Simplify visual density and increase phone usability**

In `app/globals.css`:

```css
.appbar {
  background: #050607;
  box-shadow: none;
}

.appbar-title,
.home-intro,
.menu-brand {
  background: transparent;
}

.bottom-nav a,
.segmented-control button,
.client-row,
.building-row {
  min-height: 52px;
}

.icon-button,
.voice-trigger,
.contact-actions a,
.select-lead {
  min-width: 44px;
  min-height: 44px;
}

.client-row strong,
.building-row strong { font-size: 15px; }
.client-row small,
.building-row small { font-size: 12px; }
.segmented-control button,
.prospect-chip { min-height: 36px; }
```

Remove decorative backgrounds around the Home Puma mark so it blends into black. Reduce gradients, large dashboard cards, and excess blur while retaining subtle borders.

- [ ] **Step 7: Run tests, typecheck, and build**

```bash
npm test
npm run typecheck
npm run build
```

Expected: all PASS.

- [ ] **Step 8: Commit**

```bash
git add app/components/puma-workspace-app.tsx app/globals.css lib/client-presentation.ts tests/client-presentation.test.ts
git commit -m "feat: redesign clients workspace and navigation"
```

---

### Task 5: Replace floating voice dock with top-right microphone and real recording flow

**Files:**
- Modify: `app/components/puma-workspace-app.tsx`
- Modify: `app/globals.css`
- Modify: `lib/voice-notes.ts`
- Test: `tests/voice-notes.test.ts`

**Interfaces:**
- Consumes Task 2 state machine and `/api/transcribe`.
- Produces one global top-right microphone control and transcript review UI.

- [ ] **Step 1: Remove the existing floating `.voice-dock` control**

Delete the floating bottom microphone button from JSX and remove `.voice-dock*` styles.

- [ ] **Step 2: Replace the top-right logo with the microphone trigger**

App bar structure becomes:

```tsx
<header className="appbar">
  <button className="icon-button" aria-label="Menu">…</button>
  <strong className="appbar-title">{pageTitle}</strong>
  <button className={`voice-trigger ${voicePhase}`} onClick={handleVoicePress} aria-label="Voice note">
    <Mic size={19} />
  </button>
</header>
```

No Puma logo remains in the top-right app bar.

- [ ] **Step 3: Implement real audio capture**

Add refs:

```ts
const mediaRecorderRef = useRef<MediaRecorder | null>(null);
const mediaStreamRef = useRef<MediaStream | null>(null);
const audioChunksRef = useRef<Blob[]>([]);
```

On first tap:

```ts
const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
const recorder = new MediaRecorder(stream);
audioChunksRef.current = [];
recorder.ondataavailable = (event) => {
  if (event.data.size > 0) audioChunksRef.current.push(event.data);
};
recorder.onstop = () => void processRecordedAudio();
recorder.start();
```

On second tap, call `recorder.stop()` and immediately stop every stream track after the final data event has been queued.

If `navigator.mediaDevices` or `MediaRecorder` is missing, transition to `unsupported`. If `getUserMedia` rejects with `NotAllowedError`, transition to `permission-denied`; other failures go to `error`.

- [ ] **Step 4: Send the captured blob to `/api/transcribe`**

```ts
const form = new FormData();
form.append('audio', blob, `puma-voice-${Date.now()}.webm`);
const response = await fetch('/api/transcribe', { method: 'POST', body: form });
```

If the endpoint returns 501, set an explicit UI message: `Recording captured — transcription not configured.` and offer typed note fallback. If the endpoint returns a transcript, move to `review` state and show the transcript in an editable sheet.

If configured transcription fails, optionally try `SpeechRecognition` only as a secondary fallback when available; never label fallback output as successful recording transcription unless actual text is produced.

- [ ] **Step 5: Add transcript review sheet**

Render a compact bottom sheet only for `review`, `permission-denied`, `unsupported`, or `error`. In `review`, include textarea + `Cancel` + `Save note`. Save uses the active context:

```ts
addNote(transcript, 'voice', currentCompanyId, currentPropertyId);
```

Home/Clients/Monitor without selected company/property uses the existing Voice Inbox path by leaving both IDs undefined.

- [ ] **Step 6: Ensure microphone target follows route context**

- building detail: selected company + property
- company detail: selected company only
- Home / Clients index / Monitor / Engine / Settings: inbox

Display the target name in the recording/review UI so the user can see where the note will be saved.

- [ ] **Step 7: Run tests, typecheck, build**

```bash
npm test
npm run typecheck
npm run build
```

Expected: PASS.

- [ ] **Step 8: Commit**

```bash
git add app/components/puma-workspace-app.tsx app/globals.css lib/voice-notes.ts tests/voice-notes.test.ts
git commit -m "feat: move voice notes into app bar with real capture"
```

---

### Task 6: Preview verification, review, merge, and production verification

**Files:**
- No source file required unless verification finds a defect.

**Interfaces:**
- Produces a verified Vercel preview and then a verified production deployment.

- [ ] **Step 1: Push the implementation branch and wait for Vercel preview**

Expected preview status: `READY`.

- [ ] **Step 2: Verify build logs show the full gate passing**

Required commands in Vercel build output:

```text
npm test
npm run typecheck
npm run build
```

If the Vercel project still runs `npm test && npm run build`, verify typecheck is included by `next build` TypeScript validation and also run the explicit local/CI `npm run typecheck` before merge.

- [ ] **Step 3: Manually inspect preview routes**

Verify HTTP 200 and expected hierarchy for:

```text
/
/clients
/clients/<known-company-id>
/clients/<known-company-id>/buildings
/clients/<known-company-id>/buildings/<known-property-id>
/monitor
```

- [ ] **Step 4: Verify critical UI acceptance criteria**

Confirm on rendered preview HTML/UI:

- bottom nav says Home / Clients / Monitor
- no `CRM` label in primary nav or side menu
- top-right contains microphone, not Puma logo
- floating bottom voice dock is absent
- client list has Prospects / Active Clients segmentation
- Prospects exposes the approved status chips
- company detail exposes Overview / Contacts / Buildings / Activity
- Buildings route is obvious and navigable
- building detail retains Unknown values without converting them to false negatives
- top-left branding blends into black
- tap targets are at least 44 px where required

- [ ] **Step 5: Review the diff before merge**

Use CodeRabbit or equivalent PR review. Any correctness/security/accessibility findings must be fixed before merge. Re-run the full test/typecheck/build gate after fixes.

- [ ] **Step 6: Merge to `main`**

Use a PR merge only after preview is READY and review is clean.

- [ ] **Step 7: Verify production deployment**

Confirm the Vercel production deployment for the merge commit is `READY`, then fetch the production routes listed in Step 3 and verify 200 responses.

- [ ] **Step 8: Report completion only with evidence**

Include:

```text
merge commit SHA
Vercel production deployment ID
npm test result
npm run typecheck result
npm run build result
verified routes
```
