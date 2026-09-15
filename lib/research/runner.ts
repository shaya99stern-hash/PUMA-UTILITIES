import { graphCompleteness } from './graph';
import { executeResearchTask, type ResearchTaskResult } from './executor';
import { SOURCE_REGISTRY } from './source-registry';
import { planEntityTasks } from './task-planner';
import type { ResearchGraph, ResearchTask } from './types';

export interface ResearchRunOptions {
  maxTasks?: number;
  maxDepth?: number;
  concurrency?: number;
  perNeed?: number;
  targetCompleteness?: number;
  searchEndpoint?: string;
  signal?: AbortSignal;
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
  stopReason: 'target-completeness' | 'task-budget' | 'source-exhausted' | 'aborted';
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
  const attempts = new Map<string, number>();
  const queuedKeys = new Set<string>();
  const queue: ResearchTask[] = [];
  const results: ResearchTaskResult[] = [];
  const entityDepth = new Map<string, number>([[rootEntityId, 0]]);

  enqueueEntity(rootEntityId, 0);

  while (queue.length && results.length < maxTasks) {
    if (options.signal?.aborted) return summarize('aborted');
    if (graphCompleteness(graph, rootEntityId) >= targetCompleteness && rootHasDecisionMaker(graph, rootEntityId)) {
      return summarize('target-completeness');
    }

    const batch = takeBatch(queue, concurrency);
    for (const task of batch) queuedKeys.delete(taskKey(task));
    const settled = await Promise.all(batch.map((task) => executeResearchTask(graph, task, {
      searchEndpoint: options.searchEndpoint,
      signal: options.signal,
    })));
    results.push(...settled);

    for (let index = 0; index < batch.length; index += 1) {
      const task = batch[index];
      const result = settled[index];
      const key = taskKey(task);
      attempts.set(key, (attempts.get(key) ?? 0) + 1);
      const depth = task.depth;

      if (result.evidenceAdded > 0 || result.claimsAdded > 0) enqueueEntity(task.subjectId, depth);
      if (result.retryable && (attempts.get(key) ?? 0) < 2) enqueueTask(task);

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

  function enqueueTask(task: ResearchTask): void {
    const key = taskKey(task);
    const count = attempts.get(key) ?? 0;
    if (count >= 2 || queuedKeys.has(key)) return;
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
      stopReason,
    };
  }
}

function takeBatch(queue: ResearchTask[], globalLimit: number): ResearchTask[] {
  const selected: ResearchTask[] = [];
  const perSource = new Map<string, number>();
  for (let index = 0; index < queue.length && selected.length < globalLimit;) {
    const task = queue[index];
    const sourceLimit = SOURCE_REGISTRY.find((source) => source.id === task.sourceId)?.maxConcurrency ?? 1;
    const sourceCount = perSource.get(task.sourceId) ?? 0;
    if (sourceCount >= sourceLimit) {
      index += 1;
      continue;
    }
    selected.push(task);
    perSource.set(task.sourceId, sourceCount + 1);
    queue.splice(index, 1);
  }
  if (!selected.length && queue.length) selected.push(queue.shift() as ResearchTask);
  return selected;
}

function taskKey(task: ResearchTask): string {
  return `${task.subjectId}:${task.need.fact}:${task.sourceId}`;
}

function rootHasDecisionMaker(graph: ResearchGraph, rootEntityId: string): boolean {
  const root = graph.entities.find((entity) => entity.id === rootEntityId);
  if (root?.kind !== 'company') return true;
  return graph.claims.some((claim) =>
    claim.subjectId === rootEntityId && claim.fact === 'person.decisionMaker' &&
    (claim.state === 'VERIFIED' || claim.state === 'SUPPORTED') && claim.confidence >= 0.7
  );
}

function clampInteger(value: number, minimum: number, maximum: number): number {
  return Math.max(minimum, Math.min(maximum, Math.floor(value)));
}
