# Puma Utilities v2 — Architecture & Build Contract

Puma Utilities is a CRM + lead-intelligence + outreach app for a water-metering /
water-savings business that sells to **multifamily building owners and property
managers** (initially NJ, NY, PA; HUD data is nationwide). Think "HubSpot for
multifamily water", minimal and premium, dark theme, iPhone-first but excellent
on desktop.

## Stack
- Next.js 16 App Router (`proxy.ts` replaces middleware; route `params` are Promises).
- React 19, TypeScript strict. `@/` path alias = repo root.
- Postgres (Supabase project `wxbvlpkgsxlojlwykzod`). Server code uses
  `sql()` from `lib/server/db.ts` (postgres.js, tagged templates, `prepare:false`).
  **All data access is server-side through route handlers.** No supabase-js data calls from the browser.
- Schema: `db/migrations/0001_puma_core.sql` — READ IT before writing queries. Do not change existing
  columns; if you need new tables/columns, add a new file `db/migrations/00NN_<name>.sql`
  (idempotent, `if not exists`) and apply it locally with psql (see below). Tell the lead in your report.
- Auth: sign-in is OPTIONAL (open mode). Every route handler calls `requireMember()` from
  `lib/server/auth.ts` → `{ userId | null, email, workspaceId, role }`. ALWAYS scope queries by `workspace_id = ctx.workspaceId`.
- Errors: wrap handlers with `route()` from `lib/server/http.ts`; throw `ApiError(status, msg)`;
  validate bodies with zod via `readJson(request, schema)`. Responses are JSON via `json()`.
- Client data: `useApi(url)` (SWR), `apiPost/apiPatch/apiDelete`, `invalidate(prefix)` from `lib/client/api.ts`.
- Text utils: `lib/text.ts` (companyNameKey, normalizeDomain/Phone/Email, splitName, addressKey, titleCase).
- Secrets at rest: `encryptSecret/decryptSecret` in `lib/server/crypto.ts`.

## Route map (pages)
| Path | Page |
|---|---|
| `/` | Dashboard (today: tasks/follow-ups, pipeline summary, recent activity, campaign stats, engine jobs) |
| `/companies`, `/companies/[id]` | Company list (table on desktop, cards on iPhone) + HubSpot-style record |
| `/contacts`, `/contacts/[id]` | People |
| `/properties`, `/properties/[id]` | Buildings |
| `/pipeline` | Kanban board by stage |
| `/tasks` | Tasks & follow-ups |
| `/leads`, `/leads/[jobId]` | Find Leads (research engine) + job results |
| `/inbox` | Connected mailbox threads |
| `/campaigns`, `/campaigns/new`, `/campaigns/[id]` | Mass email campaigns / sequences |
| `/monitor` | Client meter alerts (client-authorized data only) |
| `/accounts-payable` | Billing items per client |
| `/settings/*` | general, profile, team, email accounts, sending, data sources, import/export |
| `/login` | Optional sign-in |
| `/u/[token]` | Public unsubscribe page |

Legacy routes redirect: `/clients*` → `/companies*`, `/engine` → `/leads`, `/intelligence` → `/leads`, `/export` → `/settings/import-export`.

Pipeline stages (DB `companies.stage`): `new, qualified, contacted, meeting, proposal, installation, client, lost`
Labels: New lead, Qualified, Contacted, Meeting, Proposal, Installation, Client, Lost.

## Ownership (parallel build — only edit files you own)
- **UI foundation agent**: `app/styles/**`, `app/ui/**`, `app/layout.tsx`, `app/page.tsx` (dashboard), `app/api/dashboard/**`,
  `app/settings/**` (except `app/settings/email/**`), `app/api/settings/**`, `app/login/**`, `app/manifest.ts`, `public/sw.js`, `app/offline/**`, `app/components/**` (legacy; may be replaced).
- **CRM agent**: `app/companies/**`, `app/contacts/**`, `app/properties/**`, `app/pipeline/**`, `app/tasks/**`, `app/monitor/**`,
  `app/accounts-payable/**`, `app/api/companies/**`, `app/api/contacts/**`, `app/api/properties/**`, `app/api/activities/**`,
  `app/api/tasks/**`, `app/api/payables/**`, `app/api/monitor/**`, `app/api/search/**`, `app/api/import/**`, `app/api/export/**`, `lib/crm/**`.
- **Engine agent**: `lib/engine/**`, `app/leads/**`, `app/api/research/**` (replace legacy), `app/api/leads/**`.
- **Email agent**: `lib/email/**`, `app/inbox/**`, `app/campaigns/**`, `app/settings/email/**`, `app/api/mail/**`, `app/api/campaigns/**`,
  `app/api/cron/**`, `app/u/**`, `app/t/**` (tracking), `app/api/oauth/**`.
- **Chores agent**: `README.md`, `.env.example`, `next.config.ts`, `package.json` scripts, `tests/**` (new tests), `vercel.json`.

Cross-agent calls: the email agent owns `app/api/cron/tick/route.ts`; it must call
`runResearchTick({ budgetMs })` exported from `lib/engine/tick.ts` (engine agent creates it) inside a try/catch.
The CRM agent exposes `lib/crm/activity.ts` → `logActivity(ctx-ish args)` which email/engine may import.
If you need something from a file you don't own, create your own helper instead of editing theirs.

## Design system (UI agent builds it first; everyone else consumes it)
- Dark, premium, minimal (HubSpot information density, Linear/Apple polish). Keep Puma identity: near-black
  background, soft white text, off-white primary buttons, brand accent. Font: Inter Variable (already bundled).
- Tokens in `app/styles/tokens.css` (CSS variables): `--bg, --bg-elev, --surface, --surface-2, --border, --border-strong,
  --text, --text-2, --text-3, --accent (brand orange #FF7A45), --accent-soft, --success, --warning, --danger, --info,
  --radius-sm/md/lg/xl, --shadow-1/2, --space-*`, safe-area insets.
- Components in `app/ui/` (import from `@/app/ui`): `Button`, `IconButton`, `Input`, `Textarea`, `Select`, `Field`,
  `Card`, `Badge`, `StageBadge`, `ScorePill`, `Avatar`, `Tabs`, `PageHeader`, `EmptyState`, `Skeleton`, `DataTable`
  (desktop table + mobile card list), `Sheet` (bottom sheet on iPhone, side drawer on desktop), `Modal`,
  `Menu`, `Toast` (`useToast`), `Stat`, `ProgressBar`, `Chip`/`FilterChips`, `SearchInput`, `Spinner`, `KeyValue`, `Timeline`.
- Shell: desktop left sidebar; iPhone bottom tab bar (Home, Companies, Leads, Inbox, More) with safe-area padding;
  top bar with page title + actions; global search (⌘K) calling `/api/search?q=`.
- Every page must look right at 390×844 (iPhone) and 1440×900 (desktop). No horizontal scroll on phones.

## Local development
- Local Postgres: `postgres://postgres@localhost:54329/puma` (schema applied). Apply new migrations with
  `psql -h localhost -p 54329 -U postgres -d puma -v ON_ERROR_STOP=1 -f db/migrations/00NN_x.sql`.
- Dev server is ALREADY RUNNING at http://localhost:3000 with `.env.local` (hot reload). Do NOT start another
  `next dev` or run `next build` (they fight over `.next`). Test APIs with `curl localhost:3000/api/...`.
- Screenshots: Playwright at `/opt/node22/lib/node_modules/playwright/index.mjs`, Chromium at
  `/opt/pw-browsers/chromium-1194/chrome-linux/chrome`.
- Typecheck: `npx tsc --noEmit`. Tests: `node --import tsx --test tests/<file>.test.ts`.
- The container CANNOT reach external websites (NYC Open Data, ArcGIS, SEC...). To inspect live public data,
  use the Supabase MCP `execute_sql` on project `wxbvlpkgsxlojlwykzod` with helpers:
  `select devtools.fetch_text('<url>')`, `select devtools.features('<arcgis query url>')`,
  `select devtools.arcgis_fields('<layer url>')`, `select * from devtools.probe('<url>', 2000)`.
- Do NOT git commit or push; the lead integrates and commits.
- Do not delete files (the environment blocks bulk deletion); overwrite or stop importing instead.
