import { z } from 'zod';

/** Validation for Settings > Connectors create/update. */
export const connectorSchema = z.object({
  name: z.string().trim().min(2).max(80),
  kind: z.enum(['socrata', 'arcgis', 'json', 'hunter', 'opencorporates', 'brave', 'serper', 'google_cse']),
  role: z.enum(['buildings', 'people', 'company', 'search']),
  enabled: z.boolean().optional(),
  secret: z.string().max(500).optional(),
  dailyLimit: z.number().int().min(1).max(100_000).optional(),
  config: z.object({
    url: z.string().url().max(1000).optional(),
    where: z.string().max(1000).optional(),
    rowsPath: z.string().max(200).optional(),
    fields: z.record(z.string(), z.string().max(200)).optional(),
    state: z.string().length(2).optional(),
    states: z.array(z.string().length(2)).max(60).optional(),
    authHeader: z.string().max(100).optional(),
    authParam: z.string().max(100).optional(),
    cx: z.string().max(200).optional(),
    jurisdiction: z.string().max(40).optional(),
    maxRows: z.number().int().min(1).max(50_000).optional(),
  }).default({}),
});
