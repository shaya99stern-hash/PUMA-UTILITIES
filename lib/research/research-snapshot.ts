import type { ResearchRunResult } from './runner';
import type { Workspace } from '../types';

export type ResearchSnapshot = {
  researchedAt: string;
  evidenceCount: number;
  sourceCount: number;
  rootCompleteness: number;
  tasksExecuted: number;
  budgetUnitsSpent?: number;
  blocked: number;
  failed: number;
};

export type WorkspaceResearchRecency = {
  latestRetrievedAt?: string;
  status: 'fresh' | 'aging' | 'stale' | 'unknown';
  sourceCount: number;
};

export function buildResearchSnapshot(result: ResearchRunResult, researchedAt = new Date().toISOString()): ResearchSnapshot {
  return {
    researchedAt,
    evidenceCount:result.graph.evidence.length,
    sourceCount:new Set(result.graph.evidence.map((evidence) => evidence.sourceId)).size,
    rootCompleteness:result.rootCompleteness,
    tasksExecuted:result.tasksExecuted,
    budgetUnitsSpent:result.budgetUnitsSpent,
    blocked:result.blocked,
    failed:result.failed,
  };
}

export function companyResearchRecency(workspace: Workspace, companyId: string, now = new Date().toISOString()): WorkspaceResearchRecency {
  const company = workspace.companies.find((item) => item.id === companyId);
  if (!company) return { status:'unknown', sourceCount:0 };
  const propertyIds = new Set(workspace.properties.filter((property) => property.companyId === companyId).map((property) => property.id));
  const provenance = [
    ...company.provenance,
    ...workspace.properties.filter((property) => propertyIds.has(property.id)).flatMap((property) => property.provenance),
  ];
  const retrieved = provenance.map((item) => item.retrievedAt).filter((value): value is string => Boolean(value) && Number.isFinite(Date.parse(value)));
  const latestRetrievedAt = retrieved.sort((a,b) => Date.parse(b) - Date.parse(a))[0];
  const sources = new Set(provenance.map((item) => item.reference ?? item.label).filter(Boolean));
  return { latestRetrievedAt, status:researchRecencyStatus(latestRetrievedAt, now), sourceCount:sources.size };
}

export function researchRecencyStatus(researchedAt?: string, now = new Date().toISOString()): 'fresh' | 'aging' | 'stale' | 'unknown' {
  if (!researchedAt) return 'unknown';
  const researched = Date.parse(researchedAt);
  const current = Date.parse(now);
  if (!Number.isFinite(researched) || !Number.isFinite(current)) return 'unknown';
  const days = Math.max(0, (current - researched) / 86_400_000);
  if (days <= 7) return 'fresh';
  if (days <= 30) return 'aging';
  return 'stale';
}
