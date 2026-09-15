import { deriveProspectNeeds } from './graph';
import { planResearch } from './planner';
import type { ResearchGraph, ResearchTask } from './types';

export function planProspectTasks(
  graph: ResearchGraph,
  companyId: string,
  geography?: string,
  options: { depth?: number; maxTasks?: number; perNeed?: number } = {},
): ResearchTask[] {
  const depth = Math.max(0, Math.floor(options.depth ?? 0));
  const maxTasks = Math.max(1, Math.min(100, Math.floor(options.maxTasks ?? 30)));
  const perNeed = Math.max(1, Math.min(10, Math.floor(options.perNeed ?? 4)));
  const needs = deriveProspectNeeds(graph, companyId, geography);
  const planned = planResearch(needs, perNeed);
  const seen = new Set<string>();
  const tasks: ResearchTask[] = [];

  for (const item of planned) {
    const key = `${companyId}:${item.need.fact}:${item.source.id}`;
    if (seen.has(key)) continue;
    seen.add(key);
    tasks.push({
      id: `task:${key}:d${depth}`,
      subjectId: companyId,
      need: item.need,
      sourceId: item.source.id,
      status: 'queued',
      depth,
      utility: item.utility,
      reason: item.reason,
    });
    if (tasks.length >= maxTasks) break;
  }

  return tasks;
}

export function shouldContinueResearch(input: {
  depth: number;
  maxDepth: number;
  tasksCompleted: number;
  maxTasks: number;
  completeness: number;
  targetCompleteness?: number;
  marginalInformationGain?: number;
  minimumInformationGain?: number;
}): boolean {
  const target = input.targetCompleteness ?? 0.82;
  const minimumGain = input.minimumInformationGain ?? 0.02;
  if (input.completeness >= target) return false;
  if (input.depth >= input.maxDepth) return false;
  if (input.tasksCompleted >= input.maxTasks) return false;
  if ((input.marginalInformationGain ?? 1) < minimumGain) return false;
  return true;
}
