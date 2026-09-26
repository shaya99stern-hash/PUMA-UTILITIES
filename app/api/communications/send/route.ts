import { NextResponse } from 'next/server';
import { requireWorkspace } from '@/lib/server/current-workspace';

export const dynamic = 'force-dynamic';

export async function GET() {
  try {
    const { supabase, workspace } = await requireWorkspace();
    const result = await supabase
      .from('outbound_messages')
      .select('id,recipient_email,recipient_name,subject,scheduled_for,status,sent_at,last_error,created_at')
      .eq('workspace_id', workspace.id)
      .order('created_at', { ascending: false })
      .limit(25);
    if (result.error) throw result.error;
    return NextResponse.json({ ok: true, messages: result.data ?? [] }, { headers: { 'Cache-Control': 'no-store' } });
  } catch (error) {
    return NextResponse.json({ ok: false, error: error instanceof Error ? error.message : 'Unable to load scheduled email.' }, { status: 503 });
  }
}

export async function POST(request: Request) {
  try {
    const body = await request.json() as Record<string, unknown>;
    const { supabase, user, workspace } = await requireWorkspace();
    const mailboxId = typeof body.mailboxId === 'string' ? body.mailboxId : '';
    const recipientEmail = typeof body.recipientEmail === 'string' ? body.recipientEmail.trim() : '';
    const recipientName = typeof body.recipientName === 'string' ? body.recipientName.trim() : '';
    const subject = typeof body.subject === 'string' ? body.subject.trim() : '';
    const bodyText = typeof body.bodyText === 'string' ? body.bodyText.trim() : '';
    const scheduledForRaw = typeof body.scheduledFor === 'string' ? body.scheduledFor : '';
    const scheduledFor = scheduledForRaw ? new Date(scheduledForRaw) : new Date();

    if (!mailboxId || !recipientEmail || !subject || !bodyText || Number.isNaN(scheduledFor.getTime())) {
      return NextResponse.json({ ok: false, error: 'Company email, recipient, subject, message, and a valid delivery time are required.' }, { status: 400 });
    }

    const mailbox = await supabase.from('mailboxes').select('id,verified_at').eq('workspace_id', workspace.id).eq('id', mailboxId).maybeSingle();
    if (mailbox.error) throw mailbox.error;
    if (!mailbox.data?.verified_at) return NextResponse.json({ ok: false, error: 'Verify the company email before scheduling outreach.' }, { status: 400 });

    const inserted = await supabase.from('outbound_messages').insert({
      workspace_id: workspace.id,
      mailbox_id: mailboxId,
      company_id: typeof body.companyId === 'string' && body.companyId ? body.companyId : null,
      person_id: typeof body.personId === 'string' && body.personId ? body.personId : null,
      recipient_email: recipientEmail,
      recipient_name: recipientName || null,
      subject,
      body_text: bodyText,
      body_html: typeof body.bodyHtml === 'string' && body.bodyHtml.trim() ? body.bodyHtml : null,
      scheduled_for: scheduledFor.toISOString(),
      created_by: user.id,
    }).select('id,scheduled_for,status').single();

    if (inserted.error || !inserted.data) throw inserted.error ?? new Error('Unable to schedule email.');
    return NextResponse.json({ ok: true, message: inserted.data }, { status: 201, headers: { 'Cache-Control': 'no-store' } });
  } catch (error) {
    return NextResponse.json({ ok: false, error: error instanceof Error ? error.message : 'Unable to schedule email.' }, { status: 500 });
  }
}
