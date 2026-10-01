import 'server-only';
import { sql } from '@/lib/server/db';

export type CampaignStats = {
  total: number;
  queued: number;
  active: number;
  completed: number;
  contacted: number;
  sent: number;
  opened: number;
  clicked: number;
  replied: number;
  bounced: number;
  unsubscribed: number;
  failed: number;
  skipped: number;
};

export async function computeCampaignStats(campaignId: string): Promise<CampaignStats> {
  const rows = await sql()<CampaignStats[]>`
    select
      count(*)::int as total,
      count(*) filter (where status = 'queued')::int as queued,
      count(*) filter (where status = 'active')::int as active,
      count(*) filter (where status = 'completed')::int as completed,
      count(*) filter (where last_sent_at is not null)::int as contacted,
      (select count(*)::int from email_events e where e.campaign_id = ${campaignId} and e.type = 'sent') as sent,
      count(*) filter (where opened_at is not null)::int as opened,
      count(*) filter (where clicked_at is not null)::int as clicked,
      count(*) filter (where replied_at is not null)::int as replied,
      count(*) filter (where status = 'bounced' or bounced_at is not null)::int as bounced,
      count(*) filter (where status = 'unsubscribed' or unsubscribed_at is not null)::int as unsubscribed,
      count(*) filter (where status = 'failed')::int as failed,
      count(*) filter (where status = 'skipped')::int as skipped
    from campaign_recipients where campaign_id = ${campaignId}`;
  return rows[0];
}

export async function refreshCampaignStats(campaignId: string): Promise<CampaignStats> {
  const stats = await computeCampaignStats(campaignId);
  await sql()`update campaigns set stats = coalesce(stats, '{}'::jsonb) || ${sql().json(stats as never)} where id = ${campaignId}`;
  return stats;
}
