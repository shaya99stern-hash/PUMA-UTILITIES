# Puma Utilities — iOS Shell, Voice, Lifecycle, and Accounts Payable Design

## Goals

1. Make the installed iPhone PWA behave more like a native iOS app by preventing the document itself from freely rubber-banding/panning while preserving intentional scrolling inside the app content and horizontal chip/tab strips.
2. Correct all in-app Puma branding so the logo sits on the exact Puma app background color rather than a mismatched black/gray tile or blend-mode treatment. The Home Screen icon remains unchanged.
3. Make voice notes genuinely usable with explicit microphone permission, recording, transcription/fallback, review, save, and error states.
4. Replace the current two-segment Companies organization with five top-level lifecycle views: Prospects, Contacted, Not Interested, Installations, and Active Clients.
5. Add a first-class `Not Interested` lifecycle state rather than faking it as a UI-only filter.
6. Add Accounts Payable to the side drawer after Find Leads and before Settings. This phase creates the route, data model, and UI foundation for invoices/payment tracking but does not process payments or charge cards.
7. Preserve existing company, building, notes, monitoring, profile, Find Leads, and bulk-selection behavior unless explicitly moved by this design.

## iOS Shell

The root document (`html`/`body`) will be constrained to the device viewport and will not be the primary scroll container. The Puma shell will occupy the viewport and the content region will own vertical scrolling. This removes the app-wide page drag/rubber-band effect while preserving normal native-feeling vertical content scrolling.

Intentional horizontal scrollers such as lifecycle tabs, record tabs, and filter rows will keep touch scrolling. Drawer/sheet overlays remain fixed to the viewport. Safe-area insets remain respected.

## Puma Branding

The current `mix-blend-mode`/cropped app-icon treatment will be removed for in-app marks. The app will use a dedicated in-app mark presentation whose background is exactly `#050607`, matching the Puma shell. The source Puma artwork/colors are not recolored. The installed Home Screen icon remains the existing app icon.

The same in-app treatment is used consistently in the header, drawer, and bottom Home navigation mark.

## Voice Notes

Voice remains a global top-right control. The flow is:

1. User taps microphone.
2. Puma requests microphone access and shows an explicit requesting/listening state.
3. Puma records real audio using `getUserMedia`/`MediaRecorder` when available.
4. Puma attempts transcription through the existing server route when configured.
5. If server transcription is unavailable, Puma may use a supported browser speech-recognition path as a fallback where the browser exposes it.
6. If no automatic transcription path succeeds, Puma still preserves the captured-note workflow by opening the review sheet with a clear message and editable text field rather than silently failing.
7. User reviews and saves the note to the current building, company, or Voice Inbox.

Permission-denied, unsupported, empty-audio, transcription-failed, and recording-failed states must be visible and recoverable.

## Companies Lifecycle

The Companies page replaces the current Prospects/Active Clients segmented control plus secondary pipeline chips with a single top lifecycle selector:

- **Prospects** — Target, Research, and Qualified records that have not yet entered direct outreach.
- **Contacted** — Outreach, Follow-up, and Pilot records.
- **Not Interested** — new persisted pipeline stage for companies that declined, were disqualified after contact, or are intentionally closed without becoming clients.
- **Installations** — Installation-stage companies.
- **Active Clients** — Client-stage companies.

The selector is horizontally scrollable on small screens and acts as the primary list filter. Company rows remain minimal: company name, location/market, portfolio count, and disclosure chevron, with bulk selection available through Select mode.

Company detail continues to expose Overview, Contacts, Buildings, and Activity. The account lifecycle shown on the detail page is derived from the persisted stage.

## Data Model

`PipelineStage` gains `Not Interested`.

Existing stages remain valid for backward compatibility and are mapped into the five lifecycle views. No destructive migration is required for existing local workspaces.

Accounts Payable introduces a minimal local data model suitable for future persistence/backend work:

- `AccountsPayableStatus`: `Draft | Due | Paid | Overdue | Void`
- `AccountsPayableItem`: id, companyId, optional propertyId, description, amount, currency, status, dueDate, paidAt, createdAt, updatedAt, optional note
- `Workspace.accountsPayable?: AccountsPayableItem[]`

This phase stores AP records in the same workspace persistence mechanism already used by Puma. It does not represent a payment processor, bank ledger, or accounting system of record.

## Accounts Payable UI

A new `/accounts-payable` route is added and appears in the drawer after Find Leads and before Settings.

The first version shows:

- total outstanding amount
- paid amount
- overdue count
- a minimal list of AP items with company, description, amount, due date, and status
- an empty state for workspaces with no AP records yet

The UI is designed so a later billing implementation can replace the local layer without redesigning navigation.

## Testing and Verification

Implementation uses TDD where practical. Required coverage includes:

- lifecycle mapping for all persisted stages, including the new Not Interested stage
- existing workspace data loading without migration loss
- Accounts Payable calculations/status handling
- iOS shell CSS guardrails: root viewport lock plus inner vertical scroll container and intentional horizontal scrollers
- voice state-machine/error-state coverage where logic is factored into testable helpers
- existing evidence/monitoring/bulk-outreach/routing tests remain green

Before merge:

- run the full test command
- run the production Next.js build/typecheck
- review the final diff for regressions and accidental scope expansion
- verify a Vercel preview for Home, Companies, company detail/buildings, Monitor, Find Leads, Accounts Payable, Settings, and the transcription route behavior available in the environment
- only merge after preview verification passes
- verify the production deployment and live routes after merge

## Non-Goals

- no payment charging/Stripe-like processing
- no bank/accounting integration
- no replacement of the installed Home Screen icon
- no destructive rewrite of existing CRM/monitor data
