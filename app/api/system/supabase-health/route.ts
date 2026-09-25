import { NextResponse } from 'next/server';
import { requireWorkspace } from '../../../../lib/server/current-workspace';

export const dynamic = 'force-dynamic';

export async function GET() {
  const startedAt = Date.now();

  try {
    const { supabase, user, workspace } = await requireWorkspace();
    const probe = await supabase
      .from('workspaces')
      .select('id')
      .eq('id', workspace.id)
      .single();

    if (probe.error) throw probe.error;

    return NextResponse.json({
      ok: true,
      project: 'Puma Utilities',
      region: 'us-east-1',
      database: 'healthy',
      auth: 'healthy',
      authenticatedEmail: user.email ?? null,
      workspaceId: workspace.id,
      latencyMs: Date.now() - startedAt,
      checkedAt: new Date().toISOString(),
    }, { headers: { 'Cache-Control': 'no-store' } });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown Supabase error';
    const unauthorized = message === 'AUTH_REQUIRED';
    return NextResponse.json({
      ok: false,
      project: 'Puma Utilities',
      region: 'us-east-1',
      database: unauthorized ? 'unknown' : 'unavailable',
      auth: unauthorized ? 'signed-out' : 'unknown',
      latencyMs: Date.now() - startedAt,
      checkedAt: new Date().toISOString(),
      error: unauthorized ? 'Sign in again to test Puma’s database connection.' : message,
    }, { status: unauthorized ? 401 : 503, headers: { 'Cache-Control': 'no-store' } });
  }
}