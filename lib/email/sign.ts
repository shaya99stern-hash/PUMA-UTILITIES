/** HMAC helpers derived from PUMA_ENCRYPTION_KEY. Pure node crypto; no server-only guard so tests can import it. */
import { createHmac, timingSafeEqual } from 'node:crypto';

function derivedKey(purpose: string): Buffer | null {
  const raw = process.env.PUMA_ENCRYPTION_KEY?.trim();
  if (!raw) return null;
  return createHmac('sha256', Buffer.from(raw, 'base64')).update(`puma:${purpose}`).digest();
}

export function hmacHex(purpose: string, data: string, length = 32): string | null {
  const key = derivedKey(purpose);
  if (!key) return null;
  return createHmac('sha256', key).update(data).digest('hex').slice(0, length);
}

export function verifyHmac(purpose: string, data: string, sig: string | null | undefined, length = 32): boolean {
  const expected = hmacHex(purpose, data, length);
  if (!expected || !sig || sig.length !== expected.length) return false;
  return timingSafeEqual(Buffer.from(expected), Buffer.from(sig));
}

/** Signed, expiring state for OAuth round trips: base64url(payload).sig */
export function signState(payload: Record<string, unknown>, ttlSeconds = 900): string {
  const body = Buffer.from(JSON.stringify({ ...payload, exp: Math.floor(Date.now() / 1000) + ttlSeconds })).toString('base64url');
  const sig = hmacHex('oauth-state', body, 43);
  if (!sig) throw new Error('PUMA_ENCRYPTION_KEY is not configured.');
  return `${body}.${sig}`;
}

export function verifyState<T extends Record<string, unknown>>(state: string | null | undefined): T | null {
  if (!state) return null;
  const [body, sig] = state.split('.');
  if (!body || !sig || !verifyHmac('oauth-state', body, sig, 43)) return null;
  try {
    const payload = JSON.parse(Buffer.from(body, 'base64url').toString('utf8')) as T & { exp?: number };
    if (!payload.exp || payload.exp < Math.floor(Date.now() / 1000)) return null;
    return payload;
  } catch {
    return null;
  }
}
