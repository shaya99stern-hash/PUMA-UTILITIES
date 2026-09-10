import type { IngestionSource, Prospect, Utility } from './types';

// The shell ships with no demo records. The prospecting engine will populate
// these collections with real data as integrations come online.
export const UTILITIES: Utility[] = [];
export const PROSPECTS: Prospect[] = [];
export const INGESTION_SOURCES: IngestionSource[] = [];
