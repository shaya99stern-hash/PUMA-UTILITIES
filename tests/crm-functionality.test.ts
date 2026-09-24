import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import test from 'node:test';
import {
  addBuilding,
  addCompany,
  addContact,
  editActivityNote,
  logCompanyCall,
  updateBuilding,
  updateCompanyRecord,
  updateContact,
} from '../lib/crm-operations';
import { emptyWorkspace } from '../lib/workspace';

const NOW = '2026-09-23T20:00:00.000Z';

test('CRM operations create and edit a company without inventing evidence', () => {
  const created = addCompany(emptyWorkspace(), {
    name: 'Northstar Management',
    market: 'NY',
    website: 'https://northstar.example',
    nextAction: 'Call Friday',
  }, NOW);

  assert.equal(created.companies.length, 1);
  const company = created.companies[0];
  assert.equal(company?.name, 'Northstar Management');
  assert.equal(company?.stage, 'Target');
  assert.equal(company?.market, 'NY');
  assert.equal(company?.headquarters.status, 'unknown');
  assert.equal(company?.portfolioBuildings.status, 'unknown');

  const withPublishedContact = {
    ...created,
    companies: created.companies.map((item) => item.id === company!.id
      ? { ...item, publicEmail: 'published@northstar.example', publicPhone: '212-555-0111' }
      : item),
  };
  const edited = updateCompanyRecord(withPublishedContact, company!.id, { name: 'Northstar Residential', market: 'NJ', nextAction: 'Email COO' }, NOW);
  const updated = edited.companies[0];
  assert.equal(updated?.name, 'Northstar Residential');
  assert.equal(updated?.market, 'NJ');
  assert.equal(updated?.nextAction, 'Email COO');
  assert.equal(updated?.publicEmail, 'published@northstar.example');
  assert.equal(updated?.publicPhone, '212-555-0111');
});

test('CRM operations create and edit contacts as user-entered rather than verified-public', () => {
  const seeded = addCompany(emptyWorkspace(), { name: 'Northstar Management' }, NOW);
  const companyId = seeded.companies[0]!.id;
  const withContact = addContact(seeded, companyId, {
    name: 'Alex Morgan',
    role: 'COO',
    email: 'alex@northstar.example',
    phone: '212-555-0199',
  }, NOW);

  const contact = withContact.companies[0]!.people[0]!;
  assert.equal(contact.status, 'user-entered');

  const verified = {
    ...withContact,
    companies: withContact.companies.map((company) => company.id === companyId
      ? { ...company, people: company.people.map((person) => ({ ...person, status: 'verified-public' as const, provenanceId: 'published-source' })) }
      : company),
  };
  const edited = updateContact(verified, companyId, contact.id, { role: 'Chief Operating Officer' }, NOW);
  assert.equal(edited.companies[0]!.people[0]!.role, 'Chief Operating Officer');
  assert.equal(edited.companies[0]!.people[0]!.status, 'user-entered');
  assert.equal(edited.companies[0]!.people[0]!.provenanceId, undefined);
});

test('CRM operations create and edit user-entered buildings without claiming public verification', () => {
  const seeded = addCompany(emptyWorkspace(), { name: 'Northstar Management' }, NOW);
  const companyId = seeded.companies[0]!.id;
  const withBuilding = addBuilding(seeded, companyId, {
    name: 'Harbor Apartments',
    address: '10 Harbor Way, Brooklyn, NY',
    state: 'NY',
    units: 84,
  }, NOW);

  const property = withBuilding.properties[0]!;
  assert.equal(property.address.status, 'user-entered');
  assert.equal(property.units?.status, 'user-entered');
  assert.equal(property.units?.value, 84);

  const edited = updateBuilding(withBuilding, companyId, property.id, { name: 'Harbor House', units: 90 }, NOW);
  assert.equal(edited.properties[0]!.name, 'Harbor House');
  assert.equal(edited.properties[0]!.units?.value, 90);
  assert.equal(edited.properties[0]!.units?.status, 'user-entered');
});

test('logging a call updates last contact, advances an untouched prospect, and records activity', () => {
  const seeded = addCompany(emptyWorkspace(), { name: 'Northstar Management' }, NOW);
  const companyId = seeded.companies[0]!.id;
  const logged = logCompanyCall(seeded, companyId, '2026-09-23T21:00:00.000Z');
  const company = logged.companies[0]!;

  assert.equal(company.lastContactAt, '2026-09-23T21:00:00.000Z');
  assert.equal(company.stage, 'Outreach');
  assert.equal(company.activityNotes?.at(-1)?.text, 'Call logged');
});

test('activity notes can be edited in place', () => {
  const seeded = addCompany(emptyWorkspace(), { name: 'Northstar Management' }, NOW);
  const companyId = seeded.companies[0]!.id;
  const logged = logCompanyCall(seeded, companyId, '2026-09-23T21:00:00.000Z');
  const noteId = logged.companies[0]!.activityNotes![0]!.id;
  const edited = editActivityNote(logged, companyId, noteId, 'Spoke with operations; follow up Friday.', NOW);

  assert.equal(edited.companies[0]!.activityNotes![0]!.text, 'Spoke with operations; follow up Friday.');
});

test('current CRM UI exposes actionable creation, editing, call logging, contact-aware search, and due follow-ups', () => {
  const workspace = readFileSync('app/components/puma-crm-workspace.tsx', 'utf8');
  const home = readFileSync('app/components/puma-home-screen.tsx', 'utf8');

  assert.match(workspace, /Add company/);
  assert.match(workspace, /href="\/engine"/);
  assert.match(workspace, /Edit company/);
  assert.match(workspace, /Add contact/);
  assert.match(workspace, /Edit contact/);
  assert.match(workspace, /Add building/);
  assert.match(workspace, /Edit building/);
  assert.match(workspace, /Log call/);
  assert.match(workspace, /Edit note/);
  assert.match(workspace, /company\.people\.some/);
  assert.match(workspace, /companyMode === 'followups'/);
  assert.doesNotMatch(workspace, /Public email/);
  assert.doesNotMatch(workspace, /Public phone/);
  assert.match(home, /href="\/clients\/follow-ups"/);
  assert.equal(existsSync('app/clients/follow-ups/page.tsx'), true);
});
