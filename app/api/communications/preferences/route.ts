import { NextResponse } from 'next/server';
import { requireWorkspace } from '@/lib/server/current-workspace';

export const dynamic = 'force-dynamic';

export async function GET() {
  try {
    const { supabase, workspace } = await requireWorkspace();
    const result = await supabase.from('notification_preferences').select('*').eq('workspace_id', workspace.id).maybeSingle();
    if (result.error) throw result.error;
    return NextResponse.json({
      ok: true,
      preferences: result.data ?? {
        workspace_id: workspace.id,
        push_enabled: false,
        email_enabled: false,
        alert_email: null,
        research_complete: true,
        follow_up_due: true,
        email_delivery: true,
      },
    }, { headers: { 'Cache-Control': 'no-store' } });
  } catch (error) {
    return NextResponse.json({ ok: false, error: error instanceof Error ? error.message : 'Unable to load alerts.' }, { status: 503 });
  }
}

export async function POST(request: Request) {
  try {
    const body = await request.json() as Record<string, unknown>;
    const { supabase, workspace } = await requireWorkspace();
    const payload = {
      workspace_id: workspace.id,
      push_enabled: body.pushEnabled === true,
      email_enabled: body.emailEnabled === true,
      alert_email: typeof body.alertEmail === 'string' && body.alertEmail.trim() ? body.alertEmail.trim() : null,
      research_complete: body.researchComplete !== false,
      follow_up_due: body.followUpDue !== false,
      email_delivery: body.emailDelivery !== false,
      updated_at: new Date().toISOString(),
    };
    if (payload.email_enabled && !payload.alert_email) {
      return NextResponse.json({ ok: false, error: 'Enter an alert email address before enabling email alerts.' }, { status: 400 });
    }
    const result = await supabase.from('notification_preferences').upsert(payload, { onConflict: 'workspace_id' }).select('*').single();
    if (result.error || !result.data) throw result.error ?? new Error('Unable to save alert preferences.');
    return NextResponse.json({ ok: true, preferences: result.data }, { headers: { 'Cache-Control': 'no-store' } });
  } catch (error) {
    return NextResponse.json({ ok: false, error: error instanceof Error ? error.message : 'Unable to save alerts.' }, { status: 500 });
  }
}
