import assert from 'node:assert/strict';
import test from 'node:test';
import { computeFollowUpAt, computeNextSendAt, isWithinWindow, localDayKey, nextWindowStart, planSchedule, zonedParts, zonedTimeToUtc } from '../lib/email/schedule';
import { normalizeSettings, DEFAULT_SETTINGS } from '../lib/email/settings';

const S = normalizeSettings({});
const rng = (seq: number[]) => {
  let i = 0;
  return () => seq[i++ % seq.length];
};

test('default settings', () => {
  assert.equal(S.dailyLimit, 100);
  assert.equal(S.minDelaySec, 60);
  assert.equal(S.maxDelaySec, 180);
  assert.deepEqual(S.sendDays, [1, 2, 3, 4, 5]);
  assert.equal(S.windowStart, '08:30');
  assert.equal(S.windowEnd, '17:30');
  assert.equal(S.timezone, 'America/New_York');
  assert.equal(S.stopOnReply, true);
});

test('daily limit never exceeds the mailbox limit; bad values fall back', () => {
  assert.equal(normalizeSettings({ dailyLimit: 500 }, { mailboxDailyLimit: 150 }).dailyLimit, 150);
  const odd = normalizeSettings({ minDelaySec: 300, maxDelaySec: 10, windowStart: '18:00', windowEnd: '09:00', timezone: 'Nope/Zone', sendDays: [] });
  assert.ok(odd.maxDelaySec >= odd.minDelaySec);
  assert.equal(odd.windowStart, DEFAULT_SETTINGS.windowStart);
  assert.equal(odd.timezone, 'America/New_York');
  assert.deepEqual(odd.sendDays, [1, 2, 3, 4, 5]);
});

test('timezone conversion handles DST', () => {
  // Jan: EST (UTC-5); July: EDT (UTC-4)
  assert.equal(zonedTimeToUtc(2026, 1, 12, 8, 30, 'America/New_York').toISOString(), '2026-01-12T13:30:00.000Z');
  assert.equal(zonedTimeToUtc(2026, 7, 13, 8, 30, 'America/New_York').toISOString(), '2026-07-13T12:30:00.000Z');
  assert.equal(zonedTimeToUtc(2026, 7, 13, 8, 30, 'America/Los_Angeles').toISOString(), '2026-07-13T15:30:00.000Z');
  const p = zonedParts(new Date('2026-07-13T12:30:00Z'), 'America/New_York');
  assert.equal(p.hour, 8);
  assert.equal(p.weekday, 1); // Monday
});

test('window membership respects days and hours', () => {
  assert.equal(isWithinWindow(new Date('2026-07-13T12:30:00Z'), S), true); // Mon 08:30 EDT
  assert.equal(isWithinWindow(new Date('2026-07-13T12:29:00Z'), S), false); // 08:29
  assert.equal(isWithinWindow(new Date('2026-07-13T21:29:00Z'), S), true); // 17:29
  assert.equal(isWithinWindow(new Date('2026-07-13T21:30:00Z'), S), false); // 17:30 exclusive
  assert.equal(isWithinWindow(new Date('2026-07-18T15:00:00Z'), S), false); // Saturday
});

test('nextWindowStart rolls evening and weekend sends to the next business morning', () => {
  // Friday 18:00 EDT -> Monday 08:30 EDT
  const fri = nextWindowStart(new Date('2026-07-17T22:00:00Z'), S);
  assert.equal(fri.at.toISOString(), '2026-07-20T12:30:00.000Z');
  assert.equal(fri.moved, true);
  // Monday 06:00 EDT -> Monday 08:30
  assert.equal(nextWindowStart(new Date('2026-07-13T10:00:00Z'), S).at.toISOString(), '2026-07-13T12:30:00.000Z');
  // inside the window stays put
  const inside = new Date('2026-07-14T15:00:00Z');
  assert.equal(nextWindowStart(inside, S).at.getTime(), inside.getTime());
});

test('computeNextSendAt lands inside the window with jitter between min and max', () => {
  const after = new Date('2026-07-14T15:00:00Z');
  const t = computeNextSendAt(after, S, rng([0]));
  assert.equal(t.getTime() - after.getTime(), 60_000);
  const t2 = computeNextSendAt(after, S, rng([1]));
  assert.equal(t2.getTime() - after.getTime(), 180_000);
  // Near the end of the day it rolls to tomorrow morning
  const late = computeNextSendAt(new Date('2026-07-14T21:29:30Z'), S, rng([0.5]));
  assert.ok(isWithinWindow(late, S));
  assert.ok(late.getTime() >= new Date('2026-07-15T12:30:00Z').getTime());
});

test('every scheduled time from a random walk is inside the window on a send day, in several timezones', () => {
  for (const timezone of ['America/New_York', 'America/Chicago', 'America/Los_Angeles']) {
    const s = normalizeSettings({ timezone, sendDays: [1, 2, 3], windowStart: '09:00', windowEnd: '11:00', dailyLimit: 1000 });
    let cursor = new Date('2026-03-06T20:00:00Z'); // crosses the March DST change
    for (let i = 0; i < 400; i++) {
      cursor = computeNextSendAt(cursor, s);
      assert.ok(isWithinWindow(cursor, s), `${timezone} ${cursor.toISOString()}`);
    }
  }
});

test('follow-ups are placed delayDays later inside the window', () => {
  const sent = new Date('2026-07-14T15:00:00Z'); // Tue
  const t = computeFollowUpAt(sent, 3, S, rng([0.5]));
  assert.ok(isWithinWindow(t, S));
  assert.ok(t.getTime() >= sent.getTime() + 3 * 86_400_000);
  // Thursday + 3 days = Sunday -> pushed to Monday
  const thu = computeFollowUpAt(new Date('2026-07-16T15:00:00Z'), 3, S, rng([0.5]));
  assert.equal(zonedParts(thu, S.timezone).weekday, 1);
});

test('planSchedule respects the per-day cap and spaces sends', () => {
  const s = normalizeSettings({ dailyLimit: 5, minDelaySec: 60, maxDelaySec: 120 });
  const times = planSchedule(12, new Date('2026-07-14T14:00:00Z'), s);
  assert.equal(times.length, 12);
  const perDay = new Map<string, number>();
  for (let i = 0; i < times.length; i++) {
    assert.ok(isWithinWindow(times[i], s));
    if (i) assert.ok(times[i].getTime() - times[i - 1].getTime() >= 60_000);
    const k = localDayKey(times[i], s.timezone);
    perDay.set(k, (perDay.get(k) ?? 0) + 1);
  }
  assert.ok([...perDay.values()].every((n) => n <= 5));
  assert.equal(perDay.size, 3);
  // already-sent count on the first day reduces capacity
  const again = planSchedule(5, new Date('2026-07-14T14:00:00Z'), s, { sentToday: 3 });
  const day1 = again.filter((t) => localDayKey(t, s.timezone) === '2026-07-14').length;
  assert.equal(day1, 2);
});
