/** SSRF guard for fetching arbitrary company websites (never fetch private/reserved networks). */
import { lookup } from 'node:dns/promises';
import { isIP } from 'node:net';

export async function assertPublicTarget(value: string): Promise<void> {
  const url = new URL(value);
  if (url.protocol !== 'https:' && url.protocol !== 'http:') throw new Error('Only HTTP(S) URLs can be fetched.');
  if (url.username || url.password) throw new Error('URLs with credentials are refused.');
  const host = url.hostname.toLowerCase().replace(/^\[|\]$/g, '');
  if (host === 'localhost' || host.endsWith('.localhost') || host.endsWith('.local') || host.endsWith('.internal')) throw new Error('Local hostnames are refused.');
  if (isIP(host)) {
    if (!isPublicIp(host)) throw new Error('Private or reserved IP addresses are refused.');
    return;
  }
  const answers = await lookup(host, { all: true, verbatim: true });
  if (!answers.length) throw new Error('Hostname did not resolve.');
  if (answers.some((a) => !isPublicIp(a.address))) throw new Error('Hostname resolves to a private network address.');
}

export function isPublicIp(address: string): boolean {
  const version = isIP(address);
  if (version === 4) {
    const [a, b] = address.split('.').map(Number);
    if (a === 0 || a === 10 || a === 127) return false;
    if (a === 100 && b >= 64 && b <= 127) return false;
    if (a === 169 && b === 254) return false;
    if (a === 172 && b >= 16 && b <= 31) return false;
    if (a === 192 && (b === 0 || b === 168)) return false;
    if (a === 198 && (b === 18 || b === 19)) return false;
    return a < 224;
  }
  if (version === 6) {
    const v = address.toLowerCase();
    if (v === '::' || v === '::1' || v.startsWith('fc') || v.startsWith('fd') || /^fe[89ab]/.test(v) || v.startsWith('ff') || v.startsWith('2001:db8:')) return false;
    const mapped = v.match(/^::ffff:(\d+\.\d+\.\d+\.\d+)$/);
    return mapped ? isPublicIp(mapped[1]) : true;
  }
  return false;
}
