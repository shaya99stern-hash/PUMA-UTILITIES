/** Every built-in source the engine uses (shown in Settings > Data sources). */
import { contactOut } from './sources/contactout';
import { censusGeocoder } from './sources/census-geocoder';
import { dnsGoogle } from './sources/dns';
import { epaWater } from './sources/epa-water';
import { hudAssisted, hudInsured } from './sources/hud-multifamily';
import { hudPublicHousing } from './sources/hud-public-housing';
import { njModiv } from './sources/nj-modiv';
import { nyDos } from './sources/ny-dos';
import { nycHpd } from './sources/nyc-hpd';
import { nycLl84 } from './sources/nyc-ll84';
import { nycPluto } from './sources/nyc-pluto';
import { montcoParcels } from './sources/pa-counties';
import { phlOpa } from './sources/phl-opa';
import { gleif, secEdgar, wikidata } from './sources/registries';
import { nycLiens } from './sources/signals';
import { webSearch } from './sources/web-search';
import type { SourceInfo } from './types';
import { WEBSITE_SOURCE } from './website';

export const BUILT_IN_SOURCES: SourceInfo[] = [
  nycPluto, nycHpd, nycLl84, nycLiens, njModiv, phlOpa, montcoParcels, hudAssisted, hudInsured, hudPublicHousing,
  nyDos, epaWater, censusGeocoder, dnsGoogle, gleif, wikidata, secEdgar, contactOut,
  {
    id: WEBSITE_SOURCE.id,
    name: WEBSITE_SOURCE.name,
    kind: 'enrichment',
    coverage: ['WEB'],
    coverageLabel: 'Company websites',
    capabilities: ['team_pages', 'emails', 'phones', 'portfolio_claims', 'office_address', 'linkedin'],
    description: 'Finds and crawls each company website (home, contact, about, team, portfolio) for people, titles, emails and phones.',
    homepage: 'https://puma-utilities.vercel.app',
    verified: 'live',
  },
  {
    id: 'email-pattern',
    name: 'Email pattern inference',
    kind: 'enrichment',
    coverage: ['WEB'],
    coverageLabel: 'Any company domain',
    capabilities: ['inferred_emails'],
    description: 'Learns a company’s email format from published addresses (or ContactOut) and proposes addresses for decision makers, MX-checked and labeled “inferred”.',
    homepage: 'https://puma-utilities.vercel.app',
    verified: 'live',
  },
  webSearch,
];
