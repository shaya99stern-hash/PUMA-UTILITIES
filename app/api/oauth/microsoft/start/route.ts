import { NextResponse } from 'next/server';
import { requireMember } from '@/lib/server/auth';
import { ApiError, route, searchParams } from '@/lib/server/http';
import { buildAuthUrl, oauthConfig, requestOrigin } from '@/lib/email/oauth';
import { signState } from '@/lib/email/sign';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** Redirects to the provider's consent screen. The state parameter is signed and expires in 15 minutes. */
export const GET = route(async (request) => {
  const ctx = await requireMember();
  if (!oauthConfig('microsoft')) throw new ApiError(404, 'microsoft sign-in is not configured on this server.');
  const p = searchParams(request);
  const back = p.get('return')?.startsWith('/') && !p.get('return')?.startsWith('//') ? p.get('return')! : '/settings/email';
  const origin = requestOrigin(request);
  const state = signState({ p: 'microsoft', ws: ctx.workspaceId, uid: ctx.userId, back });
  return NextResponse.redirect(buildAuthUrl('microsoft', origin, state, p.get('email')));
});
