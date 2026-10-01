/** Campaign / sending settings, validation and defaults. Pure and client-safe. */
import { z } from 'zod';

export function isValidTimezone(tz: string): boolean {
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: tz });
    return true;
  } catch {
    return false;
  }
}

const hm = z.string().regex(/^([01]?\d|2[0-3]):[0-5]\d$/, 'Use HH:MM');

export const campaignSettingsSchema = z.object({
  dailyLimit: z.number().int().min(1).max(2000).default(100),
  minDelaySec: z.number().int().min(5).max(3600).default(60),
  maxDelaySec: z.number().int().min(5).max(7200).default(180),
  sendDays: z.array(z.number().int().min(1).max(7)).min(1).default([1, 2, 3, 4, 5]),
  windowStart: hm.default('08:30'),
  windowEnd: hm.default('17:30'),
  timezone: z.string().refine(isValidTimezone, 'Unknown timezone').default('America/New_York'),
  trackOpens: z.boolean().default(true),
  trackClicks: z.boolean().default(false),
  stopOnReply: z.boolean().default(true),
  includeSignature: z.boolean().default(true),
});

export type CampaignSettings = z.infer<typeof campaignSettingsSchema>;

export const DEFAULT_SETTINGS: CampaignSettings = campaignSettingsSchema.parse({});

function toMinutes(value: string): number {
  const [h, m] = value.split(':').map(Number);
  return h * 60 + m;
}

/**
 * Merges partial/untrusted settings over defaults. Always returns something usable:
 * invalid fields fall back to defaults, delays are ordered, the window is non-empty and
 * the daily limit never exceeds the mailbox limit.
 */
export function normalizeSettings(raw: unknown, opts: { mailboxDailyLimit?: number | null; base?: Partial<CampaignSettings> } = {}): CampaignSettings {
  const input = { ...(opts.base ?? {}), ...(raw && typeof raw === 'object' ? (raw as Record<string, unknown>) : {}) };
  const out = { ...DEFAULT_SETTINGS };
  const shape = campaignSettingsSchema.shape;
  for (const key of Object.keys(shape) as (keyof CampaignSettings)[]) {
    if (input[key] === undefined || input[key] === null) continue;
    const parsed = shape[key].safeParse(input[key]);
    if (parsed.success) (out as Record<string, unknown>)[key] = parsed.data;
  }
  if (out.maxDelaySec < out.minDelaySec) out.maxDelaySec = out.minDelaySec;
  if (toMinutes(out.windowEnd) <= toMinutes(out.windowStart)) {
    out.windowStart = DEFAULT_SETTINGS.windowStart;
    out.windowEnd = DEFAULT_SETTINGS.windowEnd;
  }
  out.sendDays = [...new Set(out.sendDays)].sort();
  if (opts.mailboxDailyLimit && opts.mailboxDailyLimit > 0) out.dailyLimit = Math.min(out.dailyLimit, opts.mailboxDailyLimit);
  return out;
}

export const TIMEZONES = [
  'America/New_York',
  'America/Chicago',
  'America/Denver',
  'America/Phoenix',
  'America/Los_Angeles',
  'America/Anchorage',
  'Pacific/Honolulu',
];

export const DAY_LABELS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
