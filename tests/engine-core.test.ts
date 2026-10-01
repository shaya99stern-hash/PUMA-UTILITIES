import assert from 'node:assert/strict';
import test from 'node:test';
import { clusterRecords, isServiceAddress, mergeDuplicates } from '../lib/engine/cluster';
import { normalizeInput, planCollection, inGeography } from '../lib/engine/collect';
import { mapBuildingRows, renderTemplate, getPath } from '../lib/engine/connectors';
import { addPerson, chooseName, emptyDossier, isSingleAssetName, portfolioStats, rankPeople } from '../lib/engine/dossier';
import { applyPattern, inferEmail, learnPattern, matchPatterns } from '../lib/engine/emails';
import { scoreDossier } from '../lib/engine/score';
import { parseContactOutCompany } from '../lib/engine/sources/contactout';
import { splitStreet } from '../lib/engine/resolvers';
import { estimateWater, rateFor } from '../lib/engine/water';
import { meterProgramFor } from '../lib/engine/utility-intel';
import { domainGuesses, extractSite, pickLinks, siteMatchesName } from '../lib/engine/website';
import type { PropertyRecord } from '../lib/engine/types';

const prov = (id: string) => ({ sourceId: id, sourceName: id, url: `https://example.test/${id}`, retrievedAt: '2026-10-01T00:00:00Z' });

function rec(partial: Partial<PropertyRecord> & { sourceKey: string }): PropertyRecord {
  return { address: '1 Main St', state: 'NJ', provenance: prov('nj-modiv'), ...partial };
}

test('NJ parcels with redacted owners cluster by shared mailing address', () => {
  const records = [
    rec({ sourceKey: 'nj-pin:1', address: '10 A St', units: 48, ownerMailingAddress: '210 Hudson St Ste 400, Jersey City NJ 07311', mailingKey: '210 HUDSON ST|07311', city: 'Jersey City' }),
    rec({ sourceKey: 'nj-pin:2', address: '20 B St', units: 120, ownerMailingAddress: '210 Hudson St, Jersey City NJ 07311', mailingKey: '210 HUDSON ST|07311', city: 'Jersey City' }),
    rec({ sourceKey: 'nj-pin:3', address: '30 C St', units: 30, ownerMailingAddress: '5 Other Rd, Newark NJ 07102', mailingKey: '5 OTHER RD|07102', city: 'Newark' }),
  ];
  const dossiers = clusterRecords(records);
  const big = dossiers.find((d) => d.buildings.length === 2);
  assert.ok(big, 'two parcels sharing a mailing address form one portfolio');
  assert.equal(portfolioStats(big!).units, 168);
  assert.match(big!.name, /^Owner at 210 Hudson St/);
  assert.equal(dossiers.length, 2);
});

test('records for the same building from different sources merge; HUD manager names the portfolio', () => {
  const records: PropertyRecord[] = [
    { sourceKey: 'nyc-bbl:3012340001', altKeys: ['bbl:3012340001', 'addr:100 MAIN ST|11201'], address: '100 Main St', state: 'NY', zip: '11201', units: 200, ownerName: '100 MAIN OWNER LLC', provenance: prov('nyc-pluto') },
    { sourceKey: 'hud:800001', altKeys: ['addr:100 MAIN ST|11201'], address: '100 Main St', state: 'NY', zip: '11201', units: 198, managerName: 'Acme Residential Management', provenance: prov('hud-mf-assisted'),
      people: [{ fullName: 'Jane Doe', title: 'Vice President', roleCategory: 'executive', isDecisionMaker: true, email: 'jdoe@acmeres.com', emailStatus: 'published', provenance: prov('hud-mf-assisted') }] },
    { sourceKey: 'hud:800002', altKeys: ['addr:5 OAK AVE|11206'], address: '5 Oak Ave', state: 'NY', zip: '11206', units: 90, managerName: 'ACME RESIDENTIAL MANAGEMENT', provenance: prov('hud-mf-assisted') },
  ];
  const [d] = mergeDuplicates(clusterRecords(records));
  assert.equal(d.buildings.length, 2, 'PLUTO lot and HUD property are one building');
  assert.equal(d.name, 'Acme Residential Management');
  assert.equal(d.people[0].emails[0].email, 'jdoe@acmeres.com');
  assert.ok(d.domains.some((x) => x.domain === 'acmeres.com'));
});

test('tax-service PO boxes do not glue unrelated owners together', () => {
  const stats = { buildings: 40, owners: new Set(Array.from({ length: 30 }, (_, i) => `owner ${i}`)), cities: new Set(['A', 'B', 'C', 'D', 'E', 'F', 'G']), states: new Set(['TX']), poBox: true, street: 'PO BOX 9000' };
  assert.equal(isServiceAddress(stats, new Set(['NJ'])), true);
  assert.equal(isServiceAddress({ ...stats, owners: new Set(['a']), poBox: false, cities: new Set(['A']), states: new Set(['NJ']), street: '210 HUDSON ST' }, new Set(['NJ'])), false);
});

test('single-asset LLC names are not used as company names', () => {
  assert.equal(isSingleAssetName('123 MAIN STREET LLC'), true);
  assert.equal(isSingleAssetName('KOSCAL 59 LLC'), false);
  assert.equal(isSingleAssetName('Riverside HDFC'), true);
  const d = emptyDossier('k', '');
  d.aliases.push({ name: '123 Main Street LLC', key: '123 main street', kind: 'owner', count: 1, src: ['x'] });
  d.aliases.push({ name: 'Glenwood Management', key: 'glenwood', kind: 'agent', count: 3, src: ['nyc-hpd'] });
  chooseName(d);
  assert.equal(d.name, 'Glenwood Management');
});

test('email format is learned from published examples and applied to decision makers', () => {
  assert.deepEqual(matchPatterns('Jane Doe', 'jdoe@acme.com'), ['flast']);
  assert.equal(applyPattern('first.last', 'Mary-Ann O’Brien'), 'maryann.obrien');
  const learned = learnPattern([{ name: 'Jane Doe', email: 'jdoe@acme.com' }, { name: 'Tom Ray', email: 'tray@acme.com' }, { name: 'Office', email: 'info@acme.com' }], 'acme.com');
  assert.equal(learned?.pattern, 'flast');
  const guess = inferEmail('Steven Zaro', 'acme.com', learned);
  assert.equal(guess?.email, 'szaro@acme.com');
  assert.ok((guess?.confidence ?? 0) >= 0.75);
  assert.ok((inferEmail('Steven Zaro', 'acme.com', null)?.confidence ?? 1) < 0.5, 'unconfirmed format is low confidence');
});

test('ContactOut public page: staff, titles, email format, phone, website, published emails', () => {
  const html = `<html><head><script type="application/ld+json">${JSON.stringify({
    '@context': 'https://schema.org', '@type': 'ProfilePage',
    mainEntity: { '@type': 'Organization', name: 'Denholtz Properties', contactPoint: { '@type': 'ContactPoint', telephone: '732-388-3000' }, location: '116 Chestnut Street, Red Bank, NJ 07701, US',
      employee: [{ '@type': 'Person', name: 'Stephen Cassidy', jobTitle: 'President' }, { '@type': 'Person', name: 'Steven Zaro', jobTitle: 'Property Manager', url: 'https://contactout.com/x-1' }],
      sameAs: ['https://www.linkedin.com/company/denholtz-properties', 'http://www.denholtz.com'] },
  })}</script></head><body><p>The widely used Denholtz Properties email format is {first_initial}{last}@denholtz.com (e.g. jsmith@denholtz.com), which is used 100% of the time.</p>
  <p>Steven Denholtz is the CEO. To contact Steven Denholtz email at sjd@denholtznj.com or stevendenholtz@denholtz.com. </p><p>******@denholtz.com</p></body></html>`;
  const co = parseContactOutCompany(html, 'https://contactout.com/company/Denholtz-Properties-31352');
  assert.equal(co.name, 'Denholtz Properties');
  assert.equal(co.phone, '(732) 388-3000');
  assert.equal(co.website, 'http://www.denholtz.com');
  assert.equal(co.employees.length, 2);
  assert.equal(co.employees[0].title, 'President');
  assert.deepEqual(co.emailFormat && { p: co.emailFormat.pattern, d: co.emailFormat.domain, pct: co.emailFormat.pct }, { p: 'flast', d: 'denholtz.com', pct: 100 });
  assert.deepEqual(co.publishedEmails.map((e) => e.email), ['sjd@denholtznj.com', 'stevendenholtz@denholtz.com']);
});

test('website extraction finds team members, emails, phones and portfolio claims', () => {
  const html = `<html><head><title>Glenwood Management | NYC Luxury Rentals</title><meta property="og:site_name" content="Glenwood Management"></head><body>
    <nav><a href="/about-us">About</a><a href="/our-team">Team</a><a href="/contact">Contact</a><a href="/careers">Careers</a></nav>
    <p>Glenwood owns and manages over 5,000 apartments across 25 buildings in Manhattan.</p>
    <div class="card"><h3>Jane Smith</h3><p>Vice President of Operations</p><a href="mailto:jsmith@glenwoodnyc.com">Email</a></div>
    <p>Call us: (212) 555-0182 · <a href="tel:+12125550100">Main</a></p>
    <p>Write to leasing [at] glenwoodnyc [dot] com</p>
    <a href="https://www.linkedin.com/company/glenwood-management">LinkedIn</a>
  </body></html>`;
  const f = extractSite(html, 'https://glenwoodnyc.com/');
  assert.equal(f.siteName, 'Glenwood Management');
  assert.ok(f.emails.includes('jsmith@glenwoodnyc.com'));
  assert.ok(f.emails.includes('leasing@glenwoodnyc.com'));
  assert.equal(f.phones[0], '(212) 555-0100');
  assert.ok(f.people.some((p) => p.name === 'Jane Smith' && /Vice President/.test(p.title ?? '')));
  assert.ok(f.portfolio.some((p) => p.units === 5000));
  assert.ok(f.portfolio.some((p) => p.buildings === 25));
  assert.equal(f.linkedin, 'https://www.linkedin.com/company/glenwood-management');
  assert.deepEqual(pickLinks(f.links, 3).map((l) => new URL(l).pathname), ['/our-team', '/contact', '/about-us']);
  assert.ok(siteMatchesName(f, 'Glenwood Management Corp') > 0.75);
  assert.ok(domainGuesses('Glenwood Management Corp').includes('glenwoodmanagement.com'));
  assert.ok(domainGuesses('Glenwood Management Corp').includes('glenwood.com'));
});

test('decision makers rank ahead of site staff; score explains itself', () => {
  const d = emptyDossier('k', 'Acme');
  d.nameConfidence = 0.9;
  d.nameKind = 'manager';
  addPerson(d, { name: 'Sam Super', title: 'Superintendent', role: 'maintenance' }, 'x');
  addPerson(d, { name: 'Ann Owner', title: 'President', role: 'executive', decisionMaker: true, email: 'ann@acme.com', emailStatus: 'published' }, 'website');
  assert.equal(rankPeople(d.people)[0].name, 'Ann Owner');
  for (let i = 0; i < 6; i += 1) d.buildings.push({ key: `b${i}`, altKeys: [], name: null, address: `${i} St`, city: 'Newark', state: 'NJ', zip: null, county: null, lat: null, lon: null, units: 80, unitsEstimated: false, yearBuilt: 1962, stories: null, buildingClass: null, bbl: null, parcelId: null, ownerName: null, mailingAddress: null, managerName: null, utilityName: 'Newark Water Department', utilityPwsid: 'NJ0714001', reportedWaterKgal: null, reportedWaterYear: null, estAnnualWaterCost: null, src: ['nj-modiv'] });
  d.sources = { 'nj-modiv': { name: 'NJ', hits: 6 }, website: { name: 'Site', hits: 1 }, 'hud-mf-assisted': { name: 'HUD', hits: 1 } };
  estimateWater(d);
  assert.equal(d.water.estMonthlySpend, Math.round((480 * 43.6 * 15) / 12));
  assert.equal(d.water.utilities[0].name, 'Newark Water Department');
  const s = scoreDossier(d);
  assert.ok(s.score >= 70, `strong lead scores high (got ${s.score})`);
  assert.equal(s.factors.find((f) => f.id === 'reachability')?.points, 15);
  assert.ok(s.why.some((w) => /Decision maker identified: Ann Owner/.test(w)));
});

test('utility metering knowledge and rates', () => {
  assert.equal(meterProgramFor('New York City System').status, 'amr');
  assert.equal(meterProgramFor('Philadelphia Water Department').status, 'ami_rollout');
  assert.equal(meterProgramFor('Tiny Town Water').status, 'unknown');
  assert.equal(rateFor('New York City System', null, 'NY').perKgal, 17.5);
  assert.equal(rateFor(null, null, 'NJ').perKgal, 15);
});

test('collection plan covers NJ statewide, NYC, Philadelphia, Montgomery County and HUD', () => {
  const plan = planCollection(normalizeInput({ states: ['NJ', 'NY', 'PA'] }));
  const ids = plan.map((t) => t.id);
  assert.equal(ids.filter((i) => i.startsWith('nj:')).length, 21);
  for (const id of ['pluto', 'hpd-agents', 'hpd-officers', 'opa', 'montco', 'hud-assisted', 'hud-insured', 'pha']) assert.ok(ids.includes(id), id);
  const hudson = planCollection(normalizeInput({ states: ['NJ', 'NY'], counties: ['Hudson County'] })).map((t) => t.id);
  assert.ok(hudson.includes('nj:HUDSON'));
  assert.ok(!hudson.includes('pluto'), 'NYC is out of scope for a Hudson County search');
  assert.equal(inGeography({ state: 'NY', county: 'Kings', city: 'Brooklyn', zip: '11201' }, normalizeInput({ states: ['NY'], cities: ['Brooklyn'] })), true);
  assert.equal(inGeography({ state: 'NJ', county: 'Essex', city: 'Newark', zip: null }, normalizeInput({ states: ['NJ'], counties: ['Hudson'] })), false);
});

test('connector field mapping turns any dataset into buildings', () => {
  const rows = [{ attributes: { ADDR: '12 ELM ST', TOWN: 'TRENTON', UNITS: '64', OWNER: 'ELM GARDENS LLC', MAIL_ST: '400 STATE ST', MAIL_ZIP: '08608' } }];
  const records = mapBuildingRows(rows, { id: 'c1', name: 'Mercer County', config: { state: 'NJ', fields: { address: 'attributes.ADDR', city: 'attributes.TOWN', units: 'attributes.UNITS', owner: 'attributes.OWNER', mailing_street: 'attributes.MAIL_ST', mailing_zip: 'attributes.MAIL_ZIP' } } }, 'https://x');
  assert.equal(records[0].units, 64);
  assert.equal(records[0].state, 'NJ');
  assert.equal(records[0].ownerName, 'ELM GARDENS LLC');
  assert.equal(records[0].mailingKey, '400 STATE ST|08608');
  assert.equal(renderTemplate('https://api.x/search?q={name}&d={domain}', { name: 'A & B', domain: null }), 'https://api.x/search?q=A%20%26%20B&d=');
  assert.equal(getPath({ data: { items: [1, 2] } }, 'data.items.1'), 2);
});

test('street parsing for address cross-references', () => {
  assert.deepEqual(splitStreet('210 Hudson St Ste 400, Jersey City NJ 07311'), { house: '210', streetStart: 'HUDSON ST', street: '210 HUDSON ST STE 400', zip: '07311' });
  assert.equal(splitStreet('PO Box 12, Trenton NJ 08608'), null);
});
