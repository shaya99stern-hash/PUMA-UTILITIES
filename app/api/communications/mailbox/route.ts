import { NextResponse } from 'next/server';
import { invokeCommunications } from '@/lib/server/communications';
import { requireWorkspace } from '@/lib/server/current-workspace';

export const dynamic = 'force-dynamic';

export async function GET() {
  try {
    const { supabase, workspace } = await requireWorkspace();
    const result = await supabase
      .from('mailboxes')
      .select('id,label,from_name,from_email,smtp_host,smtp_port,smtp_secure,smtp_username,verified_at,is_default')
      .eq('workspace_id', workspace.id)
      .order('created_at', { ascending: true });
    if (result.error) throw result.error;
    return NextResponse.json({ ok: true, mailboxes: result.data ?? [] }, { headers: { 'Cache-Control': 'no-store' } });
  } catch (error) {
    return NextResponse.json({ ok: false, error: error instanceof Error ? error.message : 'Unable to load company email.' }, { status: 503 });
  }
}

export async function POST(request: Request) {
  try {
    const payload = await request.json() as Record<string, unknown>;
    const { body } = await invokeCommunications('save_mailbox', payload);
    return NextResponse.json(body, { headers: { 'Cache-Control': 'no-store' } });
  } catch (error) {
    return NextResponse.json({ ok: false, error: error instanceof Error ? error.message : 'Unable to save company email.' }, { status: 400 });
  }
}
