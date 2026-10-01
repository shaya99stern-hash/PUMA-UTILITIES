import assert from 'node:assert/strict';
import test from 'node:test';
import { ComplianceError, footerHtml, footerText, listUnsubscribeHeaders, requireCompanyAddress, unsubscribeUrl } from '../lib/email/compliance';
import { renderEmail } from '../lib/email/render';
import { rewriteLinks, safeRedirectUrl, trackedLink, trackingPixel, verifyClickSignature } from '../lib/email/tracking';
import { signState, verifyState } from '../lib/email/sign';

process.env.PUMA_ENCRYPTION_KEY = Buffer.alloc(32, 7).toString('base64');

test('CAN-SPAM footer includes address and unsubscribe link; missing address blocks sending', () => {
  const f = { address: '1 Main St, Newark, NJ 07102', unsubscribeUrl: 'https://x.test/u/abc', senderName: 'Alex', companyName: 'Puma' };
  assert.ok(footerHtml(f).includes('1 Main St, Newark, NJ 07102'));
  assert.ok(footerHtml(f).includes('href="https://x.test/u/abc"'));
  assert.ok(footerText(f).includes('Unsubscribe: https://x.test/u/abc'));
  assert.throws(() => requireCompanyAddress(''), ComplianceError);
  assert.throws(() => requireCompanyAddress(null), /mailing address/);
  assert.equal(requireCompanyAddress('  1 Main St   Newark NJ '), '1 Main St Newark NJ');
});

test('List-Unsubscribe headers support one-click POST', () => {
  const url = unsubscribeUrl('https://x.test/', 'tok');
  assert.equal(url, 'https://x.test/u/tok');
  const h = listUnsubscribeHeaders({ url, mailto: 'me@x.test' });
  assert.equal(h['List-Unsubscribe'], '<https://x.test/u/tok>, <mailto:me@x.test?subject=unsubscribe>');
  assert.equal(h['List-Unsubscribe-Post'], 'List-Unsubscribe=One-Click');
  assert.deepEqual(Object.keys(listUnsubscribeHeaders({ url })), ['List-Unsubscribe', 'List-Unsubscribe-Post']);
});

test('redirect targets must be absolute http(s) URLs', () => {
  assert.equal(safeRedirectUrl('https://example.com/a?b=1'), 'https://example.com/a?b=1');
  assert.equal(safeRedirectUrl('javascript:alert(1)'), null);
  assert.equal(safeRedirectUrl('data:text/html,hi'), null);
  assert.equal(safeRedirectUrl('//evil.com'), null);
  assert.equal(safeRedirectUrl('https://user:pw@evil.com'), null);
  assert.equal(safeRedirectUrl(null), null);
  assert.equal(safeRedirectUrl('https://x.com/' + 'a'.repeat(3000)), null);
});

test('link rewriting wraps http(s) links only and signs them', () => {
  const html = '<p><a href="https://acme.com/pricing?x=1&amp;y=2">Pricing</a> <a href="mailto:a@b.com">mail</a> <a href="#top">top</a> <a href="https://x.test/u/tok">unsub</a></p>';
  const out = rewriteLinks(html, { baseUrl: 'https://x.test', token: 'tok', step: 1 });
  const m = out.match(/href="(https:\/\/x\.test\/t\/c\/tok\?[^"]+)"/);
  assert.ok(m, out);
  const url = new URL(m![1].replace(/&amp;/g, '&'));
  assert.equal(url.searchParams.get('u'), 'https://acme.com/pricing?x=1&y=2');
  assert.equal(url.searchParams.get('s'), '1');
  assert.equal(verifyClickSignature('tok', url.searchParams.get('u')!, url.searchParams.get('k')), true);
  assert.equal(verifyClickSignature('tok', 'https://evil.com', url.searchParams.get('k')), false);
  assert.equal(verifyClickSignature('other', url.searchParams.get('u')!, url.searchParams.get('k')), false);
  assert.ok(out.includes('href="mailto:a@b.com"'));
  assert.ok(out.includes('href="#top"'));
  assert.ok(out.includes('href="https://x.test/u/tok"'));
  assert.equal((out.match(/\/t\/c\//g) ?? []).length, 1);
  assert.ok(trackedLink('https://x.test', 'tok', 'https://a.com').startsWith('https://x.test/t/c/tok?u='));
});

test('tracking pixel and renderEmail honor settings', () => {
  assert.ok(trackingPixel('https://x.test', 'tok', 0).includes('https://x.test/t/o/tok?s=0'));
  const base = {
    step: { subject: 'Hello', body_html: '<p>See <a href="https://acme.com">our site</a></p>' },
    stepIndex: 0,
    recipient: { email: 'r@x.com' },
    token: 'tok',
    sender: { name: 'Alex', email: 'alex@puma.com' },
    workspace: { address: '1 Main St Newark NJ', companyName: 'Puma' },
    baseUrl: 'https://x.test',
  };
  const on = renderEmail({ ...base, settings: { trackOpens: true, trackClicks: true, includeSignature: false } });
  assert.ok(on.html.includes('/t/o/tok'));
  assert.ok(on.html.includes('/t/c/tok'));
  assert.ok(!on.html.includes('href="https://x.test/t/c/tok?u=https%3A%2F%2Fx.test/u'));
  assert.equal(on.headers['List-Unsubscribe-Post'], 'List-Unsubscribe=One-Click');
  assert.ok(on.headers['List-Unsubscribe'].includes('https://x.test/u/tok'));
  const off = renderEmail({ ...base, settings: { trackOpens: false, trackClicks: false, includeSignature: false } });
  assert.ok(!off.html.includes('/t/o/'));
  assert.ok(!off.html.includes('/t/c/'));
  assert.ok(off.html.includes('href="https://acme.com"'));
  const preview = renderEmail({ ...base, preview: true, settings: { trackOpens: true, trackClicks: true, includeSignature: false } });
  assert.ok(!preview.html.includes('/t/o/') && !preview.html.includes('/t/c/'));
  assert.ok(preview.unsubscribeUrl.endsWith('/u/preview'));
});

test('OAuth state is signed, tamper-proof and expires', () => {
  const state = signState({ ws: 'w1', p: 'google' });
  assert.equal(verifyState<{ ws: string }>(state)?.ws, 'w1');
  const [body, sig] = state.split('.');
  const tampered = Buffer.from(JSON.stringify({ ws: 'w2', p: 'google', exp: 9999999999 })).toString('base64url');
  assert.equal(verifyState(`${tampered}.${sig}`), null);
  assert.equal(verifyState(`${body}.bad`), null);
  assert.equal(verifyState(signState({ ws: 'w1' }, -10)), null);
  assert.equal(verifyState(null), null);
});
