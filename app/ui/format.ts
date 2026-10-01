/** Small, dependency-free formatters used across the UI. */

export function formatNumber(value: number | null | undefined, options?: Intl.NumberFormatOptions): string {
  if (value == null || Number.isNaN(value)) return '—';
  return new Intl.NumberFormat('en-US', options).format(value);
}

export function formatMoney(value: number | null | undefined, compact = false): string {
  if (value == null || Number.isNaN(value)) return '—';
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD',
    maximumFractionDigits: compact || Math.abs(value) >= 1000 ? 0 : 2,
    notation: compact && Math.abs(value) >= 10000 ? 'compact' : 'standard',
  }).format(value);
}

export function formatDate(value: string | number | Date | null | undefined, options?: Intl.DateTimeFormatOptions): string {
  if (value == null || value === '') return '—';
  const d = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(d.getTime())) return '—';
  const sameYear = d.getFullYear() === new Date().getFullYear();
  return d.toLocaleDateString('en-US', options ?? { month: 'short', day: 'numeric', ...(sameYear ? {} : { year: 'numeric' }) });
}

/** "just now", "5m ago", "3h ago", "yesterday", "in 2d", "Mar 4". */
export function formatRelative(value: string | number | Date | null | undefined, now: Date = new Date()): string {
  if (value == null || value === '') return '—';
  const d = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(d.getTime())) return '—';
  const diff = d.getTime() - now.getTime();
  const abs = Math.abs(diff);
  const future = diff > 0;
  const min = 60_000;
  const hour = 60 * min;
  const day = 24 * hour;
  if (abs < min) return future ? 'in a moment' : 'just now';
  if (abs < hour) return future ? `in ${Math.round(abs / min)}m` : `${Math.round(abs / min)}m ago`;
  if (abs < day) return future ? `in ${Math.round(abs / hour)}h` : `${Math.round(abs / hour)}h ago`;
  const days = Math.round(abs / day);
  if (days === 1) return future ? 'tomorrow' : 'yesterday';
  if (days < 7) return future ? `in ${days}d` : `${days}d ago`;
  return formatDate(d);
}
