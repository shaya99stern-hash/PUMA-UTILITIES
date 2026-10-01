import { contactOutLookupUrl } from '@/lib/engine/sources/contactout';
import { portfolioStats, rankPeople, type Dossier } from '@/lib/engine/dossier';
import { requireMember } from '@/lib/server/auth';
import { sql } from '@/lib/server/db';
import { ApiError, json, route, searchParams } from '@/lib/server/http';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** Compact candidate view for lists; ?candidate=<id> returns the full dossier. */
function summarize(row: { id: string; name: string; score: number | null; status: string; company_id: string | null; summary: Dossier }) {
  const d = row.summary;
  const st = portfolioStats(d);
  const people = rankPeople(d.people ?? []).slice(0, 5).map((p) => ({
    name: p.name,
    title: p.title,
    role: p.role,
    decisionMaker: p.decisionMaker,
    email: p.emails.find((e) => e.status === 'published')?.email ?? p.emails[0]?.email ?? null,
    emailStatus: p.emails.find((e) => e.status === 'published') ? 'published' : p.emails.length ? 'inferred' : null,
    phone: p.phones[0]?.phone ?? null,
    linkedin: p.linkedin,
    lookup: contactOutLookupUrl(p.name, d.nameKind === 'address' ? null : d.name),
  }));
  return {
    id: row.id,
    name: row.name,
    score: row.score,
    status: row.status,
    companyId: row.company_id,
    researchStatus: d.status,
    confidence: d.scoreConfidence,
    type: d.type,
    nameConfidence: d.nameConfidence,
    portfolio: { buildings: st.buildings, units: st.units, unitsEstimated: st.unitsEstimated, avgYearBuilt: st.avgYearBuilt, states: st.states, claimedUnits: st.claimedUnits, claimedBuildings: st.claimedBuildings },
    contacts: people,
    phone: d.phones?.[0]?.phone ?? null,
    email: d.emails?.find((e) => e.status === 'published' && !e.personKey)?.email ?? null,
    website: d.website,
    linkedin: d.linkedin,
    water: { estAnnualSpend: d.water?.estAnnualSpend ?? null, estMonthlySpend: d.water?.estMonthlySpend ?? null, utilities: (d.water?.utilities ?? []).slice(0, 3) },
    signals: (d.signals ?? []).slice(0, 5),
    why: d.why ?? [],
    gaps: d.gaps ?? [],
    sources: Object.entries(d.sources ?? {}).map(([id, s]) => ({ id, name: s.name, hits: s.hits })),
  };
}

export const GET = route(async (request, { params }: { params: Promise<{ runId: string }> }) => {
  const ctx = await requireMember();
  const { runId } = await params;
  const db = sql();
  const [job] = await db`select id, kind, title, input, status, progress, stage, stats, error, log, created_at, finished_at, target_company_id from research_jobs where id = ${runId} and workspace_id = ${ctx.workspaceId}`;
  if (!job) throw new ApiError(404, 'Search not found.');
  const sp = searchParams(request);
  const candidateId = sp.get('candidate');
  if (candidateId) {
    const [c] = await db`select id, name, score, status, company_id, summary from lead_candidates where id = ${candidateId} and job_id = ${runId}`;
    if (!c) throw new ApiError(404, 'Lead not found.');
    return json({ candidate: { ...summarize(c as never), dossier: c.summary } });
  }
  const status = sp.get('status');
  const rows = await db<{ id: string; name: string; score: number | null; status: string; company_id: string | null; summary: Dossier }[]>`
    select id, name, score, status, company_id, summary from lead_candidates
    where job_id = ${runId} ${status ? db`and status = ${status}` : db`and status <> 'dismissed'`}
    order by score desc nulls last, (summary->>'prelimRank')::int desc nulls last limit 250`;
  return json({ job, candidates: rows.map(summarize) });
});
