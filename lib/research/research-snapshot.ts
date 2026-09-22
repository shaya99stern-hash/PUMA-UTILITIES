import type { ResearchSnapshot } from '../types';
import type { ResearchRunResult } from './runner';

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
