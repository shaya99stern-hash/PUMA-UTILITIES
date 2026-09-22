import { bestClaim, graphCompleteness } from './graph';
import { executeResearchTask as defaultExecutor, type ResearchTaskResult } from './executor';
import { SOURCE_REGISTRY } from './source-registry';
import { sourceCostUnits } from './planner';
import { planEntityTasks } from './task-planner';
import type { ResearchGraph, ResearchTask } from './types';

export interface ResearchRunOptions {
  maxTasks?: number;
  maxDepth?: number;
  concurrency?: number;
  perNeed?: number;
  targetCompleteness?: number;
  maxBudgetUnits?: number;
  searchEndpoint?: string;
  signal?: AbortSignal;
  executor?: typeof defaultExecutor;
}

export interface ResearchRunResult {
  graph: ResearchGraph;
  rootEntityId: string;
  tasksExecuted: number;
  complete: number;
  blocked: number;
  failed: number;
  results: ResearchTaskResult[];
  rootCompleteness: number;
  budgetUnitsSpent?: number;
  maxBudgetUnits?: number;
  stopReason: 'target-completeness' | 'task-budget' | 'research-budget' | 'source-exhausted' | 'aborted';
}

export async function runResearch(
  graph: ResearchGraph,
  rootEntityId: string,
  options: ResearchRunOptions = {},
): Promise<ResearchRunResult> {
  const maxTasks = clampInteger(options.maxTasks ?? 60, 1, 200);
  const maxDepth = clampInteger(options.maxDepth ?? 3, 0, 8);
  const concurrency = clampInteger(options.concurrency ?? 5, 1, 12);
  const perNeed = clampInteger(options.perNeed ?? 4, 1, 10);
  const targetCompleteness = Math.max(0.25, Math.min(1, options.targetCompleteness ?? 0.82));
  const maxBudgetUnits = Math.max(1, Math.min(400, options.maxBudgetUnits ?? Math.max(16, maxTasks * 1.6)));
  const executor = options.executor ?? defaultExecutor;
  const attempts = new Map<string, number>();
  const queuedKeys = new Set<string>();
  const finishedKeys = new Set<string>();
  const queue: ResearchTask[] = [];
  const results: ResearchTaskResult[] = [];
  const entityDepth = new Map<string, number>([[rootEntityId, 0]]);
  let budgetUnitsSpent = 0;

  enqueueEntity(rootEntityId, 0);

  while (queue.length && results.length < maxTasks) {
    pruneResolvedTasks();
    if (!queue.length) return summarize('source-exhausted');
    if (options.signal?.aborted) return summarize('aborted');
    if (graphCompleteness(graph, rootEntityId) >= targetCompleteness && rootIsActionable(graph, rootEntityId)) {
      return summarize('target-completeness');
    }

    if (budgetUnitsSpent >= maxBudgetUnits) return summarize('research-budget');
    const batch = takeBatch(queue, concurrency, maxBudgetUnits - budgetUnitsSpent);
    if (!batch.length) return summarize('research-budget');
    budgetUnitsSpent += batch.reduce((sum, task) => sum + taskCost(task), 0);
    for (const task of batch) queuedKeys.delete(taskKey(task));
    const settled = await Promise.all(batch.map((task) => executor(graph, task, {
      searchEndpoint: options.searchEndpoint,
      signal: options.signal,
    })));
    results.push(...settled);

    for (let index = 0; index < batch.length; index += 1) {
      const task = batch[index];
      const result = settled[index];
      const key = taskKey(task);
      const count = (attempts.get(key) ?? 0) + 1;
      attempts.set(key, count);
      const depth = task.depth;

      if (result.status === 'complete' || !result.retryable || count >= 2) finishedKeys.add(key);
      if (result.evidenceAdded > 0 || result.claimsAdded > 0) enqueueEntity(task.subjectId, depth);
      if (result.retryable && count < 2) enqueueTask(task);

      for (const entityId of result.discoveredEntityIds) {
        const nextDepth = Math.min(maxDepth, depth + 1);
        const knownDepth = entityDepth.get(entityId);
        if (knownDepth === undefined || nextDepth < knownDepth) entityDepth.set(entityId, nextDepth);
        if (nextDepth <= maxDepth) enqueueEntity(entityId, nextDepth);
      }
    }
  }

  return summarize(results.length >= maxTasks ? 'task-budget' : 'source-exhausted');

  function enqueueEntity(entityId: string, depth: number): void {
    if (depth > maxDepth) return;
    const entity = graph.entities.find((item) => item.id === entityId);
    if (!entity) return;
    const tasks = planEntityTasks(graph, entityId, entity.geography, { depth, maxTasks: 40, perNeed });
    for (const task of tasks) enqueueTask(task);
  }

  function pruneResolvedTasks(): void {
    for (let index = queue.length - 1; index >= 0; index -= 1) {
      const task = queue[index];
      const claim = bestClaim(graph, task.subjectId, task.need.fact);
      const resolved = Boolean(claim && (claim.state === 'VERIFIED' || claim.state === 'SUPPORTED') && claim.confidence >= 0.7);
      if (!resolved) continue;
      queue.splice(index, 1);
      queuedKeys.delete(taskKey(task));
      finishedKeys.add(taskKey(task));
    }
  }

  function enqueueTask(task: ResearchTask): void {
    const key = taskKey(task);
    const count = attempts.get(key) ?? 0;
    if (count >= 2 || finishedKeys.has(key) || queuedKeys.has(key)) return;
    if (results.length + queue.length >= maxTasks * 2) return;
    queue.push(task);
    queuedKeys.add(key);
    queue.sort((left, right) => right.utility - left.utility);
  }

  function summarize(stopReason: ResearchRunResult['stopReason']): ResearchRunResult {
    return {
      graph,
      rootEntityId,
      tasksExecuted: results.length,
      complete: results.filter((item) => item.status === 'complete').length,
      blocked: results.filter((item) => item.status === 'blocked').length,
      failed: results.filter((item) => item.status === 'failed').length,
      results,
      rootCompleteness: graphCompleteness(graph, rootEntityId),
      budgetUnitsSpent: Math.round(budgetUnitsSpent * 100) / 100,
      maxBudgetUnits,
      stopReason,
    };
  }
}

function takeBatch(queue: ResearchTask[], globalLimit: number, remainingBudget: number): ResearchTask[] {
  const selected: ResearchTask[] = [];
  const perSource = new Map<string, number>();
  const executionKeys = new Set<string>();
  let selectedCost = 0;
  for (let index = 0; index < queue.length && selected.length < globalLimit;) {
    const task = queue[index];
    const cost = taskCost(task);
    const sourceLimit = SOURCE_REGISTRY.find((source) => source.id === task.sourceId)?.maxConcurrency ?? 1;
    const sourceCount = perSource.get(task.sourceId) ?? 0;
    const executionKey = `${task.subjectId}:${task.sourceId}`;
    if (sourceCount >= sourceLimit || executionKeys.has(executionKey) || selectedCost + cost > remainingBudget + 0.0001) {
      index += 1;
      continue;
    }
    selected.push(task);
    selectedCost += cost;
    perSource.set(task.sourceId, sourceCount + 1);
    executionKeys.add(executionKey);
    queue.splice(index, 1);
  }
  return selected;
}

function taskCost(task: ResearchTask): number {
  const source = SOURCE_REGISTRY.find((item) => item.id === task.sourceId);
  return source ? sourceCostUnits(source) : 2;
}

function taskKey(task: ResearchTask): string {
  return `${task.subjectId}:${task.need.fact}:${task.sourceId}`;
}

function rootIsActionable(graph: ResearchGraph, rootEntityId: string): boolean {
  const root = graph.entities.find((entity) => entity.id === rootEntityId);
  if (root?.kind !== 'company') return true;
  const decisionMakers = graph.claims.filter((claim) =>
    claim.subjectId === rootEntityId && claim.fact === 'person.decisionMaker' && claim.objectEntityId &&
    (claim.state === 'VERIFIED' || claim.state === 'SUPPORTED') && claim.confidence >= 0.7
  );
  if (!decisionMakers.length) return false;

  const companyContact = graph.claims.some((claim) =>
    claim.subjectId === rootEntityId && (claim.fact === 'company.email' || claim.fact === 'company.phone') &&
    (claim.state === 'VERIFIED' || claim.state === 'SUPPORTED') && claim.confidence >= 0.7
  );
  if (companyContact) return true;

  const personIds = new Set(decisionMakers.map((claim) => claim.objectEntityId).filter((value): value is string => Boolean(value)));
  return graph.claims.some((claim) =>
    personIds.has(claim.subjectId) && (claim.fact === 'person.email' || claim.fact === 'person.phone') &&
    (claim.state === 'VERIFIED' || claim.state === 'SUPPORTED') && claim.confidence >= 0.7
  );
}

function clampInteger(value: number, minimum: number, maximum: number): number {
  return Math.max(minimum, Math.min(maximum, Math.floor(value)));
}
