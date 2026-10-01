import 'server-only';
import { toCsv } from './csv';

export function csvResponse(filename: string, headers: string[], rows: Array<Array<unknown>>): Response {
  return new Response(`﻿${toCsv(headers, rows)}`, {
    headers: {
      'Content-Type': 'text/csv; charset=utf-8',
      'Content-Disposition': `attachment; filename="${filename}"`,
      'Cache-Control': 'no-store',
    },
  });
}

export const iso = (v: unknown) => (v ? new Date(v as string).toISOString() : '');
export const today = () => new Date().toISOString().slice(0, 10);
