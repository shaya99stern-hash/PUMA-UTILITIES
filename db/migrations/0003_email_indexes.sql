-- Email subsystem indexes (idempotent). Speeds up per-mailbox daily send counts and recipient lookups.
create index if not exists email_events_sent_mailbox_idx
  on public.email_events ((meta->>'mailbox_id'), created_at desc) where type = 'sent';
create index if not exists email_events_recipient_idx on public.email_events(recipient_id, type);
create index if not exists campaign_recipients_email_idx on public.campaign_recipients(workspace_id, email);
create index if not exists email_messages_recipient_idx on public.email_messages(recipient_id) where recipient_id is not null;
create index if not exists email_messages_msgid_lower_idx on public.email_messages(mailbox_id, lower(message_id_header));
create index if not exists mailboxes_ws_idx on public.mailboxes(workspace_id);
