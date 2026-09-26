do $$
declare
  extension_schema text;
begin
  select n.nspname
  into extension_schema
  from pg_extension e
  join pg_namespace n on n.oid = e.extnamespace
  where e.extname = 'pg_net';

  if extension_schema = 'public' then
    drop extension pg_net;
    create extension pg_net with schema extensions;
  elsif extension_schema is null then
    create extension pg_net with schema extensions;
  end if;
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

revoke execute on function public.dispatch_research_worker_tick() from public, anon, authenticated;
