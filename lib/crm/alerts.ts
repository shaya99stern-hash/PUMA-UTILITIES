/** Pure water-meter alert detection used by POST /api/monitor/readings (and tests). */

export type ReadingInput = {
  periodStart: Date | string | null;
  periodEnd: Date | string;
  gallons: number | null;
  cost: number | null;
  /** Manual flags: continuous_flow (true if flow never stops), min_night_gph (lowest overnight gallons/hour). */
  flags?: { continuous_flow?: boolean; min_night_gph?: number | null };
};
export type HistoryReading = { periodStart: Date | string | null; periodEnd: Date | string; gallons: number | null };
export type DetectedAlert = {
  kind: 'continuous_flow' | 'spike' | 'spend_threshold';
  severity: 'info' | 'warning' | 'critical';
  title: string;
  detail: string;
};
export type DetectOptions = {
  label: string;
  propertyName?: string | null;
  /** Reading is a spike when its daily rate >= spikeRatio x trailing average (default 1.5). */
  spikeRatio?: number;
  criticalRatio?: number;
  minHistory?: number;
  trailing?: number;
  spendThreshold?: number | null;
  /** Overnight minimum flow at or above this (gallons/hour) is treated as continuous flow. */
  continuousGph?: number;
};

const DAY = 86_400_000;

export function periodDays(start: Date | string | null, end: Date | string): number | null {
  if (!start) return null;
  const ms = new Date(end).getTime() - new Date(start).getTime();
  if (!Number.isFinite(ms) || ms <= 0) return null;
  return Math.max(ms / DAY, 1 / 24);
}

/** Daily gallons rate for a reading (falls back to raw gallons if the period is unknown). */
export function dailyRate(r: { periodStart: Date | string | null; periodEnd: Date | string; gallons: number | null }): number | null {
  if (r.gallons === null || r.gallons === undefined) return null;
  const days = periodDays(r.periodStart, r.periodEnd);
  return days ? r.gallons / days : r.gallons;
}

const fmt = (n: number) => Math.round(n).toLocaleString('en-US');

export function detectReadingAlerts(reading: ReadingInput, history: HistoryReading[], options: DetectOptions): DetectedAlert[] {
  const out: DetectedAlert[] = [];
  const where = options.propertyName ? `${options.propertyName} · ${options.label}` : options.label;
  const contGph = options.continuousGph ?? 1;

  const minNight = reading.flags?.min_night_gph;
  if (reading.flags?.continuous_flow || (typeof minNight === 'number' && minNight >= contGph)) {
    out.push({
      kind: 'continuous_flow',
      severity: typeof minNight === 'number' && minNight >= 10 ? 'critical' : 'warning',
      title: `Continuous flow at ${where}`,
      detail: typeof minNight === 'number' && minNight > 0
        ? `Flow never dropped below ${fmt(minNight)} gal/hr overnight. That usually points to a leak or running fixture.`
        : 'Flow did not stop during the reading period, which usually points to a leak or running fixture.',
    });
  }

  const rate = dailyRate(reading);
  if (rate !== null && rate > 0) {
    const trailing = options.trailing ?? 6;
    const prior = history
      .map((h) => dailyRate(h))
      .filter((n): n is number => n !== null && n > 0)
      .slice(0, trailing);
    if (prior.length >= (options.minHistory ?? 2)) {
      const avg = prior.reduce((a, b) => a + b, 0) / prior.length;
      const ratio = rate / avg;
      const spike = options.spikeRatio ?? 1.5;
      if (ratio >= spike) {
        out.push({
          kind: 'spike',
          severity: ratio >= (options.criticalRatio ?? 2.5) ? 'critical' : 'warning',
          title: `Usage spike at ${where}`,
          detail: `${fmt(rate)} gal/day is ${ratio.toFixed(1)}x the trailing average of ${fmt(avg)} gal/day (last ${prior.length} readings).`,
        });
      }
    }
  }

  if (options.spendThreshold && reading.cost !== null && reading.cost > options.spendThreshold) {
    out.push({
      kind: 'spend_threshold',
      severity: 'warning',
      title: `Spend above threshold at ${where}`,
      detail: `$${fmt(reading.cost)} exceeds the $${fmt(options.spendThreshold)} threshold for one reading period.`,
    });
  }
  return out;
}
