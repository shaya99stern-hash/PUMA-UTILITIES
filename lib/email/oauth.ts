import 'server-only';

export type OAuthKind = 'google' | 'microsoft';

type Config = { clientId: string; clientSecret: string; authUrl: string; tokenUrl: string; scopes: string[] };

export function oauthConfig(kind: OAuthKind): Config | null {
  if (kind === 'google') {
    const clientId = process.env.GOOGLE_CLIENT_ID?.trim();
    const clientSecret = process.env.GOOGLE_CLIENT_SECRET?.trim();
    if (!clientId || !clientSecret) return null;
    return {
      clientId,
      clientSecret,
      authUrl: 'https://accounts.google.com/o/oauth2/v2/auth',
      tokenUrl: 'https://oauth2.googleapis.com/token',
      scopes: [
        'https://www.googleapis.com/auth/gmail.send',
        'https://www.googleapis.com/auth/gmail.readonly',
        'https://www.googleapis.com/auth/userinfo.email',
      ],
    };
  }
  const clientId = process.env.MICROSOFT_CLIENT_ID?.trim();
  const clientSecret = process.env.MICROSOFT_CLIENT_SECRET?.trim();
  if (!clientId || !clientSecret) return null;
  const tenant = process.env.MICROSOFT_TENANT_ID?.trim() || 'common';
  return {
    clientId,
    clientSecret,
    authUrl: `https://login.microsoftonline.com/${tenant}/oauth2/v2.0/authorize`,
    tokenUrl: `https://login.microsoftonline.com/${tenant}/oauth2/v2.0/token`,
    scopes: ['offline_access', 'Mail.Send', 'Mail.Read', 'User.Read'],
  };
}

export function enabledProviders() {
  return { google: !!oauthConfig('google'), microsoft: !!oauthConfig('microsoft') };
}

/** Public origin of this app: NEXT_PUBLIC_APP_URL wins, then forwarded headers, then the request URL. */
export function requestOrigin(request: Request): string {
  const env = process.env.NEXT_PUBLIC_APP_URL?.trim();
  if (env) return env.replace(/\/+$/, '');
  const url = new URL(request.url);
  const host = request.headers.get('x-forwarded-host') ?? request.headers.get('host') ?? url.host;
  const proto = request.headers.get('x-forwarded-proto')?.split(',')[0] ?? url.protocol.replace(':', '');
  return `${proto}://${host}`;
}

export function redirectUri(kind: OAuthKind, origin: string) {
  return `${origin}/api/oauth/${kind}/callback`;
}

export function buildAuthUrl(kind: OAuthKind, origin: string, state: string, loginHint?: string | null): string {
  const cfg = oauthConfig(kind);
  if (!cfg) throw new Error(`${kind === 'google' ? 'Google' : 'Microsoft'} sign-in is not configured.`);
  const params = new URLSearchParams({
    client_id: cfg.clientId,
    redirect_uri: redirectUri(kind, origin),
    response_type: 'code',
    scope: cfg.scopes.join(' '),
    state,
  });
  if (kind === 'google') {
    params.set('access_type', 'offline');
    params.set('prompt', 'consent');
    params.set('include_granted_scopes', 'true');
  } else {
    params.set('response_mode', 'query');
    params.set('prompt', 'select_account');
  }
  if (loginHint) params.set('login_hint', loginHint);
  return `${cfg.authUrl}?${params.toString()}`;
}

export type TokenResponse = { access_token: string; refresh_token?: string; expires_in: number; scope?: string };

async function tokenRequest(kind: OAuthKind, body: Record<string, string>): Promise<TokenResponse> {
  const cfg = oauthConfig(kind);
  if (!cfg) throw new Error(`${kind} OAuth is not configured.`);
  const res = await fetch(cfg.tokenUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ client_id: cfg.clientId, client_secret: cfg.clientSecret, ...body }).toString(),
    cache: 'no-store',
  });
  const data = (await res.json().catch(() => ({}))) as TokenResponse & { error?: string; error_description?: string };
  if (!res.ok || !data.access_token) {
    const err = new Error(data.error_description || data.error || `Token request failed (${res.status})`) as Error & { code?: string };
    if (data.error === 'invalid_grant' || data.error === 'invalid_client' || res.status === 400 || res.status === 401) err.code = 'EAUTH';
    throw err;
  }
  return data;
}

export function exchangeCode(kind: OAuthKind, code: string, origin: string) {
  return tokenRequest(kind, { grant_type: 'authorization_code', code, redirect_uri: redirectUri(kind, origin) });
}

export function refreshAccessToken(kind: OAuthKind, refreshToken: string) {
  return tokenRequest(kind, { grant_type: 'refresh_token', refresh_token: refreshToken });
}

export async function fetchIdentity(kind: OAuthKind, accessToken: string): Promise<{ email: string; name: string | null }> {
  if (kind === 'google') {
    const res = await fetch('https://openidconnect.googleapis.com/v1/userinfo', { headers: { Authorization: `Bearer ${accessToken}` }, cache: 'no-store' });
    const data = (await res.json().catch(() => ({}))) as { email?: string; name?: string };
    if (!res.ok || !data.email) throw new Error('Google did not return an email address for this account.');
    return { email: data.email.toLowerCase(), name: data.name ?? null };
  }
  const res = await fetch('https://graph.microsoft.com/v1.0/me?$select=mail,userPrincipalName,displayName', { headers: { Authorization: `Bearer ${accessToken}` }, cache: 'no-store' });
  const data = (await res.json().catch(() => ({}))) as { mail?: string; userPrincipalName?: string; displayName?: string };
  const email = (data.mail || data.userPrincipalName || '').toLowerCase();
  if (!res.ok || !email) throw new Error('Microsoft did not return an email address for this account.');
  return { email, name: data.displayName ?? null };
}
