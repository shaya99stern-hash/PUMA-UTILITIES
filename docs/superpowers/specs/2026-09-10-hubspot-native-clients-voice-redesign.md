# Puma Utilities — HubSpot-Native Clients + Voice Redesign

## Scope

Refactor the existing Puma Utilities PWA so the daily workflow feels as clear and native as HubSpot/ClickUp while preserving Puma’s restrained black iOS-style visual language. This release is focused on navigation, client organization, building hierarchy, and reliable voice notes. It does not add a fake web-scraping engine or claim live utility integrations that do not exist.

## Product model

Puma Utilities is itself the CRM and lead workspace. Therefore the bottom navigation must be only:

- Home
- Clients
- Monitor

The current `CRM` / `Leads & CRM` naming is removed from primary navigation and side-menu labels. `Clients` is the umbrella workspace for the full lifecycle, not only paying customers.

Inside Clients, the top-level segmentation is:

- Prospects
- Active Clients

Prospects contain records that have not yet become live customers. Prospect statuses are surfaced as compact saved-view/filter chips:

- All
- Needs Outreach
- Contacted
- Follow-up
- Negotiation
- Installation

Existing pipeline values may remain in storage for backward compatibility, but the UI maps them into these clearer user-facing statuses. Active Clients are shown separately.

## Clients index

The Clients screen should behave like a mobile CRM record index rather than a dashboard wall.

Layout:

1. Page title: `Clients`.
2. Compact segmented control: `Prospects | Active Clients`.
3. Prospect-status chips when Prospects is active.
4. Search field.
5. Small, clear `Find Leads` action in the header or immediately below it. It may open the existing research workflow, but must not imply live internet scraping unless a real search provider is connected.
6. Company rows sized for phone use. Each row shows only high-value information: company name, portfolio size/market, current status, next action or last-contact cue, and a chevron.
7. Bulk selection/outreach remains available but must not dominate the default screen.

Target sizing:

- Main tappable rows: about 52–56 px high or larger when content requires it.
- Visible primary icons: 18–20 px.
- Interactive hit targets: at least 44×44 px.
- Primary text: about 15–16 px.
- Secondary text: about 12–13 px.
- Segmented controls / chips: about 36–40 px high.

The UI remains compact; these sizes are to improve usability on iPhone without turning the design into oversized cards.

## Client detail hierarchy

The current single long detail page is too dense. Replace it with a clean record-detail hierarchy.

Client header:

- Back to Clients
- Company name
- Prospect/Active status
- compact action area for call, email, voice note, and stage/status change

Client detail tabs/sections:

- Overview
- Contacts
- Buildings
- Activity

### Overview

Show only the highest-value record summary:

- portfolio summary
- current prospect/client status
- next action
- last contact
- installation summary if applicable
- compact water/smart-meter coverage summary

Detailed source evidence and research scoring should be moved behind secondary disclosure or a dedicated research detail area, not dominate the first screen.

### Contacts

Decision makers and published business contacts, with direct call/email actions. Unknown contact fields remain unknown.

### Buildings

A visible, first-class Buildings entry is required. If a company says `20 buildings`, the user must have an obvious way to enter the building list.

Each building row shows:

- building/property name
- address
- state/market
- water utility status at a glance
- smart-meter status at a glance
- chevron into building detail

Building detail includes:

- address
- water provider
- smart-meter capability/status
- portal/data-access status
- installation status if applicable
- building-specific notes/activity
- monitor handoff once client-authorized usage data exists

Unknown utility or meter data must remain `Unknown`; it must never be converted to a negative finding.

### Activity

Chronological notes, call logs, voice transcripts, follow-up history, and installation activity. Company and building notes must be visibly scoped so the user knows where each note was saved.

## Global app shell

The app bar should visually disappear into the black app background.

- Left-side Puma Utilities branding: no gray tile/card behind it; it blends into the black header.
- Remove the old top-right Puma logo entirely.
- Replace the top-right logo with the global microphone control.
- Keep the hamburger/menu control on the left where currently appropriate.
- Bottom navigation remains Home / Clients / Monitor.
- The Home bottom-nav Puma mark should also blend into the black nav rather than appear as a gray-backed tile.
- All old inline smart-meter-style Puma marks should be removed from visible branding surfaces and replaced with the approved Puma artwork where a brand mark is still needed.

## Voice-note architecture

The existing implementation depends only on `SpeechRecognition` / `webkitSpeechRecognition`; this is not sufficient for a reliable installed iPhone PWA.

Replace it with a real capture state machine.

Primary flow:

1. User taps the microphone in the top-right app bar.
2. App requests microphone permission through `navigator.mediaDevices.getUserMedia({ audio: true })`.
3. App captures audio using `MediaRecorder` when supported.
4. UI visibly shows one of: idle, requesting permission, recording, processing, transcript ready, saved, permission denied, unsupported, or error.
5. The transcript is routed to the current context:
   - building page → that building
   - client page → that client
   - Clients/Home/Monitor without a selected record → Voice Inbox
6. Before final save, show the transcript in a compact review sheet or inline composer so the user can edit/cancel/save.

Transcription layer:

- If an actual server/provider transcription endpoint is available and configured, send the recorded audio there.
- If no transcription provider is configured, do not silently pretend voice works. Provide an explicit `Recording captured — transcription not configured` state and retain the typed-note fallback.
- Browser speech recognition may be used only as a graceful secondary fallback where available, not as the sole implementation.

No audio should be uploaded or retained without a deliberate implementation path and clear user action. The app may discard raw audio after successful transcription unless future requirements explicitly call for recording retention.

## Routing

Primary routes remain native and linkable:

- `/` — Home
- `/clients` — Clients index
- `/clients/[companyId]` — client/company record
- `/clients/[companyId]/buildings` — building list
- `/clients/[companyId]/buildings/[propertyId]` — building detail
- `/monitor` — Monitor

Research and settings may remain secondary side-menu destinations. `CRM` should not appear as a primary product label.

Back navigation must be obvious on all nested client/building screens and behave predictably in iPhone PWA mode.

## Visual direction

Use HubSpot/ClickUp as interaction references, not as visual skins.

Puma should remain:

- black / near-black background
- restrained orange accent
- thin, clean typography
- subtle borders
- little blur
- minimal shadows
- larger tap targets than the current build
- fewer simultaneous cards/pills
- one clear hierarchy per screen

The design should prioritize scanning and navigation over decorative dashboards.

## Data and migration

Do not erase the existing local workspace or seed data.

- Preserve existing companies, contacts, properties, utility evidence, notes, pipeline data, installation data, and authorization boundaries.
- Add presentation/status mapping where possible rather than destructive data migrations.
- If new fields are necessary for prospect-view status or voice capture state, defaults must be backward compatible.

## Testing and verification

Before production merge:

1. Add regression tests for prospect-status mapping and Active Client segmentation.
2. Add tests that verify property/building routing and company/property note targeting.
3. Add unit tests for voice-state transitions and context routing independent of browser APIs.
4. Run the full repository test suite.
5. Run TypeScript typecheck.
6. Run a production Next.js build.
7. Verify a Vercel preview is READY.
8. Manually verify production/preview routes for Home, Clients, a client detail, Buildings list, building detail, and Monitor.
9. Verify the microphone control is in the top-right and the floating bottom microphone is removed.
10. Verify no old visible smart-meter Puma SVG remains in the app shell.
11. Verify the production deployment after merge before claiming completion.

## Explicit non-goals for this release

- Do not claim Puma is automatically scraping the public web unless a real connected search provider is implemented and verified.
- Do not infer smart-meter installation from utility territory alone.
- Do not manufacture contact data.
- Do not send bulk email automatically without an explicit connected sending workflow and user action.
- Do not persist or upload microphone audio invisibly.
