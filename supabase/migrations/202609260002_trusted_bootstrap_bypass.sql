create or replace function public.reserve_puma_device_bootstrap(
  p_device_hash text,
  p_ip_hash text,
  p_trusted boolean default false
)
returns text
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_global_count integer;
  v_ip_count integer;
begin
  if p_device_hash !~ '^[a-f0-9]{64}$' or p_ip_hash !~ '^[a-f0-9]{64}$' then
    raise exception 'invalid bootstrap hash';
  end if;

  perform pg_advisory_xact_lock(hashtext('puma_device_bootstrap_global'));

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

  if not p_trusted then
    select count(*)::integer into v_global_count
    from public.puma_device_bootstrap_registry
    where created_at >= now() - interval '24 hours';

    if v_global_count >= 25 then
      return 'global_limit';
    end if;

    select count(*)::integer into v_ip_count
    from public.puma_device_bootstrap_registry
    where ip_hash = p_ip_hash
      and created_at >= now() - interval '24 hours';

    if v_ip_count >= 5 then
      return 'ip_limit';
    end if;
  end if;

  insert into public.puma_device_bootstrap_registry (device_hash, ip_hash)
  values (p_device_hash, p_ip_hash);

  return 'new';
end;
$$;

revoke all on function public.reserve_puma_device_bootstrap(text, text, boolean) from public, anon, authenticated;
grant execute on function public.reserve_puma_device_bootstrap(text, text, boolean) to service_role;
