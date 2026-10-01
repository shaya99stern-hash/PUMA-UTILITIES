import 'server-only';
import { resolveMx } from 'node:dns/promises';
import { PRESETS, guessPreset, type PresetKey } from './presets';
import type { Endpoint } from './types';

/**
 * Works out SMTP/IMAP settings for any email address so people can connect
 * with just an address and password:
 *   1. well-known consumer domains (gmail.com, outlook.com, ...)
 *   2. MX records → the hosting provider (Google Workspace, Microsoft 365, Zoho, GoDaddy, ...)
 *   3. Mozilla Thunderbird's public autoconfig database (ISPDB) for the domain or its MX domain
 *   4. conventional host names (smtp./mail./imap. + the domain)
 */
export type ServerCandidate = { source: string; preset: PresetKey; smtp: Endpoint; imap: Endpoint | null; appPassword: boolean };

const MX_PROVIDERS: { test: RegExp; preset: PresetKey }[] = [
  { test: /(^|\.)(google|googlemail)\.com\.?$/i, preset: 'gmail' },
  { test: /(^|\.)(outlook\.com|protection\.outlook\.com|office365\.us)\.?$/i, preset: 'outlook' },
  { test: /(^|\.)(icloud\.com|me\.com)\.?$/i, preset: 'icloud' },
  { test: /(^|\.)(yahoodns\.net|yahoo\.com)\.?$/i, preset: 'yahoo' },
  { test: /(^|\.)zoho(mail)?\.(com|eu|in)\.?$/i, preset: 'zoho' },
  { test: /(^|\.)secureserver\.net\.?$/i, preset: 'godaddy' },
  { test: /(^|\.)messagingengine\.com\.?$/i, preset: 'fastmail' },
];

export function presetForMxHost(host: string): PresetKey | null {
  return MX_PROVIDERS.find((p) => p.test.test(host))?.preset ?? null;
}

async function mxHosts(domain: string): Promise<string[]> {
  try {
    const records = await resolveMx(domain);
    return records.sort((a, b) => a.priority - b.priority).map((r) => r.exchange.toLowerCase());
  } catch {
    // Fall back to DNS-over-HTTPS (some runtimes restrict raw DNS).
    try {
      const res = await fetch(`https://dns.google/resolve?name=${encodeURIComponent(domain)}&type=MX`, { signal: AbortSignal.timeout(4000) });
      const body = (await res.json()) as { Answer?: { data: string }[] };
      return (body.Answer ?? [])
        .map((a) => a.data.split(' '))
        .sort((a, b) => Number(a[0]) - Number(b[0]))
        .map((a) => (a[1] ?? '').replace(/\.$/, '').toLowerCase())
        .filter(Boolean);
    } catch {
      return [];
    }
  }
}

/** Registrable-ish base of an MX host: "aspmx.l.google.com" → "google.com". */
export function baseDomain(host: string): string {
  const parts = host.replace(/\.$/, '').split('.');
  if (parts.length <= 2) return parts.join('.');
  const twoLevel = /^(co|com|net|org|ac|gov)\.[a-z]{2}$/i.test(parts.slice(-2).join('.'));
  return parts.slice(twoLevel ? -3 : -2).join('.');
}

/** Parses a Thunderbird autoconfig XML document into endpoints. Exported for tests. */
export function parseAutoconfig(xml: string, email: string): { smtp: Endpoint | null; imap: Endpoint | null } {
  const pick = (type: 'incomingServer' | 'outgoingServer', protocol: string) => {
    const re = new RegExp(`<${type}[^>]*type="${protocol}"[^>]*>([\\s\\S]*?)</${type}>`, 'gi');
    const servers: Endpoint[] = [];
    for (const m of xml.matchAll(re)) {
      const block = m[1];
      const host = /<hostname>([^<]+)<\/hostname>/i.exec(block)?.[1]?.trim();
      const port = Number(/<port>(\d+)<\/port>/i.exec(block)?.[1]);
      const socket = /<socketType>([^<]+)<\/socketType>/i.exec(block)?.[1]?.trim().toUpperCase();
      if (!host || !port || socket === 'PLAIN') continue;
      const domain = email.split('@')[1] ?? '';
      servers.push({ host: host.replace(/%EMAILDOMAIN%/g, domain), port, secure: socket === 'SSL' });
    }
    return servers[0] ?? null;
  };
  return { smtp: pick('outgoingServer', 'smtp'), imap: pick('incomingServer', 'imap') };
}

async function ispdb(domain: string, email: string): Promise<{ smtp: Endpoint | null; imap: Endpoint | null } | null> {
  for (const url of [
    `https://autoconfig.thunderbird.net/v1.1/${encodeURIComponent(domain)}`,
    `https://autoconfig.${domain}/mail/config-v1.1.xml?emailaddress=${encodeURIComponent(email)}`,
  ]) {
    try {
      const res = await fetch(url, { signal: AbortSignal.timeout(4000), headers: { Accept: 'application/xml,text/xml' } });
      if (!res.ok) continue;
      const parsed = parseAutoconfig(await res.text(), email);
      if (parsed.smtp) return parsed;
    } catch {
      // try the next source
    }
  }
  return null;
}

function fromPreset(key: PresetKey, source: string): ServerCandidate {
  const p = PRESETS[key];
  return { source, preset: key, smtp: p.smtp, imap: p.imap, appPassword: p.appPassword };
}

/** Ordered list of server settings to try for an address (deduplicated). */
export async function detectServers(email: string): Promise<ServerCandidate[]> {
  const domain = email.split('@')[1]?.toLowerCase().trim() ?? '';
  const out: ServerCandidate[] = [];
  const add = (c: ServerCandidate) => {
    const key = `${c.smtp.host}:${c.smtp.port}`;
    if (c.smtp.host && !out.some((o) => `${o.smtp.host}:${o.smtp.port}` === key)) out.push(c);
  };
  if (!domain) return out;

  const known = guessPreset(email);
  if (known !== 'custom') add(fromPreset(known, 'known domain'));

  const mx = await mxHosts(domain);
  for (const host of mx) {
    const preset = presetForMxHost(host);
    if (preset) add(fromPreset(preset, `mail hosted by ${PRESETS[preset].label}`));
  }

  const lookups = [domain, ...new Set(mx.map(baseDomain))].filter((d, i, all) => all.indexOf(d) === i).slice(0, 3);
  for (const d of lookups) {
    const found = await ispdb(d, email);
    if (found?.smtp) add({ source: `autoconfig for ${d}`, preset: 'custom', smtp: found.smtp, imap: found.imap, appPassword: false });
  }

  for (const host of [`smtp.${domain}`, `mail.${domain}`]) {
    const imapHost = host.startsWith('smtp.') ? `imap.${domain}` : host;
    add({ source: 'common host names', preset: 'custom', smtp: { host, port: 465, secure: true }, imap: { host: imapHost, port: 993, secure: true }, appPassword: false });
    add({ source: 'common host names', preset: 'custom', smtp: { host, port: 587, secure: false }, imap: { host: imapHost, port: 993, secure: true }, appPassword: false });
  }
  return out.slice(0, 8);
}
