export type PumaAuthUser = {
  id: string;
  [key: string]: unknown;
};

type AuthResult = {
  data: { user: PumaAuthUser | null };
  error: { message?: string } | null;
};

type PumaAuthClient = {
  auth: {
    getUser(): Promise<AuthResult>;
    signInAnonymously(): Promise<AuthResult>;
  };
};

export async function ensurePumaSession(client: PumaAuthClient): Promise<PumaAuthUser> {
  const current = await client.auth.getUser();
  if (!current.error && current.data.user) return current.data.user;

  const anonymous = await client.auth.signInAnonymously();
  if (anonymous.error || !anonymous.data.user) {
    const detail = anonymous.error?.message?.trim();
    throw new Error(detail ? `AUTH_UNAVAILABLE: ${detail}` : 'AUTH_UNAVAILABLE');
  }

  return anonymous.data.user;
}
