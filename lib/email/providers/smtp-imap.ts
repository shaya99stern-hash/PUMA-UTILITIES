import nodemailer from 'nodemailer';
import { ImapFlow, type FetchMessageObject } from 'imapflow';
import { simpleParser, type ParsedMail, type AddressObject } from 'mailparser';
import { htmlToText } from '../merge';
import { parseMessageIds } from '../reply';
import type { Endpoint, Folder, InboundMessage, ListOptions, ListResult, MailProvider, OutgoingMessage, SendResult, VerifyResult } from '../types';
import { explainMailError, toMailOptions } from './shared';

export type SmtpImapConfig = {
  email: string;
  username: string;
  password: string;
  smtp: Endpoint;
  imap: Endpoint;
  /** Shown in error messages so people know to use an app password. */
  appPassword?: boolean;
};

/**
 * Local-development switch. With PUMA_EMAIL_TRANSPORT=json nothing leaves the machine:
 * sends are serialized by nodemailer's JSON transport and IMAP returns no messages.
 */
export function jsonTransportEnabled() {
  return process.env.PUMA_EMAIL_TRANSPORT === 'json';
}

function imapClient(cfg: SmtpImapConfig) {
  return new ImapFlow({
    host: cfg.imap.host,
    port: cfg.imap.port,
    secure: cfg.imap.secure,
    auth: { user: cfg.username || cfg.email, pass: cfg.password },
    logger: false,
    greetingTimeout: 15_000,
    socketTimeout: 45_000,
    connectionTimeout: 15_000,
  });
}

function smtpTransport(cfg: SmtpImapConfig) {
  if (jsonTransportEnabled()) return nodemailer.createTransport({ jsonTransport: true });
  return nodemailer.createTransport({
    host: cfg.smtp.host,
    port: cfg.smtp.port,
    secure: cfg.smtp.secure,
    requireTLS: !cfg.smtp.secure,
    auth: { user: cfg.username || cfg.email, pass: cfg.password },
    connectionTimeout: 15_000,
    greetingTimeout: 15_000,
    socketTimeout: 45_000,
  });
}

function addresses(value: AddressObject | AddressObject[] | undefined): string[] {
  if (!value) return [];
  const list = Array.isArray(value) ? value : [value];
  return list.flatMap((a) => a.value.map((v) => v.address?.toLowerCase()).filter(Boolean) as string[]);
}

/** Converts a mailparser result into the provider-neutral shape. Shared with the Gmail provider (raw format). */
export function toInbound(parsed: ParsedMail, extra: { providerId: string; folder: Folder; isRead: boolean }): InboundMessage {
  const from = parsed.from?.value?.[0];
  const html = typeof parsed.html === 'string' ? parsed.html : null;
  const text = parsed.text?.trim() || (html ? htmlToText(html) : '');
  const autoSubmitted = parsed.headers.get('auto-submitted');
  return {
    providerId: extra.providerId,
    messageId: parsed.messageId?.toLowerCase() ?? null,
    inReplyTo: parseMessageIds(parsed.inReplyTo)[0] ?? null,
    references: parseMessageIds(parsed.references),
    from: from?.address ? { email: from.address.toLowerCase(), name: from.name || null } : null,
    to: addresses(parsed.to),
    cc: addresses(parsed.cc),
    subject: parsed.subject ?? '',
    text,
    html,
    date: parsed.date ?? new Date(),
    folder: extra.folder,
    isRead: extra.isRead,
    autoSubmitted: typeof autoSubmitted === 'string' ? autoSubmitted : null,
  };
}

const SENT_NAMES = ['Sent', 'Sent Items', 'Sent Mail', '[Gmail]/Sent Mail', '[Google Mail]/Sent Mail', 'INBOX.Sent', 'Sent Messages', 'Gesendet'];

async function resolveFolder(client: ImapFlow, folder: Folder): Promise<string | null> {
  if (folder === 'inbox') return 'INBOX';
  const boxes = await client.list();
  const special = boxes.find((b) => b.specialUse === '\\Sent');
  if (special) return special.path;
  for (const name of SENT_NAMES) {
    const hit = boxes.find((b) => b.path.toLowerCase() === name.toLowerCase());
    if (hit) return hit.path;
  }
  return boxes.find((b) => /sent/i.test(b.path))?.path ?? null;
}

function parseCursor(cursor: string | null | undefined): { validity: string; uid: number } | null {
  const m = cursor?.match(/^(\d+):(\d+)$/);
  return m ? { validity: m[1], uid: Number(m[2]) } : null;
}

export function smtpImapProvider(cfg: SmtpImapConfig): MailProvider {
  return {
    async send(message: OutgoingMessage): Promise<SendResult> {
      const options = toMailOptions(message);
      try {
        await smtpTransport(cfg).sendMail(options);
      } catch (error) {
        const err = new Error(explainMailError(error, 'send', { host: cfg.smtp.host, appPassword: cfg.appPassword })) as Error & { cause?: unknown };
        err.cause = error;
        throw err;
      }
      return { messageId: options.messageId, providerId: options.messageId.toLowerCase() };
    },

    async listRecent({ folder, cursor, limit }: ListOptions): Promise<ListResult> {
      if (jsonTransportEnabled()) return { messages: [], cursor: cursor ?? null };
      const client = imapClient(cfg);
      client.on('error', () => undefined);
      try {
        await client.connect();
        const path = await resolveFolder(client, folder);
        if (!path) return { messages: [], cursor: cursor ?? null };
        const lock = await client.getMailboxLock(path, { readOnly: true });
        try {
          const mailbox = client.mailbox;
          if (!mailbox || typeof mailbox === 'boolean') return { messages: [], cursor: cursor ?? null };
          const validity = String(mailbox.uidValidity);
          const prev = parseCursor(cursor);
          const sameBox = prev && prev.validity === validity;
          const total = mailbox.exists;
          if (total === 0) return { messages: [], cursor: `${validity}:${prev && sameBox ? prev.uid : 0}` };

          let range: string;
          let byUid = false;
          if (sameBox) {
            range = `${prev.uid + 1}:*`;
            byUid = true;
          } else {
            range = `${Math.max(1, total - limit + 1)}:*`;
          }

          const fetched: FetchMessageObject[] = [];
          for await (const msg of client.fetch(range, { uid: true, flags: true, source: { maxLength: 600_000 } } as never, { uid: byUid })) {
            // `N:*` always includes the highest message even when it is older than N.
            if (sameBox && msg.uid <= prev.uid) continue;
            fetched.push(msg);
          }
          fetched.sort((a, b) => a.uid - b.uid);
          const batch = sameBox ? fetched.slice(0, limit) : fetched.slice(-limit);

          const messages: InboundMessage[] = [];
          let maxUid = sameBox ? prev.uid : 0;
          for (const msg of batch) {
            maxUid = Math.max(maxUid, msg.uid);
            if (!msg.source) continue;
            try {
              const parsed = await simpleParser(msg.source);
              messages.push(
                toInbound(parsed, {
                  providerId: parsed.messageId?.toLowerCase() ?? `imap:${validity}:${path}:${msg.uid}`,
                  folder,
                  isRead: msg.flags?.has('\\Seen') ?? false,
                }),
              );
            } catch {
              // Skip unparseable messages but keep the cursor moving.
            }
          }
          return { messages, cursor: `${validity}:${maxUid}` };
        } finally {
          lock.release();
        }
      } catch (error) {
        const err = new Error(explainMailError(error, 'imap', { host: cfg.imap.host, appPassword: cfg.appPassword })) as Error & { cause?: unknown };
        err.cause = error;
        throw err;
      } finally {
        await client.logout().catch(() => client.close());
      }
    },

    async verify(): Promise<VerifyResult> {
      if (jsonTransportEnabled()) return { ok: true, smtp: { ok: true }, imap: { ok: true }, email: cfg.email };
      const result: VerifyResult = { ok: false, email: cfg.email };
      try {
        await smtpTransport(cfg).verify();
        result.smtp = { ok: true };
      } catch (error) {
        result.smtp = { ok: false, error: explainMailError(error, 'smtp', { host: cfg.smtp.host, appPassword: cfg.appPassword }) };
      }
      const client = imapClient(cfg);
      client.on('error', () => undefined);
      try {
        await client.connect();
        result.imap = { ok: true };
      } catch (error) {
        result.imap = { ok: false, error: explainMailError(error, 'imap', { host: cfg.imap.host, appPassword: cfg.appPassword }) };
      } finally {
        await client.logout().catch(() => client.close());
      }
      result.ok = !!result.smtp?.ok && !!result.imap?.ok;
      if (!result.ok) result.error = [result.smtp?.error, result.imap?.error].filter(Boolean).join(' ');
      return result;
    },
  };
}
