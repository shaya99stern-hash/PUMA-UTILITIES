-- Complete canonical storage for the remaining browser Workspace entities.

create table if not exists public.parcels (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  legacy_id text,
  property_id uuid not null references public.properties(id) on delete cascade,
  identifier text not null,
  jurisdiction text,
  evidence_status text not null default 'unknown',
  provenance jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(workspace_id, legacy_id)
);
create index if not exists parcels_property_id_idx on public.parcels(property_id);
create index if not exists parcels_workspace_id_idx on public.parcels(workspace_id);

create table if not exists public.meters (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  legacy_id text,
  utility_id uuid not null references public.utilities(id) on delete cascade,
  label text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(workspace_id, legacy_id)
);
create index if not exists meters_utility_id_idx on public.meters(utility_id);
create index if not exists meters_workspace_id_idx on public.meters(workspace_id);

create table if not exists public.usage_readings (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  legacy_id text,
  meter_id uuid not null references public.meters(id) on delete cascade,
  period_start timestamptz,
  period_end timestamptz,
  gallons numeric,
  expected_gallons numeric,
  cost numeric,
  continuous_flow boolean,
  evidence_status text not null default 'unknown',
  provenance jsonb not null default '{}'::jsonb,
  note text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(workspace_id, legacy_id)
);
create index if not exists usage_readings_meter_id_idx on public.usage_readings(meter_id);
create index if not exists usage_readings_workspace_id_idx on public.usage_readings(workspace_id);

create table if not exists public.monitor_settings (
  workspace_id uuid primary key references public.workspaces(id) on delete cascade,
  spend_threshold numeric,
  variance_threshold_percent numeric,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.accounts_payable (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  legacy_id text,
  company_id uuid not null references public.companies(id) on delete cascade,
  property_id uuid references public.properties(id) on delete set null,
  description text not null,
  amount numeric not null,
  currency text not null default 'USD' check (currency = 'USD'),
  status text not null,
  due_date date,
  paid_at timestamptz,
  note text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(workspace_id, legacy_id)
);
create index if not exists accounts_payable_company_id_idx on public.accounts_payable(company_id);
create index if not exists accounts_payable_property_id_idx on public.accounts_payable(property_id);
create index if not exists accounts_payable_workspace_id_idx on public.accounts_payable(workspace_id);

DO $$
declare
  table_name text;
begin
  foreach table_name in array array['parcels','meters','usage_readings','monitor_settings','accounts_payable'] loop
    execute format('alter table public.%I enable row level security', table_name);
    execute format('drop policy if exists workspace_owner_all on public.%I', table_name);
    execute format(
      'create policy workspace_owner_all on public.%I for all to authenticated using (public.owns_workspace(workspace_id)) with check (public.owns_workspace(workspace_id))',
      table_name
    );
  end loop;
end $$;

DO $$
declare
  table_name text;
begin
  foreach table_name in array array['parcels','meters','usage_readings','monitor_settings','accounts_payable'] loop
    execute format('drop trigger if exists set_%1$s_updated_at on public.%1$I', table_name);
    execute format('create trigger set_%1$s_updated_at before update on public.%1$I for each row execute function public.set_updated_at()', table_name);
  end loop;
end $$;