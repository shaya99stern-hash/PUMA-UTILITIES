import { requireMember } from '@/lib/server/auth';
import { json, route } from '@/lib/server/http';
import { type IdContext } from '@/lib/email/api';
import { loadMailbox, publicMailbox } from '@/lib/email/mailboxes';
import { syncMailbox } from '@/lib/email/sync';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 60;

export const POST = route<IdContext>(async (_request, { params }) => {
  const ctx = await requireMember();
  const { id } = await params;
  const mailbox = await loadMailbox(ctx.workspaceId, id);
  const result = await syncMailbox(mailbox, { deadline: Date.now() + 40_000 });
  const fresh = await loadMailbox(ctx.workspaceId, id);
  return json({ result, mailbox: publicMailbox(fresh) });
});
