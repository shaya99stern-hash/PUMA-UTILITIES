import type { IngestionSource, Prospect, Utility } from './types';

export const UTILITIES: Utility[] = [
  {
    id: 'nyc-dep',
    name: 'NYC Department of Environmental Protection',
    state: 'NY',
    meterStatus: 'AMI mature',
    portalCapability: 'Automated meter readings, portfolio access and usage visibility',
    publicData: 'Benchmarking and building-level city datasets can support prospecting',
    rateSource: 'NYC DEP rate schedule',
  },
  {
    id: 'nj-american-water',
    name: 'New Jersey American Water',
    state: 'NJ',
    meterStatus: 'Mixed / unknown',
    portalCapability: 'Customer portal usage and billing tools',
    publicData: 'Service territory can be resolved through public utility and GIS sources',
    rateSource: 'NJ American Water tariff',
  },
  {
    id: 'veolia-nj',
    name: 'Veolia New Jersey',
    state: 'NJ',
    meterStatus: 'AMI rolling out',
    portalCapability: 'Digital customer account and usage tools vary by service area',
    publicData: 'Municipal and utility service-area records',
    rateSource: 'Veolia NJ tariff',
  },
  {
    id: 'philadelphia-water',
    name: 'Philadelphia Water Department',
    state: 'PA',
    meterStatus: 'AMI mature',
    portalCapability: 'Daily usage visibility and leak notifications',
    publicData: 'City benchmarking and property datasets provide strong enrichment signals',
    rateSource: 'Philadelphia Water rate schedule',
  },
  {
    id: 'pa-american-water',
    name: 'Pennsylvania American Water',
    state: 'PA',
    meterStatus: 'Mixed / unknown',
    portalCapability: 'Customer portal usage tracking',
    publicData: 'Service territory and tariff records',
    rateSource: 'PA American Water tariff',
  },
  {
    id: 'aqua-pa',
    name: 'Aqua Pennsylvania',
    state: 'PA',
    meterStatus: 'AMI rolling out',
    portalCapability: 'ePortal includes billing history and usage visibility in supported areas',
    publicData: 'Utility service territory and public rate filings',
    rateSource: 'Aqua Pennsylvania tariff',
  },
];

// Intentionally empty. Real prospect records should only come from the prospecting engine.
export const PROSPECTS: Prospect[] = [];

export const INGESTION_SOURCES: IngestionSource[] = [
  {
    id: 'nyc-benchmarking',
    name: 'NYC Energy & Water Benchmarking',
    geography: 'New York City',
    category: 'Building performance',
    status: 'Ready to wire',
    description: 'Building-level benchmark signal for water intensity and peer comparison.',
  },
  {
    id: 'nyc-dep',
    name: 'NYC DEP Water Data',
    geography: 'New York City',
    category: 'Meter / account',
    status: 'Scaffolded',
    description: 'Public and client-authorized water data paths stay separate by design.',
  },
  {
    id: 'phl-benchmarking',
    name: 'Philadelphia Benchmarking',
    geography: 'Philadelphia',
    category: 'Building performance',
    status: 'Ready to wire',
    description: 'Annual water-performance records for large buildings.',
  },
  {
    id: 'pwd',
    name: 'Philadelphia Water',
    geography: 'Philadelphia',
    category: 'Meter / utility',
    status: 'Scaffolded',
    description: 'AMI-aware usage monitoring path for future authorized accounts.',
  },
  {
    id: 'njdep-gis',
    name: 'NJ Public Water Service GIS',
    geography: 'New Jersey',
    category: 'Utility resolver',
    status: 'Ready to wire',
    description: 'Geospatial service-area resolver from property coordinates to water purveyor.',
  },
  {
    id: 'tariffs',
    name: 'Utility Tariff Registry',
    geography: 'NJ / NY / PA',
    category: 'Rates',
    status: 'Scaffolded',
    description: 'Effective-dated rate records so cost calculations never hard-code a stale tariff.',
  },
];
