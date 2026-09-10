import assert from 'node:assert/strict';
import test from 'node:test';
import { scoreCompany } from '../lib/scoring';
import { createReleaseOneWorkspace } from '../lib/seed';

test('public research targets remain unscored until every required factor is evidenced', () => {
  const workspace = createReleaseOneWorkspace();

  for (const company of workspace.companies) {
    const score = scoreCompany(company, workspace);
    assert.equal(score.total, undefined, `${company.name} must not receive a partial opportunity score`);
    assert.ok(score.completeness < 1, `${company.name} needs further evidence`);
    assert.ok(score.factors.some((factor) => factor.state === 'unknown'));
  }
});

test('a public locations statement is not silently converted into a building-score input', () => {
  const workspace = createReleaseOneWorkspace();
  const legow = workspace.companies.find((company) => company.id === 'legow-nj');
  assert.ok(legow);

  const portfolio = scoreCompany(legow, workspace).factors.find((factor) => factor.id === 'portfolio');
  assert.equal(portfolio?.state, 'unknown');
  assert.match(portfolio?.detail ?? '', /building count/i);
  assert.equal(legow.portfolio?.[0]?.label, 'locations');
});

test('a company portfolio page is not treated as property-level data availability', () => {
  const workspace = createReleaseOneWorkspace();
  const algin = workspace.companies.find((company) => company.id === 'algin-ny');
  assert.ok(algin);

  const dataAvailability = scoreCompany(algin, workspace).factors.find((factor) => factor.id === 'data-availability');
  assert.equal(dataAvailability?.state, 'unknown');
  assert.match(dataAvailability?.detail ?? '', /property-level/i);
});
