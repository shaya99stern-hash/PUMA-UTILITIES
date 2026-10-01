/** Thread keys, reply matching and bounce detection. Pure. */
import { createHash } from 'node:crypto';

export function normalizeSubject(subject: string | null | undefined): string {
  let s = (subject ?? '').trim();
  for (let i = 0; i < 8; i++) {
    const next = s.replace(/^\s*(re|fwd?|aw|wg|sv|antw)\s*(\[\d+\])?\s*:\s*/i, '');
    if (next === s) break;
    s = next;
  }
  return s.replace(/\s+/g, ' ').trim().toLowerCase();
}

/** Extracts `<id@host>` tokens from a References / In-Reply-To style header. */
export function parseMessageIds(header: string | string[] | null | undefined): string[] {
  const text = Array.isArray(header) ? header.join(' ') : (header ?? '');
  const ids = text.match(/<[^<>\s]+>/g) ?? [];
  const seen = new Set<string>();
  return ids.filter((id) => {
    const key = id.toLowerCase();
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

export function normalizeMessageId(id: string | null | undefined): string | null {
  if (!id) return null;
  const m = id.match(/<[^<>\s]+>/);
  return m ? m[0].toLowerCase() : id.trim().toLowerCase() || null;
}

/** Message-IDs compare case-insensitively here, but are stored and re-sent with their original case. */
export function cleanMessageId(id: string | null | undefined): string | null {
  if (!id) return null;
  const m = id.match(/<[^<>\s]+>/);
  return m ? m[0] : null;
}

function hash(value: string) {
  return createHash('sha1').update(value).digest('hex').slice(0, 20);
}

/**
 * Stable thread key: the root message id (first entry of References, else In-Reply-To, else the message itself).
 * Messages without any ids fall back to the normalized subject + counterparty.
 */
export function threadKeyFor(input: {
  messageId?: string | null;
  inReplyTo?: string | null;
  references?: string[];
  subject?: string | null;
  counterparty?: string | null;
}): string {
  const refs = (input.references ?? []).map(normalizeMessageId).filter(Boolean) as string[];
  const root = refs[0] ?? normalizeMessageId(input.inReplyTo) ?? normalizeMessageId(input.messageId);
  if (root) return hash(`id:${root}`);
  return hash(`subj:${normalizeSubject(input.subject)}|${(input.counterparty ?? '').toLowerCase()}`);
}

export type ReplyCandidate = {
  recipientId: string;
  email: string;
  status: string;
  /** Message-IDs we sent to this recipient (normalized). */
  messageIds: string[];
};

export type ReplyMatch = { candidate: ReplyCandidate; by: 'header' | 'from' };

/**
 * Finds which campaign recipient a received message answers.
 * Header match (In-Reply-To / References contain a message we sent) wins; otherwise a message from the
 * exact address of a recipient that has already been emailed counts as a reply.
 */
export function matchReply(
  message: { fromEmail: string | null; inReplyTo: string | null; references: string[] },
  candidates: ReplyCandidate[],
): ReplyMatch | null {
  const ids = new Set([...(message.references ?? []), ...(message.inReplyTo ? [message.inReplyTo] : [])].map((i) => normalizeMessageId(i)).filter(Boolean) as string[]);
  if (ids.size) {
    for (const c of candidates) {
      if (c.messageIds.some((m) => ids.has(normalizeMessageId(m) ?? ''))) return { candidate: c, by: 'header' };
    }
  }
  const from = message.fromEmail?.trim().toLowerCase();
  if (from) {
    const hit = candidates.find((c) => c.email.toLowerCase() === from && c.messageIds.length > 0 && ['active', 'completed', 'queued'].includes(c.status));
    if (hit) return { candidate: hit, by: 'from' };
  }
  return null;
}

// ---------------------------------------------------------------------------
// Auto replies and bounces
// ---------------------------------------------------------------------------

export function isAutoReply(input: { autoSubmitted?: string | null; subject?: string | null; fromEmail?: string | null }): boolean {
  if (input.autoSubmitted && !/^no$/i.test(input.autoSubmitted.trim())) return true;
  const subject = (input.subject ?? '').toLowerCase();
  if (/^(automatic reply|auto[- ]?reply|autoreply|out of office|out-of-office|ooo\b|vacation)/.test(subject.replace(/^(re|fwd?):\s*/i, ''))) return true;
  return false;
}

export type BounceInfo = {
  isBounce: boolean;
  /** Permanent failures (5.x.x) should suppress the address; temporary ones should not. */
  permanent: boolean;
  recipientEmail: string | null;
  originalMessageIds: string[];
  reason: string | null;
};

const BOUNCE_SENDER = /(mailer-daemon|postmaster|mail delivery (sub)?system|mailerdaemon|no-?reply-?dsn)/i;
const BOUNCE_SUBJECT =
  /(undeliverable|undelivered mail|delivery status notification|delivery failure|delivery has failed|mail delivery failed|returned mail|failure notice|could not be delivered|message not delivered|delivery problem)/i;
const PERMANENT_HINT =
  /(\b5\.\d{1,3}\.\d{1,3}\b|\b55\d\b|user unknown|unknown user|no such user|does not exist|doesn'?t exist|mailbox unavailable|invalid (recipient|address)|address rejected|recipient rejected|account (is )?(disabled|inactive)|no mailbox here|domain (not found|does not exist))/i;
const TEMP_HINT = /(\b4\.\d{1,3}\.\d{1,3}\b|mailbox (is )?full|over quota|temporar(y|ily)|try again later|deferred)/i;

export function detectBounce(input: {
  fromEmail: string | null;
  fromName?: string | null;
  subject: string | null;
  text: string | null;
  ownEmails?: string[];
}): BounceInfo {
  const sender = `${input.fromName ?? ''} ${input.fromEmail ?? ''}`;
  const subject = input.subject ?? '';
  const text = input.text ?? '';
  const senderIsDaemon = BOUNCE_SENDER.test(sender);
  const subjectLooksBounce = BOUNCE_SUBJECT.test(subject);
  if (!senderIsDaemon && !(subjectLooksBounce && /(final-recipient|diagnostic-code|action:\s*failed|550|5\.\d\.\d)/i.test(text))) {
    return { isBounce: false, permanent: false, recipientEmail: null, originalMessageIds: [], reason: null };
  }
  if (senderIsDaemon && !subjectLooksBounce && !/(final-recipient|diagnostic-code|action:\s*failed|wasn'?t delivered|was not delivered|couldn'?t be delivered)/i.test(text)) {
    // A human-looking postmaster message with no failure markers.
    return { isBounce: false, permanent: false, recipientEmail: null, originalMessageIds: [], reason: null };
  }

  const own = new Set((input.ownEmails ?? []).map((e) => e.toLowerCase()));
  const candidates: string[] = [];
  const push = (value?: string) => {
    const e = value?.trim().replace(/^<|>$/g, '').toLowerCase();
    if (e && /^[^\s@]+@[^\s@]+\.[a-z]{2,}$/.test(e) && !own.has(e) && !BOUNCE_SENDER.test(e)) candidates.push(e);
  };
  for (const m of text.matchAll(/final-recipient:\s*rfc822;\s*([^\s;]+)/gi)) push(m[1]);
  for (const m of text.matchAll(/x-failed-recipients:\s*([^\s,;]+)/gi)) push(m[1]);
  for (const m of text.matchAll(/original-recipient:\s*rfc822;\s*([^\s;]+)/gi)) push(m[1]);
  for (const m of text.matchAll(/(?:to|for|address|recipient)[:\s]+<?([A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,})>?/gi)) push(m[1]);
  if (!candidates.length) for (const m of text.matchAll(/[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g)) push(m[0]);

  const permanent = PERMANENT_HINT.test(text) || (/action:\s*failed/i.test(text) && !TEMP_HINT.test(text));
  const temp = TEMP_HINT.test(text) && !PERMANENT_HINT.test(text);

  const originalMessageIds = [...text.matchAll(/message-id:\s*(<[^<>\s]+>)/gi)].map((m) => m[1].toLowerCase());
  const reasonLine = text.match(/diagnostic-code:[^\n]*(?:\n[ \t]+[^\n]*)*/i)?.[0] ?? text.match(/(?:550|551|553|554)[^\n]{0,160}/)?.[0] ?? null;

  return {
    isBounce: true,
    permanent: permanent && !temp,
    recipientEmail: candidates[0] ?? null,
    originalMessageIds: [...new Set(originalMessageIds)],
    reason: reasonLine ? reasonLine.replace(/\s+/g, ' ').trim().slice(0, 240) : null,
  };
}
