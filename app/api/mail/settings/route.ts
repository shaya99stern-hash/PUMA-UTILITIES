import { z } from 'zod';
import { sql } from '@/lib/server/db';
import { requireMember } from '@/lib/server/auth';
import { json, route } from '@/lib/server/http';
import { readBody } from '@/lib/email/api';
import { campaignSettingsSchema, normalizeSettings } from '@/lib/email/settings';
import { loadWorkspaceEmail } from '@/lib/email/workspace';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export const GET = route(async () => {
  const ctx = await requireMember();
  return json(await loadWorkspaceEmail(ctx.workspaceId));
});

const schema = z.object({
  companyAddress: z.string().trim().max(400).optional(),
  companyName: z.string().trim().max(160).optional(),
  defaults: campaignSettingsSchema.partial().optional(),
});

/** Stores the CAN-SPAM mailing address, sender organization, and default throttle/window/timezone. */
export const PATCH = route(async (request) => {
  const ctx = await requireMember('admin');
  const body = await readBody(request, schema);
  const current = await loadWorkspaceEmail(ctx.workspaceId);
  const patch: Record<string, unknown> = {};
  if (body.companyAddress !== undefined) patch.companyAddress = body.companyAddress;
  if (body.companyName !== undefined) patch.companyName = body.companyName;
  if (body.defaults) patch.emailDefaults = normalizeSettings(body.defaults, { base: current.defaults });
  await sql()`update workspaces set settings = coalesce(settings, '{}'::jsonb) || ${sql().json(patch as never)} where id = ${ctx.workspaceId}`;
  return json(await loadWorkspaceEmail(ctx.workspaceId));
});
