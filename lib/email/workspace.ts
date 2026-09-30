import 'server-only';
import { sql } from '@/lib/server/db';
import { normalizeSettings, type CampaignSettings } from './settings';

export type WorkspaceEmail = {
  name: string;
  companyName: string;
  companyAddress: string | null;
  defaults: CampaignSettings;
};

/** Workspace-level email settings live in workspaces.settings (companyAddress, companyName, emailDefaults). */
export async function loadWorkspaceEmail(workspaceId: string): Promise<WorkspaceEmail> {
  const rows = await sql()<{ name: string; settings: Record<string, unknown> }[]>`select name, settings from workspaces where id = ${workspaceId}`;
  const row = rows[0];
  const s = (row?.settings ?? {}) as Record<string, unknown>;
  const address = typeof s.companyAddress === 'string' ? s.companyAddress.trim() : '';
  const companyName = typeof s.companyName === 'string' && s.companyName.trim() ? s.companyName.trim() : (row?.name ?? 'Puma Utilities');
  return {
    name: row?.name ?? 'Puma Utilities',
    companyName,
    companyAddress: address || null,
    defaults: normalizeSettings(s.emailDefaults),
  };
}
