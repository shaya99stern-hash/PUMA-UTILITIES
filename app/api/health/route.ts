import { NextResponse } from 'next/server';

export function GET() {
  return NextResponse.json({
    ok: true,
    service: 'puma-utilities',
    version: '0.1.0',
    engine: 'shell',
  });
}
