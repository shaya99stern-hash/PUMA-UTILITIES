import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';

test('protected manual evidence survives weaker incoming research during server import', async () => {
  const { preserveProtectedEvidence } = await import('../lib/server/workspace-import');

  const existingManual = { value: 'Manual address', status: 'user-entered' as const };
  const incomingResearch = { value: 'Researched address', status: 'verified-public' as const };
  assert.deepEqual(preserveProtectedEvidence(existingManual, incomingResearch), existingManual);

  const existingAuthorized = { value: 1250, status: 'client-authorized' as const };
  const incomingEstimate = { value: 980, status: 'estimated' as const };
  assert.deepEqual(preserveProtectedEvidence(existingAuthorized, incomingEstimate), existingAuthorized);

  const existingUnknown = { status: 'unknown' as const };
  assert.deepEqual(preserveProtectedEvidence(existingUnknown, incomingResearch), incomingResearch);
});

test('server import preloads existing evidence before upsert instead of blind replacement', () => {
  const source = readFileSync(new URL('../lib/server/workspace-repository.ts', import.meta.url), 'utf8');
  assert.match(source, /preserveProtectedEvidence/);
  assert.match(source, /existingRowsByLegacyId/);
  assert.match(source, /evidence_status/);
  assert.match(source, /address/);
});