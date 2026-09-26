import 'server-only';

import { cookies } from 'next/headers';
import type { PumaBootstrapSession } from '../anonymous-auth';
import { PUMA_SUPABASE_URL } from '../supabase-config';

const DEVICE_COOKIE = 'puma-device';
const DEVICE_BOOTSTRAP_URL = `${PUMA_SUPABASE_URL}/functions/v1/puma-device-bootstrap`;

function validDeviceToken(value: string | undefined): value is string {
  return Boolean(value && /^[a-f0-9]{64}$/.test(value));
}

export async function getDeviceBootstrapSession(): Promise<PumaBootstrapSession> {
  const cookieStore = await cookies();
  const deviceToken = cookieStore.get(DEVICE_COOKIE)?.value;
  if (!validDeviceToken(deviceToken)) throw new Error('AUTH_UNAVAILABLE: missing Puma device identity');

  const result = await fetch(DEVICE_BOOTSTRAP_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ deviceToken }),
    cache: 'no-store',
  });

  if (!result.ok) throw new Error(`AUTH_UNAVAILABLE: device bootstrap returned ${result.status}`);
  const body = await result.json() as Partial<PumaBootstrapSession>;
  if (!body.access_token || !body.refresh_token) throw new Error('AUTH_UNAVAILABLE: incomplete device session');

  return { access_token: body.access_token, refresh_token: body.refresh_token };
}
