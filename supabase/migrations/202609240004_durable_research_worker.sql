create unique index if not exists research_tasks_run_subject_source_capability_uidx
  on public.research_tasks(run_id, subject_key, source_id, capability);

create index if not exists research_tasks_run_queue_idx
  on public.research_tasks(run_id, status, not_before, priority, created_at);

create or replace function public.lease_research_tasks_for_run(
  worker_name text,
  target_run_id uuid,
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
  if target_run_id is null then
    raise exception 'target_run_id is required';
  end if;

  return query
  with candidates as (
    select id
    from public.research_tasks
    where run_id = target_run_id
      and (status = 'queued' or (status = 'leased' and lease_expires_at < now()))
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
      started_at = coalesce(started_at, now()),
      updated_at = now()
  from candidates c
  where t.id = c.id
  returning t.*;
end;
$$;

revoke all on function public.lease_research_tasks_for_run(text, uuid, integer, integer) from public;
revoke all on function public.lease_research_tasks_for_run(text, uuid, integer, integer) from anon;
revoke all on function public.lease_research_tasks_for_run(text, uuid, integer, integer) from authenticated;
grant execute on function public.lease_research_tasks_for_run(text, uuid, integer, integer) to service_role;
