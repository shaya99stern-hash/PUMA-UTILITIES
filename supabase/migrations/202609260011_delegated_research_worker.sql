-- Permit the autonomous research worker to use the public Supabase client without
-- shipping the project-wide service-role credential to Vercel. Access is limited
-- to research queue state and is authenticated by the existing private worker token.

create or replace function public.is_research_worker_request()
returns boolean
language plpgsql
stable
security definer
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
    from private.research_worker_dispatch d
    where d.singleton_id = true
      and extensions.digest(candidate_token, 'sha256') = extensions.digest(d.bearer_token, 'sha256')
  );
end;
$$;

revoke all on function public.is_research_worker_request() from public, anon, authenticated;
grant execute on function public.is_research_worker_request() to anon;

create or replace function public.verify_research_worker_token(candidate_token text)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select public.is_research_worker_request()
    and candidate_token is not null
    and pg_catalog.length(candidate_token) >= 32
    and exists (
      select 1
      from private.research_worker_dispatch d
      where d.singleton_id = true
        and extensions.digest(candidate_token, 'sha256') = extensions.digest(d.bearer_token, 'sha256')
    );
$$;

create or replace function public.claim_research_worker_tick(worker_name text, lease_seconds integer default 45)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not public.is_research_worker_request() then
    raise exception 'research worker authorization required' using errcode = '42501';
  end if;
  if worker_name is null or btrim(worker_name) = '' then
    raise exception 'worker_name is required';
  end if;

  update private.research_worker_dispatch
  set lease_owner = worker_name,
      lease_expires_at = now() + make_interval(secs => greatest(15, least(coalesce(lease_seconds, 45), 60))),
      updated_at = now()
  where singleton_id = true
    and (
      lease_owner is null
      or lease_expires_at is null
      or lease_expires_at < now()
      or lease_owner = worker_name
    );

  return found;
end;
$$;

create or replace function public.release_research_worker_tick(worker_name text)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not public.is_research_worker_request() then
    raise exception 'research worker authorization required' using errcode = '42501';
  end if;

  update private.research_worker_dispatch
  set lease_owner = null,
      lease_expires_at = null,
      updated_at = now()
  where singleton_id = true
    and lease_owner = worker_name;

  return found;
end;
$$;

create or replace function public.claim_research_browser_tick(
  worker_name text,
  target_run_id uuid,
  lease_seconds integer default 45
)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  target_workspace_id uuid;
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

  if auth.uid() is null or target_workspace_id is null or not public.owns_workspace(target_workspace_id) then
    raise exception 'research run ownership required' using errcode = '42501';
  end if;

  update private.research_worker_dispatch
  set lease_owner = worker_name,
      lease_expires_at = now() + make_interval(secs => greatest(15, least(coalesce(lease_seconds, 45), 60))),
      updated_at = now()
  where singleton_id = true
    and (
      lease_owner is null
      or lease_expires_at is null
      or lease_expires_at < now()
      or lease_owner = worker_name
    );

  return found;
end;
$$;

create or replace function public.release_research_browser_tick(worker_name text, target_run_id uuid)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  target_workspace_id uuid;
begin
  select r.workspace_id into target_workspace_id
  from public.research_runs r
  where r.id = target_run_id;

  if auth.uid() is null or target_workspace_id is null or not public.owns_workspace(target_workspace_id) then
    raise exception 'research run ownership required' using errcode = '42501';
  end if;

  update private.research_worker_dispatch
  set lease_owner = null,
      lease_expires_at = null,
      updated_at = now()
  where singleton_id = true
    and lease_owner = worker_name;

  return found;
end;
$$;

create or replace function public.next_research_run_for_worker()
returns uuid
language sql
stable
security definer
set search_path = ''
as $$
  select case
    when not public.is_research_worker_request() then null::uuid
    else (
      select t.run_id
      from public.research_tasks t
      join public.research_runs r on r.id = t.run_id
      where r.status in ('queued', 'running', 'partial')
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
      limit 1
    )
  end;
$$;

create or replace function public.lease_research_tasks(
  worker_name text,
  lease_seconds integer default 90,
  max_tasks integer default 1
)
returns setof public.research_tasks
language plpgsql
security definer
set search_path = 'public'
as $$
begin
  if not public.is_research_worker_request() then
    raise exception 'research worker authorization required' using errcode = '42501';
  end if;
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
security definer
set search_path = 'public'
as $$
declare
  target_workspace_id uuid;
begin
  if worker_name is null or btrim(worker_name) = '' then
    raise exception 'worker_name is required';
  end if;
  if target_run_id is null then
    raise exception 'target_run_id is required';
  end if;

  select workspace_id into target_workspace_id
  from public.research_runs
  where id = target_run_id;

  if not public.is_research_worker_request()
     and (auth.uid() is null or target_workspace_id is null or not public.owns_workspace(target_workspace_id)) then
    raise exception 'research worker authorization required' using errcode = '42501';
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

-- Existing owner policies continue to govern authenticated browser requests.
-- The anon policies below are useful only when the custom worker header matches
-- the private token generated inside Postgres.
DO $$
declare
  table_name text;
begin
  foreach table_name in array array['research_runs','research_tasks','provider_backoff_state'] loop
    execute format('drop policy if exists research_worker_all on public.%I', table_name);
    execute format(
      'create policy research_worker_all on public.%I for all to anon using (public.is_research_worker_request()) with check (public.is_research_worker_request())',
      table_name
    );
  end loop;
end $$;

revoke execute on function public.verify_research_worker_token(text) from public, authenticated;
revoke execute on function public.claim_research_worker_tick(text, integer) from public, authenticated;
revoke execute on function public.release_research_worker_tick(text) from public, authenticated;
revoke execute on function public.claim_research_browser_tick(text, uuid, integer) from public, anon;
revoke execute on function public.release_research_browser_tick(text, uuid) from public, anon;
revoke execute on function public.next_research_run_for_worker() from public, authenticated;
revoke execute on function public.lease_research_tasks(text, integer, integer) from public, authenticated;
revoke execute on function public.lease_research_tasks_for_run(text, uuid, integer, integer) from public;

grant execute on function public.verify_research_worker_token(text) to anon;
grant execute on function public.claim_research_worker_tick(text, integer) to anon;
grant execute on function public.release_research_worker_tick(text) to anon;
grant execute on function public.claim_research_browser_tick(text, uuid, integer) to authenticated;
grant execute on function public.release_research_browser_tick(text, uuid) to authenticated;
grant execute on function public.next_research_run_for_worker() to anon;
grant execute on function public.lease_research_tasks(text, integer, integer) to anon;
grant execute on function public.lease_research_tasks_for_run(text, uuid, integer, integer) to anon, authenticated;
