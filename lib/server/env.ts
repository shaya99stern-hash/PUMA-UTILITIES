import { PUMA_SUPABASE_PUBLISHABLE_KEY, PUMA_SUPABASE_URL } from '../supabase-config';

function required(name: string): string {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`${name} is required.`);
  return value;
}

export function publicSupabaseEnv() {
  return {
    url: process.env.NEXT_PUBLIC_SUPABASE_URL?.trim() || PUMA_SUPABASE_URL,
    publishableKey: process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY?.trim() || PUMA_SUPABASE_PUBLISHABLE_KEY,
  };
}

export function serverEnv() {
  return {
    ...publicSupabaseEnv(),
    serviceRoleKey: required('SUPABASE_SERVICE_ROLE_KEY'),
  };
}
