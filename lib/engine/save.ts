/**
 * Moves research into the CRM: a lead becomes a company with its contacts (decision makers
 * first), buildings (each with utility, meter program, monthly water estimate, payment signals
 * and its own pipeline status) and evidence for every fact. Existing CRM data is never
 * overwritten with weaker information — research only fills blanks and adds rows.
 */
import 'server-only';
import { logActivity } from '@/lib/crm/activity';
import { sql, type Tx } from '@/lib/server/db';
import { companyNameKey, normalizeDomain } from '@/lib/text';
import { addAddress, addAlias, addDomain, addPerson, emptyDossier, portfolioStats, primaryDomain, rankPeople, type Dossier } from './dossier';
import { meterProgramFor } from './utility-intel';
import { splitName } from './text';

function bestEmail(d: Dossier): string | null {
  const company = d.emails.find((e) => e.status === 'published' && /^(info|contact|office|management|leasing|hello)@/.test(e.email));
  return company?.email ?? null;
}

function hqAddress(d: Dossier) {
  const pref = ['website', 'hq', 'business', 'mailing', 'process'] as const;
  for (const kind of pref) {
    const a = d.addresses.filter((x) => x.kind === kind).sort((x, y) => y.count - x.count)[0];
    if (a) return a.text;
  }
  return null;
}

function parseCityStateZip(address: string | null) {
  if (!address) return { city: null, state: null, zip: null };
  const m = address.match(/,\s*([A-Za-z .'-]+?)\s*,?\s+([A-Z]{2})\s+(\d{5})/);
  return m ? { city: m[1].trim(), state: m[2], zip: m[3] } : { city: null, state: null, zip: null };
}

type SaveResult = { companyId: string; created: boolean; contacts: number; properties: number };

/** Writes a dossier into the CRM (new company or merge into an existing one). */
export async function saveDossier(workspaceId: string, userId: string | null, d: Dossier, opts: { companyId?: string; jobId?: string } = {}): Promise<SaveResult> {
  return sql().begin(async (tx) => {
    const t = tx as unknown as Tx;
    const st = portfolioStats(d);
    const domain = primaryDomain(d);
    const hq = hqAddress(d);
    const loc = parseCityStateZip(hq);
    const nameKey = companyNameKey(d.name);
    let companyId = opts.companyId ?? null;
    let created = false;

    if (!companyId) {
      const existing = await t<{ id: string }[]>`
        select id from companies where workspace_id = ${workspaceId}
          and (name_key = ${nameKey} or (${domain}::text is not null and domain = ${domain}))
        limit 1`;
      companyId = existing[0]?.id ?? null;
    }

    const units = Math.max(st.units, st.claimedUnits ?? 0) || null;
    const buildings = Math.max(st.buildings, st.claimedBuildings ?? 0) || null;
    const research = {
      jobId: opts.jobId ?? null,
      trail: d.trail.slice(-40),
      gaps: d.gaps,
      why: d.why,
      sources: d.sources,
      water: d.water,
      signals: d.signals,
      managers: d.managers.slice(0, 10),
      aliases: d.aliases.slice(0, 20),
      facts: d.facts.slice(-120),
      nameConfidence: d.nameConfidence,
      researchedAt: new Date().toISOString(),
    };
    const phone = d.phones[0]?.phone ?? null;
    if (!companyId) {
      const rows = await t<{ id: string }[]>`
        insert into companies (workspace_id, name, name_key, domain, website, phone, email, address, city, state, zip, company_type, stage,
          score, score_breakdown, score_confidence, portfolio_buildings, portfolio_units, portfolio_basis, est_annual_water_spend,
          linkedin_url, source, source_ref, research, research_status, researched_at, links, created_by)
        values (${workspaceId}, ${d.name}, ${nameKey}, ${domain}, ${d.website}, ${phone}, ${bestEmail(d)}, ${hq}, ${loc.city ?? d.buildings[0]?.city ?? null},
          ${loc.state ?? st.states[0] ?? null}, ${loc.zip}, ${d.type}, 'new', ${d.score}, ${t.json(d.scoreFactors as never)}, ${d.scoreConfidence},
          ${buildings}, ${units}, ${'Public records cross-referenced by Puma research'}, ${d.water.estAnnualSpend}, ${d.linkedin}, 'engine',
          ${t.json({ key: d.key, jobId: opts.jobId ?? null } as never)}, ${t.json(research as never)}, 'done', now(), ${t.json(d.links as never)}, ${userId})
        on conflict (workspace_id, name_key) do update set updated_at = now()
        returning id`;
      companyId = rows[0].id;
      created = true;
    } else {
      await t`
        update companies set
          domain = coalesce(domain, ${domain}),
          website = coalesce(website, ${d.website}),
          phone = coalesce(phone, ${phone}),
          email = coalesce(email, ${bestEmail(d)}),
          address = coalesce(address, ${hq}),
          city = coalesce(city, ${loc.city}),
          state = coalesce(state, ${loc.state ?? st.states[0] ?? null}),
          zip = coalesce(zip, ${loc.zip}),
          company_type = case when company_type = 'unknown' then ${d.type} else company_type end,
          score = ${d.score},
          score_breakdown = ${t.json(d.scoreFactors as never)},
          score_confidence = ${d.scoreConfidence},
          portfolio_buildings = greatest(coalesce(portfolio_buildings, 0), ${buildings ?? 0}),
          portfolio_units = greatest(coalesce(portfolio_units, 0), ${units ?? 0}),
          est_annual_water_spend = coalesce(${d.water.estAnnualSpend}, est_annual_water_spend),
          linkedin_url = coalesce(linkedin_url, ${d.linkedin}),
          research = ${t.json(research as never)},
          research_status = 'done',
          researched_at = now(),
          links = links || ${t.json(d.links as never)}
        where id = ${companyId} and workspace_id = ${workspaceId}`;
    }

    // Contacts: decision makers first; never duplicate by email or by name within the company.
    let contacts = 0;
    for (const p of rankPeople(d.people).slice(0, 25)) {
      const email = p.emails.find((e) => e.status === 'published') ?? p.emails[0] ?? null;
      const { first, last } = splitName(p.name);
      const existing = await t<{ id: string }[]>`
        select id from contacts where workspace_id = ${workspaceId}
          and ((${email?.email ?? null}::text is not null and email = ${email?.email ?? null}) or (company_id = ${companyId} and lower(full_name) = lower(${p.name})))
        limit 1`;
      const sourceRef = { sources: p.src, org: p.org, address: p.address, buildings: p.buildings, allEmails: p.emails.map((e) => ({ email: e.email, status: e.status, confidence: e.confidence })) };
      if (existing[0]) {
        await t`
          update contacts set
            title = coalesce(title, ${p.title}),
            email = coalesce(email, ${email?.email ?? null}),
            email_status = case when email is null and ${email ? (email.status === 'published' ? 'published' : 'inferred') : null}::text is not null then ${email ? (email.status === 'published' ? 'published' : 'inferred') : 'unknown'} else email_status end,
            phone = coalesce(phone, ${p.phones[0]?.phone ?? null}),
            linkedin_url = coalesce(linkedin_url, ${p.linkedin}),
            is_decision_maker = is_decision_maker or ${p.decisionMaker},
            company_id = coalesce(company_id, ${companyId})
          where id = ${existing[0].id}`;
        continue;
      }
      await t`
        insert into contacts (workspace_id, company_id, first_name, last_name, full_name, title, role_category, is_decision_maker, email, email_status,
          phone, linkedin_url, address, source, source_ref, confidence, created_by)
        values (${workspaceId}, ${companyId}, ${first}, ${last}, ${p.name}, ${p.title}, ${p.role}, ${p.decisionMaker}, ${email?.email ?? null},
          ${email ? (email.status === 'published' ? 'published' : 'inferred') : 'unknown'}, ${p.phones[0]?.phone ?? null}, ${p.linkedin}, ${p.address},
          'engine', ${t.json(sourceRef as never)}, ${email?.confidence ?? null}, ${userId})
        on conflict do nothing`;
      contacts += 1;
    }

    // Buildings with utility, meter program, monthly estimate and signals.
    let properties = 0;
    const byUnits = [...d.buildings].sort((a, b) => (b.units ?? 0) - (a.units ?? 0)).slice(0, 300);
    for (const b of byUnits) {
      const program = b.utilityName ? meterProgramFor(b.utilityName, b.utilityPwsid) : null;
      const signals = d.signals.filter((s) => s.building === b.key);
      const monthly = b.estAnnualWaterCost ? Math.round(b.estAnnualWaterCost / 12) : null;
      const res = await t<{ id: string }[]>`
        insert into properties (workspace_id, company_id, source_key, name, address, city, state, zip, county, lat, lon, units, year_built, stories,
          building_class, parcel_id, bbl, owner_name_on_record, owner_mailing_address, manager_name, utility_name, utility_pwsid, meter_status,
          meter_program, est_annual_water_gallons, est_annual_water_cost, est_monthly_water_cost, reported_water_kgal, reported_water_year, signals,
          source, source_ref)
        values (${workspaceId}, ${companyId}, ${b.key}, ${b.name}, ${b.address}, ${b.city}, ${b.state}, ${b.zip}, ${b.county}, ${b.lat}, ${b.lon},
          ${b.units}, ${b.yearBuilt}, ${b.stories}, ${b.buildingClass}, ${b.parcelId}, ${b.bbl}, ${b.ownerName}, ${b.mailingAddress}, ${b.managerName},
          ${b.utilityName}, ${b.utilityPwsid}, ${program?.status === 'ami' || program?.status === 'amr' ? 'smart' : program?.status === 'ami_rollout' ? 'ami_available' : 'unknown'},
          ${program?.label ?? null}, ${b.units ? b.units * 43_600 : null}, ${b.estAnnualWaterCost}, ${monthly}, ${b.reportedWaterKgal}, ${b.reportedWaterYear},
          ${t.json(signals as never)}, 'engine', ${t.json({ sources: b.src, altKeys: b.altKeys, unitsEstimated: b.unitsEstimated } as never)})
        on conflict (workspace_id, source_key) where source_key is not null do update set
          company_id = coalesce(properties.company_id, excluded.company_id),
          units = coalesce(properties.units, excluded.units),
          utility_name = coalesce(properties.utility_name, excluded.utility_name),
          utility_pwsid = coalesce(properties.utility_pwsid, excluded.utility_pwsid),
          meter_program = coalesce(properties.meter_program, excluded.meter_program),
          est_annual_water_cost = coalesce(excluded.est_annual_water_cost, properties.est_annual_water_cost),
          est_monthly_water_cost = coalesce(excluded.est_monthly_water_cost, properties.est_monthly_water_cost),
          reported_water_kgal = coalesce(excluded.reported_water_kgal, properties.reported_water_kgal),
          signals = excluded.signals,
          lat = coalesce(properties.lat, excluded.lat),
          lon = coalesce(properties.lon, excluded.lon)
        returning (xmax = 0) as inserted, id`;
      if (res[0]) properties += 1;
    }

    // Evidence (latest facts + where each key field came from).
    const facts = [
      ...d.facts.slice(-150).map((f) => ({ field: f.field, value: f.value, source_id: f.src, source_name: d.sources[f.src]?.name ?? f.src, source_url: f.url ?? null, method: f.method, confidence: f.confidence })),
      ...Object.entries(d.sources).map(([id, s]) => ({ field: 'source', value: `${s.hits} record(s)`, source_id: id, source_name: s.name, source_url: s.url ?? null, method: 'api' as const, confidence: 0.9 })),
    ];
    if (facts.length) {
      await t`delete from evidence where workspace_id = ${workspaceId} and entity_type = 'company' and entity_id = ${companyId} and method <> 'user'`;
      await t`insert into evidence ${t(facts.map((f) => ({ ...f, workspace_id: workspaceId, entity_type: 'company', entity_id: companyId! })))}`;
    }

    await logActivity({
      db: t,
      workspaceId,
      companyId,
      type: 'research',
      subject: created ? 'Added from Puma research' : 'Research refreshed',
      body: [...d.why.slice(0, 4), ...d.trail.slice(-6)].join('\n'),
      meta: { jobId: opts.jobId ?? null, score: d.score, contacts, properties, sources: Object.keys(d.sources) },
      userId,
    });
    return { companyId: companyId!, created, contacts, properties };
  });
}

/** Saves a lead candidate and links it to the new/merged company. */
export async function saveCandidate(workspaceId: string, userId: string | null, candidateId: string) {
  const rows = await sql()<{ id: string; job_id: string; summary: Dossier; company_id: string | null }[]>`
    select id, job_id, summary, company_id from lead_candidates where id = ${candidateId} and workspace_id = ${workspaceId}`;
  const c = rows[0];
  if (!c) throw new Error('Lead not found');
  const result = await saveDossier(workspaceId, userId, c.summary, { companyId: c.company_id ?? undefined, jobId: c.job_id });
  await sql()`update lead_candidates set status = 'saved', company_id = ${result.companyId} where id = ${candidateId}`;
  return result;
}

/** Builds a starting dossier from a CRM company (for "Research with engine"). */
export async function dossierFromCompany(workspaceId: string, companyId: string): Promise<Dossier> {
  const db = sql();
  const [company] = await db<{ name: string; domain: string | null; website: string | null; phone: string | null; email: string | null; address: string | null; links: Record<string, string> | null; linkedin_url: string | null }[]>`
    select name, domain, website, phone, email, address, links, linkedin_url from companies where id = ${companyId} and workspace_id = ${workspaceId}`;
  if (!company) throw new Error('Company not found');
  const d = emptyDossier(`company:${companyId}`, company.name);
  addAlias(d, company.name, 'website', 'crm');
  d.nameKind = 'website';
  d.nameConfidence = 0.95;
  d.sources.crm = { name: 'Your CRM', hits: 1 };
  const dom = normalizeDomain(company.domain ?? company.website ?? company.email);
  if (dom) addDomain(d, dom, 'crm', Boolean(company.website || company.domain));
  if (company.website) d.website = company.website;
  if (company.phone) d.phones.push({ phone: company.phone, label: 'main office', src: ['crm'] });
  if (company.address) addAddress(d, company.address, 'hq', 'crm');
  if (company.linkedin_url) d.linkedin = company.linkedin_url;
  d.links = { ...(company.links ?? {}) };
  const contacts = await db<{ full_name: string; title: string | null; email: string | null; email_status: string; phone: string | null; is_decision_maker: boolean; role_category: string }[]>`
    select full_name, title, email, email_status, phone, is_decision_maker, role_category from contacts where company_id = ${companyId} and workspace_id = ${workspaceId}`;
  for (const c of contacts) {
    addPerson(d, { name: c.full_name, title: c.title, role: c.role_category as never, decisionMaker: c.is_decision_maker, email: c.email, emailStatus: c.email_status === 'inferred' ? 'inferred' : 'published', phone: c.phone }, 'crm');
  }
  const props = await db<{ source_key: string | null; id: string; address: string; city: string | null; state: string | null; zip: string | null; county: string | null; lat: number | null; lon: number | null; units: number | null; year_built: number | null; bbl: string | null; parcel_id: string | null; utility_name: string | null; utility_pwsid: string | null; owner_mailing_address: string | null }[]>`
    select * from properties where company_id = ${companyId} and workspace_id = ${workspaceId} limit 400`;
  for (const p of props) {
    d.buildings.push({
      key: p.source_key ?? `crm:${p.id}`, altKeys: p.bbl ? [`bbl:${p.bbl}`] : [], name: null, address: p.address, city: p.city, state: p.state ?? 'NY', zip: p.zip,
      county: p.county, lat: p.lat, lon: p.lon, units: p.units, unitsEstimated: false, yearBuilt: p.year_built, stories: null, buildingClass: null, bbl: p.bbl,
      parcelId: p.parcel_id, ownerName: null, mailingAddress: p.owner_mailing_address, managerName: null, utilityName: p.utility_name, utilityPwsid: p.utility_pwsid,
      reportedWaterKgal: null, reportedWaterYear: null, estAnnualWaterCost: null, src: ['crm'],
    });
    if (p.owner_mailing_address) addAddress(d, p.owner_mailing_address, 'mailing', 'crm');
  }
  d.trail.push(`Started from your CRM record: ${contacts.length} contact(s), ${props.length} building(s).`);
  return d;
}

export async function applyDossierToCompany(workspaceId: string, companyId: string, d: Dossier, jobId: string): Promise<string> {
  // The CRM name stays as the user wrote it.
  const [company] = await sql()<{ name: string }[]>`select name from companies where id = ${companyId}`;
  if (company) d.name = company.name;
  const r = await saveDossier(workspaceId, null, d, { companyId, jobId });
  return `${r.contacts} new contact(s), ${r.properties} building(s) updated, score ${d.score ?? '—'}`;
}
