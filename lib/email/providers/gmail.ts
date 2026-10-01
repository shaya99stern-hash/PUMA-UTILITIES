import MailComposer from 'nodemailer/lib/mail-composer';
import { simpleParser } from 'mailparser';
import type { Folder, InboundMessage, ListOptions, ListResult, MailProvider, OutgoingMessage, SendResult, VerifyResult } from '../types';
import { toInbound } from './smtp-imap';
import { toMailOptions } from './shared';

const API = 'https://gmail.googleapis.com/gmail/v1/users/me';

export type TokenSource = () => Promise<string>;

async function call<T>(getToken: TokenSource, path: string, init: RequestInit = {}): Promise<T> {
  const token = await getToken();
  const res = await fetch(`${API}${path}`, {
    ...init,
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json', ...(init.headers ?? {}) },
    cache: 'no-store',
  });
  if (!res.ok) {
    let detail = '';
    try {
      const body = (await res.json()) as { error?: { message?: string } };
      detail = body.error?.message ?? '';
    } catch {}
    if (res.status === 401) throw Object.assign(new Error('Google rejected the saved sign-in. Reconnect your Gmail account.'), { code: 'EAUTH' });
    if (res.status === 403 && /insufficient|scope/i.test(detail)) throw new Error('Gmail permissions are missing. Reconnect and allow access to send and read mail.');
    if (res.status === 429) throw new Error('Gmail rate limit reached. Try again later.');
    throw new Error(`Gmail API error (${res.status}): ${detail || res.statusText}`);
  }
  return (await res.json()) as T;
}

async function buildRaw(msg: OutgoingMessage): Promise<{ raw: string; messageId: string }> {
  const options = toMailOptions(msg);
  const mail = new MailComposer(options);
  const buffer: Buffer = await new Promise((resolve, reject) => mail.compile().build((err, out) => (err ? reject(err) : resolve(out))));
  return { raw: buffer.toString('base64url'), messageId: options.messageId };
}

type ListResponse = { messages?: { id: string; threadId: string }[] };
type RawMessage = { id: string; threadId: string; labelIds?: string[]; internalDate?: string; raw?: string };

export function gmailProvider(getToken: TokenSource, email: string): MailProvider {
  async function fetchRaw(id: string, folder: Folder): Promise<{ msg: InboundMessage; internal: number } | null> {
    const full = await call<RawMessage>(getToken, `/messages/${id}?format=raw`);
    if (!full.raw) return null;
    const parsed = await simpleParser(Buffer.from(full.raw, 'base64url'));
    const internal = Number(full.internalDate ?? Date.now());
    return {
      internal,
      msg: toInbound(parsed, { providerId: full.id, folder, isRead: !(full.labelIds ?? []).includes('UNREAD') }),
    };
  }

  return {
    async send(message: OutgoingMessage): Promise<SendResult> {
      const { raw, messageId } = await buildRaw(message);
      const sent = await call<{ id: string }>(getToken, '/messages/send', { method: 'POST', body: JSON.stringify({ raw }) });
      return { messageId, providerId: sent.id };
    },

    async listRecent({ folder, cursor, limit, known }: ListOptions): Promise<ListResult> {
      const afterMs = cursor && /^\d+$/.test(cursor) ? Number(cursor) : Date.now() - 14 * 86_400_000;
      // `after:` takes epoch seconds; overlap one minute and rely on `known` to skip.
      const q = `after:${Math.floor(afterMs / 1000) - 60}`;
      const label = folder === 'inbox' ? 'INBOX' : 'SENT';
      const list = await call<ListResponse>(getToken, `/messages?labelIds=${label}&maxResults=${Math.min(limit, 100)}&q=${encodeURIComponent(q)}`);
      const ids = (list.messages ?? []).filter((m) => !known?.has(m.id));
      const messages: InboundMessage[] = [];
      let maxInternal = cursor && /^\d+$/.test(cursor) ? Number(cursor) : 0;
      for (let i = 0; i < ids.length; i += 5) {
        const chunk = await Promise.all(ids.slice(i, i + 5).map((m) => fetchRaw(m.id, folder).catch(() => null)));
        for (const item of chunk) {
          if (!item) continue;
          messages.push(item.msg);
          maxInternal = Math.max(maxInternal, item.internal);
        }
      }
      // Already-known messages still advance the cursor so the window does not grow forever.
      if (!ids.length && list.messages?.length) maxInternal = Math.max(maxInternal, Date.now() - 120_000);
      return { messages, cursor: maxInternal ? String(maxInternal) : (cursor ?? null) };
    },

    async fetchThread(threadId: string): Promise<InboundMessage[]> {
      const thread = await call<{ messages?: RawMessage[] }>(getToken, `/threads/${threadId}?format=minimal`);
      const out: InboundMessage[] = [];
      for (const m of thread.messages ?? []) {
        const one = await fetchRaw(m.id, (m.labelIds ?? []).includes('SENT') ? 'sent' : 'inbox').catch(() => null);
        if (one) out.push(one.msg);
      }
      return out;
    },

    async verify(): Promise<VerifyResult> {
      try {
        const profile = await call<{ emailAddress: string }>(getToken, '/profile');
        return { ok: true, email: profile.emailAddress, smtp: { ok: true }, imap: { ok: true } };
      } catch (error) {
        const message = error instanceof Error ? error.message : 'Could not reach Gmail.';
        return { ok: false, email, error: message };
      }
    },
  };
}
