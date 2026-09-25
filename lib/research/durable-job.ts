import { addClaim, createResearchGraph, graphCompleteness, upsertEntity } from './graph';
import { SOURCE_REGISTRY } from './source-registry';
import { sourceCostUnits } from './planner';
import { planEntityTasks } from './task-planner';
import type { ResearchGraph, ResearchTask } from './types';
import type { ResearchTaskResult } from './executor';
import type { ResearchRunResult } from './runner';

export type DurableResearchInput = {
  label: string;
  geography?: string;
  website?: string;
  maxTasks?: number;
  maxDepth?: number;
  perNeed?: number;
  maxBudgetUnits?: number;
  targetCompleteness?: number;
};

export type DurableTaskDisposition = {
  status: 'queued' | 'complete' | 'blocked' | 'failed';
  retry: boolean;
  backoffSeconds: number;
};

export function createDurableResearchSeed(input: DurableResearchInput) {
  const label = input.label.trim();
  const geography = input.geography?.trim().toUpperCase();
  const graph = createResearchGraph();
  const rootEntityId = `seed:company:${slug(label)}`;
  upsertEntity(graph, { id: rootEntityId, kind: 'company', label, geography: geography || undefined });

  if (input.website) {
    const origin = new URL(input.website).origin;
    addClaim(graph, {
      id: `claim:${rootEntityId}:website:operator-hint`,
      subjectId: rootEntityId,
      fact: 'company.website',
      value: origin,
      state: 'INFERRED',
      confidence: 0.69,
      evidenceIds: [],
      observedAt: new Date().toISOString(),
    });
  }

  const tasks = planEntityTasks(graph, rootEntityId, geography, {
    depth: 0,
    maxTasks: Math.min(40, clampInteger(input.maxTasks ?? 60, 1, 80)),
    perNeed: clampInteger(input.perNeed ?? 6, 1, 6),
  });

  return { graph, rootEntityId, tasks };
}

export function decideDurableTaskDisposition(
  result: Pick<ResearchTaskResult, 'status' | 'retryable'>,
  attemptCount: number,
  maxAttempts: number,
): DurableTaskDisposition {
  if (result.status === 'complete') return { status: 'complete', retry: false, backoffSeconds: 0 };
  const canRetry = Boolean(result.retryable) && attemptCount < maxAttempts;
  if (canRetry) {
    return { status: 'queued', retry: true, backoffSeconds: Math.min(120, Math.max(10, attemptCount * 10)) };
  }
  return { status: result.status === 'blocked' ? 'blocked' : 'failed', retry: false, backoffSeconds: 0 };
}

export function taskCostUnits(task: ResearchTask): number {
  const source = SOURCE_REGISTRY.find((item) => item.id === task.sourceId);
  return source ? sourceCostUnits(source) : 2;
}

export function durableTaskKey(task: ResearchTask): string {
  return `${task.subjectId}:${task.need.fact}:${task.sourceId}`;
}

export function buildDurableRunResult(input: {
  graph: ResearchGraph;
  rootEntityId: string;
  results: ResearchTaskResult[];
  budgetUnitsSpent: number;
  maxBudgetUnits: number;
  stopReason?: ResearchRunResult['stopReason'];
}): ResearchRunResult {
  return {
    graph: input.graph,
    rootEntityId: input.rootEntityId,
    tasksExecuted: input.results.length,
    complete: input.results.filter((item) => item.status === 'complete').length,
    blocked: input.results.filter((item) => item.status === 'blocked').length,
    failed: input.results.filter((item) => item.status === 'failed').length,
    results: input.results,
    rootCompleteness: graphCompleteness(input.graph, input.rootEntityId),
    budgetUnitsSpent: Math.round(input.budgetUnitsSpent * 100) / 100,
    maxBudgetUnits: input.maxBudgetUnits,
    stopReason: input.stopReason ?? 'source-exhausted',
  };
}

function clampInteger(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, Math.floor(value)));
}

function slug(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 80) || 'entity';
}
