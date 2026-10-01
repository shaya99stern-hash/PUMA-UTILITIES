import 'server-only';
import { z } from 'zod';
import { ApiError } from '@/lib/server/http';

export const uuid = z.string().uuid();
export const isUuid = (v: string | null | undefined): v is string => !!v && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(v);

export type IdContext = { params: Promise<{ id: string }> };

export function emailList(label: string, max = 50) {
  return z
    .array(z.string().trim().toLowerCase().email(`${label} contains an invalid email address.`))
    .max(max);
}

export function requireUuid(value: string, what = 'id') {
  if (!isUuid(value)) throw new ApiError(404, `${what} not found.`);
  return value;
}

/** Like readJson but returns the schema's OUTPUT type (defaults applied). */
export async function readBody<S extends z.ZodTypeAny>(request: Request, schema: S): Promise<z.output<S>> {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    throw new ApiError(400, 'Request body must be JSON.');
  }
  const parsed = schema.safeParse(body);
  if (!parsed.success) {
    const issue = parsed.error.issues[0];
    throw new ApiError(400, issue?.message && issue.message !== 'Required' ? issue.message : `${issue?.path.join('.') || 'Request'} is invalid.`, parsed.error.flatten());
  }
  return parsed.data;
}
