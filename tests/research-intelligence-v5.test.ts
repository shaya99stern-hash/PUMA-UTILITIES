import assert from 'node:assert/strict';
import test from 'node:test';
import { addClaim, addEvidence, createResearchGraph, upsertEntity } from '../lib/research/graph';
import { extractContacts, extractLeadershipSignals, extractPropertySignals, extractLikelySitemapUrls } from '../lib/research/sources/company-website';
import { ingestAcrisOwnership, type AcrisOwnershipResult } from '../lib/research/sources/nyc-acris';
import { ingestHpdOwnership, ingestNjParcel, ingestCompanyWebsite } from '../lib/research/ingest';
import { normalizeNjPropertyLocationSearch } from '../lib/research/sources/nj-parcels';
import { estimatePropertyWaterCost, parseFixedWaterCharge } from '../lib/research/water-cost';

test('schema.org Person JSON-LD strengthens first-party leadership and direct contact extraction', () => {
  const html = `
    <script type="application/ld+json">
      {"@context":"https://schema.org","@type":"Person","name":"Jane Smith","jobTitle":"Chief Operating Officer","email":"jane@samplepm.com","telephone":"(212) 555-0100"}
    </script>
  `;
  const leadership = extractLeadershipSignals(html, 'https://samplepm.com/team');
  const contacts = extractContacts(html, 'https://samplepm.com/team');
  assert.ok(leadership.some((signal) => /Jane Smith.*Chief Operating Officer/i.test(signal.text)));
  assert.ok(contacts.some((contact) => contact.value === 'jane@samplepm.com' && /Jane Smith/i.test(contact.context ?? '')));
  assert.ok(contacts.some((contact) => contact.type === 'phone' && /Jane Smith/i.test(contact.context ?? '')));
});

test('schema.org apartment/property JSON-LD can expose address units and floor area', () => {
  const html = `
    <script type="application/ld+json">
      {
        "@context":"https://schema.org",
        "@type":"ApartmentComplex",
        "name":"Maple Court",
        "address":{"@type":"PostalAddress","streetAddress":"123 Main St","addressLocality":"Newark","addressRegion":"NJ","postalCode":"07102"},
        "numberOfAccommodationUnits":124,
        "floorSize":{"@type":"QuantitativeValue","value":156000,"unitText":"SQ FT"}
      }
    </script>
  `;
  const properties = extractPropertySignals(html, 'https://samplepm.com/properties/maple-court');
  const property = properties.find((item) => /123 Main St/i.test(item.address));
  assert.ok(property);
  assert.equal(property?.units, 124);
  assert.equal(property?.grossSquareFeet, 156000);
});

test('NJ parcel lookup reduces a full mailing address to a property-location search fragment', () => {
  assert.equal(normalizeNjPropertyLocationSearch('123 Main St, Newark, NJ 07102'), '123 MAIN ST');
  assert.equal(normalizeNjPropertyLocationSearch('77-79 Broad Street, Elizabeth, NJ 07201'), '77-79 BROAD STREET');
});

test('NJ official parcel evidence enriches the researched property instead of creating a duplicate property', () => {
  const graph = createResearchGraph();
  upsertEntity(graph, { id:'property:portfolio', kind:'property', label:'123 Main St, Newark, NJ 07102', geography:'NJ' });
  ingestNjParcel(graph, {
    pamsPin:'0714_123_4',
    propertyLocation:'123 MAIN ST',
    ownerName:'ACME HOLDINGS LLC',
    dwellingUnits:84,
  }, undefined, '2026-09-22T19:00:00Z', 'property:portfolio');

  assert.equal(graph.entities.filter((entity) => entity.kind === 'property').length, 1);
  assert.ok(graph.claims.some((claim) => claim.subjectId === 'property:portfolio' && claim.fact === 'property.owner' && claim.objectEntityId));
  assert.ok(graph.claims.some((claim) => claim.subjectId === 'property:portfolio' && claim.fact === 'property.units' && claim.value === 84));
  assert.ok(graph.entities.find((entity) => entity.id === 'property:portfolio')?.aliases?.includes('NJ PAMS 0714_123_4'));
});

test('official unit-count conflicts block false precision in cost estimation', () => {
  const graph = createResearchGraph();
  upsertEntity(graph, { id:'property:conflict', kind:'property', label:'123 Main St', geography:'NJ' });
  addClaim(graph, { id:'u1', subjectId:'property:conflict', fact:'property.units', value:100, state:'SUPPORTED', confidence:.85, evidenceIds:[], observedAt:'2026-09-22T19:00:00Z' });
  const second = addClaim(graph, { id:'u2', subjectId:'property:conflict', fact:'property.units', value:84, state:'VERIFIED', confidence:.95, evidenceIds:[], observedAt:'2026-09-22T19:01:00Z' });
  assert.equal(second.state, 'CONFLICTED');
  assert.equal(graph.claims.find((claim) => claim.id === 'u1')?.state, 'CONFLICTED');
});

test('ACRIS latest deed grantees attach to the existing NYC property with BBL provenance', () => {
  const graph = createResearchGraph();
  upsertEntity(graph, { id:'property:nyc', kind:'property', label:'10 Example Ave, Brooklyn, NY 11201', geography:'NY' });
  const result: AcrisOwnershipResult = {
    bbl: { borough:'3', block:'123', lot:'45' },
    propertyAddress:'10 EXAMPLE AVENUE',
    deed: { documentId:'2026090100001001', documentType:'DEED', recordedAt:'2026-09-01T12:00:00.000', crfn:'2026000000001' },
    grantees:[
      { name:'EXAMPLE OWNER LLC', partyType:'2', address:'1 OFFICE WAY', city:'BROOKLYN', state:'NY', zip:'11201' }
    ],
    sourceUrls:[
      'https://data.cityofnewyork.us/resource/8h5j-fqxa.json',
      'https://data.cityofnewyork.us/resource/bnx9-e6tj.json',
      'https://data.cityofnewyork.us/resource/636b-3b5g.json'
    ]
  };
  ingestAcrisOwnership(graph, 'property:nyc', result, '2026-09-22T19:00:00Z');

  assert.equal(graph.entities.filter((entity) => entity.kind === 'property').length, 1);
  assert.ok(graph.entities.find((entity) => entity.id === 'property:nyc')?.aliases?.some((value) => /BBL 3-123-45/i.test(value)));
  assert.ok(graph.claims.some((claim) => claim.subjectId === 'property:nyc' && claim.fact === 'property.owner' && claim.state === 'VERIFIED'));
});

test('fixed water charge parser accepts a single unconditional monthly charge and rejects meter-size tables', () => {
  assert.equal(parseFixedWaterCharge('Monthly water service charge: $18.50 per month')?.monthlyDollars, 18.5);
  assert.equal(parseFixedWaterCharge('5/8 inch meter $18.50 per month; 1 inch meter $42.00 per month'), undefined);
});

test('water benchmark includes a unique published monthly water service charge without adding sewer or tax', () => {
  const graph = createResearchGraph();
  upsertEntity(graph, { id:'property:one', kind:'property', label:'123 Main St, Newark, NJ 07102', geography:'NJ' });
  upsertEntity(graph, { id:'utility:one', kind:'utility', label:'Example Water', geography:'NJ' });
  addEvidence(graph, { id:'property:evidence', sourceId:'company-first-party-web', url:'https://example.com/property', observedAt:'2026-09-22T19:00:00Z', authority:'first-party', confidence:.9 });
  addEvidence(graph, { id:'rate:evidence', sourceId:'utility-first-party-web', url:'https://water.example/rates', observedAt:'2026-09-22T19:00:00Z', authority:'first-party', confidence:.9 });
  addClaim(graph, { id:'units', subjectId:'property:one', fact:'property.units', value:100, state:'SUPPORTED', confidence:.9, evidenceIds:['property:evidence'], observedAt:'2026-09-22T19:00:00Z' });
  addClaim(graph, { id:'provider', subjectId:'property:one', fact:'utility.provider', objectEntityId:'utility:one', state:'SUPPORTED', confidence:.9, evidenceIds:['rate:evidence'], observedAt:'2026-09-22T19:00:00Z' });
  addClaim(graph, { id:'rate', subjectId:'utility:one', fact:'utility.rateSchedule', value:'Water usage charge $8.42 per 1,000 gallons. Monthly water service charge: $18.50 per month.', state:'SUPPORTED', confidence:.9, evidenceIds:['rate:evidence'], observedAt:'2026-09-22T19:00:00Z' });

  const estimate = estimatePropertyWaterCost(graph, 'property:one');
  assert.ok(estimate);
  assert.equal(estimate?.includesFixedCharges, true);
  assert.equal(estimate?.monthlyFixedWaterCharge, 18.5);
  assert.equal(estimate?.annualFixedWaterCharge, 222);
  assert.equal(estimate?.annualEstimatedWaterCost, (estimate?.annualVariableCost ?? 0) + 222);
  assert.match(estimate?.methodology ?? '', /sewer.*tax.*excluded/i);
});


test('HPD official contacts enrich the existing NYC property after a BBL is resolved', () => {
  const graph = createResearchGraph();
  upsertEntity(graph, { id:'property:hpd-target', kind:'property', label:'10 Example Ave, Brooklyn, NY 11201', geography:'NY', aliases:['BBL 3-123-45'] });
  ingestHpdOwnership(graph, {
    registration:{ registrationId:'100', boroughId:'3', block:'123', lot:'45' },
    contacts:[
      { registrationId:'100', type:'CorporateOwner', corporationName:'EXAMPLE OWNER LLC' },
      { registrationId:'100', type:'Agent', corporationName:'EXAMPLE MANAGEMENT LLC' }
    ],
    sourceUrls:['https://data.cityofnewyork.us/resource/tesw-yqqr.json','https://data.cityofnewyork.us/resource/feu5-w2e2.json']
  }, '10 Example Ave, Brooklyn, NY 11201', '2026-09-22T19:00:00Z', 'property:hpd-target');

  assert.equal(graph.entities.filter((entity) => entity.kind === 'property').length, 1);
  assert.ok(graph.claims.some((claim) => claim.subjectId === 'property:hpd-target' && claim.fact === 'property.owner'));
  assert.ok(graph.claims.some((claim) => claim.subjectId === 'property:hpd-target' && claim.fact === 'property.manager'));
});


test('sitemap parser prioritizes first-party team and property detail pages only', () => {
  const xml = `
    <urlset>
      <url><loc>https://samplepm.com/</loc></url>
      <url><loc>https://samplepm.com/properties/maple-court</loc></url>
      <url><loc>https://samplepm.com/team/jane-smith</loc></url>
      <url><loc>https://samplepm.com/blog/market-update</loc></url>
      <url><loc>https://other.example/properties/not-ours</loc></url>
    </urlset>
  `;
  const urls = extractLikelySitemapUrls(xml, 'https://samplepm.com');
  assert.deepEqual(urls.sort(), [
    'https://samplepm.com/properties/maple-court',
    'https://samplepm.com/team/jane-smith',
  ]);
});

test('distinct first-party property addresses create only a conservative portfolio lower bound', () => {
  const graph = createResearchGraph();
  upsertEntity(graph, { id:'company:portfolio', kind:'company', label:'Portfolio Owner', geography:'NJ' });
  ingestCompanyWebsite(graph, 'company:portfolio', {
    seedUrl:'https://portfolio.example/',
    visitedUrls:['https://portfolio.example/properties'],
    contacts:[],
    leadershipSignals:[],
    propertySignals:[
      { address:'1 Main St, Newark, NJ 07102', state:'NJ', sourceUrl:'https://portfolio.example/properties' },
      { address:'2 Main St, Newark, NJ 07102', state:'NJ', sourceUrl:'https://portfolio.example/properties' },
      { address:'3 Main St, Newark, NJ 07102', state:'NJ', sourceUrl:'https://portfolio.example/properties' },
    ],
    portfolioSignals:[],
    ownerOperatorSignals:[],
    socialUrls:[],
    warnings:[],
  }, '2026-09-22T19:00:00Z');

  assert.equal(graph.claims.some((claim) => claim.subjectId === 'company:portfolio' && claim.fact === 'company.portfolio'), false);
  assert.ok(graph.claims.some((claim) =>
    claim.subjectId === 'company:portfolio' &&
    claim.fact === 'company.portfolioLowerBound' &&
    claim.value === 3 &&
    claim.qualifier === 'at-least'
  ));
});


test('ACRIS deed-code handling uses documented grantee/buyer conveyance codes only', () => {
  const source = require('node:fs').readFileSync(new URL('../lib/research/sources/nyc-acris.ts', import.meta.url), 'utf8');
  assert.match(source, /DEED, TS/);
  assert.match(source, /IDED/);
  assert.doesNotMatch(source, /CONDEED/);
  assert.doesNotMatch(source, /REIT/);
});

test('network crawlers do not automatically follow unchecked redirects', () => {
  const fs = require('node:fs') as typeof import('node:fs');
  const companySource = fs.readFileSync(new URL('../lib/research/sources/company-website.ts', import.meta.url), 'utf8');
  const personSource = fs.readFileSync(new URL('../lib/research/sources/person-company.ts', import.meta.url), 'utf8');
  assert.doesNotMatch(companySource, /redirect:\s*['"]follow['"]/);
  assert.doesNotMatch(personSource, /redirect:\s*['"]follow['"]/);
  assert.match(companySource, /assertPublicNetworkTarget\(current\)/);
  assert.match(personSource, /assertPublicNetworkTarget\(current\)/);
});
