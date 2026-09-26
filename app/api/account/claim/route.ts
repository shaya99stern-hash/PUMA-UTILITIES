import { NextResponse } from 'next/server';
import { requireUser } from '@/lib/server/current-workspace';

export const dynamic = 'force-dynamic';

export async function POST(request: Request) {
  try {
    const body = await request.json() as { email?: unknown; password?: unknown };
    const email = typeof body.email === 'string' ? body.email.trim() : '';
    const password = typeof body.password === 'string' ? body.password : '';
    if (!email || !password) return NextResponse.json({ ok: false, error: 'Email and password are required.' }, { status: 400 });
    if (password.length < 8) return NextResponse.json({ ok: false, error: 'Use at least 8 characters for your password.' }, { status: 400 });

    const { supabase } = await requireUser();
    const updated = await supabase.auth.updateUser({ email, password });
    if (updated.error) return NextResponse.json({ ok: false, error: updated.error.message }, { status: 400 });

    return NextResponse.json({
      ok: true,
      email,
      confirmationRequired: updated.data.user?.email !== email,
      message: 'Account email saved. Check your inbox if Supabase asks you to confirm the new address.',
    }, { headers: { 'Cache-Control': 'no-store' } });
  } catch (error) {
    return NextResponse.json({ ok: false, error: error instanceof Error ? error.message : 'Unable to save account email.' }, { status: 500 });
  }
}
