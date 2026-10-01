/**
 * HUD Multifamily Properties (Assisted + FHA Insured) on HUD's ArcGIS org. Nationwide.
 * Each property lists its management agent organization with a named contact, title, phone and email.
 */
import { cleanPhone, displayOrgName, displayPersonName, isDecisionMakerTitle, isGenericName, mailingKey, normalizeEmail, roleCategoryFor, streetKey, titleCase, toInt, toNumber, trimOrNull, zip5 } from '../text';
import type { PropertyRecord, SourceInfo } from '../types';
import { arcgisQuery, provenance, sqlLit, type FetchCtx } from './common';

export const hudAssisted: SourceInfo = {
  id: 'hud-mf-assisted',
  name: 'HUD Multifamily Assisted Properties',
  kind: 'discovery',
  coverage: ['US'],
  coverageLabel: 'Nationwide',
  capabilities: ['buildings', 'units', 'management_agent', 'contact_name', 'contact_email', 'contact_phone', 'coordinates'],
  description: 'Section 8 / assisted multifamily properties with total units and the management agent contact (name, title, phone, email).',
  homepage: 'https://hudgis-hud.opendata.arcgis.com/datasets/multifamily-properties-assisted',
  verified: 'live',
};

export const hudInsured: SourceInfo = {
  id: 'hud-mf-insured',
  name: 'HUD FHA-Insured Multifamily Properties',
  kind: 'discovery',
  coverage: ['US'],
  coverageLabel: 'Nationwide',
  capabilities: ['buildings', 'units', 'management_agent', 'contact_name', 'contact_email', 'contact_phone', 'coordinates'],
  description: 'Multifamily properties with FHA-insured mortgages, with unit counts and management agent contacts.',
  homepage: 'https://hudgis-hud.opendata.arcgis.com/datasets/hud-insured-multifamily-properties',
  verified: 'live',
};

export const HUD_LAYERS: Record<string, string> = {
  'hud-mf-assisted': 'https://services.arcgis.com/VTyQ9soqVukalItT/arcgis/rest/services/MULTIFAMILY_PROPERTIES_ASSISTED/FeatureServer/0',
  'hud-mf-insured': 'https://services.arcgis.com/VTyQ9soqVukalItT/arcgis/rest/services/HUD_Insured_Multifamily_Properties/FeatureServer/0',
};

const FIELDS = 'PROPERTY_ID,PROPERTY_NAME_TEXT,STD_ADDR,STD_CITY,STD_ST,STD_ZIP5,CURCNTY_NM,TOTAL_UNIT_COUNT,PROPERTY_ON_SITE_PHONE_NUMBER,PROPERTY_CATEGORY_NAME,CLIENT_GROUP_NAME,MGMT_AGENT_ORG_NAME,MGMT_CONTACT_FULL_NAME,MGMT_CONTACT_INDV_TITLE_TEXT,MGMT_CONTACT_MAIN_PHN_NBR,MGMT_CONTACT_EMAIL_TEXT,MGMT_CONTACT_ADDRESS_LINE1,MGMT_CONTACT_ADDRESS_LINE2,MGMT_CONTACT_CITY_NAME,MGMT_CONTACT_STATE_CODE,MGMT_CONTACT_ZIP_CODE,LAT,LON';

export type HudQuery = { states: string[]; counties?: string[]; cities?: string[]; zips?: string[]; minUnits: number; orgLike?: string[]; mgmtStreetLike?: string };

export function hudWhere(q: HudQuery): string {
  const parts = [`TOTAL_UNIT_COUNT >= ${Math.max(1, Math.floor(q.minUnits))}`];
  if (q.states.length) parts.push(`STD_ST IN (${q.states.map((s) => sqlLit(s.toUpperCase())).join(',')})`);
  if (q.counties?.length) parts.push(`(${q.counties.map((c) => `UPPER(CURCNTY_NM) LIKE ${sqlLit(`${c.toUpperCase().replace(/\s+COUNTY$/, '')}%`)}`).join(' OR ')})`);
  if (q.cities?.length) parts.push(`(${q.cities.map((c) => `UPPER(STD_CITY) LIKE ${sqlLit(`${c.toUpperCase()}%`)}`).join(' OR ')})`);
  if (q.zips?.length) parts.push(`STD_ZIP5 IN (${q.zips.map(sqlLit).join(',')})`);
  if (q.orgLike?.length) parts.push(`(${q.orgLike.map((k) => `UPPER(MGMT_AGENT_ORG_NAME) LIKE ${sqlLit(`%${k.toUpperCase()}%`)}`).join(' OR ')})`);
  if (q.mgmtStreetLike) parts.push(`UPPER(MGMT_CONTACT_ADDRESS_LINE1) LIKE ${sqlLit(`${q.mgmtStreetLike.toUpperCase()}%`)}`);
  return parts.join(' AND ');
}

export function parseHudFeatures(sourceId: 'hud-mf-assisted' | 'hud-mf-insured', features: { attributes: Record<string, unknown> }[], url: string): PropertyRecord[] {
  const info = sourceId === 'hud-mf-assisted' ? hudAssisted : hudInsured;
  const prov = provenance(info, url);
  return features.flatMap(({ attributes: a }) => {
    const id = trimOrNull(a.PROPERTY_ID);
    const address = trimOrNull(a.STD_ADDR);
    const state = trimOrNull(a.STD_ST);
    if (!id || !address || !state) return [];
    const org = trimOrNull(a.MGMT_AGENT_ORG_NAME);
    const person = trimOrNull(a.MGMT_CONTACT_FULL_NAME);
    const title = trimOrNull(a.MGMT_CONTACT_INDV_TITLE_TEXT);
    const mStreet = [trimOrNull(a.MGMT_CONTACT_ADDRESS_LINE1), trimOrNull(a.MGMT_CONTACT_ADDRESS_LINE2)].filter(Boolean).join(' ');
    const mCity = trimOrNull(a.MGMT_CONTACT_CITY_NAME);
    const mState = trimOrNull(a.MGMT_CONTACT_STATE_CODE);
    const mZip = zip5(trimOrNull(a.MGMT_CONTACT_ZIP_CODE));
    const mgmtAddress = mStreet ? `${mStreet}, ${mCity ?? ''} ${mState ?? ''} ${mZip ?? ''}`.replace(/\s+/g, ' ').trim() : null;
    const zip = zip5(trimOrNull(a.STD_ZIP5));
    const email = normalizeEmail(trimOrNull(a.MGMT_CONTACT_EMAIL_TEXT));
    const phone = cleanPhone(trimOrNull(a.MGMT_CONTACT_MAIN_PHN_NBR));
    return [{
      sourceKey: `hud:${id}`,
      altKeys: zip ? [`addr:${streetKey(address)}|${zip}`] : [],
      name: trimOrNull(a.PROPERTY_NAME_TEXT) ? titleCase(String(a.PROPERTY_NAME_TEXT)) : null,
      address: titleCase(address),
      city: trimOrNull(a.STD_CITY) ? titleCase(String(a.STD_CITY)) : null,
      state: state.toUpperCase(),
      zip,
      county: trimOrNull(a.CURCNTY_NM),
      lat: toNumber(a.LAT),
      lon: toNumber(a.LON),
      units: toInt(a.TOTAL_UNIT_COUNT),
      managerName: org && !isGenericName(org) ? displayOrgName(org) : null,
      ownerMailingAddress: null,
      mailingKey: mStreet ? mailingKey(mStreet, mCity, mZip) : null,
      people: person && !isGenericName(person)
        ? [{
          fullName: displayPersonName(null, null, person),
          title: title ? titleCase(title) : 'Management contact',
          roleCategory: roleCategoryFor(title),
          isDecisionMaker: isDecisionMakerTitle(title),
          email,
          emailStatus: email ? 'published' : 'unknown',
          phone,
          address: mgmtAddress,
          organization: org ? displayOrgName(org) : null,
          provenance: prov,
        }]
        : [],
      provenance: prov,
      extra: {
        mgmtAddress,
        mgmtPhone: phone,
        mgmtEmail: email,
        onSitePhone: cleanPhone(trimOrNull(a.PROPERTY_ON_SITE_PHONE_NUMBER)),
        category: trimOrNull(a.PROPERTY_CATEGORY_NAME),
        clientGroup: trimOrNull(a.CLIENT_GROUP_NAME),
      },
    }];
  });
}

export async function fetchHudProperties(sourceId: 'hud-mf-assisted' | 'hud-mf-insured', q: HudQuery, page: { offset: number; limit: number }, ctx: FetchCtx) {
  const info = sourceId === 'hud-mf-assisted' ? hudAssisted : hudInsured;
  const { features, exceeded, url } = await arcgisQuery(info, HUD_LAYERS[sourceId], {
    where: hudWhere(q),
    outFields: FIELDS,
    returnGeometry: false,
    orderByFields: 'OBJECTID',
    resultOffset: page.offset,
    resultRecordCount: Math.min(2000, page.limit),
  }, ctx, { ttlMs: 7 * 24 * 3_600_000 });
  return { records: parseHudFeatures(sourceId, features, url), raw: features.length, exceeded, url };
}
