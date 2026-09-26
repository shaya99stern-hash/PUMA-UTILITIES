import { NextResponse } from 'next/server';
import { invokeCommunications } from '@/lib/server/communications';
import { requireWorkspace } from '@/lib/server/current-workspace';

export const dynamic = 'force-dynamic';

export async function GET() {
  try {
    const { body } = await invokeCommunications('push_key');
    return NextResponse.json({ ok: true, publicKey: body.publicKey }, { headers: { 'Cache-Control': 'no-store' } });
  } catch (error) {
    return NextResponse.json({ ok: false, error: error instanceof Error ? error.message : 'Unable to initialize phone alerts.' }, { status: 503 });
  }
}

export async function POST(request: Request) {
  try {
    const body = await request.json() as { endpoint?: unknown; keys?: { p256dh?: unknown; auth?: unknown } };
    const endpoint = typeof body.endpoint === 'string' ? body.endpoint : '';
    const p256dh = typeof body.keys?.p256dh === 'string' ? body.keys.p256dh : '';
    const auth = typeof body.keys?.auth === 'string' ? body.keys.auth : '';
    if (!endpoint || !p256dh || !auth) return NextResponse.json({ ok: false, error: 'Invalid push subscription.' }, { status: 400 });

    const { supabase, workspace } = await requireWorkspace();
    const result = await supabase.from('push_subscriptions').upsert({
      workspace_id: workspace.id,
      endpoint,
      p256dh,
      auth,
      user_agent: request.headers.get('user-agent'),
      last_used_at: new Date().toISOString(),
    }, { onConflict: 'workspace_id,endpoint' }).select('id').single();
    if (result.error) throw result.error;

    const preference = await supabase.from('notification_preferences').upsert({
      workspace_id: workspace.id,
      push_enabled: true,
      updated_at: new Date().toISOString(),
    }, { onConflict: 'workspace_id' });
    if (preference.error) throw preference.error;

    return NextResponse.json({ ok: true, pushEnabled: true }, { status: 201, headers: { 'Cache-Control': 'no-store' } });
  } catch (error) {
    return NextResponse.json({ ok: false, error: error instanceof Error ? error.message : 'Unable to enable phone alerts.' }, { status: 500 });
  }
}

export async function DELETE(request: Request) {
  try {
    const body = await request.json().catch(() => ({})) as { endpoint?: unknown };
    const endpoint = typeof body.endpoint === 'string' ? body.endpoint : '';
    if (!endpoint) return NextResponse.json({ ok: false, error: 'A push subscription endpoint is required.' }, { status: 400 });

    const { supabase, workspace } = await requireWorkspace();
    const removed = await supabase
      .from('push_subscriptions')
      .delete()
      .eq('workspace_id', workspace.id)
      .eq('endpoint', endpoint);
    if (removed.error) throw removed.error;

    const remaining = await supabase
      .from('push_subscriptions')
      .select('id', { count: 'exact', head: true })
      .eq('workspace_id', workspace.id);
    if (remaining.error) throw remaining.error;
    const remainingSubscriptions = remaining.count ?? 0;

    const preference = await supabase.from('notification_preferences').upsert({
      workspace_id: workspace.id,
      push_enabled: remainingSubscriptions > 0,
      updated_at: new Date().toISOString(),
    }, { onConflict: 'workspace_id' });
    if (preference.error) throw preference.error;

    return NextResponse.json({
      ok: true,
      pushEnabled: remainingSubscriptions > 0,
      remainingSubscriptions,
    }, { headers: { 'Cache-Control': 'no-store' } });
  } catch (error) {
    return NextResponse.json({ ok: false, error: error instanceof Error ? error.message : 'Unable to disable phone alerts.' }, { status: 500 });
  }
}
