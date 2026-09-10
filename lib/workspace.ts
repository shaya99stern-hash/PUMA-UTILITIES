import type { Workspace } from './types';

export const WORKSPACE_KEY = 'puma-utilities.workspace.v1';

export function nowIso() {
  return new Date().toISOString();
}

export function createId(prefix: string) {
  const random = typeof crypto !== 'undefined' && 'randomUUID' in crypto
    ? crypto.randomUUID()
    : Math.random().toString(36).slice(2);
  return `${prefix}_${random}`;
}

export function emptyWorkspace(): Workspace {
  return {
    version: 1,
    companies: [],
    properties: [],
    parcels: [],
    utilities: [],
    meters: [],
    tariffs: [],
    monitorSettings: {},
    updatedAt: nowIso(),
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function arrayOrEmpty<T>(value: unknown): T[] {
  return Array.isArray(value) ? value as T[] : [];
}

/**
 * The import guard is deliberately structural and conservative. It prevents a
 * malformed file from breaking the local PWA, but source facts remain visible
 * data for the operator to review.
 */
export function parseWorkspace(value: unknown): Workspace {
  if (!isRecord(value) || value.version !== 1) {
    throw new Error('This is not a Puma Utilities workspace export (version 1).');
  }

  return {
    version: 1,
    companies: arrayOrEmpty(value.companies),
    properties: arrayOrEmpty(value.properties),
    parcels: arrayOrEmpty(value.parcels),
    utilities: arrayOrEmpty(value.utilities),
    meters: arrayOrEmpty(value.meters),
    tariffs: arrayOrEmpty(value.tariffs),
    monitorSettings: isRecord(value.monitorSettings) ? value.monitorSettings : {},
    updatedAt: typeof value.updatedAt === 'string' ? value.updatedAt : nowIso(),
  };
}

export function loadWorkspace(): Workspace {
  if (typeof window === 'undefined') return emptyWorkspace();
  try {
    const stored = window.localStorage.getItem(WORKSPACE_KEY);
    return stored ? parseWorkspace(JSON.parse(stored)) : emptyWorkspace();
  } catch {
    return emptyWorkspace();
  }
}

/**
 * Local persistence is best-effort by design: a privacy setting or full quota
 * must not make the PWA unusable or cause an update to erase in-memory work.
 */
export function saveWorkspace(workspace: Workspace): boolean {
  if (typeof window === 'undefined') return false;
  try {
    window.localStorage.setItem(WORKSPACE_KEY, JSON.stringify(workspace));
    return true;
  } catch {
    return false;
  }
}

export function touchWorkspace(workspace: Workspace): Workspace {
  return { ...workspace, updatedAt: nowIso() };
}
