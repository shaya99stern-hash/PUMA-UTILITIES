import { deriveEntityNeeds } from './graph';
import { planResearch } from './planner';
import type { ResearchGraph, ResearchTask } from './types';

export function planEntityTasks(
  graph: ResearchGraph,
  entityId: string,
  geography?: string,
  options: { depth?: number; maxTasks?: number; perNeed?: number } = {},
): ResearchTask[] {
  const depth = Math.max(0, Math.floor(options.depth ?? 0));
  const maxTasks = Math.max(1, Math.min(100, Math.floor(options.maxTasks ?? 30)));
  const perNeed = Math.max(1, Math.min(10, Math.floor(options.perNeed ?? 4)));
  const needs = deriveEntityNeeds(graph, entityId, geography);
  const planned = planResearch(needs, perNeed).filter((item) => sourceAppliesToEntity(item.source.id, entity));
  const seen = new Set<string>();
  const tasks: ResearchTask[] = [];

  for (const item of planned) {
    const key = `${entityId}:${item.need.fact}:${item.source.id}`;
    if (seen.has(key)) continue;
    seen.add(key);
    tasks.push({
      id: `task:${key}:d${depth}`,
      subjectId: entityId,
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

function sourceAppliesToEntity(sourceId: string, entity: ResearchGraph['entities'][number]): boolean {
  if (entity.kind !== 'property') return true;
  const label = entity.label;
  const state = (entity.geography ?? '').toUpperCase();
  const looksNyc = /\b(?:new york|brooklyn|bronx|queens|staten island)\b/i.test(label) && state === 'NY';
  if (sourceId === 'nyc-acris' || sourceId === 'nyc-pluto' || sourceId === 'nyc-hpd-registrations') return looksNyc;
  if (sourceId === 'nys-tax-parcels-public') return state === 'NY' && !looksNyc;
  if (sourceId === 'phila-opa-properties') return state === 'PA' && /\bphiladelphia\b/i.test(label);
  return true;
}

export function planProspectTasks(
  graph: ResearchGraph,
  companyId: string,
  geography?: string,
  options: { depth?: number; maxTasks?: number; perNeed?: number } = {},
): ResearchTask[] {
  return planEntityTasks(graph, companyId, geography, options);
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
