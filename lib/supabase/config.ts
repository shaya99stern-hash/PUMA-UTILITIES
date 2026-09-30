/** Public Supabase settings (safe to ship to the browser). */
export const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL?.trim() || 'https://wxbvlpkgsxlojlwykzod.supabase.co';
export const SUPABASE_PUBLISHABLE_KEY =
  process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY?.trim() || 'sb_publishable_b5robCaaYY-rRprCoH3G2g_vaLHuc2i';

/**
 * Sign-in is optional by default: the app opens straight into the shared
 * workspace. Set PUMA_REQUIRE_LOGIN=1 to require an account for every page.
 */
export function loginRequired(): boolean {
  return process.env.PUMA_REQUIRE_LOGIN?.trim() === '1';
}

/**
 * Local development can impersonate a user by setting PUMA_DEV_USER_ID
 * (never honored on Vercel).
 */
export function devAuthUserId(): string | null {
  if (process.env.VERCEL) return null;
  return process.env.PUMA_DEV_USER_ID?.trim() || null;
}
