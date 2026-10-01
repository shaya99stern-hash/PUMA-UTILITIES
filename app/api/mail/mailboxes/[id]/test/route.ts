import { requireMember } from '@/lib/server/auth';
import { json, route } from '@/lib/server/http';
import { type IdContext } from '@/lib/email/api';
import { loadMailbox, markMailbox, providerFor } from '@/lib/email/mailboxes';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 60;

/** Re-checks the saved connection (SMTP login + IMAP login, or the OAuth token). */
export const POST = route<IdContext>(async (_request, { params }) => {
  const ctx = await requireMember();
  const { id } = await params;
  const mailbox = await loadMailbox(ctx.workspaceId, id);
  let result;
  try {
    result = await providerFor(mailbox).verify();
  } catch (error) {
    result = { ok: false, error: error instanceof Error ? error.message : 'Could not test this mailbox.' };
  }
  await markMailbox(mailbox.id, result.ok ? 'active' : 'error', result.ok ? null : (result.error ?? 'Connection failed'));
  return json({ test: result });
});
