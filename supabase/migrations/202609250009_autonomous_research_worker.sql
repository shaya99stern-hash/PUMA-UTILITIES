create extension if not exists pg_cron;
create extension if not exists pg_net with schema extensions;

create schema if not exists private;
revoke all on schema private from public, anon, authenticated;

create table if not exists private.research_worker_dispatch (
  singleton_id boolean primary key default true check (singleton_id),
  endpoint_url text,
  bearer_token text not null default encode(extensions.gen_random_bytes(32), 'hex'),
  enabled boolean not null default false,
  lease_owner text,
  lease_expires_at timestamptz,
  updated_at timestamptz not null default now()
);

revoke all on private.research_worker_dispatch from public, anon, authenticated;

insert into private.research_worker_dispatch (singleton_id)
values (true)
on conflict (singleton_id) do nothing;

create or replace function public.verify_research_worker_token(candidate_token text)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from private.research_worker_dispatch d
    where d.singleton_id = true
      and candidate_token is not null
      and length(candidate_token) >= 32
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
  limit 1;
$$;

create or replace function public.lease_research_tasks(worker_name text, lease_seconds integer default 90, max_tasks integer default 1)
returns setof public.research_tasks
language plpgsql
security definer
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

create or replace function public.lease_research_tasks_for_run(worker_name text, target_run_id uuid, lease_seconds integer default 90, max_tasks integer default 1)
returns setof public.research_tasks
language plpgsql
security definer
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

create or replace function public.dispatch_research_worker_tick()
returns bigint
language plpgsql
security definer
set search_path = ''
as $$
declare
  cfg record;
  request_id bigint;
begin
  select d.endpoint_url, d.bearer_token, d.enabled
  into cfg
  from private.research_worker_dispatch d
  where d.singleton_id = true;

  if not coalesce(cfg.enabled, false) or cfg.endpoint_url is null then
    return null;
  end if;

  select net.http_post(
    url := cfg.endpoint_url,
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'Authorization', 'Bearer ' || cfg.bearer_token
    ),
    body := '{}'::jsonb,
    timeout_milliseconds := 45000
  )
  into request_id;

  return request_id;
end;
$$;

create or replace function public.configure_research_worker_dispatch(endpoint text, active boolean default true)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  existing_job bigint;
begin
  if active and endpoint !~ '^https://puma-utilities\.vercel\.app/api/research/worker-tick$' then
    raise exception 'Research worker endpoint must use the Puma production HTTPS route.';
  end if;

  update private.research_worker_dispatch
  set endpoint_url = case when active then endpoint else endpoint_url end,
      enabled = active,
      updated_at = now()
  where singleton_id = true;

  for existing_job in
    select jobid from cron.job where jobname = 'puma-autonomous-research-worker'
  loop
    perform cron.unschedule(existing_job);
  end loop;

  if active then
    perform cron.schedule(
      'puma-autonomous-research-worker',
      '20 seconds',
      'select public.dispatch_research_worker_tick();'
    );
  end if;
end;
$$;

revoke execute on function public.verify_research_worker_token(text) from public, anon, authenticated;
revoke execute on function public.claim_research_worker_tick(text, integer) from public, anon, authenticated;
revoke execute on function public.release_research_worker_tick(text) from public, anon, authenticated;
revoke execute on function public.next_research_run_for_worker() from public, anon, authenticated;
revoke execute on function public.lease_research_tasks(text, integer, integer) from public, anon, authenticated;
revoke execute on function public.lease_research_tasks_for_run(text, uuid, integer, integer) from public, anon, authenticated;
revoke execute on function public.dispatch_research_worker_tick() from public, anon, authenticated;
revoke execute on function public.configure_research_worker_dispatch(text, boolean) from public, anon, authenticated;

grant execute on function public.verify_research_worker_token(text) to service_role;
grant execute on function public.claim_research_worker_tick(text, integer) to service_role;
grant execute on function public.release_research_worker_tick(text) to service_role;
grant execute on function public.next_research_run_for_worker() to service_role;
grant execute on function public.lease_research_tasks(text, integer, integer) to service_role;
grant execute on function public.lease_research_tasks_for_run(text, uuid, integer, integer) to service_role;
