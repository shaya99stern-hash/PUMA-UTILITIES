import assert from 'node:assert/strict';
import test from 'node:test';
import { buildMergeVars, htmlToText, renderMerge, sanitizeEmailHtml, unknownTags } from '../lib/email/merge';
import { renderEmail } from '../lib/email/render';

test('renders merge tags and fallbacks', () => {
  const vars = buildMergeVars({ first_name: 'Jordan', company_name: 'Hudson Residential', state: 'NJ', portfolio_units: 1250 }, { name: 'Alex Puma' });
  assert.equal(renderMerge('Hi {{first_name|there}},', vars), 'Hi Jordan,');
  assert.equal(renderMerge('Hi {{ first_name }} at {{company}} in {{state}}', vars), 'Hi Jordan at Hudson Residential in NJ');
  assert.equal(renderMerge('{{portfolio_units}} units', vars), '1,250 units');
  assert.equal(renderMerge('From {{sender_name}}', vars), 'From Alex Puma');
  const empty = buildMergeVars({ first_name: '  ', last_name: null }, {});
  assert.equal(renderMerge('Hi {{first_name|there}},', empty), 'Hi there,');
  assert.equal(renderMerge('Hi {{first_name}},', empty), 'Hi ,');
  assert.equal(renderMerge('{{city|your city}} / {{CITY|x}}', empty), 'your city / x');
});

test('html merge escapes values so data cannot inject markup', () => {
  const vars = buildMergeVars({ first_name: '<script>alert(1)</script>', company_name: 'A & B' }, {});
  const out = renderMerge('<p>{{first_name}} {{company}}</p>', vars, { html: true });
  assert.ok(!out.includes('<script>'));
  assert.ok(out.includes('A &amp; B'));
});

test('detects unknown tags', () => {
  assert.deepEqual(unknownTags('{{first_name}} {{bogus}} {{other|x}}').sort(), ['bogus', 'other']);
});

test('sanitizer keeps basic formatting and strips scripts, handlers and unsafe links', () => {
  const dirty = '<p onclick="x()">Hi <b>there</b><script>alert(1)</script> <a href="javascript:alert(1)">bad</a> <a href="https://ok.com/a?b=1&c=2" onmouseover="y()">ok</a><iframe src="x"></iframe></p>';
  const clean = sanitizeEmailHtml(dirty);
  assert.ok(!/script|onclick|onmouseover|iframe|javascript:/i.test(clean), clean);
  assert.ok(clean.includes('<b>there</b>'));
  assert.ok(clean.includes('href="https://ok.com/a?b=1&amp;c=2"'));
});

test('html to text keeps links and lists readable', () => {
  const text = htmlToText('<p>Hello <b>Sam</b>,</p><ul><li>One</li><li>Two</li></ul><p><a href="https://x.com/a">See this</a></p>');
  assert.ok(text.includes('Hello Sam,'));
  assert.ok(text.includes('- One\n- Two'));
  assert.ok(text.includes('See this (https://x.com/a)'));
});

test('renderEmail builds subject, Re: fallback, footer, headers, and flags missing tags', () => {
  const base = {
    stepIndex: 0,
    recipient: { first_name: null, company_name: 'Acme', email: 'a@acme.com' },
    token: 'tok123',
    sender: { name: 'Alex', email: 'alex@puma.com' },
    settings: { trackOpens: false, trackClicks: false, includeSignature: true },
    workspace: { address: '1 Main St, Newark, NJ 07102', companyName: 'Puma Utilities' },
    baseUrl: 'https://app.puma.test',
  };
  const first = renderEmail({ ...base, step: { subject: 'Water savings for {{company}}', body_html: '<p>Hi {{first_name}}</p>' } });
  assert.equal(first.subject, 'Water savings for Acme');
  assert.deepEqual(first.missing, ['first_name']);
  assert.ok(first.html.includes('https://app.puma.test/u/tok123'));
  assert.ok(first.html.includes('1 Main St, Newark, NJ 07102'));
  assert.ok(first.text.includes('Unsubscribe: https://app.puma.test/u/tok123'));
  const follow = renderEmail({ ...base, stepIndex: 1, firstSubject: first.subject, step: { subject: '', body_html: '<p>Following up</p>' } });
  assert.equal(follow.subject, 'Re: Water savings for Acme');
  const fb = renderEmail({ ...base, step: { subject: 'x', body_html: '<p>Hi {{first_name|there}}</p>' } });
  assert.deepEqual(fb.missing, []);
  assert.ok(fb.html.includes('Hi there'));
});
