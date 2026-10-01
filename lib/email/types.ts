/** Shared types for the email subsystem. Pure (no server-only imports) so they can be used anywhere. */

export type ProviderName = 'smtp_imap' | 'gmail' | 'microsoft';
export type Folder = 'inbox' | 'sent';

export type Address = { email: string; name?: string | null };

export type OutgoingMessage = {
  from: Address;
  to: string[];
  cc?: string[];
  bcc?: string[];
  subject: string;
  html: string;
  text?: string;
  /** Message-ID header including angle brackets. Generated when omitted. */
  messageId?: string;
  inReplyTo?: string | null;
  references?: string[];
  headers?: Record<string, string>;
};

export type SendResult = {
  /** RFC 5322 Message-ID header value, including angle brackets. */
  messageId: string;
  /** Provider's own id for the stored message (Gmail id, Graph id, or the Message-ID for SMTP). */
  providerId: string;
};

export type InboundMessage = {
  providerId: string;
  messageId: string | null;
  inReplyTo: string | null;
  references: string[];
  from: Address | null;
  to: string[];
  cc: string[];
  subject: string;
  text: string;
  html: string | null;
  date: Date;
  folder: Folder;
  isRead: boolean;
  autoSubmitted?: string | null;
};

export type ListOptions = {
  folder: Folder;
  /** Opaque cursor returned by the previous call for the same folder. */
  cursor?: string | null;
  limit: number;
  /** Provider ids already stored; providers that fetch one message at a time use this to skip work. */
  known?: Set<string>;
};

export type ListResult = { messages: InboundMessage[]; cursor: string | null };

export type VerifyResult = {
  ok: boolean;
  smtp?: { ok: boolean; error?: string };
  imap?: { ok: boolean; error?: string };
  error?: string;
  email?: string;
};

export interface MailProvider {
  send(message: OutgoingMessage): Promise<SendResult>;
  listRecent(options: ListOptions): Promise<ListResult>;
  fetchThread?(threadId: string): Promise<InboundMessage[]>;
  verify(): Promise<VerifyResult>;
}

export type Endpoint = { host: string; port: number; secure: boolean };
