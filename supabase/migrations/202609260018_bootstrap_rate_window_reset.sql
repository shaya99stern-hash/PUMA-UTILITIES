create table if not exists private.puma_bootstrap_rate_window (
  singleton_id boolean primary key default true check (singleton_id),
  window_started_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
revoke all on private.puma_bootstrap_rate_window from public, anon, authenticated;
insert into private.puma_bootstrap_rate_window (singleton_id)
values (true)
on conflict (singleton_id) do nothing;

create or replace function public.reserve_puma_device_bootstrap(
  p_device_hash text,
  p_ip_hash text
)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_global_count integer;
  v_ip_count integer;
  v_window_start timestamptz;
begin
  if p_device_hash !~ '^[a-f0-9]{64}$' or p_ip_hash !~ '^[a-f0-9]{64}$' then
    raise exception 'invalid bootstrap hash';
  end if;

  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtext('puma_device_bootstrap_global'));

  if exists (
    select 1
    from public.puma_device_bootstrap_registry
    where device_hash = p_device_hash
  ) then
    update public.puma_device_bootstrap_registry
      set last_seen_at = now()
      where device_hash = p_device_hash;
    return 'existing';
  end if;

  select window_started_at into v_window_start
  from private.puma_bootstrap_rate_window
  where singleton_id = true;

  select count(*)::integer into v_global_count
  from public.puma_device_bootstrap_registry
  where created_at >= greatest(now() - interval '24 hours', v_window_start);

  if v_global_count >= 500 then
    return 'global_limit';
  end if;

  select count(*)::integer into v_ip_count
  from public.puma_device_bootstrap_registry
  where ip_hash = p_ip_hash
    and created_at >= greatest(now() - interval '24 hours', v_window_start);

  if v_ip_count >= 50 then
    return 'ip_limit';
  end if;

  insert into public.puma_device_bootstrap_registry (device_hash, ip_hash)
  values (p_device_hash, p_ip_hash);

  return 'new';
end;
$$;

revoke all on function public.reserve_puma_device_bootstrap(text, text) from public, anon, authenticated;
grant execute on function public.reserve_puma_device_bootstrap(text, text) to service_role;
