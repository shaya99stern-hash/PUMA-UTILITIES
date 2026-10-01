-- Research engine staging, user-configurable connectors, and per-building pipeline status.

-- Raw building records collected by a discovery job (clustered into candidates later).
create table if not exists public.research_job_records (
  job_id uuid not null references public.research_jobs(id) on delete cascade,
  source_key text not null,
  data jsonb not null,
  created_at timestamptz not null default now(),
  primary key (job_id, source_key)
);
alter table public.research_job_records enable row level security;

-- Data sources added in Settings > Connectors.
create table if not exists public.connectors (
  id uuid primary key default extensions.gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  name text not null,
  kind text not null check (kind in ('socrata', 'arcgis', 'json', 'hunter', 'opencorporates', 'brave', 'serper', 'google_cse')),
  role text not null check (role in ('buildings', 'people', 'company', 'search')),
  enabled boolean not null default true,
  config jsonb not null default '{}'::jsonb,
  secret_enc text,
  daily_limit integer not null default 100,
  usage jsonb not null default '{}'::jsonb,
  last_test jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists connectors_ws_idx on public.connectors(workspace_id);
alter table public.connectors enable row level security;
drop policy if exists member_all on public.connectors;
create policy member_all on public.connectors for all to authenticated using (public.is_workspace_member(workspace_id)) with check (public.is_workspace_member(workspace_id));
drop trigger if exists set_updated_at on public.connectors;
create trigger set_updated_at before update on public.connectors for each row execute function public.set_updated_at();

-- Company -> buildings hierarchy: each building moves through its own pipeline.
alter table public.properties add column if not exists status text not null default 'prospect';
do $$ begin
  alter table public.properties add constraint properties_status_check
    check (status in ('prospect', 'contacted', 'negotiating', 'contracted', 'installing', 'installed', 'monitoring', 'not_interested'));
exception when duplicate_object then null; end $$;
alter table public.properties add column if not exists status_changed_at timestamptz;
alter table public.properties add column if not exists meter_program text;
alter table public.properties add column if not exists est_monthly_water_cost numeric(14, 2);
alter table public.properties add column if not exists signals jsonb not null default '[]'::jsonb;
create index if not exists properties_company_status_idx on public.properties(company_id, status);

-- Companies keep external profile links (ContactOut page, LinkedIn) found or pasted.
alter table public.companies add column if not exists links jsonb not null default '{}'::jsonb;
