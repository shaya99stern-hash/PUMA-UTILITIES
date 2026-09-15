import { lookup } from 'node:dns/promises';
import { isIP } from 'node:net';

export async function assertPublicNetworkTarget(value: string): Promise<void> {
  const url = new URL(value);
  if (url.protocol !== 'https:' && url.protocol !== 'http:') throw new Error('Research fetches require HTTP(S).');
  const host = url.hostname.toLowerCase().replace(/^\[|\]$/g, '');
  if (host === 'localhost' || host.endsWith('.localhost')) throw new Error('Research fetch refused a local hostname.');

  if (isIP(host)) {
    if (!isPublicIp(host)) throw new Error('Research fetch refused a private or reserved IP address.');
    return;
  }

  const answers = await lookup(host, { all: true, verbatim: true });
  if (!answers.length) throw new Error('Research hostname did not resolve.');
  if (answers.some((answer) => !isPublicIp(answer.address))) {
    throw new Error('Research hostname resolved to a private or reserved network address.');
  }
}

export function isPublicIp(address: string): boolean {
  const version = isIP(address);
  if (version === 4) return isPublicIpv4(address);
  if (version === 6) return isPublicIpv6(address);
  return false;
}

function isPublicIpv4(address: string): boolean {
  const parts = address.split('.').map(Number);
  if (parts.length !== 4 || parts.some((part) => !Number.isInteger(part) || part < 0 || part > 255)) return false;
  const [a, b] = parts;
  if (a === 0 || a === 10 || a === 127) return false;
  if (a === 100 && b >= 64 && b <= 127) return false;
  if (a === 169 && b === 254) return false;
  if (a === 172 && b >= 16 && b <= 31) return false;
  if (a === 192 && b === 0) return false;
  if (a === 192 && b === 168) return false;
  if (a === 198 && (b === 18 || b === 19)) return false;
  if (a >= 224) return false;
  return true;
}

function isPublicIpv6(address: string): boolean {
  const value = address.toLowerCase();
  if (value === '::' || value === '::1') return false;
  if (value.startsWith('fc') || value.startsWith('fd')) return false;
  if (/^fe[89ab]/.test(value)) return false;
  if (value.startsWith('ff')) return false;
  if (value.startsWith('2001:db8:')) return false;
  const mapped = value.match(/^::ffff:(\d+\.\d+\.\d+\.\d+)$/);
  if (mapped) return isPublicIpv4(mapped[1]);
  return true;
}
