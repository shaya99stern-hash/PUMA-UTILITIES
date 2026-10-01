/**
 * Email pattern inference. When a company publishes even one personal address (on its website,
 * in HUD records...), we learn its format (first.last@, jsmith@, ...) and apply it to the decision
 * makers we found elsewhere. Inferred addresses are always labeled "inferred" — never verified.
 */
export type Pattern = 'first.last' | 'firstlast' | 'flast' | 'f.last' | 'first' | 'firstl' | 'first_last' | 'last.first' | 'lastf' | 'last';

export const PATTERNS: Pattern[] = ['first.last', 'flast', 'first', 'firstlast', 'f.last', 'firstl', 'first_last', 'last.first', 'lastf', 'last'];

function clean(part: string) {
  return part.toLowerCase().normalize('NFKD').replace(/[̀-ͯ]/g, '').replace(/[^a-z]/g, '');
}

export function nameParts(fullName: string): { first: string; last: string } | null {
  const words = fullName
    .replace(/\(.*?\)/g, ' ')
    .replace(/\b(jr|sr|ii|iii|iv|mr|mrs|ms|dr|esq)\b\.?/gi, ' ')
    .split(/\s+/)
    .map(clean)
    .filter((w) => w.length > 1);
  if (words.length < 2) return null;
  return { first: words[0], last: words[words.length - 1] };
}

export function applyPattern(pattern: Pattern, fullName: string): string | null {
  const p = nameParts(fullName);
  if (!p) return null;
  const { first, last } = p;
  switch (pattern) {
    case 'first.last': return `${first}.${last}`;
    case 'firstlast': return `${first}${last}`;
    case 'flast': return `${first[0]}${last}`;
    case 'f.last': return `${first[0]}.${last}`;
    case 'first': return first;
    case 'firstl': return `${first}${last[0]}`;
    case 'first_last': return `${first}_${last}`;
    case 'last.first': return `${last}.${first}`;
    case 'lastf': return `${last}${first[0]}`;
    case 'last': return last;
  }
}

/** Which patterns explain a known (name, email) pair. */
export function matchPatterns(fullName: string, email: string): Pattern[] {
  const local = email.split('@')[0]?.toLowerCase() ?? '';
  return PATTERNS.filter((p) => applyPattern(p, fullName) === local);
}

const ROLE_LOCAL = /^(info|contact|office|admin|leasing|rentals?|management|mgmt|hello|sales|service|support|maintenance|accounting|ap|ar|billing|careers|jobs|hr|reception|frontdesk|team|general|mail|inquiries|questions)$/;

export function isRoleAddress(email: string): boolean {
  return ROLE_LOCAL.test(email.split('@')[0]?.toLowerCase() ?? '');
}

/**
 * Learns the company email pattern from known (person, email) pairs on the same domain.
 * Returns the best pattern and how many examples support it.
 */
export function learnPattern(pairs: { name: string; email: string }[], domain: string): { pattern: Pattern; support: number } | null {
  const tally = new Map<Pattern, number>();
  for (const { name, email } of pairs) {
    if (!email.toLowerCase().endsWith(`@${domain}`) || isRoleAddress(email)) continue;
    const matches = matchPatterns(name, email);
    // Ambiguous single-name matches ("first" vs "firstl" for short names) count less.
    for (const m of matches) tally.set(m, (tally.get(m) ?? 0) + 1 / matches.length);
  }
  const best = [...tally.entries()].sort((a, b) => b[1] - a[1])[0];
  return best ? { pattern: best[0], support: best[1] } : null;
}

/**
 * Proposes an address for a person. With a learned pattern the confidence is good;
 * without one we fall back to the most common corporate format (first.last) at low confidence.
 */
export function inferEmail(fullName: string, domain: string, learned: { pattern: Pattern; support: number } | null): { email: string; confidence: number; basis: string } | null {
  const pattern = learned?.pattern ?? 'first.last';
  const local = applyPattern(pattern, fullName);
  if (!local) return null;
  const confidence = learned ? Math.min(0.85, 0.55 + learned.support * 0.15) : 0.3;
  const basis = learned
    ? `Company format ${pattern}@${domain} learned from ${Math.round(learned.support)} published address${learned.support >= 2 ? 'es' : ''}`
    : `Most common corporate format (${pattern}@); not yet confirmed for ${domain}`;
  return { email: `${local}@${domain}`, confidence, basis };
}
