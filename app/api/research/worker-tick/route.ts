import { randomUUID } from 'node:crypto';
import { NextResponse } from 'next/server';
import { createWorkerSupabase } from '@/lib/server/supabase-worker';
import { processNextResearchWork } from '@/lib/server/research-worker';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 45;

const NO_STORE = { 'Cache-Control': 'no-store' };

export async function POST(request: Request) {
  const authorization = request.headers.get('Authorization')?.trim() ?? '';
  const token = authorization.toLowerCase().startsWith('bearer ')
    ? authorization.slice(7).trim()
    : '';

  if (!token) {
    return NextResponse.json({ ok: false, error: 'Unauthorized.' }, { status: 401, headers: NO_STORE });
  }

  let worker: ReturnType<typeof createWorkerSupabase>;
  try {
    worker = createWorkerSupabase(token);
  } catch {
    return NextResponse.json({ ok: false, error: 'Unauthorized.' }, { status: 401, headers: NO_STORE });
  }

  const verified = await worker.rpc('verify_research_worker_token', { candidate_token: token });
  if (verified.error) {
    console.error('research-worker auth check failed', verified.error.message);
    return NextResponse.json({ ok: false, error: 'Worker unavailable.' }, { status: 503, headers: NO_STORE });
  }
  if (verified.data !== true) {
    return NextResponse.json({ ok: false, error: 'Unauthorized.' }, { status: 401, headers: NO_STORE });
  }

  const workerName = `cron:${randomUUID()}`;
  const claimed = await worker.rpc('claim_research_worker_tick', {
    worker_name: workerName,
    lease_seconds: 45,
  });
  if (claimed.error) {
    console.error('research-worker lease failed', claimed.error.message);
    return NextResponse.json({ ok: false, error: 'Worker unavailable.' }, { status: 503, headers: NO_STORE });
  }
  if (claimed.data !== true) {
    return NextResponse.json({ ok: true, worked: false, busy: true }, { status: 202, headers: NO_STORE });
  }

  try {
    const result = await processNextResearchWork(worker, workerName);
    return NextResponse.json(
      { ok: true, worked: result.worked, runId: result.runId, status: result.status },
      { status: result.worked ? 200 : 202, headers: NO_STORE },
    );
  } catch (error) {
    console.error('research-worker tick failed', error instanceof Error ? error.message : String(error));
    return NextResponse.json({ ok: false, error: 'Worker tick failed.' }, { status: 500, headers: NO_STORE });
  } finally {
    const released = await worker.rpc('release_research_worker_tick', { worker_name: workerName });
    if (released.error) console.error('research-worker lease release failed', released.error.message);
  }
}
