/**
 * Transparent 0-100 lead score. Each factor explains itself; unknown facts lower confidence
 * instead of being scored as zero-value evidence.
 */
import { portfolioStats, rankPeople, type Dossier, type ScoreFactor } from './dossier';

export function scoreDossier(d: Dossier): { score: number; confidence: 'high' | 'medium' | 'low'; factors: ScoreFactor[]; why: string[] } {
  const stats = portfolioStats(d);
  const factors: ScoreFactor[] = [];
  const why: string[] = [];
  const units = Math.max(stats.units, stats.claimedUnits ?? 0);
  const buildings = Math.max(stats.buildings, stats.claimedBuildings ?? 0);

  // 1. Portfolio size (30)
  let size = 0;
  if (units > 0) {
    if (units < 40) size = 4;
    else if (units < 100) size = 10;
    else if (units < 300) size = 18;
    else if (units < 1000) size = 25;
    else size = 30;
    if (buildings >= 5) size = Math.min(30, size + 3);
  }
  factors.push({ id: 'portfolio', label: 'Portfolio size', points: size, max: 30, known: units > 0, detail: units > 0 ? `${buildings.toLocaleString()} building${buildings === 1 ? '' : 's'}, ${units.toLocaleString()} units${stats.unitsEstimated ? ' (some estimated)' : ''}` : 'Unit count not found yet' });
  if (units >= 300) why.push(`${units.toLocaleString()} units across ${buildings} buildings`);

  // 2. Water spend exposure (20)
  const spend = d.water.estAnnualSpend ?? 0;
  const spendPts = spend <= 0 ? 0 : spend < 50_000 ? 5 : spend < 150_000 ? 10 : spend < 500_000 ? 15 : 20;
  factors.push({ id: 'water', label: 'Water + sewer spend', points: spendPts, max: 20, known: spend > 0, detail: spend > 0 ? `~$${Math.round(spend / 1000).toLocaleString()}K per year (estimate)` : 'No units to estimate from' });
  if (spend >= 150_000) why.push(`Estimated ~$${Math.round(spend / 1000).toLocaleString()}K/yr water + sewer spend`);

  // 3. Decision maker (15)
  const ranked = rankPeople(d.people);
  const dm = ranked.find((p) => p.decisionMaker);
  const dmPts = dm ? (dm.role === 'owner' || dm.role === 'executive' ? 15 : 11) : ranked.length ? 6 : 0;
  factors.push({ id: 'decision_maker', label: 'Decision maker', points: dmPts, max: 15, known: ranked.length > 0, detail: dm ? `${dm.name}${dm.title ? `, ${dm.title}` : ''}` : ranked.length ? `${ranked[0].name} (role unclear)` : 'Nobody named yet' });
  if (dm) why.push(`Decision maker identified: ${dm.name}${dm.title ? ` (${dm.title})` : ''}`);

  // 4. Reachability (15)
  const dmPublished = ranked.find((p) => p.decisionMaker && p.emails.some((e) => e.status === 'published'));
  const anyPublished = ranked.find((p) => p.emails.some((e) => e.status === 'published'));
  const dmInferred = ranked.find((p) => p.decisionMaker && p.emails.length);
  let reach = 0;
  let reachDetail = 'No email or phone yet';
  if (dmPublished) { reach = 15; reachDetail = `Published email for ${dmPublished.name}`; }
  else if (anyPublished) { reach = 12; reachDetail = `Published email for ${anyPublished.name}`; }
  else if (dmInferred) { reach = 9; reachDetail = `Inferred email for ${dmInferred.name}`; }
  else if (d.emails.length) { reach = 7; reachDetail = `Company email ${d.emails[0].email}`; }
  else if (d.phones.length || ranked.some((p) => p.phones.length)) { reach = 5; reachDetail = `Phone ${d.phones[0]?.phone ?? ranked.find((p) => p.phones.length)?.phones[0].phone}`; }
  factors.push({ id: 'reachability', label: 'Reachability', points: reach, max: 15, known: reach > 0, detail: reachDetail });
  if (reach >= 12) why.push('Direct email published in public records or on their website');

  // 5. Building age (10) — older plumbing leaks more.
  const year = stats.avgYearBuilt;
  const agePts = !year ? 0 : year < 1950 ? 10 : year < 1975 ? 8 : year < 2000 ? 5 : 2;
  factors.push({ id: 'age', label: 'Building age', points: agePts, max: 10, known: !!year, detail: year ? `Average year built ${year}` : 'Year built unknown' });
  if (year && year < 1975) why.push(`Older stock (avg. built ${year}): higher leak risk`);

  // 6. Corroboration (10)
  const sources = Object.keys(d.sources).length;
  const corr = sources >= 4 ? 10 : sources === 3 ? 8 : sources === 2 ? 5 : 2;
  factors.push({ id: 'corroboration', label: 'Cross-referenced sources', points: corr, max: 10, known: true, detail: `${sources} independent source${sources === 1 ? '' : 's'}` });

  const score = Math.max(0, Math.min(100, factors.reduce((s, f) => s + f.points, 0)));
  const known = factors.filter((f) => f.known).length;
  const confidence = known >= 5 && d.nameConfidence >= 0.6 ? 'high' : known >= 3 && d.nameConfidence >= 0.35 ? 'medium' : 'low';
  if (d.water.utilities[0]) why.push(`Served by ${d.water.utilities[0].name}`);
  return { score, confidence, factors, why };
}
