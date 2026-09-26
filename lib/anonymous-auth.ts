export type PumaAuthUser = {
  id: string;
  email?: string | null;
};

export type PumaBootstrapSession = {
  access_token: string;
  refresh_token: string;
};

type UserResult = {
  data: { user: PumaAuthUser | null };
  error: { message?: string } | null;
};

type SessionResult = {
  data: { user: PumaAuthUser | null };
  error: { message?: string } | null;
};

type PumaAuthClient = {
  auth: {
    getUser(): Promise<UserResult>;
    setSession(session: PumaBootstrapSession): Promise<SessionResult>;
  };
};

export async function ensurePumaSession(
  client: PumaAuthClient,
  bootstrap?: () => Promise<PumaBootstrapSession>,
): Promise<PumaAuthUser> {
  const current = await client.auth.getUser();
  if (!current.error && current.data.user) return current.data.user;

  if (!bootstrap) throw new Error('AUTH_UNAVAILABLE');

  const session = await bootstrap();
  if (!session.access_token || !session.refresh_token) throw new Error('AUTH_UNAVAILABLE');

  const established = await client.auth.setSession(session);
  if (established.error || !established.data.user) {
    const detail = established.error?.message?.trim();
    throw new Error(detail ? `AUTH_UNAVAILABLE: ${detail}` : 'AUTH_UNAVAILABLE');
  }

  return established.data.user;
}
