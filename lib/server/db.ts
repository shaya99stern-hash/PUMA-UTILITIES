import 'server-only';
import postgres from 'postgres';

/**
 * Single Postgres client for all server-side data access.
 *
 * Production connects as role `puma_app` through the Supabase pooler
 * (transaction mode, so prepared statements are disabled). Locally it points
 * at the development cluster described in docs/ARCHITECTURE.md.
 */
declare global {
  var __pumaSql: ReturnType<typeof postgres> | undefined;
}

function createClient() {
  const url = process.env.DATABASE_URL?.trim();
  if (!url) throw new Error('DATABASE_URL is not configured.');
  return postgres(url, {
    prepare: false,
    max: process.env.NODE_ENV === 'production' ? 3 : 8,
    idle_timeout: 20,
    connect_timeout: 15,
    transform: { undefined: null },
    types: {
      // Return numeric/bigint as JS numbers (values in this app fit safely).
      numeric: { to: 1700, from: [1700], serialize: (v: unknown) => String(v), parse: (v: string) => Number(v) },
      bigint: { to: 20, from: [20], serialize: (v: unknown) => String(v), parse: (v: string) => Number(v) },
    },
  });
}

export function sql() {
  if (!globalThis.__pumaSql) globalThis.__pumaSql = createClient();
  return globalThis.__pumaSql;
}

export type Sql = ReturnType<typeof postgres>;
export type Tx = postgres.TransactionSql;
