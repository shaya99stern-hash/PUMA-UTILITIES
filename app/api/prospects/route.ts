import { NextResponse } from 'next/server';
import { RELEASE_RETRIEVED_AT, WORKSPACE_RELEASE } from '@/lib/seed';

/**
 * Legacy public endpoint retained for compatibility.
 * Puma no longer ships canned companies into the operator workspace or exposes
 * them as pseudo-prospects. Real prospects are created only through live
 * evidence-backed research and remain in the user's local workspace.
 */
export function GET() {
  return NextResponse.json({
    generatedAt: RELEASE_RETRIEVED_AT,
    workspaceRelease: WORKSPACE_RELEASE,
    scope: 'Legacy endpoint. Puma no longer publishes static seed companies as prospects.',
    companies: [],
    prospects: [],
  }, {
    headers: { 'Cache-Control': 'no-store' },
  });
}
