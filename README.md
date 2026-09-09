# Puma Utilities

Puma Utilities is a mobile-first multifamily water-intelligence and prospecting shell for New Jersey, New York and Pennsylvania.

## What works now

- Navi-inspired dark PWA shell with safe-area-aware mobile navigation
- NJ / NY / PA prospect queue with search and state filters
- 0–100 opportunity scoring engine with visible factor breakdowns
- Utility/meter capability registry
- Seed ingestion registry for NYC DEP, NYC/Philadelphia benchmarking, NJ water-service GIS and tariffs
- Prospect detail drawer with modeled exposure, buyer path and utility footprint
- Client-monitoring surface that is intentionally empty until authorized meter data exists
- JSON endpoints at `/api/health` and `/api/prospects`

## Data boundary

Public prospecting data and client-authorized meter/billing data are separate pipelines. Research-seed and estimated fields are labeled as such. The shell does not represent modeled water exposure as an actual customer bill.

## Run locally

```bash
npm install
npm run dev
```

## Build

```bash
npm run typecheck
npm run build
```

The next implementation phase is live ingestion: property/entity resolution, utility service-area mapping, effective-dated tariff ingestion, benchmarking joins and authorized customer meter connectors.
