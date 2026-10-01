/** HUD Public Housing Developments: PHA developments with units and the executive director's contact. */
import { cleanPhone, displayOrgName, normalizeEmail, streetKey, titleCase, toInt, toNumber, trimOrNull, zip5 } from '../text';
import type { PropertyRecord, SourceInfo } from '../types';
import { arcgisQuery, provenance, sqlLit, type FetchCtx } from './common';

export const hudPublicHousing: SourceInfo = {
  id: 'hud-public-housing',
  name: 'HUD Public Housing Developments',
  kind: 'discovery',
  coverage: ['US'],
  coverageLabel: 'Nationwide',
  capabilities: ['buildings', 'units', 'housing_authority', 'executive_director_email', 'phone', 'coordinates'],
  description: 'Public housing developments by housing authority, with dwelling units and the authority / executive director contact.',
  homepage: 'https://hudgis-hud.opendata.arcgis.com/datasets/public-housing-developments',
  verified: 'live',
};

export const PHA_LAYER = 'https://services.arcgis.com/VTyQ9soqVukalItT/arcgis/rest/services/Public_Housing_Developments/FeatureServer/0';
const FIELDS = 'PARTICIPANT_CODE,FORMAL_PARTICIPANT_NAME,DEVELOPMENT_CODE,PROJECT_NAME,TOTAL_DWELLING_UNITS,TOTAL_UNITS,STD_ADDR,STD_CITY,STD_ST,STD_ZIP5,CURCNTY_NM,LAT,LON,PHA_TOTAL_UNITS,HA_PHN_NUM,HA_EMAIL_ADDR_TEXT,EXEC_DIR_PHONE,EXEC_DIR_EMAIL';

export type PhaQuery = { states: string[]; counties?: string[]; cities?: string[]; zips?: string[]; minUnits: number };

export function phaWhere(q: PhaQuery): string {
  const parts = [`TOTAL_DWELLING_UNITS >= ${Math.max(1, Math.floor(q.minUnits))}`];
  if (q.states.length) parts.push(`STD_ST IN (${q.states.map((s) => sqlLit(s.toUpperCase())).join(',')})`);
  if (q.counties?.length) parts.push(`(${q.counties.map((c) => `UPPER(CURCNTY_NM) LIKE ${sqlLit(`${c.toUpperCase().replace(/\s+COUNTY$/, '')}%`)}`).join(' OR ')})`);
  if (q.cities?.length) parts.push(`(${q.cities.map((c) => `UPPER(STD_CITY) LIKE ${sqlLit(`${c.toUpperCase()}%`)}`).join(' OR ')})`);
  if (q.zips?.length) parts.push(`STD_ZIP5 IN (${q.zips.map(sqlLit).join(',')})`);
  return parts.join(' AND ');
}

export function parsePhaFeatures(features: { attributes: Record<string, unknown> }[], url: string): PropertyRecord[] {
  const prov = provenance(hudPublicHousing, url);
  return features.flatMap(({ attributes: a }) => {
    const dev = trimOrNull(a.DEVELOPMENT_CODE);
    const pha = trimOrNull(a.FORMAL_PARTICIPANT_NAME);
    const state = trimOrNull(a.STD_ST);
    if (!dev || !pha || !state) return [];
    const zip = zip5(trimOrNull(a.STD_ZIP5));
    const address = trimOrNull(a.STD_ADDR) ? titleCase(String(a.STD_ADDR)) : `${titleCase(String(a.PROJECT_NAME ?? dev))}`;
    const email = normalizeEmail(trimOrNull(a.EXEC_DIR_EMAIL)) ?? normalizeEmail(trimOrNull(a.HA_EMAIL_ADDR_TEXT));
    const phone = cleanPhone(trimOrNull(a.EXEC_DIR_PHONE)) ?? cleanPhone(trimOrNull(a.HA_PHN_NUM));
    return [{
      sourceKey: `hud-pha:${dev}`,
      altKeys: zip && a.STD_ADDR ? [`addr:${streetKey(String(a.STD_ADDR))}|${zip}`] : [],
      name: a.PROJECT_NAME ? titleCase(String(a.PROJECT_NAME)) : null,
      address,
      city: trimOrNull(a.STD_CITY) ? titleCase(String(a.STD_CITY)) : null,
      state: state.toUpperCase(),
      zip,
      county: trimOrNull(a.CURCNTY_NM),
      lat: toNumber(a.LAT),
      lon: toNumber(a.LON),
      units: toInt(a.TOTAL_DWELLING_UNITS) ?? toInt(a.TOTAL_UNITS),
      ownerName: displayOrgName(pha),
      managerName: displayOrgName(pha),
      people: email || phone
        ? [{
          fullName: 'Executive Director',
          title: 'Executive Director',
          roleCategory: 'executive',
          isDecisionMaker: true,
          email,
          emailStatus: email ? 'published' : 'unknown',
          phone,
          organization: displayOrgName(pha),
          provenance: prov,
        }]
        : [],
      provenance: prov,
      extra: { participantCode: trimOrNull(a.PARTICIPANT_CODE), phaTotalUnits: toInt(a.PHA_TOTAL_UNITS), haEmail: normalizeEmail(trimOrNull(a.HA_EMAIL_ADDR_TEXT)), haPhone: cleanPhone(trimOrNull(a.HA_PHN_NUM)) },
    }];
  });
}

export async function fetchPhaDevelopments(q: PhaQuery, page: { offset: number; limit: number }, ctx: FetchCtx) {
  const { features, exceeded, url } = await arcgisQuery(hudPublicHousing, PHA_LAYER, {
    where: phaWhere(q),
    outFields: FIELDS,
    returnGeometry: false,
    orderByFields: 'OBJECTID',
    resultOffset: page.offset,
    resultRecordCount: Math.min(2000, page.limit),
  }, ctx, { ttlMs: 14 * 24 * 3_600_000 });
  return { records: parsePhaFeatures(features, url), raw: features.length, exceeded, url };
}
