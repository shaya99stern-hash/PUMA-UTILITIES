create extension if not exists pgcrypto;

-- Canonical workspace ownership ------------------------------------------------
create table if not exists public.workspaces (
  id uuid primary key default gen_random_uuid(),
  owner_user_id uuid not null references auth.users(id) on delete cascade,
  name text not null default 'Puma Utilities',
  local_import_completed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(owner_user_id)
);

-- CRM -------------------------------------------------------------------------
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
  portfolio jsonb not null default '[]'::jsonb,
  prospect_assessment jsonb,
  opportunity_intelligence jsonb,
  research_pathways jsonb not null default '[]'::jsonb,
  next_action text,
  notes text,
  installation_status text,
  last_contact_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(workspace_id, legacy_id)
);

create index if not exists companies_workspace_name_idx
  on public.companies(workspace_id, normalized_name);

create table if not exists public.people (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  legacy_id text,
  name text not null,
  normalized_name text not null,
  role text,
  email text,
  phone text,
  evidence_status text not null default 'unknown',
  provenance jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(workspace_id, legacy_id)
);

create index if not exists people_workspace_name_idx
  on public.people(workspace_id, normalized_name);

create table if not exists public.company_people (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  company_id uuid not null references public.companies(id) on delete cascade,
  person_id uuid not null references public.people(id) on delete cascade,
  relationship_type text not null default 'contact',
  evidence_status text not null default 'unknown',
  provenance jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(company_id, person_id, relationship_type)
);

create table if not exists public.properties (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  legacy_id text,
  name text not null,
  normalized_address text,
  state text,
  address jsonb not null default '{"status":"unknown"}'::jsonb,
  units jsonb,
  gross_square_feet jsonb,
  provenance jsonb not null default '[]'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(workspace_id, legacy_id)
);

create index if not exists properties_workspace_address_idx
  on public.properties(workspace_id, normalized_address);

create table if not exists public.company_properties (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  company_id uuid not null references public.companies(id) on delete cascade,
  property_id uuid not null references public.properties(id) on delete cascade,
  relationship_type text not null default 'manager',
  evidence_status text not null default 'unknown',
  provenance jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(company_id, property_id, relationship_type)
);

create table if not exists public.utilities (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  legacy_id text,
  provider text not null,
  normalized_provider text not null,
  service_area text,
  capability text not null default 'unknown',
  portal text not null default 'unknown',
  evidence_status text not null default 'unknown',
  provenance jsonb not null default '{}'::jsonb,
  ami_program jsonb,
  rate_summary jsonb,
  benchmark_cost jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(workspace_id, legacy_id)
);

create index if not exists utilities_workspace_provider_idx
  on public.utilities(workspace_id, normalized_provider);

create table if not exists public.property_utilities (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  property_id uuid not null references public.properties(id) on delete cascade,
  utility_id uuid not null references public.utilities(id) on delete cascade,
  service_type text not null default 'water',
  evidence_status text not null default 'unknown',
  provenance jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(property_id, utility_id, service_type)
);

create table if not exists public.tariffs (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  legacy_id text,
  utility_id uuid not null references public.utilities(id) on delete cascade,
  label text not null,
  effective_from date,
  effective_to date,
  customer_class text,
  freshness text,
  source_url text,
  retrieved_at timestamptz,
  published_text text,
  evidence_status text not null default 'unknown',
  provenance jsonb not null default '{}'::jsonb,
  note text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(workspace_id, legacy_id)
);

create table if not exists public.activity_notes (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  legacy_id text,
  company_id uuid references public.companies(id) on delete cascade,
  property_id uuid references public.properties(id) on delete cascade,
  text text not null,
  source text not null check (source in ('typed','voice')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(workspace_id, legacy_id)
);

create table if not exists public.follow_ups (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  company_id uuid not null references public.companies(id) on delete cascade,
  due_at timestamptz not null,
  status text not null default 'open',
  note text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists follow_ups_workspace_due_idx
  on public.follow_ups(workspace_id, status, due_at);

create table if not exists public.pipeline_events (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  company_id uuid not null references public.companies(id) on delete cascade,
  from_stage text,
  to_stage text not null,
  source text not null default 'user',
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

-- Durable research -------------------------------------------------------------
do $$ begin
  create type public.research_run_status as enum ('queued','running','partial','completed','failed','cancelled');
exception when duplicate_object then null;
end $$;

do $$ begin
  create type public.research_task_status as enum ('queued','leased','running','complete','blocked','failed','cancelled');
exception when duplicate_object then null;
end $$;

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

create index if not exists research_runs_workspace_created_idx
  on public.research_runs(workspace_id, created_at desc);

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
  max_attempts integer not null default 3 check (max_attempts between 1 and 20),
  not_before timestamptz not null default now(),
  lease_owner text,
  lease_expires_at timestamptz,
  input jsonb not null default '{}'::jsonb,
  output jsonb not null default '{}'::jsonb,
  failure_class text,
  failure_message text,
  started_at timestamptz,
  completed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists research_tasks_queue_idx
  on public.research_tasks(status, not_before, priority, created_at);
create index if not exists research_tasks_run_idx
  on public.research_tasks(run_id, status);

create table if not exists public.research_sources (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  source_id text not null,
  kind text not null,
  enabled boolean not null default true,
  capabilities jsonb not null default '[]'::jsonb,
  geographies jsonb not null default '[]'::jsonb,
  cost_model jsonb not null default '{}'::jsonb,
  health_status text not null default 'unknown',
  health_checked_at timestamptz,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(workspace_id, source_id)
);

create table if not exists public.research_entities (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  run_id uuid references public.research_runs(id) on delete cascade,
  entity_key text,
  kind text not null,
  label text not null,
  normalized_label text not null,
  geography text,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists research_entities_workspace_kind_label_idx
  on public.research_entities(workspace_id, kind, normalized_label);

create table if not exists public.entity_aliases (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  entity_id uuid not null references public.research_entities(id) on delete cascade,
  alias text not null,
  normalized_alias text not null,
  source_id text,
  created_at timestamptz not null default now(),
  unique(entity_id, normalized_alias)
);

create table if not exists public.research_evidence (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  run_id uuid references public.research_runs(id) on delete cascade,
  task_id uuid references public.research_tasks(id) on delete set null,
  source_id text not null,
  source_reference text,
  url text,
  authority text not null default 'unknown',
  confidence double precision not null default 0 check (confidence between 0 and 1),
  excerpt text,
  raw_payload jsonb,
  observed_at timestamptz not null,
  created_at timestamptz not null default now()
);

create index if not exists research_evidence_run_source_idx
  on public.research_evidence(run_id, source_id);

create table if not exists public.research_claims (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  run_id uuid references public.research_runs(id) on delete cascade,
  subject_entity_id uuid not null references public.research_entities(id) on delete cascade,
  fact text not null,
  value jsonb,
  object_entity_id uuid references public.research_entities(id) on delete set null,
  state text not null,
  confidence double precision not null default 0 check (confidence between 0 and 1),
  evidence_ids uuid[] not null default '{}'::uuid[],
  observed_at timestamptz not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists research_claims_subject_fact_idx
  on public.research_claims(subject_entity_id, fact);

create table if not exists public.entity_links (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  run_id uuid references public.research_runs(id) on delete cascade,
  from_entity_id uuid not null references public.research_entities(id) on delete cascade,
  to_entity_id uuid not null references public.research_entities(id) on delete cascade,
  relation text not null,
  confidence double precision not null default 0 check (confidence between 0 and 1),
  evidence_ids uuid[] not null default '{}'::uuid[],
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  unique(run_id, from_entity_id, to_entity_id, relation)
);

create table if not exists public.source_health_events (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  source_id text not null,
  status text not null,
  latency_ms integer,
  message text,
  metadata jsonb not null default '{}'::jsonb,
  observed_at timestamptz not null default now(),
  created_at timestamptz not null default now()
);

create index if not exists source_health_workspace_source_idx
  on public.source_health_events(workspace_id, source_id, observed_at desc);

-- Provider accounting (never provider secrets) --------------------------------
create table if not exists public.provider_accounts (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  provider_id text not null,
  enabled boolean not null default false,
  mode text not null default 'disabled',
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(workspace_id, provider_id)
);

create table if not exists public.provider_quota_snapshots (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  provider_account_id uuid not null references public.provider_accounts(id) on delete cascade,
  remaining numeric,
  limit_value numeric,
  reset_at timestamptz,
  metadata jsonb not null default '{}'::jsonb,
  observed_at timestamptz not null default now()
);

create table if not exists public.provider_usage_events (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  provider_account_id uuid references public.provider_accounts(id) on delete set null,
  run_id uuid references public.research_runs(id) on delete set null,
  task_id uuid references public.research_tasks(id) on delete set null,
  operation text not null,
  units numeric not null default 0,
  credits numeric not null default 0,
  cost_usd numeric,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create table if not exists public.provider_backoff_state (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  provider_id text not null,
  blocked_until timestamptz,
  reason text,
  consecutive_failures integer not null default 0,
  updated_at timestamptz not null default now(),
  unique(workspace_id, provider_id)
);

-- Timestamp maintenance --------------------------------------------------------
create or replace function public.set_updated_at()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

revoke all on function public.set_updated_at() from public;

DO $$
declare
  table_name text;
begin
  foreach table_name in array array[
    'workspaces','companies','people','company_people','properties','company_properties',
    'utilities','property_utilities','tariffs','activity_notes','follow_ups',
    'research_runs','research_tasks','research_sources','research_entities','research_claims',
    'provider_accounts','provider_backoff_state'
  ] loop
    execute format('drop trigger if exists set_%1$s_updated_at on public.%1$I', table_name);
    execute format('create trigger set_%1$s_updated_at before update on public.%1$I for each row execute function public.set_updated_at()', table_name);
  end loop;
end $$;

-- Owner checks and RLS ---------------------------------------------------------
create or replace function public.owns_workspace(target_workspace_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.workspaces w
    where w.id = target_workspace_id
      and w.owner_user_id = auth.uid()
  );
$$;

revoke all on function public.owns_workspace(uuid) from public;
grant execute on function public.owns_workspace(uuid) to authenticated;

alter table public.workspaces enable row level security;
drop policy if exists workspace_owner_all on public.workspaces;
create policy workspace_owner_all on public.workspaces
  for all to authenticated
  using (owner_user_id = auth.uid())
  with check (owner_user_id = auth.uid());

DO $$
declare
  table_name text;
begin
  foreach table_name in array array[
    'companies','people','company_people','properties','company_properties','utilities',
    'property_utilities','tariffs','activity_notes','follow_ups','pipeline_events',
    'research_runs','research_tasks','research_sources','research_evidence','research_claims',
    'research_entities','entity_aliases','entity_links','source_health_events',
    'provider_accounts','provider_quota_snapshots','provider_usage_events','provider_backoff_state'
  ] loop
    execute format('alter table public.%I enable row level security', table_name);
    execute format('drop policy if exists workspace_owner_all on public.%I', table_name);
    execute format(
      'create policy workspace_owner_all on public.%I for all to authenticated using (public.owns_workspace(workspace_id)) with check (public.owns_workspace(workspace_id))',
      table_name
    );
  end loop;
end $$;

-- Atomic worker leasing --------------------------------------------------------
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
  if worker_name is null or btrim(worker_name) = '' then
    raise exception 'worker_name is required';
  end if;

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

revoke all on function public.lease_research_tasks(text, integer, integer) from public;
revoke all on function public.lease_research_tasks(text, integer, integer) from anon;
revoke all on function public.lease_research_tasks(text, integer, integer) from authenticated;
grant execute on function public.lease_research_tasks(text, integer, integer) to service_role;
