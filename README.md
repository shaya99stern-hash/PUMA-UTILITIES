# Puma Utilities v2

Puma Utilities is a mobile-first CRM, lead-intelligence engine, and email outreach platform built for multifamily water companies. It combines public data research (NYC, NJ, PA, nationwide HUD) with private CRM workflows, automated lead scoring, and IMAP/SMTP + OAuth email integration to identify and nurture prospect relationships.

## Features

### CRM Core
- **Companies** — searchable directory with HubSpot-style records, stage pipeline (new → qualified → contacted → meeting → proposal → installation → client → lost), enrichment from public sources
- **Contacts** — people linked to companies, name/email normalization
- **Properties** — multifamily buildings with location, unit count, and linked meter/ownership data
- **Pipeline** — Kanban board by stage with drag-to-advance workflow
- **Tasks & Follow-ups** — activity scheduling and tracking
- **Accounts Payable** — billing and invoice management

### Find Leads Engine
Autonomous research worker using free public data sources (optional search API integration):
- NYC PLUTO (property records, ownership)
- HPD registrations & violation history
- LL84 energy benchmarking (water insights)
- NY DOS business registrations
- NJ MOD-IV parcels
- Philadelphia OPA assessments
- HUD multifamily nationwide (LIHTC)
- EPA water system boundaries
- Company websites (Brave/Serper/Google Custom Search, optional)
- Playwright-based browser research (optional external worker)

Scoring & cross-referencing: duplicate detection, ownership mapping, water-risk heuristics.

### Inbox & Campaigns
- **Connected mailbox** — IMAP/SMTP for any email provider, or OAuth with Gmail/Outlook (optional)
- **Thread-based inbox** — grouped conversations, archive/reply workflows
- **Campaigns** — mass and sequential email outreach with unsubscribe tracking
- **CAN-SPAM compliance** — automatic unsubscribe links and bounce handling

### Monitor
- Real-time meter alerts (client-authorized data only)
- Consumption trends and tariff impact

### Settings
- Email account management (OAuth, IMAP credentials)
- Data import/export
- Team & user roles
- Integration status dashboard

## Architecture

**Stack:**
- **Frontend:** Next.js 16 App Router (React 19, TypeScript strict mode)
- **Database:** Supabase Postgres (project `wxbvlpkgsxlojlwykzod`)
- **Background jobs:** pg_cron tick (every 30s) for research & email workflows
- **Secrets:** AES-256-GCM encryption for mailbox OAuth tokens and API keys

**Auth:**
- Optional sign-in (set `PUMA_REQUIRE_LOGIN=1` to enforce)
- Every route scoped to a workspace; multi-tenant by design
- Signed cookies and CSRF protection built-in

## Local Development

**Prerequisites:**
- Node.js 20.9+
- Local Postgres on port 54329 (schema pre-applied)

**Setup:**
```bash
npm install

# Apply schema or new migrations
npm run db:migrate:local

# Type check
npm run typecheck

# Run tests (collects unit/*.test.ts, engine-*.test.ts, email-*.test.ts, crm-*.test.ts)
npm test

# Start dev server (http://localhost:3000)
npm run dev
```

**Create `.env.local` (see `.env.example`):**
```bash
DATABASE_URL=postgres://postgres@localhost:54329/puma
NEXT_PUBLIC_SUPABASE_URL=<dev-project-url>
NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY=<public-key>
NEXT_PUBLIC_APP_URL=http://localhost:3000
PUMA_ENCRYPTION_KEY=<32-byte-base64>
PUMA_CRON_SECRET=<random-secret>
# Optional:
PUMA_REQUIRE_LOGIN=
GOOGLE_CLIENT_ID= # Gmail OAuth
MICROSOFT_CLIENT_ID= # Outlook OAuth
BRAVE_SEARCH_API_KEY= # Web search (optional)
```

**Dev server already running:** Do NOT run `next dev` or `next build` yourself (they fight over `.next`). The container has a dev server on `:3000` with hot reload.

## Deployment

**Vercel:**
1. Connect GitHub repo
2. Set environment variables (see `.env.example` for required/optional)
3. Vercel uses `vercel.json` build command: `npm test && npm run typecheck && npm run build`

**Database:** Supabase project `wxbvlpkgsxlojlwykzod` (create new branch for staging)

**Cron:** Set `PUMA_CRON_SECRET` (any string) and point external timer to `/api/cron/tick?secret=<value>` (e.g., EasyCron, Vercel Cron, or AWS Lambda) every 30s.

## Security

- **Open mode:** By default, anyone can sign in or use the app without auth. Set `PUMA_REQUIRE_LOGIN=1` to restrict to verified workspace members.
- **Encrypted secrets:** Email OAuth tokens and API keys are encrypted at rest (AES-256-GCM) with `PUMA_ENCRYPTION_KEY` (32-byte base64).
- **CAN-SPAM:** Campaigns include unsubscribe links; monitor bounce addresses and honor opt-outs.
- **Workspace isolation:** All data scoped by `workspace_id`; multi-tenant by design.

## Optional Integrations

Marked as optional in `.env.example`:
- **Gmail/Outlook OAuth:** For connected inbox (else fall back to IMAP/SMTP)
- **Web search:** Brave Search, Serper, or Google Custom Search for finding company websites
- **Browser research:** External Playwright worker for JavaScript-heavy pages
- **Voice transcription:** OpenAI Whisper (check `app/api/transcribe/route.ts` for variable name)

## Development Notes

- All data access is server-side (route handlers). No Supabase client calls from the browser.
- Text utilities: `lib/text.ts` (company name deduping, phone/email/domain normalization, address matching)
- Crypto: `lib/server/crypto.ts` (symmetric encryption, SHA256, timing-safe comparison)
- Design system: CSS tokens + React components in `app/ui/` and `app/styles/` (dark theme, premium, HubSpot-like density)
- Every page: responsive at 390×844 (iPhone) and 1440×900 (desktop)

See `docs/ARCHITECTURE.md` for detailed ownership, route map, database schema, and component inventory.
