/**
 * Polite, cached HTTP client for the research engine.
 *
 * - Responses are cached in `source_cache` (TTL per call).
 * - Every call updates `source_health` (ok/error counts, latency). After 5 consecutive
 *   errors a source is paused for 10 minutes and calls fail fast with code 'disabled'.
 * - Retries with exponential backoff on network errors, 429 and 5xx.
 * - Per-host concurrency is capped at 2; website fetches respect robots.txt and an SSRF guard.
 *
 * The DB client is imported lazily so parsers that import this module stay unit-testable.
 */
import { createHash } from 'node:crypto';
import { assertPublicTarget } from './net';

export const USER_AGENT = 'PumaResearch/2.0 (+https://puma-utilities.vercel.app)';
const BROWSER_UA = 'Mozilla/5.0 (compatible; PumaResearch/2.0; +https://puma-utilities.vercel.app)';
const MAX_CACHE_BYTES = 2_500_000;
const MAX_BODY_BYTES = 6_000_000;
const DISABLE_AFTER = 5;
const DISABLE_MS = 10 * 60_000;

export type FetchErrorCode = 'disabled' | 'timeout' | 'http' | 'network' | 'robots' | 'blocked' | 'budget' | 'parse';

export class SourceError extends Error {
  constructor(public sourceId: string, public code: FetchErrorCode, message: string, public status?: number) {
    super(message);
    this.name = 'SourceError';
  }
}

export type FetchOptions = {
  sourceId: string;
  url: string;
  method?: 'GET' | 'POST';
  body?: string;
  headers?: Record<string, string>;
  /** Cache TTL. 0 disables cache reads/writes. Default 24h. */
  ttlMs?: number;
  timeoutMs?: number;
  retries?: number;
  /** Absolute epoch ms deadline (job budget). */
  deadline?: number;
  /** Website mode: SSRF guard + robots.txt + browser-ish UA. */
  web?: boolean;
  /** Accept these non-2xx statuses as a valid (cacheable) response instead of an error. */
  acceptStatus?: number[];
};

export type FetchResult = { status: number; body: string; contentType: string | null; url: string; fromCache: boolean; ms: number };

type DbModule = typeof import('@/lib/server/db');
let dbModule: Promise<DbModule | null> | null = null;
function db(): Promise<DbModule | null> {
  if (!process.env.DATABASE_URL) return Promise.resolve(null);
  dbModule ??= import('@/lib/server/db').catch(() => null);
  return dbModule;
}

// ---------------------------------------------------------------------------
// Per-host concurrency
// ---------------------------------------------------------------------------
const hostSlots = new Map<string, { active: number; queue: (() => void)[] }>();
async function withHostSlot<T>(host: string, limit: number, fn: () => Promise<T>): Promise<T> {
  let slot = hostSlots.get(host);
  if (!slot) {
    slot = { active: 0, queue: [] };
    hostSlots.set(host, slot);
  }
  if (slot.active >= limit) await new Promise<void>((resolve) => slot!.queue.push(resolve));
  slot.active += 1;
  try {
    return await fn();
  } finally {
    slot.active -= 1;
    slot.queue.shift()?.();
  }
}

// ---------------------------------------------------------------------------
// Health
// ---------------------------------------------------------------------------
const disabledCache = new Map<string, { until: number; checkedAt: number }>();

async function isDisabled(sourceId: string): Promise<number | null> {
  const cached = disabledCache.get(sourceId);
  const now = Date.now();
  if (cached && now - cached.checkedAt < 30_000) return cached.until > now ? cached.until : null;
  const mod = await db();
  if (!mod) return null;
  try {
    const rows = await mod.sql()<{ disabled_until: Date | null }[]>`select disabled_until from source_health where source_id = ${sourceId}`;
    const until = rows[0]?.disabled_until ? new Date(rows[0].disabled_until).getTime() : 0;
    disabledCache.set(sourceId, { until, checkedAt: now });
    return until > now ? until : null;
  } catch {
    return null;
  }
}

export async function recordHealth(sourceId: string, ok: boolean, ms: number, error?: string): Promise<void> {
  const mod = await db();
  if (!mod) return;
  try {
    if (ok) {
      await mod.sql()`
        insert into source_health (source_id, ok_count, consecutive_errors, last_ok_at, avg_ms, updated_at)
        values (${sourceId}, 1, 0, now(), ${Math.round(ms)}, now())
        on conflict (source_id) do update set
          ok_count = source_health.ok_count + 1,
          consecutive_errors = 0,
          last_ok_at = now(),
          disabled_until = null,
          avg_ms = round(coalesce(source_health.avg_ms, ${Math.round(ms)}) * 0.8 + ${Math.round(ms)} * 0.2),
          updated_at = now()`;
      disabledCache.delete(sourceId);
    } else {
      const rows = await mod.sql()<{ consecutive_errors: number }[]>`
        insert into source_health (source_id, error_count, consecutive_errors, last_error_at, last_error, updated_at)
        values (${sourceId}, 1, 1, now(), ${(error ?? 'error').slice(0, 500)}, now())
        on conflict (source_id) do update set
          error_count = source_health.error_count + 1,
          consecutive_errors = source_health.consecutive_errors + 1,
          last_error_at = now(),
          last_error = ${(error ?? 'error').slice(0, 500)},
          updated_at = now()
        returning consecutive_errors`;
      if ((rows[0]?.consecutive_errors ?? 0) >= DISABLE_AFTER) {
        const until = new Date(Date.now() + DISABLE_MS);
        await mod.sql()`update source_health set disabled_until = ${until} where source_id = ${sourceId}`;
        disabledCache.set(sourceId, { until: until.getTime(), checkedAt: Date.now() });
      }
    }
  } catch {
    // Health bookkeeping must never break research.
  }
}

// ---------------------------------------------------------------------------
// Cache
// ---------------------------------------------------------------------------
function cacheKey(o: FetchOptions) {
  return createHash('sha256').update(`${o.method ?? 'GET'} ${o.url}\n${o.body ?? ''}`).digest('hex');
}

async function readCache(key: string): Promise<FetchResult | null> {
  const mod = await db();
  if (!mod) return null;
  try {
    const rows = await mod.sql()<{ url: string; status: number; body: string; content_type: string | null }[]>`
      select url, status, body, content_type from source_cache where key = ${key} and expires_at > now()`;
    const r = rows[0];
    return r ? { status: r.status, body: r.body, contentType: r.content_type, url: r.url, fromCache: true, ms: 0 } : null;
  } catch {
    return null;
  }
}

async function writeCache(key: string, result: FetchResult, ttlMs: number): Promise<void> {
  if (result.body.length > MAX_CACHE_BYTES) return;
  const mod = await db();
  if (!mod) return;
  try {
    const expires = new Date(Date.now() + ttlMs);
    await mod.sql()`
      insert into source_cache (key, url, status, body, content_type, fetched_at, expires_at)
      values (${key}, ${result.url.slice(0, 2000)}, ${result.status}, ${result.body}, ${result.contentType}, now(), ${expires})
      on conflict (key) do update set status = excluded.status, body = excluded.body, content_type = excluded.content_type,
        fetched_at = now(), expires_at = excluded.expires_at, url = excluded.url`;
    // Opportunistic cleanup of expired rows (cheap, bounded).
    if (Math.random() < 0.02) await mod.sql()`delete from source_cache where key in (select key from source_cache where expires_at < now() limit 200)`;
  } catch {
    // ignore
  }
}

// ---------------------------------------------------------------------------
// robots.txt
// ---------------------------------------------------------------------------
const robotsMemo = new Map<string, { rules: RobotsRules; at: number }>();
export type RobotsRules = { allow: string[]; disallow: string[] };

/** Parses robots.txt and returns the rules that apply to our agent (PumaResearch or *). */
export function parseRobots(text: string, agent = 'pumaresearch'): RobotsRules {
  const groups: { agents: string[]; allow: string[]; disallow: string[] }[] = [];
  let current: { agents: string[]; allow: string[]; disallow: string[] } | null = null;
  let lastWasAgent = false;
  for (const rawLine of text.split(/\r?\n/)) {
    const line = rawLine.replace(/#.*$/, '').trim();
    if (!line) continue;
    const idx = line.indexOf(':');
    if (idx < 0) continue;
    const field = line.slice(0, idx).trim().toLowerCase();
    const value = line.slice(idx + 1).trim();
    if (field === 'user-agent') {
      if (!current || !lastWasAgent) {
        current = { agents: [], allow: [], disallow: [] };
        groups.push(current);
      }
      current.agents.push(value.toLowerCase());
      lastWasAgent = true;
      continue;
    }
    lastWasAgent = false;
    if (!current) continue;
    if (field === 'allow' && value) current.allow.push(value);
    if (field === 'disallow' && value) current.disallow.push(value);
  }
  const specific = groups.find((g) => g.agents.some((a) => a !== '*' && agent.includes(a)));
  const any = groups.filter((g) => g.agents.includes('*'));
  const chosen = specific ? [specific] : any;
  return { allow: chosen.flatMap((g) => g.allow), disallow: chosen.flatMap((g) => g.disallow) };
}

export function robotsAllows(rules: RobotsRules, path: string): boolean {
  const match = (pattern: string) => {
    const re = new RegExp('^' + pattern.replace(/[.+?^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '.*').replace(/\\\$$/, '$'));
    return re.test(path) ? pattern.length : -1;
  };
  const allow = Math.max(-1, ...rules.allow.map(match));
  const disallow = Math.max(-1, ...rules.disallow.map(match));
  return disallow < 0 || allow >= disallow;
}

async function robotsFor(origin: string, deadline?: number): Promise<RobotsRules> {
  const memo = robotsMemo.get(origin);
  if (memo && Date.now() - memo.at < 3_600_000) return memo.rules;
  let rules: RobotsRules = { allow: [], disallow: [] };
  try {
    const res = await rawFetch({ sourceId: 'web-robots', url: `${origin}/robots.txt`, ttlMs: 24 * 3_600_000, timeoutMs: 5000, retries: 0, deadline, acceptStatus: [401, 403, 404, 410] }, true);
    if (res.status >= 200 && res.status < 300 && !/<html/i.test(res.body.slice(0, 300))) rules = parseRobots(res.body);
  } catch {
    // Unreachable robots.txt is treated as allow-all (RFC 9309 §2.3.1.3 for 4xx; we are lenient on network errors).
  }
  robotsMemo.set(origin, { rules, at: Date.now() });
  return rules;
}

// ---------------------------------------------------------------------------
// Fetch
// ---------------------------------------------------------------------------
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function rawFetch(o: FetchOptions, skipRobots = false): Promise<FetchResult> {
  const ttl = o.ttlMs ?? 24 * 3_600_000;
  const key = cacheKey(o);
  if (ttl > 0) {
    const hit = await readCache(key);
    if (hit) return hit;
  }
  const url = new URL(o.url);
  if (o.web) {
    await assertPublicTarget(o.url).catch((e: Error) => {
      throw new SourceError(o.sourceId, 'blocked', e.message);
    });
    if (!skipRobots) {
      const rules = await robotsFor(url.origin, o.deadline);
      if (!robotsAllows(rules, url.pathname + url.search)) throw new SourceError(o.sourceId, 'robots', `robots.txt disallows ${url.pathname}`);
    }
  }
  const retries = o.retries ?? 2;
  let lastError: SourceError | null = null;
  for (let attempt = 0; attempt <= retries; attempt += 1) {
    const remaining = o.deadline ? o.deadline - Date.now() : Infinity;
    if (remaining < 1500) throw new SourceError(o.sourceId, 'budget', 'Out of time for this slice.');
    const timeout = Math.max(1000, Math.min(o.timeoutMs ?? 15_000, remaining - 500));
    const started = Date.now();
    try {
      const response = await withHostSlot(url.host, 2, () =>
        fetch(o.url, {
          method: o.method ?? 'GET',
          body: o.body,
          redirect: 'follow',
          cache: 'no-store',
          signal: AbortSignal.timeout(timeout),
          headers: {
            'User-Agent': o.web ? BROWSER_UA : USER_AGENT,
            Accept: o.web ? 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8' : 'application/json, text/plain, */*',
            'Accept-Language': 'en-US,en;q=0.8',
            ...(o.headers ?? {}),
          },
        }),
      );
      const length = Number(response.headers.get('content-length') ?? 0);
      if (length > MAX_BODY_BYTES) throw new SourceError(o.sourceId, 'http', `Response too large (${length} bytes).`, response.status);
      const body = (await response.text()).slice(0, MAX_BODY_BYTES);
      const ms = Date.now() - started;
      const result: FetchResult = { status: response.status, body, contentType: response.headers.get('content-type'), url: response.url || o.url, fromCache: false, ms };
      const accepted = response.ok || (o.acceptStatus ?? []).includes(response.status);
      if (accepted) {
        if (ttl > 0) await writeCache(key, result, ttl);
        return result;
      }
      lastError = new SourceError(o.sourceId, 'http', `HTTP ${response.status} from ${url.host}`, response.status);
      if (response.status !== 429 && response.status < 500) throw lastError;
      const retryAfter = Number(response.headers.get('retry-after') ?? 0);
      await sleep(Math.min(5000, retryAfter > 0 ? retryAfter * 1000 : 600 * 2 ** attempt));
    } catch (error) {
      if (error instanceof SourceError) {
        if (error.code !== 'http' || (error.status && error.status < 500 && error.status !== 429)) throw error;
        lastError = error;
      } else {
        const e = error as Error & { cause?: { code?: string; message?: string } };
        const timedOut = e.name === 'TimeoutError' || e.name === 'AbortError';
        lastError = new SourceError(o.sourceId, timedOut ? 'timeout' : 'network', timedOut ? `Timed out after ${timeout}ms (${url.host})` : `${url.host} unreachable: ${e.cause?.code ?? e.cause?.message ?? e.message}`);
        if (attempt < retries) await sleep(400 * 2 ** attempt);
      }
    }
  }
  throw lastError ?? new SourceError(o.sourceId, 'network', 'Request failed.');
}

/**
 * Fetches a URL on behalf of a source, with cache, retries and health bookkeeping.
 * Throws SourceError on failure (callers log it and carry on with other sources).
 */
export async function fetchSource(o: FetchOptions): Promise<FetchResult> {
  const disabledUntil = await isDisabled(o.sourceId);
  if (disabledUntil) {
    throw new SourceError(o.sourceId, 'disabled', `Paused after repeated errors until ${new Date(disabledUntil).toISOString().slice(11, 16)} UTC`);
  }
  const started = Date.now();
  try {
    const result = await rawFetch(o);
    if (!result.fromCache) await recordHealth(o.sourceId, true, Date.now() - started);
    return result;
  } catch (error) {
    const se = error instanceof SourceError ? error : new SourceError(o.sourceId, 'network', (error as Error).message);
    // Robots/budget/blocked/4xx outcomes are not the source's fault.
    const countsAsSourceError = se.code === 'network' || se.code === 'timeout' || (se.code === 'http' && (!se.status || se.status >= 500 || se.status === 429));
    if (countsAsSourceError) await recordHealth(o.sourceId, false, Date.now() - started, se.message);
    throw se;
  }
}

export async function fetchJson<T = unknown>(o: FetchOptions): Promise<{ data: T; url: string; fromCache: boolean }> {
  const res = await fetchSource(o);
  try {
    return { data: JSON.parse(res.body) as T, url: res.url, fromCache: res.fromCache };
  } catch {
    throw new SourceError(o.sourceId, 'parse', `Invalid JSON from ${new URL(o.url).host}`);
  }
}

export function describeError(error: unknown): string {
  if (error instanceof SourceError) return error.message;
  if (error instanceof Error) return error.message;
  return String(error);
}
