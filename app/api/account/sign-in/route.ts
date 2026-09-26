import { NextResponse } from 'next/server';
import { createServerSupabase } from '@/lib/server/supabase-server';

export const dynamic = 'force-dynamic';

export async function POST(request: Request) {
  try {
    const body = await request.json() as { email?: unknown; password?: unknown };
    const email = typeof body.email === 'string' ? body.email.trim() : '';
    const password = typeof body.password === 'string' ? body.password : '';
    if (!email || !password) return NextResponse.json({ ok: false, error: 'Email and password are required.' }, { status: 400 });

    const supabase = await createServerSupabase();
    const signedIn = await supabase.auth.signInWithPassword({ email, password });
    if (signedIn.error || !signedIn.data.user) {
      return NextResponse.json({ ok: false, error: signedIn.error?.message || 'Unable to sign in.' }, { status: 401 });
    }

    return NextResponse.json({ ok: true, email: signedIn.data.user.email ?? email }, { headers: { 'Cache-Control': 'no-store' } });
  } catch (error) {
    return NextResponse.json({ ok: false, error: error instanceof Error ? error.message : 'Unable to sign in.' }, { status: 500 });
  }
}
