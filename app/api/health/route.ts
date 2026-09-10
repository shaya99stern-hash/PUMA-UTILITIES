import { NextResponse } from 'next/server';

export function GET() {
  return NextResponse.json({
    ok: true,
    service: 'puma-utilities',
    version: '0.2.0',
    workspaceRelease: 'release-1-public-research',
    engine: 'local-first research workspace',
    storage: 'Browser local storage per device; no server-side client workspace is exposed by this endpoint.',
    publicResearchSeeds: 5,
    monitoringBoundary: 'Client-stage records with client-authorized readings only.',
  });
}
