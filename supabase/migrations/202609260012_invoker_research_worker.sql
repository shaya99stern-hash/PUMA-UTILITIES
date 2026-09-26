-- Follow-up hardening: remove anonymously executable SECURITY DEFINER worker RPCs.
-- A SHA-256 digest of the high-entropy worker token is safe to expose for comparison;
-- the raw token remains only in the private dispatch table.

create table if not exists public.research_worker_credentials (
  singleton_id boolean primary key default true check (singleton_id),
  token_sha256 bytea not null,
  updated_at timestamptz not null default now()
);

alter table public.research_worker_credentials enable row level security;
drop policy if exists research_worker_credential_read on public.research_worker_credentials;
create policy research_worker_credential_read on public.research_worker_credentials
  for select to anon using (true);

revoke all on table public.research_worker_credentials from public, authenticated;
grant select (singleton_id, token_sha256) on public.research_worker_credentials to anon;

insert into public.research_worker_credentials (singleton_id, token_sha256, updated_at)
select true, extensions.digest(d.bearer_token, 'sha256'), now()
from private.research_worker_dispatch d
where d.singleton_id = true
on conflict (singleton_id) do update
set token_sha256 = excluded.token_sha256,
    updated_at = excluded.updated_at;

create or replace function private.sync_research_worker_credential()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.research_worker_credentials (singleton_id, token_sha256, updated_at)
  values (true, extensions.digest(new.bearer_token, 'sha256'), now())
  on conflict (singleton_id) do update
  set token_sha256 = excluded.token_sha256,
      updated_at = excluded.updated_at;
  return new;
end;
$$;

revoke all on function private.sync_research_worker_credential() from public, anon, authenticated;
drop trigger if exists sync_research_worker_credential on private.research_worker_dispatch;
create trigger sync_research_worker_credential
after insert or update of bearer_token on private.research_worker_dispatch
for each row execute function private.sync_research_worker_credential();

create or replace function public.is_research_worker_request()
returns boolean
language plpgsql
stable
security invoker
set search_path = ''
as $$
declare
  request_headers jsonb;
  candidate_token text;
begin
  begin
    request_headers := nullif(pg_catalog.current_setting('request.headers', true), '')::jsonb;
  exception when others then
    return false;
  end;

  candidate_token := request_headers ->> 'x-puma-worker-token';
  if candidate_token is null or pg_catalog.length(candidate_token) < 32 then
    return false;
  end if;

  return exists (
    select 1
    from public.research_worker_credentials c
    where c.singleton_id = true
      and extensions.digest(candidate_token, 'sha256') = c.token_sha256
  );
end;
$$;

revoke all on function public.is_research_worker_request() from public, authenticated;
grant execute on function public.is_research_worker_request() to anon;

create or replace function public.verify_research_worker_token(candidate_token text)
returns boolean
language sql
stable
security invoker
set search_path = ''
as $$
  select public.is_research_worker_request()
    and candidate_token is not null
    and pg_catalog.length(candidate_token) >= 32
    and exists (
      select 1
      from public.research_worker_credentials c
      where c.singleton_id = true
        and extensions.digest(candidate_token, 'sha256') = c.token_sha256
    );
$$;

create table if not exists public.research_run_worker_leases (
  run_id uuid primary key references public.research_runs(id) on delete cascade,
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  lease_owner text not null,
  lease_expires_at timestamptz not null,
  updated_at timestamptz not null default now()
);

create index if not exists research_run_worker_leases_expiry_idx
  on public.research_run_worker_leases(lease_expires_at);

alter table public.research_run_worker_leases enable row level security;
drop policy if exists research_worker_lease_anon on public.research_run_worker_leases;
create policy research_worker_lease_anon on public.research_run_worker_leases
  for all to anon
  using (public.is_research_worker_request())
  with check (public.is_research_worker_request());
drop policy if exists research_worker_lease_owner on public.research_run_worker_leases;
create policy research_worker_lease_owner on public.research_run_worker_leases
  for all to authenticated
  using (public.owns_workspace(workspace_id))
  with check (public.owns_workspace(workspace_id));

grant select, insert, update, delete on public.research_run_worker_leases to anon, authenticated;

create or replace function public.claim_research_run_tick(
  worker_name text,
  target_run_id uuid,
  lease_seconds integer default 45
)
returns boolean
language plpgsql
security invoker
set search_path = 'public'
as $$
declare
  target_workspace_id uuid;
  claimed_run_id uuid;
begin
  if worker_name is null or btrim(worker_name) = '' then
    raise exception 'worker_name is required';
  end if;
  if target_run_id is null then
    raise exception 'target_run_id is required';
  end if;

  select r.workspace_id into target_workspace_id
  from public.research_runs r
  where r.id = target_run_id;
  if target_workspace_id is null then
    return false;
  end if;

  insert into public.research_run_worker_leases (
    run_id, workspace_id, lease_owner, lease_expires_at, updated_at
  ) values (
    target_run_id,
    target_workspace_id,
    worker_name,
    now() + make_interval(secs => greatest(15, least(coalesce(lease_seconds, 45), 60))),
    now()
  )
  on conflict (run_id) do update
  set lease_owner = excluded.lease_owner,
      lease_expires_at = excluded.lease_expires_at,
      updated_at = now()
  where public.research_run_worker_leases.lease_expires_at < now()
     or public.research_run_worker_leases.lease_owner = excluded.lease_owner
  returning run_id into claimed_run_id;

  return claimed_run_id is not null;
end;
$$;

create or replace function public.release_research_run_tick(worker_name text, target_run_id uuid)
returns boolean
language plpgsql
security invoker
set search_path = 'public'
as $$
begin
  delete from public.research_run_worker_leases
  where run_id = target_run_id
    and lease_owner = worker_name;
  return found;
end;
$$;

create or replace function public.next_research_run_for_worker()
returns uuid
language sql
stable
security invoker
set search_path = 'public'
as $$
  select t.run_id
  from public.research_tasks t
  join public.research_runs r on r.id = t.run_id
  left join public.research_run_worker_leases l on l.run_id = t.run_id
  where r.status in ('queued', 'running', 'partial')
    and (l.run_id is null or l.lease_expires_at < now())
    and (
      (t.status = 'queued' and t.attempt_count < t.max_attempts)
      or (
        t.status in ('leased', 'running')
        and t.lease_expires_at is not null
        and t.lease_expires_at < now()
      )
    )
    and t.not_before <= now()
  order by t.priority asc, t.created_at asc
  limit 1;
$$;

create or replace function public.lease_research_tasks(
  worker_name text,
  lease_seconds integer default 90,
  max_tasks integer default 1
)
returns setof public.research_tasks
language plpgsql
security invoker
set search_path = 'public'
as $$
begin
  if worker_name is null or btrim(worker_name) = '' then
    raise exception 'worker_name is required';
  end if;

  return query
  with candidates as (
    select id
    from public.research_tasks
    where (
      (status = 'queued' and attempt_count < max_attempts)
      or (
        status in ('leased', 'running')
        and lease_expires_at is not null
        and lease_expires_at < now()
      )
    )
      and not_before <= now()
    order by priority asc, created_at asc
    for update skip locked
    limit greatest(1, least(max_tasks, 10))
  )
  update public.research_tasks t
  set status = 'leased',
      lease_owner = worker_name,
      lease_expires_at = now() + make_interval(secs => greatest(15, least(lease_seconds, 600))),
      attempt_count = case when t.status = 'queued' then t.attempt_count + 1 else t.attempt_count end,
      updated_at = now()
  from candidates c
  where t.id = c.id
  returning t.*;
end;
$$;

create or replace function public.lease_research_tasks_for_run(
  worker_name text,
  target_run_id uuid,
  lease_seconds integer default 90,
  max_tasks integer default 1
)
returns setof public.research_tasks
language plpgsql
security invoker
set search_path = 'public'
as $$
begin
  if worker_name is null or btrim(worker_name) = '' then
    raise exception 'worker_name is required';
  end if;
  if target_run_id is null then
    raise exception 'target_run_id is required';
  end if;

  return query
  with candidates as (
    select id
    from public.research_tasks
    where run_id = target_run_id
      and (
        (status = 'queued' and attempt_count < max_attempts)
        or (
          status in ('leased', 'running')
          and lease_expires_at is not null
          and lease_expires_at < now()
        )
      )
      and not_before <= now()
    order by priority asc, created_at asc
    for update skip locked
    limit greatest(1, least(max_tasks, 10))
  )
  update public.research_tasks t
  set status = 'leased',
      lease_owner = worker_name,
      lease_expires_at = now() + make_interval(secs => greatest(15, least(lease_seconds, 600))),
      attempt_count = case when t.status = 'queued' then t.attempt_count + 1 else t.attempt_count end,
      started_at = coalesce(t.started_at, now()),
      updated_at = now()
  from candidates c
  where t.id = c.id
  returning t.*;
end;
$$;

-- Retire the SECURITY DEFINER lock RPCs exposed by the previous migration.
revoke execute on function public.claim_research_worker_tick(text, integer) from anon, authenticated;
revoke execute on function public.release_research_worker_tick(text) from anon, authenticated;
revoke execute on function public.claim_research_browser_tick(text, uuid, integer) from anon, authenticated;
revoke execute on function public.release_research_browser_tick(text, uuid) from anon, authenticated;

revoke execute on function public.verify_research_worker_token(text) from public, authenticated;
revoke execute on function public.claim_research_run_tick(text, uuid, integer) from public;
revoke execute on function public.release_research_run_tick(text, uuid) from public;
revoke execute on function public.next_research_run_for_worker() from public, authenticated;
revoke execute on function public.lease_research_tasks(text, integer, integer) from public, authenticated;
revoke execute on function public.lease_research_tasks_for_run(text, uuid, integer, integer) from public;

grant execute on function public.verify_research_worker_token(text) to anon;
grant execute on function public.claim_research_run_tick(text, uuid, integer) to anon, authenticated;
grant execute on function public.release_research_run_tick(text, uuid) to anon, authenticated;
grant execute on function public.next_research_run_for_worker() to anon;
grant execute on function public.lease_research_tasks(text, integer, integer) to anon;
grant execute on function public.lease_research_tasks_for_run(text, uuid, integer, integer) to anon, authenticated;
