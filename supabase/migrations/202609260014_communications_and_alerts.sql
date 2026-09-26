create extension if not exists pg_cron;
create extension if not exists pg_net with schema extensions;
create schema if not exists private;

create table if not exists public.mailboxes (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  label text not null default 'Company email',
  from_name text,
  from_email text not null,
  smtp_host text not null,
  smtp_port integer not null default 465 check (smtp_port between 1 and 65535),
  smtp_secure boolean not null default true,
  smtp_username text not null,
  secret_id uuid,
  verified_at timestamptz,
  is_default boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (workspace_id, from_email)
);

create table if not exists public.outbound_messages (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  mailbox_id uuid not null references public.mailboxes(id) on delete cascade,
  company_id uuid references public.companies(id) on delete set null,
  person_id uuid references public.people(id) on delete set null,
  recipient_email text not null,
  recipient_name text,
  subject text not null,
  body_text text not null,
  body_html text,
  scheduled_for timestamptz not null default now(),
  status text not null default 'queued' check (status in ('queued','leased','sending','sent','failed','cancelled')),
  attempt_count integer not null default 0,
  max_attempts integer not null default 3,
  lease_owner text,
  lease_expires_at timestamptz,
  sent_at timestamptz,
  last_error text,
  created_by uuid default auth.uid(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.notification_preferences (
  workspace_id uuid primary key references public.workspaces(id) on delete cascade,
  push_enabled boolean not null default false,
  email_enabled boolean not null default false,
  alert_email text,
  research_complete boolean not null default true,
  follow_up_due boolean not null default true,
  email_delivery boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.push_subscriptions (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  endpoint text not null,
  p256dh text not null,
  auth text not null,
  user_agent text,
  created_at timestamptz not null default now(),
  last_used_at timestamptz,
  unique (workspace_id, endpoint)
);

create table if not exists public.notifications (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  kind text not null,
  title text not null,
  body text not null,
  href text,
  dedupe_key text,
  push_status text not null default 'pending' check (push_status in ('pending','sent','failed','disabled')),
  email_status text not null default 'pending' check (email_status in ('pending','sent','failed','disabled')),
  push_error text,
  email_error text,
  read_at timestamptz,
  created_at timestamptz not null default now(),
  unique (workspace_id, dedupe_key)
);

create index if not exists outbound_messages_due_idx on public.outbound_messages(status, scheduled_for) where status in ('queued','leased','sending');
create index if not exists notifications_delivery_idx on public.notifications(workspace_id, created_at) where push_status = 'pending' or email_status = 'pending';
create index if not exists push_subscriptions_workspace_idx on public.push_subscriptions(workspace_id);

alter table public.mailboxes enable row level security;
alter table public.outbound_messages enable row level security;
alter table public.notification_preferences enable row level security;
alter table public.push_subscriptions enable row level security;
alter table public.notifications enable row level security;

create policy mailboxes_workspace_access on public.mailboxes for all to authenticated
  using (public.owns_workspace(workspace_id)) with check (public.owns_workspace(workspace_id));
create policy outbound_messages_workspace_access on public.outbound_messages for all to authenticated
  using (public.owns_workspace(workspace_id)) with check (public.owns_workspace(workspace_id));
create policy notification_preferences_workspace_access on public.notification_preferences for all to authenticated
  using (public.owns_workspace(workspace_id)) with check (public.owns_workspace(workspace_id));
create policy push_subscriptions_workspace_access on public.push_subscriptions for all to authenticated
  using (public.owns_workspace(workspace_id)) with check (public.owns_workspace(workspace_id));
create policy notifications_workspace_access on public.notifications for all to authenticated
  using (public.owns_workspace(workspace_id)) with check (public.owns_workspace(workspace_id));

create or replace function public.save_mailbox_secret(p_mailbox_id uuid, p_password text)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  sid uuid;
begin
  if p_mailbox_id is null or coalesce(p_password, '') = '' then
    raise exception 'mailbox id and password are required';
  end if;

  select secret_id into sid from public.mailboxes where id = p_mailbox_id;
  if not found then raise exception 'mailbox not found'; end if;

  if sid is null then
    select vault.create_secret(p_password, 'puma-mailbox-' || p_mailbox_id::text, 'Puma SMTP password') into sid;
    update public.mailboxes set secret_id = sid, updated_at = now() where id = p_mailbox_id;
  else
    perform vault.update_secret(sid, p_password, 'puma-mailbox-' || p_mailbox_id::text, 'Puma SMTP password');
  end if;

  return sid;
end;
$$;

create or replace function public.get_mailbox_secret(p_mailbox_id uuid)
returns text
language sql
stable
security definer
set search_path = ''
as $$
  select v.decrypted_secret
  from public.mailboxes m
  join vault.decrypted_secrets v on v.id = m.secret_id
  where m.id = p_mailbox_id
  limit 1;
$$;

create or replace function public.lease_outbound_messages(worker_name text, max_messages integer default 10)
returns setof public.outbound_messages
language plpgsql
security definer
set search_path = 'public'
as $$
begin
  return query
  with candidates as (
    select id
    from public.outbound_messages
    where scheduled_for <= now()
      and attempt_count < max_attempts
      and (
        status = 'queued'
        or (status in ('leased','sending') and lease_expires_at is not null and lease_expires_at < now())
      )
    order by scheduled_for asc, created_at asc
    for update skip locked
    limit greatest(1, least(coalesce(max_messages, 10), 25))
  )
  update public.outbound_messages m
  set status = 'leased',
      lease_owner = worker_name,
      lease_expires_at = now() + interval '90 seconds',
      attempt_count = case when m.status = 'queued' then m.attempt_count + 1 else m.attempt_count end,
      updated_at = now()
  from candidates c
  where m.id = c.id
  returning m.*;
end;
$$;

create or replace function public.enqueue_due_follow_up_notifications(max_rows integer default 50)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare inserted_count integer;
begin
  insert into public.notifications (workspace_id, kind, title, body, href, dedupe_key)
  select f.workspace_id,
         'follow_up_due',
         'Follow-up due',
         coalesce(nullif(f.note, ''), 'A client or prospect follow-up is due.'),
         '/clients/follow-ups',
         'follow-up:' || f.id::text
  from public.follow_ups f
  where f.due_at <= now()
    and lower(coalesce(f.status, 'open')) not in ('done','completed','closed','cancelled')
  order by f.due_at asc
  limit greatest(1, least(coalesce(max_rows, 50), 200))
  on conflict (workspace_id, dedupe_key) do nothing;

  get diagnostics inserted_count = row_count;
  return inserted_count;
end;
$$;

create or replace function public.enqueue_research_run_notification()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.status::text in ('completed','partial','failed')
     and (old.status is distinct from new.status) then
    insert into public.notifications (workspace_id, kind, title, body, href, dedupe_key)
    values (
      new.workspace_id,
      'research_complete',
      case when new.status::text = 'failed' then 'Research needs attention' else 'Research finished' end,
      case when new.status::text = 'completed' then 'Puma finished a research run and saved the evidence.'
           when new.status::text = 'partial' then 'Puma finished a research run with partial results.'
           else 'A Puma research run failed and may need another pass.' end,
      '/engine',
      'research:' || new.id::text || ':' || new.status::text
    ) on conflict (workspace_id, dedupe_key) do nothing;
  end if;
  return new;
end;
$$;

drop trigger if exists research_run_notification_trigger on public.research_runs;
create trigger research_run_notification_trigger
after update of status on public.research_runs
for each row execute function public.enqueue_research_run_notification();

create table if not exists private.communications_worker_dispatch (
  singleton_id boolean primary key default true check (singleton_id),
  endpoint_url text not null default 'https://ogseewoboddgnyvjdqoz.supabase.co/functions/v1/puma-communications',
  bearer_token text not null default encode(extensions.gen_random_bytes(32), 'hex'),
  enabled boolean not null default false,
  updated_at timestamptz not null default now()
);
revoke all on private.communications_worker_dispatch from public, anon, authenticated;
insert into private.communications_worker_dispatch (singleton_id) values (true) on conflict (singleton_id) do nothing;

create or replace function public.verify_communications_worker_token(candidate_token text)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from private.communications_worker_dispatch d
    where d.singleton_id = true
      and candidate_token is not null
      and length(candidate_token) >= 32
      and extensions.digest(candidate_token, 'sha256') = extensions.digest(d.bearer_token, 'sha256')
  );
$$;

create or replace function public.dispatch_communications_worker_tick()
returns bigint
language plpgsql
security definer
set search_path = ''
as $$
declare cfg record; request_id bigint;
begin
  select endpoint_url, bearer_token, enabled into cfg
  from private.communications_worker_dispatch where singleton_id = true;
  if not coalesce(cfg.enabled, false) then return null; end if;

  select net.http_post(
    url := cfg.endpoint_url,
    headers := jsonb_build_object('Content-Type','application/json','Authorization','Bearer ' || cfg.bearer_token),
    body := '{"action":"worker_tick"}'::jsonb,
    timeout_milliseconds := 45000
  ) into request_id;
  return request_id;
end;
$$;

create or replace function public.configure_communications_worker_dispatch(active boolean)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  update private.communications_worker_dispatch set enabled = active, updated_at = now() where singleton_id = true;
end;
$$;

do $$
begin
  if not exists (select 1 from cron.job where jobname = 'puma-communications-worker') then
    perform cron.schedule('puma-communications-worker', '* * * * *', 'select public.dispatch_communications_worker_tick();');
  end if;
end $$;

revoke all on function public.save_mailbox_secret(uuid, text) from public, anon, authenticated;
revoke all on function public.get_mailbox_secret(uuid) from public, anon, authenticated;
revoke all on function public.lease_outbound_messages(text, integer) from public, anon, authenticated;
revoke all on function public.enqueue_due_follow_up_notifications(integer) from public, anon, authenticated;
revoke all on function public.verify_communications_worker_token(text) from public, anon, authenticated;
revoke all on function public.dispatch_communications_worker_tick() from public, anon, authenticated;
revoke all on function public.configure_communications_worker_dispatch(boolean) from public, anon, authenticated;

grant execute on function public.save_mailbox_secret(uuid, text) to service_role;
grant execute on function public.get_mailbox_secret(uuid) to service_role;
grant execute on function public.lease_outbound_messages(text, integer) to service_role;
grant execute on function public.enqueue_due_follow_up_notifications(integer) to service_role;
grant execute on function public.verify_communications_worker_token(text) to service_role;
