import { NextResponse } from 'next/server';
import { requireUser } from '@/lib/server/current-workspace';

export const dynamic = 'force-dynamic';

export async function GET() {
  try {
    const { user } = await requireUser();
    const email = user.email ?? '';
    const portable = Boolean(email && !email.endsWith('@device.invalid'));
    return NextResponse.json({ ok: true, portable, email: portable ? email : null }, { headers: { 'Cache-Control': 'no-store' } });
  } catch (error) {
    return NextResponse.json({ ok: false, portable: false, email: null, error: error instanceof Error ? error.message : 'Unable to read account status.' }, { status: 503, headers: { 'Cache-Control': 'no-store' } });
  }
}
