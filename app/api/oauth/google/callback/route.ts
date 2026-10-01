import { NextResponse } from 'next/server';
import { encryptSecret } from '@/lib/server/crypto';
import { sql } from '@/lib/server/db';
import { exchangeCode, fetchIdentity, requestOrigin } from '@/lib/email/oauth';
import { verifyState } from '@/lib/email/sign';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

type State = { p: string; ws: string; uid: string | null; back: string };

function done(origin: string, back: string, params: Record<string, string>) {
  const url = new URL(back, origin);
  for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v);
  return NextResponse.redirect(url);
}

export async function GET(request: Request) {
  const origin = requestOrigin(request);
  const url = new URL(request.url);
  const state = verifyState<State>(url.searchParams.get('state'));
  if (!state || state.p !== 'google') return done(origin, '/settings/email', { error: 'The sign-in link expired. Please try connecting again.' });
  const back = state.back || '/settings/email';
  const denied = url.searchParams.get('error');
  if (denied) return done(origin, back, { error: denied === 'access_denied' ? 'Sign-in was cancelled.' : url.searchParams.get('error_description') || denied });
  const code = url.searchParams.get('code');
  if (!code) return done(origin, back, { error: 'The provider did not return an authorization code.' });

  try {
    const token = await exchangeCode('google', code, origin);
    const identity = await fetchIdentity('google', token.access_token);
    const db = sql();
    const provider = 'gmail';
    const existing = await db<{ secret_enc: string | null }[]>`select secret_enc from mailboxes where workspace_id = ${state.ws} and email = ${identity.email}`;
    // Providers only return a refresh token on first consent; keep the old one when it is missing.
    const refresh = token.refresh_token ? encryptSecret(token.refresh_token) : existing[0]?.secret_enc;
    if (!refresh) return done(origin, back, { error: 'No long-lived access was granted. Remove Puma from your account permissions and connect again.' });
    const expires = new Date(Date.now() + Math.max(60, token.expires_in) * 1000);
    await db`
      insert into mailboxes (workspace_id, user_id, provider, email, display_name, secret_enc, access_token_enc, token_expires_at, status, last_error)
      values (${state.ws}, ${state.uid}, ${provider}, ${identity.email}, ${identity.name}, ${refresh}, ${encryptSecret(token.access_token)}, ${expires}, 'active', null)
      on conflict (workspace_id, email) do update set
        provider = excluded.provider, secret_enc = excluded.secret_enc, access_token_enc = excluded.access_token_enc, token_expires_at = excluded.token_expires_at,
        display_name = coalesce(mailboxes.display_name, excluded.display_name), status = 'active', last_error = null`;
    return done(origin, back, { connected: identity.email });
  } catch (error) {
    return done(origin, back, { error: error instanceof Error ? error.message : 'Could not finish connecting.' });
  }
}
