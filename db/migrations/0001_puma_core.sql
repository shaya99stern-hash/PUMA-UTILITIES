-- Puma Utilities v2 core schema.
-- Applied to Supabase project wxbvlpkgsxlojlwykzod and to local Postgres for development.
-- The Next.js server connects as role `puma_app` (BYPASSRLS) through the Supabase pooler.
-- RLS policies below are defense-in-depth for any direct client access.

create schema if not exists extensions;
create extension if not exists pgcrypto with schema extensions;
create extension if not exists citext with schema extensions;
create extension if not exists pg_trgm with schema extensions;

create schema if not exists private;
revoke all on schema private from public;

-- ---------------------------------------------------------------------------
-- Helpers
-- ---------------------------------------------------------------------------
create or replace function public.set_updated_at() returns trigger
language plpgsql as $$
begin
  new.updated_at := now();
  return new;
end $$;

create table if not exists private.app_config (
  key text primary key,
  value text not null,
  updated_at timestamptz not null default now()
);

create table if not exists private.owner_allowlist (
  email extensions.citext primary key,
  created_at timestamptz not null default now()
);

-- ---------------------------------------------------------------------------
-- Workspaces & membership
-- ---------------------------------------------------------------------------
create table if not exists public.workspaces (
  id uuid primary key default extensions.gen_random_uuid(),
  name text not null default 'Puma Utilities',
  settings jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.profiles (
  user_id uuid primary key references auth.users(id) on delete cascade,
  email extensions.citext,
  full_name text,
  title text,
  phone text,
  avatar_url text,
  preferences jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.workspace_members (
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  role text not null default 'member' check (role in ('owner', 'admin', 'member')),
  created_at timestamptz not null default now(),
  primary key (workspace_id, user_id)
);
create index if not exists workspace_members_user_idx on public.workspace_members(user_id);

create table if not exists public.invitations (
  id uuid primary key default extensions.gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  email extensions.citext not null,
  role text not null default 'member' check (role in ('admin', 'member')),
  token text not null unique default encode(extensions.gen_random_bytes(24), 'hex'),
  invited_by uuid references auth.users(id) on delete set null,
  accepted_at timestamptz,
  expires_at timestamptz not null default now() + interval '30 days',
  created_at timestamptz not null default now()
);
create index if not exists invitations_email_idx on public.invitations(email) where accepted_at is null;

-- ---------------------------------------------------------------------------
-- CRM
-- ---------------------------------------------------------------------------
create table if not exists public.companies (
  id uuid primary key default extensions.gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  name text not null,
  name_key text not null,
  legal_name text,
  domain extensions.citext,
  website text,
  phone text,
  email extensions.citext,
  address text,
  city text,
  state text,
  zip text,
  company_type text not null default 'unknown'
    check (company_type in ('owner_operator', 'property_manager', 'developer', 'reit', 'nonprofit', 'public_housing', 'investor', 'other', 'unknown')),
  stage text not null default 'new'
    check (stage in ('new', 'qualified', 'contacted', 'meeting', 'proposal', 'installation', 'client', 'lost')),
  owner_user_id uuid references auth.users(id) on delete set null,
  score integer check (score between 0 and 100),
  score_breakdown jsonb not null default '[]'::jsonb,
  score_confidence text check (score_confidence in ('high', 'medium', 'low')),
  portfolio_buildings integer,
  portfolio_units integer,
  portfolio_basis text,
  est_annual_water_spend numeric(14, 2),
  tags text[] not null default '{}',
  description text,
  linkedin_url text,
  source text not null default 'manual' check (source in ('manual', 'engine', 'import')),
  source_ref jsonb not null default '{}'::jsonb,
  research jsonb not null default '{}'::jsonb,
  research_status text not null default 'none' check (research_status in ('none', 'queued', 'running', 'done', 'failed')),
  researched_at timestamptz,
  next_follow_up_at timestamptz,
  last_activity_at timestamptz,
  last_contacted_at timestamptz,
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (workspace_id, name_key)
);
create unique index if not exists companies_domain_uniq on public.companies(workspace_id, domain) where domain is not null;
create index if not exists companies_ws_stage_idx on public.companies(workspace_id, stage);
create index if not exists companies_ws_score_idx on public.companies(workspace_id, score desc nulls last);
create index if not exists companies_name_trgm on public.companies using gin (name extensions.gin_trgm_ops);
create index if not exists companies_followup_idx on public.companies(workspace_id, next_follow_up_at) where next_follow_up_at is not null;

create table if not exists public.contacts (
  id uuid primary key default extensions.gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  company_id uuid references public.companies(id) on delete set null,
  first_name text,
  last_name text,
  full_name text not null,
  title text,
  role_category text not null default 'other'
    check (role_category in ('owner', 'executive', 'property_manager', 'operations', 'maintenance', 'finance', 'leasing', 'other')),
  is_decision_maker boolean not null default false,
  email extensions.citext,
  email_status text not null default 'unknown' check (email_status in ('verified', 'published', 'inferred', 'unknown', 'bounced')),
  phone text,
  mobile text,
  linkedin_url text,
  address text,
  source text not null default 'manual',
  source_ref jsonb not null default '{}'::jsonb,
  confidence numeric(4, 3),
  tags text[] not null default '{}',
  notes text,
  unsubscribed_at timestamptz,
  bounced_at timestamptz,
  last_contacted_at timestamptz,
  last_replied_at timestamptz,
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create unique index if not exists contacts_email_uniq on public.contacts(workspace_id, email) where email is not null;
create index if not exists contacts_company_idx on public.contacts(company_id);
create index if not exists contacts_name_trgm on public.contacts using gin (full_name extensions.gin_trgm_ops);

create table if not exists public.properties (
  id uuid primary key default extensions.gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  company_id uuid references public.companies(id) on delete set null,
  source_key text,
  name text,
  address text not null,
  city text,
  state text,
  zip text,
  county text,
  lat double precision,
  lon double precision,
  units integer,
  buildings integer,
  year_built integer,
  stories integer,
  building_class text,
  gross_sqft integer,
  assessed_value numeric(16, 2),
  parcel_id text,
  bbl text,
  owner_name_on_record text,
  owner_mailing_address text,
  manager_name text,
  utility_name text,
  utility_pwsid text,
  meter_status text not null default 'unknown' check (meter_status in ('unknown', 'smart', 'ami_available', 'manual', 'puma_installed')),
  est_annual_water_gallons numeric(16, 2),
  est_annual_water_cost numeric(14, 2),
  reported_water_kgal numeric(14, 2),
  reported_water_year integer,
  energy_star_score integer,
  source text not null default 'manual',
  source_ref jsonb not null default '{}'::jsonb,
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create unique index if not exists properties_source_key_uniq on public.properties(workspace_id, source_key) where source_key is not null;
create index if not exists properties_company_idx on public.properties(company_id);
create index if not exists properties_ws_state_idx on public.properties(workspace_id, state);

create table if not exists public.activities (
  id uuid primary key default extensions.gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  company_id uuid references public.companies(id) on delete cascade,
  contact_id uuid references public.contacts(id) on delete set null,
  property_id uuid references public.properties(id) on delete set null,
  type text not null check (type in ('note', 'voice_note', 'call', 'meeting', 'email_out', 'email_in', 'stage_change', 'task_done', 'research', 'campaign', 'system')),
  subject text,
  body text,
  meta jsonb not null default '{}'::jsonb,
  occurred_at timestamptz not null default now(),
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now()
);
create index if not exists activities_company_idx on public.activities(company_id, occurred_at desc);
create index if not exists activities_ws_idx on public.activities(workspace_id, occurred_at desc);
create index if not exists activities_contact_idx on public.activities(contact_id, occurred_at desc);

create table if not exists public.tasks (
  id uuid primary key default extensions.gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  company_id uuid references public.companies(id) on delete cascade,
  contact_id uuid references public.contacts(id) on delete set null,
  property_id uuid references public.properties(id) on delete set null,
  title text not null,
  notes text,
  type text not null default 'todo' check (type in ('todo', 'call', 'email', 'follow_up', 'meeting', 'site_visit')),
  priority text not null default 'normal' check (priority in ('low', 'normal', 'high')),
  status text not null default 'open' check (status in ('open', 'done')),
  due_at timestamptz,
  assignee_id uuid references auth.users(id) on delete set null,
  completed_at timestamptz,
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists tasks_ws_due_idx on public.tasks(workspace_id, status, due_at);
create index if not exists tasks_company_idx on public.tasks(company_id);

create table if not exists public.evidence (
  id uuid primary key default extensions.gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  entity_type text not null check (entity_type in ('company', 'contact', 'property')),
  entity_id uuid not null,
  field text not null,
  value text,
  source_id text not null,
  source_name text not null,
  source_url text,
  method text not null default 'api' check (method in ('api', 'scrape', 'browser', 'inferred', 'user', 'derived')),
  confidence numeric(4, 3) not null default 0.8,
  retrieved_at timestamptz not null default now(),
  meta jsonb not null default '{}'::jsonb
);
create index if not exists evidence_entity_idx on public.evidence(entity_type, entity_id);

create table if not exists public.payables (
  id uuid primary key default extensions.gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  company_id uuid references public.companies(id) on delete cascade,
  property_id uuid references public.properties(id) on delete set null,
  description text not null,
  amount numeric(14, 2) not null default 0,
  status text not null default 'due' check (status in ('draft', 'due', 'paid', 'overdue', 'void')),
  due_date date,
  paid_at timestamptz,
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists payables_ws_idx on public.payables(workspace_id, status);

-- Monitoring (client-authorized meter data only)
create table if not exists public.meters (
  id uuid primary key default extensions.gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  property_id uuid not null references public.properties(id) on delete cascade,
  label text not null,
  utility_account text,
  meter_number text,
  meter_type text not null default 'water',
  status text not null default 'active' check (status in ('active', 'inactive')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create table if not exists public.meter_readings (
  id uuid primary key default extensions.gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  meter_id uuid not null references public.meters(id) on delete cascade,
  period_start timestamptz,
  period_end timestamptz not null,
  gallons numeric(16, 2),
  cost numeric(14, 2),
  source text not null default 'manual' check (source in ('manual', 'import', 'api')),
  flags jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);
create index if not exists meter_readings_meter_idx on public.meter_readings(meter_id, period_end desc);
create table if not exists public.alerts (
  id uuid primary key default extensions.gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  property_id uuid references public.properties(id) on delete cascade,
  meter_id uuid references public.meters(id) on delete cascade,
  reading_id uuid references public.meter_readings(id) on delete cascade,
  kind text not null check (kind in ('continuous_flow', 'spike', 'spend_threshold', 'no_data')),
  severity text not null default 'warning' check (severity in ('info', 'warning', 'critical')),
  title text not null,
  detail text,
  status text not null default 'open' check (status in ('open', 'acknowledged', 'resolved')),
  detected_at timestamptz not null default now(),
  resolved_at timestamptz
);
create index if not exists alerts_ws_idx on public.alerts(workspace_id, status, detected_at desc);

create table if not exists public.saved_views (
  id uuid primary key default extensions.gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  user_id uuid references auth.users(id) on delete cascade,
  entity text not null check (entity in ('companies', 'contacts', 'properties')),
  name text not null,
  filters jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

-- ---------------------------------------------------------------------------
-- Research engine
-- ---------------------------------------------------------------------------
create table if not exists public.research_jobs (
  id uuid primary key default extensions.gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  kind text not null check (kind in ('discover', 'enrich')),
  title text not null,
  input jsonb not null default '{}'::jsonb,
  status text not null default 'queued' check (status in ('queued', 'running', 'completed', 'failed', 'canceled')),
  progress numeric(5, 2) not null default 0,
  stage text,
  log jsonb not null default '[]'::jsonb,
  stats jsonb not null default '{}'::jsonb,
  state jsonb not null default '{}'::jsonb,
  error text,
  attempts integer not null default 0,
  lease_until timestamptz,
  target_company_id uuid references public.companies(id) on delete set null,
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  started_at timestamptz,
  finished_at timestamptz,
  updated_at timestamptz not null default now()
);
create index if not exists research_jobs_ws_idx on public.research_jobs(workspace_id, created_at desc);
create index if not exists research_jobs_runnable_idx on public.research_jobs(status, lease_until) where status in ('queued', 'running');

create table if not exists public.lead_candidates (
  id uuid primary key default extensions.gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  job_id uuid not null references public.research_jobs(id) on delete cascade,
  key text not null,
  name text not null,
  kind text not null default 'company' check (kind in ('company', 'owner_cluster')),
  state text,
  city text,
  score integer,
  score_breakdown jsonb not null default '[]'::jsonb,
  summary jsonb not null default '{}'::jsonb,
  status text not null default 'new' check (status in ('new', 'saved', 'dismissed')),
  company_id uuid references public.companies(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (job_id, key)
);
create index if not exists lead_candidates_job_idx on public.lead_candidates(job_id, score desc nulls last);

create table if not exists public.source_cache (
  key text primary key,
  url text not null,
  status integer not null,
  body text not null,
  content_type text,
  fetched_at timestamptz not null default now(),
  expires_at timestamptz not null
);
create index if not exists source_cache_expires_idx on public.source_cache(expires_at);

create table if not exists public.source_health (
  source_id text primary key,
  ok_count integer not null default 0,
  error_count integer not null default 0,
  consecutive_errors integer not null default 0,
  last_ok_at timestamptz,
  last_error_at timestamptz,
  last_error text,
  avg_ms integer,
  disabled_until timestamptz,
  updated_at timestamptz not null default now()
);

-- ---------------------------------------------------------------------------
-- Email: mailboxes, messages, campaigns
-- ---------------------------------------------------------------------------
create table if not exists public.mailboxes (
  id uuid primary key default extensions.gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  user_id uuid references auth.users(id) on delete set null,
  provider text not null check (provider in ('smtp_imap', 'gmail', 'microsoft')),
  email extensions.citext not null,
  display_name text,
  smtp_host text,
  smtp_port integer,
  smtp_secure boolean,
  imap_host text,
  imap_port integer,
  imap_secure boolean,
  username text,
  secret_enc text,
  access_token_enc text,
  token_expires_at timestamptz,
  status text not null default 'active' check (status in ('active', 'error', 'disconnected')),
  last_error text,
  last_sync_at timestamptz,
  sync_state jsonb not null default '{}'::jsonb,
  daily_limit integer not null default 150,
  signature_html text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (workspace_id, email)
);

create table if not exists public.email_messages (
  id uuid primary key default extensions.gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  mailbox_id uuid not null references public.mailboxes(id) on delete cascade,
  direction text not null check (direction in ('in', 'out')),
  provider_id text not null,
  message_id_header text,
  thread_key text,
  in_reply_to text,
  references_header text,
  from_email extensions.citext,
  from_name text,
  to_emails text[] not null default '{}',
  cc_emails text[] not null default '{}',
  subject text,
  snippet text,
  body_text text,
  body_html text,
  sent_at timestamptz not null default now(),
  is_read boolean not null default false,
  contact_id uuid references public.contacts(id) on delete set null,
  company_id uuid references public.companies(id) on delete set null,
  campaign_id uuid,
  recipient_id uuid,
  created_at timestamptz not null default now(),
  unique (mailbox_id, provider_id)
);
create index if not exists email_messages_ws_idx on public.email_messages(workspace_id, sent_at desc);
create index if not exists email_messages_thread_idx on public.email_messages(mailbox_id, thread_key);
create index if not exists email_messages_msgid_idx on public.email_messages(message_id_header);
create index if not exists email_messages_company_idx on public.email_messages(company_id, sent_at desc);

create table if not exists public.campaigns (
  id uuid primary key default extensions.gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  mailbox_id uuid references public.mailboxes(id) on delete set null,
  name text not null,
  status text not null default 'draft' check (status in ('draft', 'scheduled', 'sending', 'paused', 'completed', 'canceled')),
  settings jsonb not null default '{}'::jsonb,
  stats jsonb not null default '{}'::jsonb,
  scheduled_at timestamptz,
  started_at timestamptz,
  completed_at timestamptz,
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists campaigns_ws_idx on public.campaigns(workspace_id, created_at desc);

create table if not exists public.campaign_steps (
  id uuid primary key default extensions.gen_random_uuid(),
  campaign_id uuid not null references public.campaigns(id) on delete cascade,
  position integer not null,
  delay_days integer not null default 0,
  subject text not null default '',
  body_html text not null default '',
  created_at timestamptz not null default now(),
  unique (campaign_id, position)
);

create table if not exists public.campaign_recipients (
  id uuid primary key default extensions.gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  campaign_id uuid not null references public.campaigns(id) on delete cascade,
  contact_id uuid references public.contacts(id) on delete set null,
  company_id uuid references public.companies(id) on delete set null,
  email extensions.citext not null,
  first_name text,
  last_name text,
  company_name text,
  merge jsonb not null default '{}'::jsonb,
  token text not null unique default encode(extensions.gen_random_bytes(16), 'hex'),
  status text not null default 'queued' check (status in ('queued', 'active', 'completed', 'replied', 'bounced', 'unsubscribed', 'failed', 'skipped')),
  current_step integer not null default 0,
  next_send_at timestamptz,
  last_sent_at timestamptz,
  opened_at timestamptz,
  open_count integer not null default 0,
  clicked_at timestamptz,
  click_count integer not null default 0,
  replied_at timestamptz,
  bounced_at timestamptz,
  unsubscribed_at timestamptz,
  error text,
  last_message_id text,
  thread_key text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (campaign_id, email)
);
create index if not exists campaign_recipients_due_idx on public.campaign_recipients(next_send_at) where status in ('queued', 'active');
create index if not exists campaign_recipients_campaign_idx on public.campaign_recipients(campaign_id, status);

create table if not exists public.email_events (
  id bigint generated always as identity primary key,
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  campaign_id uuid references public.campaigns(id) on delete cascade,
  recipient_id uuid references public.campaign_recipients(id) on delete cascade,
  type text not null check (type in ('sent', 'open', 'click', 'reply', 'bounce', 'unsubscribe', 'error')),
  meta jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);
create index if not exists email_events_campaign_idx on public.email_events(campaign_id, type, created_at desc);

create table if not exists public.suppressions (
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  email extensions.citext not null,
  reason text not null check (reason in ('unsubscribed', 'bounced', 'manual', 'complaint')),
  created_at timestamptz not null default now(),
  primary key (workspace_id, email)
);

create table if not exists public.notifications (
  id uuid primary key default extensions.gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  user_id uuid references auth.users(id) on delete cascade,
  kind text not null,
  title text not null,
  body text,
  href text,
  read_at timestamptz,
  created_at timestamptz not null default now()
);
create index if not exists notifications_user_idx on public.notifications(workspace_id, user_id, created_at desc);

-- ---------------------------------------------------------------------------
-- updated_at triggers
-- ---------------------------------------------------------------------------
do $$
declare t text;
begin
  foreach t in array array['workspaces','profiles','companies','contacts','properties','tasks','payables','meters','research_jobs','lead_candidates','mailboxes','campaigns','campaign_recipients']
  loop
    execute format('drop trigger if exists set_updated_at on public.%I', t);
    execute format('create trigger set_updated_at before update on public.%I for each row execute function public.set_updated_at()', t);
  end loop;
end $$;

-- ---------------------------------------------------------------------------
-- Auth gate: invite-only signups, auto-provision membership
-- ---------------------------------------------------------------------------
create or replace function private.gate_new_user() returns trigger
language plpgsql security definer set search_path = public, private, extensions as $$
begin
  if exists (select 1 from private.owner_allowlist a where a.email = new.email::extensions.citext)
     or exists (select 1 from public.invitations i where i.email = new.email::extensions.citext and i.accepted_at is null and i.expires_at > now()) then
    new.email_confirmed_at := coalesce(new.email_confirmed_at, now());
    return new;
  end if;
  raise exception 'PUMA_INVITE_REQUIRED: % has not been invited to Puma Utilities', new.email using errcode = 'P0001';
end $$;

create or replace function private.provision_new_user() returns trigger
language plpgsql security definer set search_path = public, private, extensions as $$
declare
  inv record;
  ws uuid;
  joined boolean := false;
begin
  insert into public.profiles(user_id, email, full_name)
  values (new.id, new.email, coalesce(new.raw_user_meta_data->>'full_name', split_part(new.email, '@', 1)))
  on conflict (user_id) do nothing;

  for inv in select * from public.invitations i where i.email = new.email::extensions.citext and i.accepted_at is null and i.expires_at > now() loop
    insert into public.workspace_members(workspace_id, user_id, role) values (inv.workspace_id, new.id, inv.role)
    on conflict do nothing;
    update public.invitations set accepted_at = now() where id = inv.id;
    joined := true;
  end loop;

  if not joined and exists (select 1 from private.owner_allowlist a where a.email = new.email::extensions.citext) then
    select id into ws from public.workspaces order by created_at limit 1;
    if ws is null then
      insert into public.workspaces(name) values ('Puma Utilities') returning id into ws;
      insert into public.workspace_members(workspace_id, user_id, role) values (ws, new.id, 'owner');
    else
      insert into public.workspace_members(workspace_id, user_id, role) values (ws, new.id, 'owner') on conflict do nothing;
    end if;
  end if;
  return new;
end $$;

drop trigger if exists puma_gate_new_user on auth.users;
create trigger puma_gate_new_user before insert on auth.users for each row execute function private.gate_new_user();
drop trigger if exists puma_provision_new_user on auth.users;
create trigger puma_provision_new_user after insert on auth.users for each row execute function private.provision_new_user();

-- ---------------------------------------------------------------------------
-- RLS (defense in depth; the server role bypasses RLS)
-- ---------------------------------------------------------------------------
create or replace function public.is_workspace_member(ws uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.workspace_members m where m.workspace_id = ws and m.user_id = auth.uid())
$$;

do $$
declare t text;
begin
  foreach t in array array['companies','contacts','properties','activities','tasks','evidence','payables','meters','meter_readings','alerts','saved_views','research_jobs','lead_candidates','mailboxes','email_messages','campaigns','campaign_recipients','email_events','suppressions','notifications','invitations']
  loop
    execute format('alter table public.%I enable row level security', t);
    execute format('drop policy if exists member_all on public.%I', t);
    execute format('create policy member_all on public.%I for all to authenticated using (public.is_workspace_member(workspace_id)) with check (public.is_workspace_member(workspace_id))', t);
  end loop;
end $$;

alter table public.workspaces enable row level security;
drop policy if exists member_read on public.workspaces;
create policy member_read on public.workspaces for select to authenticated using (public.is_workspace_member(id));
alter table public.workspace_members enable row level security;
drop policy if exists member_read on public.workspace_members;
create policy member_read on public.workspace_members for select to authenticated using (public.is_workspace_member(workspace_id));
alter table public.profiles enable row level security;
drop policy if exists self_all on public.profiles;
create policy self_all on public.profiles for all to authenticated using (user_id = auth.uid()) with check (user_id = auth.uid());
alter table public.campaign_steps enable row level security;
drop policy if exists member_all on public.campaign_steps;
create policy member_all on public.campaign_steps for all to authenticated
  using (exists (select 1 from public.campaigns c where c.id = campaign_id and public.is_workspace_member(c.workspace_id)));
alter table public.source_cache enable row level security;
alter table public.source_health enable row level security;

revoke all on all tables in schema public from anon;
revoke all on all tables in schema private from anon, authenticated;
