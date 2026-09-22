import { NextResponse } from 'next/server';
import { addClaim, createResearchGraph, upsertEntity } from '@/lib/research/graph';
import { runResearch } from '@/lib/research/runner';
import { isPublicHttpUrl } from '@/lib/research/web-search';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 60;

const MAX_BODY_BYTES = 16_384;

export async function GET() {
  return NextResponse.json({
    webDiscoveryConfigured: true,
    webDiscoveryBackend: process.env.PUMA_SEARXNG_URL ? 'searxng' : 'duckduckgo-html',
    browserEnrichmentConfigured: Boolean(process.env.PUMA_BROWSER_RESEARCH_URL && process.env.PUMA_BROWSER_RESEARCH_TOKEN),
    browserAdapters: ['contactout-public-directory'],
    officialLeadershipSources: ['sec-edgar'],
    officialPropertySources: ['nyc-acris','nyc-hpd-registrations','nj-parcel-mod4'],
    structuredFirstParty: ['schema-org-person','schema-org-property','sitemap-discovery'],
    costEstimation: 'evidence-gated-residential-benchmark-plus-unambiguous-fixed-water-charge',
    rules: { publicOnly: true, paywallBypass: false, contactCreditsBypass: false },
  }, { headers: { 'Cache-Control': 'no-store' } });
}

export async function POST(request: Request) {
  try {
    const contentLength = Number(request.headers.get('content-length') ?? 0);
    if (contentLength > MAX_BODY_BYTES) return NextResponse.json({ error: 'Request is too large.' }, { status: 413 });
    const raw = await request.text();
    if (raw.length > MAX_BODY_BYTES) return NextResponse.json({ error: 'Request is too large.' }, { status: 413 });
    const input = JSON.parse(raw) as Record<string, unknown>;

    const label = typeof input.label === 'string' ? input.label.trim() : '';
    const geography = typeof input.geography === 'string' ? input.geography.trim().toUpperCase() : '';
    const website = typeof input.website === 'string' ? input.website.trim() : '';
    if (label.length < 2 || label.length > 180) return invalid('Company name must be 2–180 characters.');
    if (geography && !/^[A-Z]{2}$/.test(geography)) return invalid('Geography must be a two-letter state code.');
    if (website && !isPublicHttpUrl(website)) return invalid('Website must be a public HTTP(S) URL.');

    const graph = createResearchGraph();
    const rootEntityId = `seed:company:${slug(label)}`;
    upsertEntity(graph, { id: rootEntityId, kind: 'company', label, geography: geography || undefined });

    if (website) {
      addClaim(graph, {
        id: `claim:${rootEntityId}:website:operator-hint`,
        subjectId: rootEntityId,
        fact: 'company.website',
        value: new URL(website).origin,
        state: 'INFERRED',
        confidence: 0.69,
        evidenceIds: [],
        observedAt: new Date().toISOString(),
      });
    }

    const result = await runResearch(graph, rootEntityId, {
      maxTasks: boundedInteger(input.maxTasks, 44, 1, 80),
      maxDepth: boundedInteger(input.maxDepth, 3, 0, 5),
      maxBudgetUnits: boundedNumber(input.maxBudgetUnits, 58, 5, 120),
      concurrency: boundedInteger(input.concurrency, 4, 1, 8),
      perNeed: boundedInteger(input.perNeed, 4, 1, 6),
      targetCompleteness: boundedNumber(input.targetCompleteness, 0.82, 0.25, 1),
      signal: request.signal,
    });

    return NextResponse.json(result, { headers: { 'Cache-Control': 'no-store' } });
  } catch (error) {
    if (error instanceof SyntaxError) return invalid('Request body must be valid JSON.');
    const message = error instanceof Error ? error.message : 'Research run failed.';
    return NextResponse.json({ error: message }, { status: 502 });
  }
}

function invalid(message: string) {
  return NextResponse.json({ error: message }, { status: 400 });
}

function boundedInteger(value: unknown, fallback: number, min: number, max: number): number {
  return typeof value === 'number' && Number.isFinite(value) ? Math.max(min, Math.min(max, Math.floor(value))) : fallback;
}

function boundedNumber(value: unknown, fallback: number, min: number, max: number): number {
  return typeof value === 'number' && Number.isFinite(value) ? Math.max(min, Math.min(max, value)) : fallback;
}

function slug(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 80) || 'entity';
}
