export const PUMA_SUPABASE_URL =
  process.env.NEXT_PUBLIC_SUPABASE_URL?.trim() || 'https://ogseewoboddgnyvjdqoz.supabase.co';

export const PUMA_SUPABASE_PUBLISHABLE_KEY =
  process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY?.trim() ||
  'sb_publishable_nE9vWUbRvXHKECCiUvwqrg_kMKZ82zg';

export function pumaSupabasePublicConfig() {
  return {
    url: PUMA_SUPABASE_URL,
    publishableKey: PUMA_SUPABASE_PUBLISHABLE_KEY,
  };
}