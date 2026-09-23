import type { Workspace } from './types';
import { parseWorkspace } from './workspace';

export type WorkspaceBackupEnvelope = {
  format: 'puma-utilities-workspace-backup';
  version: 1;
  exportedAt: string;
  workspace: Workspace;
};

export function serializeWorkspaceBackup(workspace: Workspace, exportedAt = new Date().toISOString()): string {
  const envelope: WorkspaceBackupEnvelope = { format:'puma-utilities-workspace-backup', version:1, exportedAt, workspace };
  return JSON.stringify(envelope, null, 2);
}

export function parseWorkspaceBackup(text: string): Workspace {
  let parsed: unknown;
  try { parsed = JSON.parse(text); } catch { throw new Error('This is not a valid Puma Utilities workspace backup.'); }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) throw new Error('This is not a Puma Utilities workspace backup.');
  const envelope = parsed as Partial<WorkspaceBackupEnvelope>;
  if (envelope.format !== 'puma-utilities-workspace-backup' || envelope.version !== 1 || !envelope.workspace) {
    throw new Error('This is not a Puma Utilities workspace backup (version 1).');
  }
  return parseWorkspace(envelope.workspace);
}
