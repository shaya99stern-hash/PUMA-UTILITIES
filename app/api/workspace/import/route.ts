import { NextResponse } from 'next/server';
import { parseWorkspace } from '../../../../lib/workspace';
import { requireWorkspace } from '../../../../lib/server/current-workspace';
import { importLegacyWorkspace } from '../../../../lib/server/workspace-repository';

export const dynamic = 'force-dynamic';
const MAX_IMPORT_BYTES = 5_000_000;

function errorResponse(error: unknown) {
  const message = error instanceof Error ? error.message : 'Unknown workspace import error';
  if (message === 'AUTH_REQUIRED') {
    return NextResponse.json({ ok: false, error: 'Sign in to import this device.' }, { status: 401 });
  }
  if (/workspace export|JSON|Unexpected token|not valid JSON/i.test(message)) {
    return NextResponse.json({ ok: false, error: 'This device does not contain a valid Puma workspace.' }, { status: 400 });
  }
  return NextResponse.json({ ok: false, error: message }, { status: 500 });
}

export async function POST(request: Request) {
  try {
    const contentLength = Number(request.headers.get('content-length') ?? 0);
    if (Number.isFinite(contentLength) && contentLength > MAX_IMPORT_BYTES) {
      return NextResponse.json({ ok: false, error: 'Workspace import is too large.' }, { status: 413 });
    }

    const raw = await request.text();
    if (new TextEncoder().encode(raw).byteLength > MAX_IMPORT_BYTES) {
      return NextResponse.json({ ok: false, error: 'Workspace import is too large.' }, { status: 413 });
    }

    const parsed = parseWorkspace(JSON.parse(raw));
    const { supabase, workspace } = await requireWorkspace();
    const result = await importLegacyWorkspace(supabase, workspace.id, parsed);

    return NextResponse.json({ ok: true, ...result }, { headers: { 'Cache-Control': 'no-store' } });
  } catch (error) {
    return errorResponse(error);
  }
}