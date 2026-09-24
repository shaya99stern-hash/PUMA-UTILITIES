import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { discoverCompanies } from '../lib/research/discovery-service';

const hit = {
  title: 'Reliable Property Group | Portfolio',
  url: 'https://reliable.example/portfolio',
  snippet: 'Owner-operator multifamily portfolio. Owns and manages communities.',
};

test('discovery keeps successful candidates when one query fails', async () => {
  let calls = 0;
  const outcome = await discoverCompanies(
    { geography: 'NJ, NY', minBuildings: 20, maxBuildings: 100, count: 10 },
    {
      search: async (query) => {
        calls += 1;
        if (calls === 1) throw new Error('temporary upstream failure');
        return { query, results: [hit], backend: 'duckduckgo-html' as const };
      },
    },
  );

  assert.equal(outcome.diagnostics.attempted, 4);
  assert.equal(outcome.diagnostics.succeeded, 3);
  assert.equal(outcome.diagnostics.failed, 1);
  assert.equal(outcome.warnings.length, 1);
  assert.equal(outcome.allFailed, false);
  assert.ok(outcome.candidates.some((candidate) => candidate.website === 'https://reliable.example'));
});

test('discovery reports all searches failed instead of pretending no candidates exist', async () => {
  const outcome = await discoverCompanies(
    { geography: 'NJ', minBuildings: 20, maxBuildings: 100, count: 10 },
    { search: async () => { throw new Error('upstream unavailable'); } },
  );

  assert.equal(outcome.diagnostics.attempted, 2);
  assert.equal(outcome.diagnostics.succeeded, 0);
  assert.equal(outcome.diagnostics.failed, 2);
  assert.equal(outcome.candidates.length, 0);
  assert.equal(outcome.allFailed, true);
});

test('discovery route maps all-failed outcome to a 502 response', () => {
  const source = readFileSync(new URL('../app/api/research/discover/route.ts', import.meta.url), 'utf8');
  assert.match(source, /outcome\.allFailed/);
  assert.match(source, /status:\s*502/);
  assert.match(source, /Lead discovery sources are temporarily unavailable/);
});
