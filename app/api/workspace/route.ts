import { NextResponse } from 'next/server';
import { requireWorkspace } from '../../../lib/server/current-workspace';
import { getCanonicalWorkspaceSummary } from '../../../lib/server/workspace-repository';

export const dynamic = 'force-dynamic';

export async function GET() {
  try {
    const { supabase, workspace } = await requireWorkspace();
    const summary = await getCanonicalWorkspaceSummary(supabase, workspace.id);
    return NextResponse.json({ ok: true, ...summary }, { headers: { 'Cache-Control': 'no-store' } });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unable to read Puma workspace status.';
    if (message === 'AUTH_REQUIRED') {
      return NextResponse.json({ ok: false, error: 'Sign in to view workspace status.' }, { status: 401 });
    }
    return NextResponse.json({ ok: false, error: message }, { status: 500 });
  }
}