/** Shapes returned by the email APIs, for client components. */
import type { BadgeTone } from '@/app/ui';

export type MailboxDto = {
  id: string;
  provider: 'smtp_imap' | 'gmail' | 'microsoft';
  email: string;
  display_name: string | null;
  smtp_host: string | null;
  smtp_port: number | null;
  imap_host: string | null;
  status: 'active' | 'error' | 'disconnected';
  last_error: string | null;
  last_sync_at: string | null;
  daily_limit: number;
  signature_html: string | null;
  has_secret: boolean;
  sent_today: number;
};

export type ThreadListItem = {
  threadKey: string;
  mailboxId: string;
  subject: string;
  snippet: string;
  fromEmail: string | null;
  fromName: string | null;
  to: string[];
  lastAt: string;
  messageCount: number;
  unread: number;
  company: { id: string; name: string; stage: string } | null;
  contact: { id: string | null; name: string } | null;
  campaign: { id: string; name: string } | null;
};

export type ThreadMessage = {
  id: string;
  mailbox_id: string;
  direction: 'in' | 'out';
  message_id_header: string | null;
  from_email: string | null;
  from_name: string | null;
  to_emails: string[];
  cc_emails: string[];
  subject: string | null;
  body_text: string | null;
  body_html: string | null;
  sent_at: string;
  is_read: boolean;
};

export type ThreadDetail = {
  threadKey: string;
  subject: string;
  mailbox: { id: string; email: string; display_name: string | null } | null;
  company: { id: string; name: string; stage: string; city: string | null; state: string | null } | null;
  contact: { id: string; full_name: string; title: string | null; email: string | null } | null;
  campaign: { id: string; name: string } | null;
  messages: ThreadMessage[];
};

export type CampaignSettingsDto = {
  dailyLimit: number;
  minDelaySec: number;
  maxDelaySec: number;
  sendDays: number[];
  windowStart: string;
  windowEnd: string;
  timezone: string;
  trackOpens: boolean;
  trackClicks: boolean;
  stopOnReply: boolean;
  includeSignature: boolean;
};

export type WorkspaceEmailDto = { name: string; companyName: string; companyAddress: string | null; defaults: CampaignSettingsDto };

export type CampaignListItem = {
  id: string;
  name: string;
  status: CampaignStatus;
  mailbox_email: string | null;
  created_at: string;
  started_at: string | null;
  total: number;
  contacted: number;
  opened: number;
  clicked: number;
  replied: number;
  bounced: number;
  unsubscribed: number;
  queued: number;
  steps: number;
  last_error: string | null;
};

export type CampaignStatus = 'draft' | 'scheduled' | 'sending' | 'paused' | 'completed' | 'canceled';

export const STATUS_TONE: Record<CampaignStatus, BadgeTone> = {
  draft: 'neutral',
  scheduled: 'info',
  sending: 'success',
  paused: 'warning',
  completed: 'info',
  canceled: 'neutral',
};

export const STATUS_LABEL: Record<CampaignStatus, string> = {
  draft: 'Draft',
  scheduled: 'Scheduled',
  sending: 'Sending',
  paused: 'Paused',
  completed: 'Completed',
  canceled: 'Canceled',
};

export const RECIPIENT_TONE: Record<string, BadgeTone> = {
  queued: 'neutral',
  active: 'info',
  completed: 'success',
  replied: 'accent',
  bounced: 'danger',
  unsubscribed: 'warning',
  failed: 'danger',
  skipped: 'neutral',
};

export type AudienceRowDto = {
  contact_id: string | null;
  company_id: string | null;
  email: string;
  first_name: string | null;
  last_name: string | null;
  full_name: string | null;
  title: string | null;
  is_decision_maker: boolean;
  company_name: string | null;
  city: string | null;
  state: string | null;
  stage: string | null;
  score: number | null;
  unsubscribed_at: string | null;
  bounced_at: string | null;
  suppressed: string | null;
};

export function audienceKey(row: Pick<AudienceRowDto, 'contact_id' | 'company_id' | 'email'>) {
  return row.contact_id ? `c:${row.contact_id}` : `e:${row.company_id ?? ''}:${row.email}`;
}
