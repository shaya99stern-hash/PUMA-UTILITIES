import http from 'node:http';
import { chromium } from 'playwright';
import { parseContactOutStaff } from './parser.mjs';

const PORT = boundedInt(process.env.PORT, 8787, 1, 65535);
const TOKEN = process.env.BROWSER_RESEARCH_TOKEN?.trim();
const MAX_BODY_BYTES = 16_384;
const MAX_ACTIVE = 2;
let active = 0;
let browserPromise;

if (!TOKEN) throw new Error('BROWSER_RESEARCH_TOKEN is required.');

function browser() {
  browserPromise ??= chromium.launch({ headless: true });
  return browserPromise;
}

const server = http.createServer(async (request, response) => {
  if (request.method === 'GET' && request.url === '/health') {
    return json(response, 200, { ok: true, adapter: 'contactout-public-directory' });
  }
  if (request.method !== 'POST' || request.url !== '/') return json(response, 404, { error: 'Not found.' });
  if (request.headers.authorization !== `Bearer ${TOKEN}`) return json(response, 401, { error: 'Unauthorized.' });
  if (active >= MAX_ACTIVE) return json(response, 429, { error: 'Browser worker is busy.' });

  active += 1;
  try {
    const body = await readJson(request);
    if (body.adapter !== 'contactout-public-directory') return json(response, 400, { error: 'Unsupported adapter.' });
    const company = typeof body.company === 'string' ? body.company.trim().slice(0, 180) : '';
    const geography = typeof body.geography === 'string' ? body.geography.trim().slice(0, 80) : '';
    const maxPeople = boundedInt(body.maxPeople, 20, 1, 20);
    if (company.length < 2) return json(response, 400, { error: 'Company is required.' });

    const context = await (await browser()).newContext({
      userAgent: 'Mozilla/5.0 (compatible; PumaUtilitiesResearch/1.1; public business research)',
      viewport: { width: 1280, height: 900 },
    });
    const page = await context.newPage();
    page.setDefaultTimeout(12_000);
    page.setDefaultNavigationTimeout(20_000);

    try {
      const query = `site:contactout.com/company "${company}" ${geography}`.trim();
      await page.goto(`https://html.duckduckgo.com/html/?q=${encodeURIComponent(query)}`, { waitUntil: 'domcontentloaded' });
      const hrefs = await page.locator('a.result__a').evaluateAll((anchors) => anchors.map((anchor) => anchor.href));
      const contactOutUrl = hrefs.map(unwrapDuckDuckGoUrl).find((url) => /^https:\/\/(?:www\.)?contactout\.com\/company\//i.test(url));
      if (!contactOutUrl) return json(response, 200, { people: [], sourceUrl: undefined, note: 'No public ContactOut company profile was found.' });

      await page.goto(contactOutUrl, { waitUntil: 'domcontentloaded' });
      const finalUrl = page.url();
      if (!/^https:\/\/(?:www\.)?contactout\.com\/company\//i.test(finalUrl)) {
        return json(response, 200, { people: [], sourceUrl: contactOutUrl, note: 'ContactOut redirected away from a public company profile.' });
      }
      const text = (await page.locator('body').innerText()).slice(0, 500_000);
      const people = parseContactOutStaff(text, finalUrl, maxPeople);
      return json(response, 200, {
        people,
        sourceUrl: finalUrl,
        note: 'Only publicly visible names and roles were parsed. No reveal controls, logins, paywalls, emails, or phone credits were accessed.',
      });
    } finally {
      await context.close();
    }
  } catch (error) {
    return json(response, 502, { error: error instanceof Error ? error.message : String(error) });
  } finally {
    active -= 1;
  }
});

server.listen(PORT, '0.0.0.0', () => {
  process.stdout.write(`Puma browser research worker listening on :${PORT}\n`);
});

process.on('SIGTERM', async () => {
  server.close();
  if (browserPromise) await (await browserPromise).close();
  process.exit(0);
});

function unwrapDuckDuckGoUrl(value) {
  try {
    const url = new URL(value);
    return url.searchParams.get('uddg') || url.toString();
  } catch {
    return value;
  }
}

function readJson(request) {
  return new Promise((resolve, reject) => {
    let raw = '';
    request.setEncoding('utf8');
    request.on('data', (chunk) => {
      raw += chunk;
      if (raw.length > MAX_BODY_BYTES) request.destroy(new Error('Request is too large.'));
    });
    request.on('end', () => {
      try { resolve(JSON.parse(raw || '{}')); } catch { reject(new Error('Request body must be valid JSON.')); }
    });
    request.on('error', reject);
  });
}

function json(response, status, payload) {
  response.writeHead(status, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' });
  response.end(JSON.stringify(payload));
}

function boundedInt(value, fallback, min, max) {
  const number = Number(value);
  return Number.isFinite(number) ? Math.max(min, Math.min(max, Math.floor(number))) : fallback;
}
