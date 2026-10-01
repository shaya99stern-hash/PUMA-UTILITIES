import MailComposer from 'nodemailer/lib/mail-composer';
import { htmlToText } from '../merge';
import { parseMessageIds } from '../reply';
import type { Folder, InboundMessage, ListOptions, ListResult, MailProvider, OutgoingMessage, SendResult, VerifyResult } from '../types';
import { toMailOptions } from './shared';
import type { TokenSource } from './gmail';

const API = 'https://graph.microsoft.com/v1.0/me';

async function call<T>(getToken: TokenSource, path: string, init: RequestInit = {}, parse = true): Promise<T> {
  const token = await getToken();
  const res = await fetch(`${API}${path}`, {
    ...init,
    headers: { Authorization: `Bearer ${token}`, ...(init.headers ?? {}) },
    cache: 'no-store',
  });
  if (!res.ok) {
    let detail = '';
    try {
      const body = (await res.json()) as { error?: { message?: string } };
      detail = body.error?.message ?? '';
    } catch {}
    if (res.status === 401) throw Object.assign(new Error('Microsoft rejected the saved sign-in. Reconnect your Outlook account.'), { code: 'EAUTH' });
    if (res.status === 403) throw new Error(`Microsoft denied access. Your admin may need to approve mail permissions. ${detail}`.trim());
    if (res.status === 429) throw new Error('Microsoft rate limit reached. Try again later.');
    throw new Error(`Microsoft Graph error (${res.status}): ${detail || res.statusText}`);
  }
  return (parse ? await res.json() : (undefined as T)) as T;
}

type GraphAddress = { emailAddress?: { address?: string; name?: string } };
type GraphMessage = {
  id: string;
  internetMessageId?: string;
  subject?: string;
  from?: GraphAddress;
  toRecipients?: GraphAddress[];
  ccRecipients?: GraphAddress[];
  receivedDateTime?: string;
  sentDateTime?: string;
  isRead?: boolean;
  body?: { contentType?: string; content?: string };
  bodyPreview?: string;
  internetMessageHeaders?: { name: string; value: string }[];
};

function header(m: GraphMessage, name: string): string | null {
  return m.internetMessageHeaders?.find((h) => h.name.toLowerCase() === name)?.value ?? null;
}

function toInbound(m: GraphMessage, folder: Folder): InboundMessage {
  const html = m.body?.contentType?.toLowerCase() === 'html' ? (m.body.content ?? null) : null;
  const text = html ? htmlToText(html) : (m.body?.content ?? m.bodyPreview ?? '');
  const from = m.from?.emailAddress;
  return {
    providerId: m.id,
    messageId: m.internetMessageId ?? null,
    inReplyTo: parseMessageIds(header(m, 'in-reply-to'))[0] ?? null,
    references: parseMessageIds(header(m, 'references')),
    from: from?.address ? { email: from.address.toLowerCase(), name: from.name || null } : null,
    to: (m.toRecipients ?? []).map((r) => r.emailAddress?.address?.toLowerCase()).filter(Boolean) as string[],
    cc: (m.ccRecipients ?? []).map((r) => r.emailAddress?.address?.toLowerCase()).filter(Boolean) as string[],
    subject: m.subject ?? '',
    text,
    html,
    date: new Date(folder === 'sent' ? (m.sentDateTime ?? m.receivedDateTime ?? Date.now()) : (m.receivedDateTime ?? Date.now())),
    folder,
    isRead: m.isRead ?? false,
    autoSubmitted: header(m, 'auto-submitted'),
  };
}

export function microsoftProvider(getToken: TokenSource, email: string): MailProvider {
  return {
    async send(message: OutgoingMessage): Promise<SendResult> {
      // MIME submission keeps List-Unsubscribe, In-Reply-To and References intact (JSON sendMail only accepts x- headers).
      const options = toMailOptions(message);
      const mail = new MailComposer({ ...options, bcc: options.bcc });
      const buffer: Buffer = await new Promise((resolve, reject) => mail.compile().build((err, out) => (err ? reject(err) : resolve(out))));
      await call<void>(
        getToken,
        '/sendMail',
        { method: 'POST', headers: { 'Content-Type': 'text/plain' }, body: buffer.toString('base64') },
        false,
      );
      return { messageId: options.messageId, providerId: options.messageId };
    },

    async listRecent({ folder, cursor, limit }: ListOptions): Promise<ListResult> {
      const folderName = folder === 'inbox' ? 'inbox' : 'sentitems';
      const since = cursor && !Number.isNaN(Date.parse(cursor)) ? cursor : new Date(Date.now() - 14 * 86_400_000).toISOString();
      const select = 'id,internetMessageId,subject,from,toRecipients,ccRecipients,receivedDateTime,sentDateTime,isRead,body,bodyPreview,internetMessageHeaders';
      const params = new URLSearchParams({
        $top: String(Math.min(limit, 50)),
        $select: select,
        $orderby: 'receivedDateTime desc',
        $filter: `receivedDateTime gt ${since}`,
      });
      const data = await call<{ value: GraphMessage[] }>(getToken, `/mailFolders/${folderName}/messages?${params.toString()}`, {
        headers: { Prefer: 'outlook.body-content-type="html"' },
      });
      const messages = (data.value ?? []).map((m) => toInbound(m, folder));
      const newest = (data.value ?? []).reduce<string | null>((acc, m) => (m.receivedDateTime && (!acc || m.receivedDateTime > acc) ? m.receivedDateTime : acc), null);
      return { messages, cursor: newest ?? cursor ?? null };
    },

    async verify(): Promise<VerifyResult> {
      try {
        const me = await call<{ mail?: string; userPrincipalName?: string }>(getToken, '');
        return { ok: true, email: me.mail ?? me.userPrincipalName ?? email, smtp: { ok: true }, imap: { ok: true } };
      } catch (error) {
        return { ok: false, email, error: error instanceof Error ? error.message : 'Could not reach Microsoft.' };
      }
    },
  };
}
