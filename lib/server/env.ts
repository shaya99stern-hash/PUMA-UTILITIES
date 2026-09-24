function required(name: string): string {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`${name} is required.`);
  return value;
}

export function publicSupabaseEnv() {
  return {
    url: required('NEXT_PUBLIC_SUPABASE_URL'),
    publishableKey: required('NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY'),
  };
}

export function serverEnv() {
  return {
    ...publicSupabaseEnv(),
    serviceRoleKey: required('SUPABASE_SERVICE_ROLE_KEY'),
  };
}
