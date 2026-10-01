import { requireMember } from '@/lib/server/auth';
import { intParam, json, route, searchParams } from '@/lib/server/http';
import { searchAudience } from '@/lib/email/audience';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * Campaign audience picker: contacts with an email address (plus company-level addresses for companies with no
 * contact email), filtered by stage/state/type/search, flagged when suppressed or unsubscribed.
 * ?companyIds=a,b pre-selects companies (used by "Email these companies" from the CRM).
 */
export const GET = route(async (request) => {
  const ctx = await requireMember();
  const p = searchParams(request);
  const list = (key: string) => p.get(key)?.split(',').map((s) => s.trim()).filter(Boolean);
  const result = await searchAudience(
    ctx.workspaceId,
    {
      companyIds: list('companyIds'),
      contactIds: list('contactIds'),
      filter: {
        q: p.get('q') ?? undefined,
        stage: p.get('stage') || undefined,
        state: p.get('state') || undefined,
        companyType: p.get('companyType') || undefined,
        decisionMakersOnly: p.get('decisionMakersOnly') === '1' || p.get('decisionMakersOnly') === 'true',
      },
    },
    { limit: intParam(p.get('limit'), 100, 1, 500), offset: intParam(p.get('offset'), 0, 0, 100_000) },
  );
  return json(result);
});
