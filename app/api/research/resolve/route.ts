import { NextResponse } from 'next/server';
import { lookupHpdOwnershipByBbl } from '@/lib/research/sources/nyc-hpd';
import { lookupNjParcelByPin, searchNjParcelsByAddress } from '@/lib/research/sources/nj-parcels';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const MAX_BODY_BYTES = 8_192;

type ResolveRequest =
  | { kind: 'nj-address'; address: string }
  | { kind: 'nj-pin'; pin: string }
  | { kind: 'nyc-bbl'; borough: string | number; block: string | number; lot: string | number };

export async function POST(request: Request) {
  try {
    const contentLength = Number(request.headers.get('content-length') ?? 0);
    if (contentLength > MAX_BODY_BYTES) return NextResponse.json({ error: 'Request is too large.' }, { status: 413 });
    const body = await request.text();
    if (body.length > MAX_BODY_BYTES) return NextResponse.json({ error: 'Request is too large.' }, { status: 413 });
    const input = JSON.parse(body) as Partial<ResolveRequest> & { kind?: string };

    if (input.kind === 'nj-address') {
      const address = typeof input.address === 'string' ? input.address.trim() : '';
      if (address.length < 4 || address.length > 120) return invalid('New Jersey address must be 4–120 characters.');
      const records = await searchNjParcelsByAddress(address, request.signal);
      return NextResponse.json({ kind: input.kind, source: 'nj-parcel-mod4', records });
    }

    if (input.kind === 'nj-pin') {
      const pin = typeof input.pin === 'string' ? input.pin.trim() : '';
      if (!/^[A-Za-z0-9_.-]{3,64}$/.test(pin)) return invalid('Invalid New Jersey PAMS PIN.');
      const records = await lookupNjParcelByPin(pin, request.signal);
      return NextResponse.json({ kind: input.kind, source: 'nj-parcel-mod4', records });
    }

    if (input.kind === 'nyc-bbl') {
      const borough = String(input.borough ?? '').trim();
      const block = String(input.block ?? '').trim();
      const lot = String(input.lot ?? '').trim();
      if (!/^\d$/.test(borough) || !/^\d+(?:\.\d+)?$/.test(block) || !/^\d+(?:\.\d+)?$/.test(lot)) {
        return invalid('NYC BBL requires numeric borough, block and lot values.');
      }
      const record = await lookupHpdOwnershipByBbl(borough, block, lot, request.signal);
      return NextResponse.json({ kind: input.kind, source: 'nyc-hpd-registrations', record });
    }

    return invalid('Unsupported research resolver kind.');
  } catch (error) {
    if (error instanceof SyntaxError) return invalid('Request body must be valid JSON.');
    const message = error instanceof Error ? error.message : 'Research source failed.';
    return NextResponse.json({ error: message }, { status: 502 });
  }
}

function invalid(message: string) {
  return NextResponse.json({ error: message }, { status: 400 });
}
