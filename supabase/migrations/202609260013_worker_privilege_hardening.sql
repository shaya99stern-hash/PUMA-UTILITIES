-- Supabase default table grants are broader than this worker needs. RLS protects
-- row access, but the delegated worker should still have the smallest SQL privilege set.

revoke all on table public.research_worker_credentials from anon;
grant select (singleton_id, token_sha256) on public.research_worker_credentials to anon;

revoke all on table public.research_run_worker_leases from anon, authenticated;
grant select, insert, update, delete on public.research_run_worker_leases to anon, authenticated;

revoke all on table public.research_runs from anon;
grant select, update on public.research_runs to anon;

revoke all on table public.research_tasks from anon;
grant select, insert, update on public.research_tasks to anon;

revoke all on table public.provider_backoff_state from anon;
grant select, insert, update on public.provider_backoff_state to anon;
