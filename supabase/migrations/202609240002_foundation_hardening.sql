-- Live Supabase advisor hardening for Lead Engine V2 foundation.

create or replace function public.owns_workspace(target_workspace_id uuid)
returns boolean
language sql
stable
security invoker
set search_path = public
as $$
  select exists (
    select 1
    from public.workspaces w
    where w.id = target_workspace_id
      and w.owner_user_id = auth.uid()
  );
$$;

revoke all on function public.owns_workspace(uuid) from public;
revoke all on function public.owns_workspace(uuid) from anon;
grant execute on function public.owns_workspace(uuid) to authenticated;

drop policy if exists workspace_owner_all on public.workspaces;
create policy workspace_owner_all on public.workspaces
  for all to authenticated
  using (owner_user_id = (select auth.uid()))
  with check (owner_user_id = (select auth.uid()));

create index if not exists activity_notes_company_id_idx on public.activity_notes(company_id);
create index if not exists activity_notes_property_id_idx on public.activity_notes(property_id);
create index if not exists company_people_person_id_idx on public.company_people(person_id);
create index if not exists company_people_workspace_id_idx on public.company_people(workspace_id);
create index if not exists company_properties_property_id_idx on public.company_properties(property_id);
create index if not exists company_properties_workspace_id_idx on public.company_properties(workspace_id);
create index if not exists entity_aliases_workspace_id_idx on public.entity_aliases(workspace_id);
create index if not exists entity_links_from_entity_id_idx on public.entity_links(from_entity_id);
create index if not exists entity_links_to_entity_id_idx on public.entity_links(to_entity_id);
create index if not exists entity_links_workspace_id_idx on public.entity_links(workspace_id);
create index if not exists follow_ups_company_id_idx on public.follow_ups(company_id);
create index if not exists pipeline_events_company_id_idx on public.pipeline_events(company_id);
create index if not exists pipeline_events_workspace_id_idx on public.pipeline_events(workspace_id);
create index if not exists property_utilities_utility_id_idx on public.property_utilities(utility_id);
create index if not exists property_utilities_workspace_id_idx on public.property_utilities(workspace_id);
create index if not exists provider_quota_snapshots_provider_account_id_idx on public.provider_quota_snapshots(provider_account_id);
create index if not exists provider_quota_snapshots_workspace_id_idx on public.provider_quota_snapshots(workspace_id);
create index if not exists provider_usage_events_provider_account_id_idx on public.provider_usage_events(provider_account_id);
create index if not exists provider_usage_events_run_id_idx on public.provider_usage_events(run_id);
create index if not exists provider_usage_events_task_id_idx on public.provider_usage_events(task_id);
create index if not exists provider_usage_events_workspace_id_idx on public.provider_usage_events(workspace_id);
create index if not exists research_claims_object_entity_id_idx on public.research_claims(object_entity_id);
create index if not exists research_claims_run_id_idx on public.research_claims(run_id);
create index if not exists research_claims_workspace_id_idx on public.research_claims(workspace_id);
create index if not exists research_entities_run_id_idx on public.research_entities(run_id);
create index if not exists research_evidence_task_id_idx on public.research_evidence(task_id);
create index if not exists research_evidence_workspace_id_idx on public.research_evidence(workspace_id);
create index if not exists research_runs_requested_by_idx on public.research_runs(requested_by);
create index if not exists research_tasks_workspace_id_idx on public.research_tasks(workspace_id);
create index if not exists tariffs_utility_id_idx on public.tariffs(utility_id);