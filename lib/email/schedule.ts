/** Send-window scheduling with timezone support (no dependencies). Pure. */
import type { CampaignSettings } from './settings';

type Parts = { year: number; month: number; day: number; hour: number; minute: number; second: number; weekday: number };

const formatters = new Map<string, Intl.DateTimeFormat>();
function formatter(tz: string) {
  let f = formatters.get(tz);
  if (!f) {
    f = new Intl.DateTimeFormat('en-US', {
      timeZone: tz,
      hourCycle: 'h23',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
      weekday: 'short',
    });
    formatters.set(tz, f);
  }
  return f;
}

const WEEKDAYS: Record<string, number> = { Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6, Sun: 7 };

/** Wall-clock parts of an instant in a timezone. weekday: 1 = Monday ... 7 = Sunday. */
export function zonedParts(date: Date, tz: string): Parts {
  const out: Record<string, string> = {};
  for (const p of formatter(tz).formatToParts(date)) out[p.type] = p.value;
  return {
    year: Number(out.year),
    month: Number(out.month),
    day: Number(out.day),
    hour: Number(out.hour) % 24,
    minute: Number(out.minute),
    second: Number(out.second),
    weekday: WEEKDAYS[out.weekday] ?? 1,
  };
}

function offsetMs(date: Date, tz: string): number {
  const p = zonedParts(date, tz);
  const asUtc = Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute, p.second);
  return asUtc - Math.floor(date.getTime() / 1000) * 1000;
}

/** Converts a wall-clock time in `tz` to the matching UTC instant. */
export function zonedTimeToUtc(year: number, month: number, day: number, hour: number, minute: number, tz: string): Date {
  const target = Date.UTC(year, month - 1, day, hour, minute);
  let guess = target;
  for (let i = 0; i < 3; i++) guess = target - offsetMs(new Date(guess), tz);
  return new Date(guess);
}

function hm(value: string): [number, number] {
  const [h, m] = value.split(':').map(Number);
  return [h, m];
}

type Window = Pick<CampaignSettings, 'sendDays' | 'windowStart' | 'windowEnd' | 'timezone'>;

function normalizedDays(days: number[]) {
  return new Set(days.map((d) => (d === 0 ? 7 : d)));
}

export function isWithinWindow(date: Date, w: Window): boolean {
  const p = zonedParts(date, w.timezone);
  if (!normalizedDays(w.sendDays).has(p.weekday)) return false;
  const [sh, sm] = hm(w.windowStart);
  const [eh, em] = hm(w.windowEnd);
  const mins = p.hour * 60 + p.minute + p.second / 60;
  return mins >= sh * 60 + sm && mins < eh * 60 + em;
}

/** Earliest instant >= `after` that falls inside a send window. */
export function nextWindowStart(after: Date, w: Window): { at: Date; moved: boolean } {
  const days = normalizedDays(w.sendDays);
  const p = zonedParts(after, w.timezone);
  const [sh, sm] = hm(w.windowStart);
  const [eh, em] = hm(w.windowEnd);
  for (let offset = 0; offset < 15; offset++) {
    const base = new Date(Date.UTC(p.year, p.month - 1, p.day + offset));
    const y = base.getUTCFullYear();
    const m = base.getUTCMonth() + 1;
    const d = base.getUTCDate();
    const weekday = base.getUTCDay() === 0 ? 7 : base.getUTCDay();
    if (!days.has(weekday)) continue;
    const start = zonedTimeToUtc(y, m, d, sh, sm, w.timezone);
    const end = zonedTimeToUtc(y, m, d, eh, em, w.timezone);
    if (after.getTime() < start.getTime()) return { at: start, moved: true };
    if (after.getTime() < end.getTime()) return { at: after, moved: false };
  }
  // No valid day found (empty sendDays); fall back to the input.
  return { at: after, moved: false };
}

type Rng = () => number;

function jitterMs(s: Pick<CampaignSettings, 'minDelaySec' | 'maxDelaySec'>, rng: Rng) {
  return Math.round((s.minDelaySec + rng() * Math.max(0, s.maxDelaySec - s.minDelaySec)) * 1000);
}

/**
 * The time for the next message: `after` plus a random delay (min..max seconds),
 * pushed into the next send window when it lands outside one.
 */
export function computeNextSendAt(after: Date, s: CampaignSettings, rng: Rng = Math.random): Date {
  let t = new Date(after.getTime() + jitterMs(s, rng));
  for (let i = 0; i < 3; i++) {
    const w = nextWindowStart(t, s);
    if (!w.moved) return w.at;
    // Spread the first sends of a window instead of stacking them on the opening minute.
    t = new Date(w.at.getTime() + Math.round(rng() * Math.max(1, s.maxDelaySec - s.minDelaySec) * 1000));
  }
  return t;
}

/** When a follow-up step is due: the previous send plus `delayDays`, placed inside a window with jitter. */
export function computeFollowUpAt(lastSentAt: Date, delayDays: number, s: CampaignSettings, rng: Rng = Math.random): Date {
  const base = new Date(lastSentAt.getTime() + Math.max(0, delayDays) * 86_400_000);
  return computeNextSendAt(base, s, rng);
}

export function localDayKey(date: Date, tz: string): string {
  const p = zonedParts(date, tz);
  return `${p.year}-${String(p.month).padStart(2, '0')}-${String(p.day).padStart(2, '0')}`;
}

/**
 * Spaces `count` first-touch sends starting at `start`, honoring windows, jitter and a per-local-day cap.
 * `sentToday` is how many sends already happened on the local day of `start`.
 */
export function planSchedule(count: number, start: Date, s: CampaignSettings, opts: { sentToday?: number; rng?: Rng } = {}): Date[] {
  const rng = opts.rng ?? Math.random;
  const perDay = new Map<string, number>();
  perDay.set(localDayKey(start, s.timezone), opts.sentToday ?? 0);
  const out: Date[] = [];
  let cursor = start;
  for (let i = 0; i < count; i++) {
    let t = computeNextSendAt(cursor, s, rng);
    let key = localDayKey(t, s.timezone);
    let guard = 0;
    while ((perDay.get(key) ?? 0) >= s.dailyLimit && guard++ < 400) {
      const p = zonedParts(t, s.timezone);
      const nextMidnight = zonedTimeToUtc(p.year, p.month, p.day + 1, 0, 1, s.timezone);
      t = computeNextSendAt(new Date(nextMidnight.getTime() - jitterMs(s, rng)), s, rng);
      key = localDayKey(t, s.timezone);
    }
    perDay.set(key, (perDay.get(key) ?? 0) + 1);
    out.push(t);
    cursor = t;
  }
  return out;
}
