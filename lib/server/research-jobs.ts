import 'server-only';

import type { SupabaseClient } from '@supabase/supabase-js';
import { executeResearchTask, type ResearchTaskResult } from '../research/executor';
import {
  buildDurableRunResult,
  createDurableResearchSeed,
  decideDurableTaskDisposition,
  taskCostUnits,
  type DurableResearchInput,
} from '../research/durable-job';
import { planEntityTasks } from '../research/task-planner';
import type { ResearchGraph, ResearchTask } from '../research/types';

export type ResearchJobStatus = 'queued' | 'running' | 'partial' | 'completed' | 'failed' | 'cancelled';
type DbClient = SupabaseClient<any, any, any>;

type StoredSummary = {
  graph: ResearchGraph;
  rootEntityId: string;
  results: ResearchTaskResult[];
  budgetUnitsSpent: number;
  maxBudgetUnits: number;
  maxTasks: number;
  maxDepth: number;
  perNeed: number;
  targetCompleteness: number;
};

type LeasedTaskRow = {
  id: string;
  workspace_id: string;
  run_id: string;
  source_id: string;
  subject_key: string;
  capability: string;
  attempt_count: number;
  max_attempts: number;
  input: { task?: ResearchTask } | null;
};

export async function createResearchJob(
  client: DbClient,
  workspaceId: string,
  requestedBy: string,
  input: DurableResearchInput,
) {
  const seed = createDurableResearchSeed(input);
  const maxTasks = boundedInteger(input.maxTasks, 60, 1, 80);
  const maxDepth = boundedInteger(input.maxDepth, 4, 0, 5);
  const perNeed = boundedInteger(input.perNeed, 6, 1, 6);
  const maxBudgetUnits = boundedNumber(input.maxBudgetUnits, 82, 5, 120);
  const targetCompleteness = boundedNumber(input.targetCompleteness, 0.82, 0.25, 1);
  const summary: StoredSummary = {
    graph: seed.graph,
    rootEntityId: seed.rootEntityId,
    results: [],
    budgetUnitsSpent: 0,
    maxBudgetUnits,
    maxTasks,
    maxDepth,
    perNeed,
    targetCompleteness,
  };

  const created = await client
    .from('research_runs')
    .insert({
      workspace_id: workspaceId,
      kind: 'company-research',
      status: 'queued',
      input,
      summary,
      requested_by: requestedBy,
    })
    .select('id,status,created_at')
    .single();
  if (created.error || !created.data) throw new Error(`Unable to create research run: ${created.error?.message ?? 'unknown error'}`);

  if (seed.tasks.length) {
    const inserted = await client.from('research_tasks').upsert(
      seed.tasks.map((task) => taskRow(workspaceId, created.data.id, task)),
      { onConflict: 'run_id,subject_key,source_id,capability', ignoreDuplicates: true },
    );
    if (inserted.error) {
      await client.from('research_runs').delete().eq('id', created.data.id).eq('workspace_id', workspaceId);
      throw new Error(`Unable to queue research tasks: ${inserted.error.message}`);
    }
  }

  return { runId: created.data.id as string, status: created.data.status as ResearchJobStatus };
}

export async function getResearchJobStatus(client: DbClient, workspaceId: string, runId: string) {
  const runResult = await client
    .from('research_runs')
    .select('id,status,summary,created_at,started_at,completed_at')
    .eq('workspace_id', workspaceId)
    .eq('id', runId)
    .maybeSingle();
  if (runResult.error) throw new Error(`Unable to read research run: ${runResult.error.message}`);
  if (!runResult.data) throw new Error('RESEARCH_RUN_NOT_FOUND');

  const tasksResult = await client
    .from('research_tasks')
    .select('status')
    .eq('workspace_id', workspaceId)
    .eq('run_id', runId);
  if (tasksResult.error) throw new Error(`Unable to read research tasks: ${tasksResult.error.message}`);

  const summary = normalizeStoredSummary(runResult.data.summary);
  const statuses = (tasksResult.data ?? []).map((item: { status: string }) => item.status);
  const counts = countTaskStatuses(statuses);
  const terminal = ['completed', 'failed', 'cancelled'].includes(runResult.data.status as string);
  const result = terminal && summary
    ? buildDurableRunResult({
        graph: summary.graph,
        rootEntityId: summary.rootEntityId,
        results: summary.results,
        budgetUnitsSpent: summary.budgetUnitsSpent,
        maxBudgetUnits: summary.maxBudgetUnits,
        stopReason: inferStopReason(summary),
      })
    : null;

  return {
    runId,
    status: runResult.data.status as ResearchJobStatus,
    taskCounts: counts,
    result,
    createdAt: runResult.data.created_at as string,
    startedAt: runResult.data.started_at as string | null,
    completedAt: runResult.data.completed_at as string | null,
  };
}

export async function processResearchJob(admin: DbClient, runId: string, workerName: string) {
  const runLookup = await admin.from('research_runs').select('id,workspace_id,status,summary').eq('id', runId).maybeSingle();
  if (runLookup.error) throw new Error(`Unable to load research run: ${runLookup.error.message}`);
  if (!runLookup.data) throw new Error('RESEARCH_RUN_NOT_FOUND');
  if (['completed', 'failed', 'cancelled'].includes(runLookup.data.status as string)) {
    return getResearchJobStatus(admin, runLookup.data.workspace_id as string, runId);
  }

  const summary = normalizeStoredSummary(runLookup.data.summary);
  if (!summary) throw new Error('Research run summary is invalid.');

  if (summary.results.length >= summary.maxTasks || summary.budgetUnitsSpent >= summary.maxBudgetUnits) {
    await finalizeRun(admin, runId, runLookup.data.workspace_id as string, summary, 'completed');
    return getResearchJobStatus(admin, runLookup.data.workspace_id as string, runId);
  }

  const lease = await admin.rpc('lease_research_tasks_for_run', {
    worker_name: workerName,
    target_run_id: runId,
    lease_seconds: 90,
    max_tasks: 1,
  });
  if (lease.error) throw new Error(`Unable to lease research task: ${lease.error.message}`);
  const leased = (lease.data ?? []) as LeasedTaskRow[];

  if (!leased.length) {
    await settleRunIfIdle(admin, runLookup.data.workspace_id as string, runId, summary);
    return getResearchJobStatus(admin, runLookup.data.workspace_id as string, runId);
  }

  const row = leased[0];
  const task = row.input?.task;
  if (!task) {
    await admin.from('research_tasks').update({
      status: 'failed',
      failure_class: 'invalid-task',
      failure_message: 'Durable task payload is missing.',
      lease_owner: null,
      lease_expires_at: null,
      completed_at: new Date().toISOString(),
    }).eq('id', row.id);
    await settleRunIfIdle(admin, row.workspace_id, runId, summary);
    return getResearchJobStatus(admin, row.workspace_id, runId);
  }

  await admin.from('research_runs').update({ status: 'running', started_at: new Date().toISOString() }).eq('id', runId).is('started_at', null);
  await admin.from('research_tasks').update({ status: 'running' }).eq('id', row.id).eq('lease_owner', workerName);

  const result = await executeResearchTask(summary.graph, task);
  const disposition = decideDurableTaskDisposition(result, row.attempt_count, row.max_attempts);
  const cost = taskCostUnits(task);
  summary.results.push(result);
  summary.budgetUnitsSpent = Math.round((summary.budgetUnitsSpent + cost) * 100) / 100;

  const now = new Date();
  const taskUpdate: Record<string, unknown> = {
    status: disposition.status,
    output: result,
    lease_owner: null,
    lease_expires_at: null,
    failure_class: result.status === 'failed' ? 'source-failure' : null,
    failure_message: result.status === 'complete' ? null : result.message,
    completed_at: disposition.retry ? null : now.toISOString(),
  };
  if (disposition.retry) taskUpdate.not_before = new Date(now.getTime() + disposition.backoffSeconds * 1000).toISOString();
  const updatedTask = await admin.from('research_tasks').update(taskUpdate).eq('id', row.id).eq('run_id', runId);
  if (updatedTask.error) throw new Error(`Unable to update research task: ${updatedTask.error.message}`);

  await recordProviderBackoff(admin, row.workspace_id, task.sourceId, result, disposition, row.attempt_count);

  if (!disposition.retry && summary.results.length < summary.maxTasks && summary.budgetUnitsSpent < summary.maxBudgetUnits) {
    const entityIds = new Set([task.subjectId, ...result.discoveredEntityIds]);
    const nextTasks: ResearchTask[] = [];
    for (const entityId of entityIds) {
      const entity = summary.graph.entities.find((item) => item.id === entityId);
      if (!entity) continue;
      const depth = entityId === task.subjectId ? task.depth : Math.min(summary.maxDepth, task.depth + 1);
      if (depth > summary.maxDepth) continue;
      nextTasks.push(...planEntityTasks(summary.graph, entityId, entity.geography, { depth, maxTasks: 40, perNeed: summary.perNeed }));
    }
    if (nextTasks.length) {
      const queued = await admin.from('research_tasks').upsert(
        nextTasks.slice(0, Math.max(0, summary.maxTasks - summary.results.length)).map((nextTask) => taskRow(row.workspace_id, runId, nextTask)),
        { onConflict: 'run_id,subject_key,source_id,capability', ignoreDuplicates: true },
      );
      if (queued.error) throw new Error(`Unable to queue follow-up research: ${queued.error.message}`);
    }
  }

  const runUpdate = await admin.from('research_runs').update({ summary, status: 'running' }).eq('id', runId);
  if (runUpdate.error) throw new Error(`Unable to persist research progress: ${runUpdate.error.message}`);
  await settleRunIfIdle(admin, row.workspace_id, runId, summary);
  return getResearchJobStatus(admin, row.workspace_id, runId);
}

function taskRow(workspaceId: string, runId: string, task: ResearchTask) {
  return {
    workspace_id: workspaceId,
    run_id: runId,
    source_id: task.sourceId,
    subject_type: 'research-entity',
    subject_key: task.subjectId,
    capability: task.need.fact,
    status: 'queued',
    priority: Math.max(1, 1000 - Math.round(task.utility * 100)),
    max_attempts: 3,
    input: { task },
  };
}

async function settleRunIfIdle(admin: DbClient, workspaceId: string, runId: string, summary: StoredSummary) {
  const pending = await admin.from('research_tasks').select('id,status,not_before').eq('run_id', runId).eq('workspace_id', workspaceId).in('status', ['queued', 'leased', 'running']);
  if (pending.error) throw new Error(`Unable to inspect research queue: ${pending.error.message}`);
  if ((pending.data ?? []).length) {
    await admin.from('research_runs').update({ status: summary.results.length ? 'running' : 'queued', summary }).eq('id', runId);
    return;
  }
  const terminalTasks = await admin.from('research_tasks').select('status').eq('run_id', runId).eq('workspace_id', workspaceId);
  if (terminalTasks.error) throw new Error(`Unable to finalize research queue: ${terminalTasks.error.message}`);
  const statuses = (terminalTasks.data ?? []).map((item: { status: string }) => item.status);
  const allFailed = statuses.length > 0 && statuses.every((status: string) => status === 'failed');
  await finalizeRun(admin, runId, workspaceId, summary, allFailed ? 'failed' : 'completed');
}

async function finalizeRun(admin: DbClient, runId: string, workspaceId: string, summary: StoredSummary, status: 'completed' | 'failed') {
  const update = await admin.from('research_runs').update({
    status,
    summary,
    completed_at: new Date().toISOString(),
  }).eq('id', runId).eq('workspace_id', workspaceId);
  if (update.error) throw new Error(`Unable to finalize research run: ${update.error.message}`);
}

async function recordProviderBackoff(
  admin: DbClient,
  workspaceId: string,
  sourceId: string,
  result: ResearchTaskResult,
  disposition: ReturnType<typeof decideDurableTaskDisposition>,
  attemptCount: number,
) {
  const record = disposition.retry
    ? {
        workspace_id: workspaceId,
        provider_id: sourceId,
        blocked_until: new Date(Date.now() + disposition.backoffSeconds * 1000).toISOString(),
        reason: result.message,
        consecutive_failures: attemptCount,
      }
    : {
        workspace_id: workspaceId,
        provider_id: sourceId,
        blocked_until: null,
        reason: result.status === 'complete' ? null : result.message,
        consecutive_failures: result.status === 'complete' ? 0 : attemptCount,
      };
  const saved = await admin.from('provider_backoff_state').upsert(record, { onConflict: 'workspace_id,provider_id' });
  if (saved.error) throw new Error(`Unable to persist provider backoff state: ${saved.error.message}`);
}

function normalizeStoredSummary(value: unknown): StoredSummary | null {
  if (!value || typeof value !== 'object') return null;
  const item = value as Partial<StoredSummary>;
  if (!item.graph || !item.rootEntityId || !Array.isArray(item.results)) return null;
  return {
    graph: item.graph,
    rootEntityId: item.rootEntityId,
    results: item.results,
    budgetUnitsSpent: Number(item.budgetUnitsSpent ?? 0),
    maxBudgetUnits: Number(item.maxBudgetUnits ?? 82),
    maxTasks: Number(item.maxTasks ?? 60),
    maxDepth: Number(item.maxDepth ?? 4),
    perNeed: Number(item.perNeed ?? 6),
    targetCompleteness: Number(item.targetCompleteness ?? 0.82),
  };
}

function countTaskStatuses(statuses: string[]) {
  const counts: Record<string, number> = { queued: 0, leased: 0, running: 0, complete: 0, blocked: 0, failed: 0, cancelled: 0 };
  for (const status of statuses) counts[status] = (counts[status] ?? 0) + 1;
  return counts;
}

function inferStopReason(summary: StoredSummary) {
  if (summary.results.length >= summary.maxTasks) return 'task-budget' as const;
  if (summary.budgetUnitsSpent >= summary.maxBudgetUnits) return 'research-budget' as const;
  return 'source-exhausted' as const;
}

function boundedInteger(value: number | undefined, fallback: number, min: number, max: number) {
  return typeof value === 'number' && Number.isFinite(value) ? Math.max(min, Math.min(max, Math.floor(value))) : fallback;
}

function boundedNumber(value: number | undefined, fallback: number, min: number, max: number) {
  return typeof value === 'number' && Number.isFinite(value) ? Math.max(min, Math.min(max, value)) : fallback;
}
