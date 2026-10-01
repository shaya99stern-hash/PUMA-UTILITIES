/**
 * Durable research jobs. A job is pumped in short slices (from the browser while the page is
 * open, and from the per-minute cron tick otherwise), so long research survives serverless
 * time limits. Stages for discovery: collect -> cluster -> enrich -> finalize.
 */
import 'server-only';
import { sql } from '@/lib/server/db';
import { clusterRecords, mergeDuplicates, prelimRank } from './cluster';
import { collectPage, inGeography, normalizeInput, planCollection, type CollectTask, type StagedSeed } from './collect';
import { loadConnectors, type LoadedConnector } from './connectors';
import { addAddress, addPerson, emptyDossier, portfolioStats, rankPeople, type Dossier } from './dossier';
import { describeError } from './http';
import { derive, hudSignals, resolveDossier } from './resolvers';
import { scoreDossier } from './score';
import type { DiscoverInput, LogLine, PropertyRecord } from './types';

export type JobRow = {
  id: string;
  workspace_id: string;
  kind: 'discover' | 'enrich';
  title: string;
  input: Record<string, unknown>;
  status: 'queued' | 'running' | 'completed' | 'failed' | 'canceled';
  progress: number;
  stage: string | null;
  log: LogLine[];
  stats: Record<string, unknown>;
  state: JobState;
  error: string | null;
  attempts: number;
  target_company_id: string | null;
  created_at: string;
  updated_at: string;
  finished_at: string | null;
};

export type JobState = {
  stage?: 'collect' | 'cluster' | 'enrich' | 'finalize' | 'done';
  tasks?: CollectTask[];
  candidates?: number;
  enriched?: number;
  dossier?: Dossier;
};

const LEASE_SECONDS = 75;
const ENRICH_CONCURRENCY = 4;
const MAX_LOG = 400;

class JobLog {
  lines: LogLine[] = [];
  add(level: LogLine['level'], message: string, source?: string) {
    this.lines.push({ at: new Date().toISOString(), level, message: message.slice(0, 400), source });
  }
}

export function describeSearch(input: DiscoverInput): string {
  const where = [...(input.cities ?? []), ...(input.counties ?? []), ...(input.zips ?? [])];
  const geo = where.length ? where.slice(0, 3).join(', ') : input.states.join(', ');
  const size = input.minUnits ? `${input.minUnits.toLocaleString()}+ units` : 'any size';
  return `Multifamily owners & managers · ${geo} · ${size}`;
}

export async function createDiscoverJob(workspaceId: string, userId: string | null, raw: Partial<DiscoverInput>) {
  const input = normalizeInput(raw);
  const db = sql();
  const rows = await db<{ id: string }[]>`
    insert into research_jobs (workspace_id, kind, title, input, status, stage, created_by, state)
    values (${workspaceId}, 'discover', ${describeSearch(input)}, ${db.json(input as never)}, 'queued', 'Queued', ${userId}, ${db.json({ stage: 'collect' })})
    returning id`;
  return rows[0].id;
}

export async function createEnrichJob(workspaceId: string, userId: string | null, companyId: string) {
  const db = sql();
  const company = await db<{ name: string }[]>`select name from companies where id = ${companyId} and workspace_id = ${workspaceId}`;
  if (!company[0]) throw new Error('Company not found');
  const running = await db<{ id: string }[]>`
    select id from research_jobs where workspace_id = ${workspaceId} and target_company_id = ${companyId} and status in ('queued','running') limit 1`;
  if (running[0]) return running[0].id;
  const rows = await db<{ id: string }[]>`
    insert into research_jobs (workspace_id, kind, title, input, status, stage, created_by, target_company_id, state)
    values (${workspaceId}, 'enrich', ${`Deep research · ${company[0].name}`}, ${db.json({ companyId })}, 'queued', 'Queued', ${userId}, ${companyId}, ${db.json({ stage: 'enrich' })})
    returning id`;
  await db`update companies set research_status = 'queued' where id = ${companyId}`;
  return rows[0].id;
}

/** Claims the job lease; returns null when another worker is already pumping it. */
async function claim(jobId: string): Promise<JobRow | null> {
  const rows = await sql()<JobRow[]>`
    update research_jobs set
      lease_until = now() + make_interval(secs => ${LEASE_SECONDS}),
      status = case when status = 'queued' then 'running' else status end,
      started_at = coalesce(started_at, now()),
      attempts = attempts + 1
    where id = ${jobId} and status in ('queued', 'running') and (lease_until is null or lease_until < now())
    returning *`;
  return rows[0] ?? null;
}

async function release(job: JobRow, log: JobLog, patch: Partial<Pick<JobRow, 'status' | 'progress' | 'stage' | 'stats' | 'state' | 'error'>>) {
  const db = sql();
  const newLog = [...(job.log ?? []), ...log.lines].slice(-MAX_LOG);
  const finished = patch.status === 'completed' || patch.status === 'failed';
  await db`
    update research_jobs set
      lease_until = null,
      log = ${db.json(newLog as never)},
      status = coalesce(${patch.status ?? null}, status),
      progress = coalesce(${patch.progress ?? null}, progress),
      stage = coalesce(${patch.stage ?? null}, stage),
      stats = ${db.json((patch.stats ?? job.stats ?? {}) as never)},
      state = ${db.json((patch.state ?? job.state ?? {}) as never)},
      error = coalesce(${patch.error ?? null}, error),
      finished_at = case when ${finished} then now() else finished_at end
    where id = ${job.id}`;
}

/**
 * Advances a job for up to `budgetMs`. Safe to call concurrently (lease) and repeatedly.
 * Returns the job status after the slice.
 */
export async function pumpJob(jobId: string, budgetMs: number): Promise<{ status: string; progress: number } | null> {
  const job = await claim(jobId);
  if (!job) {
    const rows = await sql()<{ status: string; progress: number }[]>`select status, progress from research_jobs where id = ${jobId}`;
    return rows[0] ?? null;
  }
  const deadline = Date.now() + budgetMs;
  const log = new JobLog();
  try {
    const connectors = await loadConnectors(job.workspace_id).catch(() => [] as LoadedConnector[]);
    const result = job.kind === 'enrich' ? await pumpEnrich(job, deadline, log, connectors) : await pumpDiscover(job, deadline, log, connectors);
    await release(job, log, result);
    return { status: result.status ?? job.status, progress: result.progress ?? job.progress };
  } catch (error) {
    log.add('error', `Research slice failed: ${describeError(error)}`);
    const fatal = job.attempts >= 40;
    await release(job, log, fatal ? { status: 'failed', error: describeError(error) } : {});
    if (job.kind === 'enrich' && fatal && job.target_company_id) await sql()`update companies set research_status = 'failed' where id = ${job.target_company_id}`;
    return { status: fatal ? 'failed' : job.status, progress: job.progress };
  }
}

// ---------------------------------------------------------------------------
// Discovery
// ---------------------------------------------------------------------------
type Patch = Partial<Pick<JobRow, 'status' | 'progress' | 'stage' | 'stats' | 'state' | 'error'>>;

async function pumpDiscover(job: JobRow, deadline: number, log: JobLog, connectors: LoadedConnector[]): Promise<Patch> {
  const db = sql();
  const input = normalizeInput(job.input as Partial<DiscoverInput>);
  const state: JobState = { ...(job.state ?? {}) };
  const stats: Record<string, number> = { ...(job.stats as Record<string, number>) };
  state.stage ??= 'collect';

  if (state.stage === 'collect') {
    if (!state.tasks) {
      state.tasks = planCollection(input, connectors);
      log.add('info', `Searching ${state.tasks.length} sources: ${state.tasks.map((t) => t.label).join(' · ')}`);
    }
    for (const task of state.tasks) {
      while (!task.done && Date.now() < deadline - 6000) {
        try {
          const page = await collectPage(task, input, { deadline }, connectors);
          task.fetched += page.raw;
          task.offset += page.raw;
          task.done = page.done || page.raw === 0;
          const rows = [
            ...page.records.map((r) => ({ job_id: job.id, source_key: r.sourceKey, data: r as unknown })),
            ...page.seeds.map((s) => ({ job_id: job.id, source_key: `seed:${s.seed.kind}:${s.seed.label}`, data: s as unknown })),
          ];
          for (let i = 0; i < rows.length; i += 500) {
            const chunk = rows.slice(i, i + 500);
            await db`insert into research_job_records ${db(chunk.map((r) => ({ ...r, data: db.json(r.data as never) })))} on conflict do nothing`;
          }
          stats.records = (stats.records ?? 0) + page.records.length + page.seeds.length;
          if (task.done) log.add('success', `${task.label}: ${task.fetched.toLocaleString()} records`, task.kind);
        } catch (error) {
          task.error = describeError(error).slice(0, 200);
          task.done = true;
          log.add('warn', `${task.label}: unavailable (${task.error}). Continuing with other sources.`, task.kind);
        }
      }
      if (Date.now() >= deadline - 6000) break;
    }
    const done = state.tasks.filter((t) => t.done).length;
    if (done < state.tasks.length) {
      return { state, stats, stage: `Collecting · ${done}/${state.tasks.length} sources`, progress: Math.round((done / state.tasks.length) * 25) };
    }
    state.stage = 'cluster';
  }

  if (state.stage === 'cluster') {
    const rows = await db<{ source_key: string; data: unknown }[]>`select source_key, data from research_job_records where job_id = ${job.id}`;
    const records: PropertyRecord[] = [];
    const seeds: StagedSeed[] = [];
    for (const r of rows) {
      if (r.source_key.startsWith('seed:')) seeds.push(r.data as StagedSeed);
      else records.push(r.data as PropertyRecord);
    }
    log.add('info', `Linking ${records.length.toLocaleString()} buildings into portfolios by owner, mailing address and manager…`);
    let dossiers = clusterRecords(records);
    for (const d of dossiers) hudSignals(d, records.filter((r) => d.buildings.some((b) => b.key === r.sourceKey)));
    for (const s of seeds) {
      const d = emptyDossier('', s.seed.label);
      d.seed = { kind: s.seed.kind, label: s.seed.label, count: s.seed.count, first: s.seed.first, last: s.seed.last, house: s.seed.house, street: s.seed.street, zip: s.seed.zip };
      if (s.seed.kind === 'hpd-agent') {
        d.aliases.push({ name: s.seed.label, key: s.seed.label.toLowerCase(), kind: 'agent', count: s.seed.count, src: ['nyc-hpd'] });
      } else {
        addPerson(d, { name: s.seed.label, title: 'Head Officer (HPD)', role: 'owner', decisionMaker: true }, 'nyc-hpd');
        if (s.seed.house && s.seed.street) addAddress(d, `${s.seed.house} ${s.seed.street}, New York NY ${s.seed.zip ?? ''}`.trim(), 'business', 'nyc-hpd');
      }
      d.sources['nyc-hpd'] = { name: 'NYC HPD Multiple Dwelling Registrations', url: s.seed.url, hits: s.seed.count };
      d.trail.push(`NYC HPD: ${s.seed.label} is listed on ${s.seed.count.toLocaleString()} building registrations citywide.`);
      derive(d);
      d.key = `${s.seed.kind}:${s.seed.label.toLowerCase()}`;
      dossiers.push(d);
    }
    dossiers = mergeDuplicates(dossiers);
    const minUnits = input.minUnits ?? 0;
    const viable = dossiers.filter((d) => {
      const st = portfolioStats(d);
      if (d.seed) return true;
      if (!d.buildings.some((b) => inGeography(b, input))) return false;
      return st.units >= Math.min(minUnits, 40) || st.buildings >= 2;
    });
    for (const d of viable) d.prelimRank = prelimRank(d);
    viable.sort((a, b) => b.prelimRank - a.prelimRank);
    const take = Math.min(viable.length, Math.max(input.limit! * 2, 30), 160);
    const selected = viable.slice(0, take);
    for (const d of selected) {
      const st = portfolioStats(d);
      const row = {
        workspace_id: job.workspace_id,
        job_id: job.id,
        key: d.key.slice(0, 300),
        name: d.name.slice(0, 300),
        kind: d.nameKind === 'address' ? 'owner_cluster' : 'company',
        state: st.states[0] ?? null,
        city: d.buildings[0]?.city ?? null,
        score: null,
        summary: db.json(d as never),
      };
      await db`insert into lead_candidates ${db(row)} on conflict (job_id, key) do nothing`;
    }
    state.stage = 'enrich';
    state.candidates = selected.length;
    state.enriched = 0;
    stats.portfolios = dossiers.length;
    stats.candidates = selected.length;
    log.add('success', `Found ${dossiers.length.toLocaleString()} portfolios; researching the top ${selected.length} in depth.`);
    await db`delete from research_job_records where job_id = ${job.id}`;
    return { state, stats, stage: `Researching 0/${selected.length}`, progress: 30 };
  }

  if (state.stage === 'enrich') {
    const total = state.candidates ?? 0;
    while (Date.now() < deadline - 5000) {
      const batch = await db<{ id: string; summary: Dossier }[]>`
        select id, summary from lead_candidates
        where job_id = ${job.id} and coalesce(summary->>'status', 'pending') <> 'done'
        order by (summary->>'prelimRank')::int desc nulls last
        limit ${ENRICH_CONCURRENCY}`;
      if (!batch.length) break;
      await Promise.all(batch.map(async (row) => {
        const d = row.summary;
        const finished = await resolveDossier(d, { deadline, connectors, log: (level, message) => log.add(level === 'success' ? 'success' : level === 'warn' ? 'warn' : 'info', message) }, 36);
        const s = scoreDossier(d);
        d.score = s.score;
        d.scoreConfidence = s.confidence;
        d.scoreFactors = s.factors;
        d.why = s.why;
        const st = portfolioStats(d);
        await db`
          update lead_candidates set
            name = ${d.name.slice(0, 300)},
            kind = ${d.nameKind === 'address' ? 'owner_cluster' : 'company'},
            state = ${st.states[0] ?? null},
            city = ${d.buildings[0]?.city ?? null},
            score = ${s.score},
            score_breakdown = ${db.json(s.factors as never)},
            summary = ${db.json(d as never)}
          where id = ${row.id}`;
        if (finished) {
          state.enriched = (state.enriched ?? 0) + 1;
          const dm = rankPeople(d.people).find((p) => p.decisionMaker);
          log.add('success', `✓ ${d.name}: score ${s.score} · ${st.buildings} bldg / ${st.units.toLocaleString()} units${dm ? ` · ${dm.name}` : ''}${d.emails.length ? ` · ${d.emails.length} email(s)` : ''}`);
        }
      }));
    }
    const remaining = await db<{ n: number }[]>`select count(*)::int as n from lead_candidates where job_id = ${job.id} and coalesce(summary->>'status','pending') <> 'done'`;
    const done = total - (remaining[0]?.n ?? 0);
    state.enriched = done;
    if ((remaining[0]?.n ?? 0) > 0) {
      return { state, stats, stage: `Researching ${done}/${total}`, progress: 30 + Math.round((done / Math.max(1, total)) * 65) };
    }
    state.stage = 'finalize';
  }

  if (state.stage === 'finalize') {
    const rows = await db<{ id: string; summary: Dossier; score: number | null }[]>`select id, summary, score from lead_candidates where job_id = ${job.id}`;
    const keep: { id: string; score: number }[] = [];
    const drop: string[] = [];
    for (const r of rows) {
      const d = r.summary;
      const st = portfolioStats(d);
      const units = Math.max(st.units, st.claimedUnits ?? 0);
      const buildings = Math.max(st.buildings, st.claimedBuildings ?? 0);
      const okGeo = d.buildings.some((b) => inGeography(b, input));
      const okSize = units >= (input.minUnits ?? 0) && (!input.maxUnits || units <= input.maxUnits) && buildings >= (input.minBuildings ?? 1) && (!input.maxBuildings || buildings <= input.maxBuildings);
      const okType = !input.ownerType || input.ownerType === 'any' || d.type === input.ownerType || (input.ownerType === 'owner_operator' && d.type === 'unknown');
      const okKeywords = !input.keywords?.length || input.keywords.some((k) => JSON.stringify(d.aliases).toLowerCase().includes(k.toLowerCase()) || d.name.toLowerCase().includes(k.toLowerCase()));
      if (okGeo && okSize && okType && okKeywords) keep.push({ id: r.id, score: r.score ?? 0 });
      else drop.push(r.id);
    }
    keep.sort((a, b) => b.score - a.score);
    const overflow = keep.slice(input.limit!).map((k) => k.id);
    const remove = [...drop, ...overflow];
    if (remove.length) await db`delete from lead_candidates where id in ${db(remove)}`;
    stats.leads = Math.min(keep.length, input.limit!);
    log.add('success', `Done: ${stats.leads} qualified leads ranked by fit, reachability and water spend.`);
    state.stage = 'done';
    return { state, stats, status: 'completed', stage: `${stats.leads} leads`, progress: 100 };
  }
  return { state, stats };
}

// ---------------------------------------------------------------------------
// Deep research on an existing CRM company
// ---------------------------------------------------------------------------
async function pumpEnrich(job: JobRow, deadline: number, log: JobLog, connectors: LoadedConnector[]): Promise<Patch> {
  const db = sql();
  const companyId = String((job.input as { companyId?: string }).companyId ?? job.target_company_id);
  const state: JobState = { ...(job.state ?? {}) };
  if (!state.dossier) {
    const { dossierFromCompany } = await import('./save');
    state.dossier = await dossierFromCompany(job.workspace_id, companyId);
    log.add('info', `Starting deep research on ${state.dossier.name} with ${state.dossier.buildings.length} known buildings and ${state.dossier.people.length} contacts.`);
    await db`update companies set research_status = 'running' where id = ${companyId}`;
  }
  const d = state.dossier;
  const finished = await resolveDossier(d, { deadline, connectors, log: (level, message) => log.add(level === 'success' ? 'success' : level === 'warn' ? 'warn' : 'info', message) }, 60);
  const s = scoreDossier(d);
  d.score = s.score;
  d.scoreConfidence = s.confidence;
  d.scoreFactors = s.factors;
  d.why = s.why;
  if (!finished) return { state, stage: `Researching · ${d.runs} lookups`, progress: Math.min(90, 10 + d.runs * 2) };
  const { applyDossierToCompany } = await import('./save');
  const summary = await applyDossierToCompany(job.workspace_id, companyId, d, job.id);
  log.add('success', `Updated ${d.name}: ${summary}`);
  return { state, status: 'completed', stage: 'Done', progress: 100 };
}

/** Jobs the cron tick should advance. */
export async function runnableJobs(limit = 3) {
  return sql()<{ id: string }[]>`
    select id from research_jobs
    where status in ('queued', 'running') and (lease_until is null or lease_until < now())
    order by updated_at asc limit ${limit}`;
}
