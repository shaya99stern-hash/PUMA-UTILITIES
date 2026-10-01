/** Merge tags, HTML sanitizing and plain-text conversion. Pure and client-safe. */

export const MERGE_TAGS = [
  { tag: 'first_name', label: 'First name', example: 'Jordan' },
  { tag: 'last_name', label: 'Last name', example: 'Rivera' },
  { tag: 'full_name', label: 'Full name', example: 'Jordan Rivera' },
  { tag: 'company', label: 'Company', example: 'Hudson Residential' },
  { tag: 'city', label: 'City', example: 'Newark' },
  { tag: 'state', label: 'State', example: 'NJ' },
  { tag: 'portfolio_units', label: 'Portfolio units', example: '1,250' },
  { tag: 'sender_name', label: 'Your name', example: 'Alex Puma' },
] as const;

export type MergeVars = Record<string, string | null | undefined>;

const KNOWN_TAGS = new Set<string>([...MERGE_TAGS.map((t) => t.tag), 'email', 'sender_first_name', 'sender_email', 'title']);
const TAG_RE = /\{\{\s*([a-zA-Z_][a-zA-Z0-9_]*)\s*(?:\|([^}]*))?\}\}/g;

export function escapeHtml(value: string): string {
  return value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

export function decodeEntities(value: string): string {
  return value
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&quot;/gi, '"')
    .replace(/&#39;|&apos;/gi, "'")
    .replace(/&#(\d+);/g, (_, n: string) => String.fromCodePoint(Math.min(0x10ffff, Number(n))))
    .replace(/&#x([0-9a-f]+);/gi, (_, n: string) => String.fromCodePoint(Math.min(0x10ffff, parseInt(n, 16))));
}

/**
 * Replaces `{{tag}}` and `{{tag|fallback}}` placeholders.
 * Missing or blank values use the fallback, or an empty string when there is none.
 * In html mode values are escaped (fallback text too) so merge data can never inject markup.
 */
export function renderMerge(template: string, vars: MergeVars, options: { html?: boolean } = {}): string {
  return template.replace(TAG_RE, (_match, rawKey: string, fallback?: string) => {
    const key = rawKey.toLowerCase();
    const value = vars[key]?.toString().trim();
    const chosen = value ? value : (fallback ?? '').trim();
    return options.html ? escapeHtml(chosen) : chosen;
  });
}

/** Tags used in a template that we do not know how to fill. */
export function unknownTags(template: string): string[] {
  const found = new Set<string>();
  for (const m of template.matchAll(TAG_RE)) {
    const key = m[1].toLowerCase();
    if (!KNOWN_TAGS.has(key)) found.add(key);
  }
  return [...found];
}

export function usedTags(template: string): string[] {
  return [...new Set([...template.matchAll(TAG_RE)].map((m) => m[1].toLowerCase()))];
}

export function formatUnits(value: number | string | null | undefined): string | null {
  if (value === null || value === undefined || value === '') return null;
  const n = typeof value === 'number' ? value : Number(String(value).replace(/,/g, ''));
  return Number.isFinite(n) && n > 0 ? Math.round(n).toLocaleString('en-US') : null;
}

export type MergeSource = {
  first_name?: string | null;
  last_name?: string | null;
  full_name?: string | null;
  email?: string | null;
  title?: string | null;
  company_name?: string | null;
  city?: string | null;
  state?: string | null;
  portfolio_units?: number | string | null;
};

export function buildMergeVars(recipient: MergeSource, sender: { name?: string | null; email?: string | null }): MergeVars {
  const first = recipient.first_name?.trim() || null;
  const last = recipient.last_name?.trim() || null;
  const full = recipient.full_name?.trim() || [first, last].filter(Boolean).join(' ') || null;
  const senderName = sender.name?.trim() || null;
  return {
    first_name: first,
    last_name: last,
    full_name: full,
    email: recipient.email ?? null,
    title: recipient.title ?? null,
    company: recipient.company_name?.trim() || null,
    city: recipient.city?.trim() || null,
    state: recipient.state?.trim() || null,
    portfolio_units: formatUnits(recipient.portfolio_units),
    sender_name: senderName,
    sender_first_name: senderName?.split(/\s+/)[0] ?? null,
    sender_email: sender.email ?? null,
  };
}

export const SAMPLE_RECIPIENT: MergeSource = {
  first_name: 'Jordan',
  last_name: 'Rivera',
  full_name: 'Jordan Rivera',
  email: 'jordan@example.com',
  company_name: 'Hudson Residential',
  city: 'Newark',
  state: 'NJ',
  portfolio_units: 1250,
};

// ---------------------------------------------------------------------------
// HTML sanitizing (editor output -> email-safe HTML)
// ---------------------------------------------------------------------------

const ALLOWED = new Set(['a', 'b', 'strong', 'i', 'em', 'u', 'p', 'br', 'div', 'span', 'ul', 'ol', 'li', 'blockquote', 'h1', 'h2', 'h3', 'hr', 'img', 'table', 'tbody', 'thead', 'tr', 'td', 'th']);
const DROP_WITH_CONTENT = /<(script|style|iframe|object|embed|form|head|title|noscript|svg|math)\b[\s\S]*?<\/\1\s*>/gi;

function safeUrl(value: string, allowMail: boolean): string | null {
  const v = decodeEntities(value).trim();
  if (/^(https?:\/\/)/i.test(v)) return v;
  if (allowMail && /^(mailto:|tel:)/i.test(v)) return v;
  if (v.startsWith('{{')) return v; // merge tag used as a URL
  return null;
}

export function sanitizeEmailHtml(html: string): string {
  const input = html.replace(/<!--[\s\S]*?-->/g, '').replace(DROP_WITH_CONTENT, '');
  return input.replace(/<(\/?)([a-zA-Z][a-zA-Z0-9]*)\b([^>]*)>/g, (_m, slash: string, rawTag: string, attrs: string) => {
    const tag = rawTag.toLowerCase();
    if (!ALLOWED.has(tag)) return '';
    if (slash) return `</${tag}>`;
    const keep: string[] = [];
    const attr = (name: string) => {
      const m = attrs.match(new RegExp(`\\b${name}\\s*=\\s*(?:"([^"]*)"|'([^']*)'|([^\\s>]+))`, 'i'));
      return m ? (m[1] ?? m[2] ?? m[3] ?? '') : null;
    };
    if (tag === 'a') {
      const href = attr('href');
      const safe = href === null ? null : safeUrl(href, true);
      if (safe) keep.push(`href="${escapeHtml(safe)}"`);
    }
    if (tag === 'img') {
      const src = attr('src');
      const safe = src === null ? null : safeUrl(src, false);
      if (!safe) return '';
      keep.push(`src="${escapeHtml(safe)}"`);
      const alt = attr('alt');
      if (alt) keep.push(`alt="${escapeHtml(decodeEntities(alt))}"`);
      const width = attr('width');
      if (width && /^\d{1,4}$/.test(width)) keep.push(`width="${width}"`);
    }
    if (tag === 'td' || tag === 'th') {
      for (const n of ['colspan', 'rowspan']) {
        const v = attr(n);
        if (v && /^\d{1,2}$/.test(v)) keep.push(`${n}="${v}"`);
      }
    }
    const style = attr('style');
    if (style) {
      const allowed = style
        .split(';')
        .map((s) => s.trim())
        .filter((s) => /^(font-weight|font-style|text-decoration|text-align|color)\s*:\s*[#a-zA-Z0-9(),.\s%-]+$/i.test(s));
      if (allowed.length) keep.push(`style="${escapeHtml(allowed.join('; '))}"`);
    }
    const selfClose = tag === 'br' || tag === 'hr' || tag === 'img' ? '' : '';
    return `<${tag}${keep.length ? ' ' + keep.join(' ') : ''}${selfClose}>`;
  });
}

// ---------------------------------------------------------------------------
// HTML -> plain text
// ---------------------------------------------------------------------------

export function htmlToText(html: string): string {
  let out = html
    .replace(/<!--[\s\S]*?-->/g, '')
    .replace(/<(script|style|head|title)\b[\s\S]*?<\/\1\s*>/gi, '')
    .replace(/<a\b[^>]*href\s*=\s*(?:"([^"]*)"|'([^']*)')[^>]*>([\s\S]*?)<\/a>/gi, (_m, d: string, s: string, label: string) => {
      const href = decodeEntities(d ?? s ?? '').trim();
      const text = label.replace(/<[^>]+>/g, '').trim();
      if (!href || /^(#|mailto:)/i.test(href)) return text || href.replace(/^mailto:/i, '');
      if (!text || text === href || text.replace(/^https?:\/\//, '') === href.replace(/^https?:\/\//, '')) return href;
      return `${text} (${href})`;
    })
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/(p|div|h[1-6]|tr|blockquote)>/gi, '\n\n')
    .replace(/<li\b[^>]*>/gi, '- ')
    .replace(/<\/li>/gi, '\n')
    .replace(/<\/(ul|ol)>/gi, '\n')
    .replace(/<\/t[dh]>/gi, '\t')
    .replace(/<hr\s*\/?>/gi, '\n----\n')
    .replace(/<[^>]+>/g, '');
  out = decodeEntities(out)
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .replace(/[ \t]{2,}/g, ' ')
    .trim();
  return out;
}

export function snippetOf(text: string, length = 160): string {
  return text.replace(/\s+/g, ' ').trim().slice(0, length);
}
