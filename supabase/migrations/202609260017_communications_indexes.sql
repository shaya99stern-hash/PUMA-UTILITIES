create index if not exists outbound_messages_workspace_idx on public.outbound_messages(workspace_id);
create index if not exists outbound_messages_mailbox_idx on public.outbound_messages(mailbox_id);
create index if not exists outbound_messages_company_idx on public.outbound_messages(company_id) where company_id is not null;
create index if not exists outbound_messages_person_idx on public.outbound_messages(person_id) where person_id is not null;
