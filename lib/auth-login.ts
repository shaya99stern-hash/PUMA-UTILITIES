export function buildEmailOtpOptions(emailRedirectTo: string) {
  return {
    shouldCreateUser: true,
    emailRedirectTo,
  } as const;
}
