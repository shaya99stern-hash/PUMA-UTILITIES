'use client';

import useSWR, { mutate as globalMutate, type SWRConfiguration } from 'swr';

export class ClientApiError extends Error {
  constructor(public status: number, message: string, public details?: unknown) {
    super(message);
  }
}

async function parse<T>(res: Response): Promise<T> {
  const text = await res.text();
  const body = text ? JSON.parse(text) : null;
  if (!res.ok) {
    if (res.status === 401 && typeof window !== 'undefined' && !window.location.pathname.startsWith('/login')) {
      window.location.href = `/login?next=${encodeURIComponent(window.location.pathname + window.location.search)}`;
    }
    throw new ClientApiError(res.status, body?.error ?? `Request failed (${res.status})`, body?.details);
  }
  return body as T;
}

export async function apiGet<T>(url: string): Promise<T> {
  return parse<T>(await fetch(url, { cache: 'no-store', credentials: 'same-origin' }));
}

export async function apiSend<T>(method: 'POST' | 'PATCH' | 'PUT' | 'DELETE', url: string, body?: unknown): Promise<T> {
  return parse<T>(
    await fetch(url, {
      method,
      credentials: 'same-origin',
      headers: body === undefined ? undefined : { 'Content-Type': 'application/json' },
      body: body === undefined ? undefined : JSON.stringify(body),
    }),
  );
}

export const apiPost = <T>(url: string, body?: unknown) => apiSend<T>('POST', url, body);
export const apiPatch = <T>(url: string, body?: unknown) => apiSend<T>('PATCH', url, body);
export const apiDelete = <T>(url: string) => apiSend<T>('DELETE', url);

/** SWR hook for GET endpoints. Pass null to skip. */
export function useApi<T>(url: string | null, config?: SWRConfiguration<T>) {
  return useSWR<T>(url, (key: string) => apiGet<T>(key), { revalidateOnFocus: true, keepPreviousData: true, ...config });
}

/** Revalidate every cached GET whose URL starts with the prefix. */
export function invalidate(prefix: string) {
  return globalMutate((key) => typeof key === 'string' && key.startsWith(prefix));
}
