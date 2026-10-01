/** Display formatters shared by CRM pages. Pure; safe on client and server. */

export function fmtNumber(n: number | null | undefined): string {
  return n === null || n === undefined ? '—' : Math.round(n).toLocaleString('en-US');
}

export function fmtMoney(n: number | null | undefined, opts: { compact?: boolean; cents?: boolean } = {}): string {
  if (n === null || n === undefined) return '—';
  if (opts.compact && Math.abs(n) >= 1000) {
    if (Math.abs(n) >= 1_000_000) return `$${(n / 1_000_000).toFixed(n >= 10_000_000 ? 0 : 1)}M`;
    return `$${(n / 1000).toFixed(Math.abs(n) >= 100_000 ? 0 : 1).replace(/\.0$/, '')}K`;
  }
  return n.toLocaleString('en-US', { style: 'currency', currency: 'USD', minimumFractionDigits: opts.cents ? 2 : 0, maximumFractionDigits: opts.cents ? 2 : 0 });
}

export function fmtGallons(n: number | null | undefined): string {
  if (n === null || n === undefined) return '—';
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M gal`;
  if (n >= 1000) return `${Math.round(n / 1000).toLocaleString('en-US')}K gal`;
  return `${Math.round(n)} gal`;
}

export function fmtDate(value: string | Date | null | undefined, withTime = false): string {
  if (!value) return '—';
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return '—';
  return d.toLocaleString('en-US', withTime
    ? { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' }
    : { month: 'short', day: 'numeric', year: d.getFullYear() === new Date().getFullYear() ? undefined : 'numeric' });
}

/** "5m ago", "3d ago", "in 2d". */
export function relTime(value: string | Date | null | undefined, now = Date.now()): string {
  if (!value) return '—';
  const t = new Date(value).getTime();
  if (Number.isNaN(t)) return '—';
  const diff = t - now;
  const abs = Math.abs(diff);
  const m = 60_000, h = 60 * m, d = 24 * h;
  let text: string;
  if (abs < m) return 'just now';
  if (abs < h) text = `${Math.round(abs / m)}m`;
  else if (abs < d) text = `${Math.round(abs / h)}h`;
  else if (abs < 30 * d) text = `${Math.round(abs / d)}d`;
  else if (abs < 365 * d) text = `${Math.round(abs / (30 * d))}mo`;
  else text = `${Math.round(abs / (365 * d))}y`;
  return diff < 0 ? `${text} ago` : `in ${text}`;
}

export function isOverdue(value: string | Date | null | undefined, now = Date.now()): boolean {
  return !!value && new Date(value).getTime() < now;
}

export function initials(name: string | null | undefined): string {
  const parts = (name ?? '').trim().split(/\s+/).filter(Boolean);
  if (!parts.length) return '?';
  return ((parts[0][0] ?? '') + (parts.length > 1 ? parts[parts.length - 1][0] : '')).toUpperCase();
}

/** yyyy-MM-ddTHH:mm in local time, for <input type=datetime-local>. */
export function toLocalInput(value: string | Date | null | undefined): string {
  if (!value) return '';
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return '';
  const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}`;
}
