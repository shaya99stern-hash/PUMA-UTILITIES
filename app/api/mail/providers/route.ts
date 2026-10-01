import { json, route } from '@/lib/server/http';
import { requireMember } from '@/lib/server/auth';
import { enabledProviders, requestOrigin } from '@/lib/email/oauth';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** Which sign-in providers are configured on the server. The UI uses this to show or hide OAuth buttons. */
export const GET = route(async (request) => {
  await requireMember();
  const { google, microsoft } = enabledProviders();
  const origin = requestOrigin(request);
  return json({
    google,
    microsoft,
    smtp: true,
    origin,
    redirectUris: { google: `${origin}/api/oauth/google/callback`, microsoft: `${origin}/api/oauth/microsoft/callback` },
    devTransport: process.env.PUMA_EMAIL_TRANSPORT === 'json',
  });
});
