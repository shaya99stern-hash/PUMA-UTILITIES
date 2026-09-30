import 'server-only';
import { NextResponse } from 'next/server';
import { ZodError, type ZodType } from 'zod';

export class ApiError extends Error {
  constructor(public status: number, message: string, public details?: unknown) {
    super(message);
  }
}

export function json<T>(data: T, init?: number | ResponseInit) {
  const options = typeof init === 'number' ? { status: init } : init;
  return NextResponse.json(data, { ...options, headers: { 'Cache-Control': 'no-store', ...(options?.headers ?? {}) } });
}

/**
 * Wraps a route handler with consistent error handling.
 * Errors return `{ error: string, details? }` with the right status.
 */
export function route<C = unknown>(handler: (request: Request, context: C) => Promise<Response>) {
  return async (request: Request, context: C) => {
    try {
      return await handler(request, context);
    } catch (error) {
      if (error instanceof ApiError) return json({ error: error.message, details: error.details }, error.status);
      if (error instanceof ZodError) {
        return json({ error: 'Invalid request.', details: error.flatten() }, 400);
      }
      console.error('[api]', request.method, new URL(request.url).pathname, error);
      const message = error instanceof Error && process.env.NODE_ENV !== 'production' ? error.message : 'Something went wrong.';
      return json({ error: message }, 500);
    }
  };
}

export async function readJson<T>(request: Request, schema: ZodType<T>): Promise<T> {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    throw new ApiError(400, 'Request body must be JSON.');
  }
  return schema.parse(body);
}

export function searchParams(request: Request) {
  return new URL(request.url).searchParams;
}

export function intParam(value: string | null, fallback: number, min = 0, max = 1000) {
  const n = Number.parseInt(value ?? '', 10);
  if (!Number.isFinite(n)) return fallback;
  return Math.min(max, Math.max(min, n));
}
