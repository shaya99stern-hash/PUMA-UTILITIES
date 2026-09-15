import { NextResponse } from 'next/server';
import { lookupHpdOwnershipByBbl } from '@/lib/research/sources/nyc-hpd';
import { lookupNjParcelByPin, searchNjParcelsByAddress } from '@/lib/research/sources/nj-parcels';
import { resolveWaterServiceByAddress } from '@/lib/research/sources/water-service';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const MAX_BODY_BYTES = 8_192;

export async function POST(request: Request) {
  try {
    const contentLength = Number(request.headers.get('content-length') ?? 0);
    if (contentLength > MAX_BODY_BYTES) return NextResponse.json({ error: 'Request is too large.' }, { status: 413 });
    const body = await request.text();
    if (body.length > MAX_BODY_BYTES) return NextResponse.json({ error: 'Request is too large.' }, { status: 413 });
    const input = JSON.parse(body) as Record<string, unknown>;
    const kind = typeof input.kind === 'string' ? input.kind : '';

    if (kind === 'nj-address') {
      const address = typeof input.address === 'string' ? input.address.trim() : '';
      if (address.length < 4 || address.length > 120) return invalid('New Jersey address must be 4–120 characters.');
      const records = await searchNjParcelsByAddress(address, request.signal);
      return NextResponse.json({ kind, source: 'nj-parcel-mod4', records });
    }

    if (kind === 'nj-pin') {
      const pin = typeof input.pin === 'string' ? input.pin.trim() : '';
      if (!/^[A-Za-z0-9_.-]{3,64}$/.test(pin)) return invalid('Invalid New Jersey PAMS PIN.');
      const records = await lookupNjParcelByPin(pin, request.signal);
      return NextResponse.json({ kind, source: 'nj-parcel-mod4', records });
    }

    if (kind === 'nyc-bbl') {
      const borough = String(input.borough ?? '').trim();
      const block = String(input.block ?? '').trim();
      const lot = String(input.lot ?? '').trim();
      if (!/^\d$/.test(borough) || !/^\d+(?:\.\d+)?$/.test(block) || !/^\d+(?:\.\d+)?$/.test(lot)) {
        return invalid('NYC BBL requires numeric borough, block and lot values.');
      }
      const record = await lookupHpdOwnershipByBbl(borough, block, lot, request.signal);
      return NextResponse.json({ kind, source: 'nyc-hpd-registrations', record });
    }

    if (kind === 'water-address') {
      const address = typeof input.address === 'string' ? input.address.trim() : '';
      const state = typeof input.state === 'string' ? input.state.trim().toUpperCase() : undefined;
      if (address.length < 6 || address.length > 180) return invalid('Water-service address must be 6–180 characters.');
      if (state && !/^[A-Z]{2}$/.test(state)) return invalid('State must be a two-letter code.');
      const result = await resolveWaterServiceByAddress(address, state, request.signal);
      return NextResponse.json({ kind, source: 'public-water-service-areas', result });
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
