-- Supabase only (requires pg_cron + pg_net): fire the app's background tick every minute.
-- private.app_config must hold 'app_url' and 'cron_secret' (same value as PUMA_CRON_SECRET on Vercel).
create or replace function private.fire_tick() returns void
language plpgsql security definer set search_path = private, extensions, public as $$
declare
  base text := (select value from private.app_config where key = 'app_url');
  secret text := (select value from private.app_config where key = 'cron_secret');
begin
  if base is null or secret is null then return; end if;
  perform net.http_post(
    url := base || '/api/cron/tick',
    headers := jsonb_build_object('Content-Type', 'application/json', 'x-cron-secret', secret),
    body := '{}'::jsonb,
    timeout_milliseconds := 60000
  );
end $$;
revoke all on function private.fire_tick() from public, anon, authenticated;
select cron.unschedule(jobid) from cron.job where jobname = 'puma-tick';
select cron.schedule('puma-tick', '* * * * *', $$select private.fire_tick()$$);
select cron.schedule('puma-cache-prune', '17 3 * * *', $$delete from public.source_cache where expires_at < now(); delete from net._http_response where created < now() - interval '1 day'$$);
