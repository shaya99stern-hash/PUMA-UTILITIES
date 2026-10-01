import { z } from 'zod';
import { requireMember } from '@/lib/server/auth';
import { sql } from '@/lib/server/db';
import { json, readJson, route } from '@/lib/server/http';

export const runtime = 'nodejs';

/**
 * Workspace settings live in `workspaces.settings` (jsonb). Keys owned here:
 *   companyName, companyAddress (CAN-SPAM footer; shared with the email module),
 *   timezone (IANA), markets (state codes), website, phone,
 *   profile (open-mode fallback for name/title/phone when nobody is signed in).
 */
type Settings = {
  companyName?: string;
  companyAddress?: string;
  timezone?: string;
  markets?: string[];
  website?: string;
  phone?: string;
  profile?: { full_name?: string; title?: string; phone?: string };
};

function isTimezone(value: string) {
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: value });
    return true;
  } catch {
    return false;
  }
}

async function load(ctx: Awaited<ReturnType<typeof requireMember>>) {
  const db = sql();
  const [ws] = await db<{ id: string; name: string; settings: Settings }[]>`select id, name, settings from workspaces where id = ${ctx.workspaceId}`;
  const settings = (ws?.settings ?? {}) as Settings;
  let profile = { full_name: settings.profile?.full_name ?? '', title: settings.profile?.title ?? '', phone: settings.profile?.phone ?? '', email: ctx.email ?? '' };
  if (ctx.userId) {
    const [p] = await db<{ full_name: string | null; title: string | null; phone: string | null; email: string | null }[]>`
      select full_name, title, phone, email from profiles where user_id = ${ctx.userId}`;
    profile = { full_name: p?.full_name ?? '', title: p?.title ?? '', phone: p?.phone ?? '', email: p?.email ?? ctx.email ?? '' };
  }
  return {
    signedIn: !!ctx.userId,
    role: ctx.role,
    workspace: {
      id: ws?.id ?? ctx.workspaceId,
      name: ws?.name ?? 'Puma Utilities',
      companyName: settings.companyName ?? '',
      companyAddress: settings.companyAddress ?? '',
      timezone: settings.timezone ?? 'America/New_York',
      markets: Array.isArray(settings.markets) ? settings.markets : ['NJ', 'NY', 'PA'],
      website: settings.website ?? '',
      phone: settings.phone ?? '',
    },
    profile,
  };
}

export const GET = route(async () => {
  const ctx = await requireMember();
  return json(await load(ctx));
});

const text = (max: number) => z.string().trim().max(max);
const patchSchema = z
  .object({
    workspaceName: text(120).min(1).optional(),
    companyName: text(160).optional(),
    companyAddress: text(400).optional(),
    timezone: z.string().trim().refine(isTimezone, 'Unknown time zone').optional(),
    markets: z.array(z.string().trim().toUpperCase().regex(/^[A-Z]{2}$/)).max(60).optional(),
    website: text(300).optional(),
    phone: text(40).optional(),
    profile: z.object({ full_name: text(120).optional(), title: text(120).optional(), phone: text(40).optional() }).optional(),
  })
  .strict();

export const PATCH = route(async (request) => {
  const body = await readJson(request, patchSchema);
  const touchesWorkspace = Object.keys(body).some((k) => k !== 'profile');
  const ctx = await requireMember(touchesWorkspace ? 'admin' : 'member');
  const db = sql();

  const patch: Settings = {};
  if (body.companyName !== undefined) patch.companyName = body.companyName;
  if (body.companyAddress !== undefined) patch.companyAddress = body.companyAddress;
  if (body.timezone !== undefined) patch.timezone = body.timezone;
  if (body.markets !== undefined) patch.markets = Array.from(new Set(body.markets));
  if (body.website !== undefined) patch.website = body.website;
  if (body.phone !== undefined) patch.phone = body.phone;

  if (body.profile) {
    if (ctx.userId) {
      const p = body.profile;
      await db`
        insert into profiles (user_id, email, full_name, title, phone)
        values (${ctx.userId}, ${ctx.email}, ${p.full_name ?? null}, ${p.title ?? null}, ${p.phone ?? null})
        on conflict (user_id) do update set
          full_name = coalesce(${p.full_name ?? null}, profiles.full_name),
          title = coalesce(${p.title ?? null}, profiles.title),
          phone = coalesce(${p.phone ?? null}, profiles.phone),
          updated_at = now()`;
    } else {
      const [ws] = await db<{ settings: Settings }[]>`select settings from workspaces where id = ${ctx.workspaceId}`;
      patch.profile = { ...(ws?.settings?.profile ?? {}), ...body.profile };
    }
  }

  if (Object.keys(patch).length || body.workspaceName) {
    await db`
      update workspaces set
        name = coalesce(${body.workspaceName ?? null}, name),
        settings = coalesce(settings, '{}'::jsonb) || ${db.json(patch as never)},
        updated_at = now()
      where id = ${ctx.workspaceId}`;
  }
  return json(await load(ctx));
});
