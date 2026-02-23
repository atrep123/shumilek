import { createLogger, Logger } from '../logger';
import { createContext, resolveContextPath } from './context';
import { registerBuiltInTasks, getTaskHandler } from './taskRegistry';
import { resolveTemplates } from './template';
import { validatePipeline } from './validator';
import {
  PipelineDefinition,
  PipelineRunReport,
  PipelineSettings,
  PipelineTask,
  TaskRunRecord,
  TaskStatus
} from './types';

export interface RunOptions {
  cwd?: string;
  env?: Record<string, string>;
  vars?: Record<string, unknown>;
  maxConcurrency?: number;
  failFast?: boolean;
  logger?: Logger;
  runId?: string;
}

function buildSettings(pipeline: PipelineDefinition, options: RunOptions): Required<PipelineSettings> {
  const maxConcurrency = pipeline.settings?.maxConcurrency ?? options.maxConcurrency ?? 1;
  const failFast = pipeline.settings?.failFast ?? options.failFast ?? true;
  return {
    maxConcurrency: Math.max(1, Math.floor(maxConcurrency)),
    failFast: Boolean(failFast)
  };
}

function generateRunId(): string {
  return `run_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
}

function buildTaskMaps(tasks: PipelineTask[]) {
  const taskMap = new Map<string, PipelineTask>();
  const dependents = new Map<string, string[]>();
  const dependencies = new Map<string, string[]>();

  for (const task of tasks) {
    const deps = Array.isArray(task.dependsOn) ? task.dependsOn : [];
    taskMap.set(task.id, task);
    dependencies.set(task.id, deps);
    for (const dep of deps) {
      if (!dependents.has(dep)) dependents.set(dep, []);
      dependents.get(dep)!.push(task.id);
    }
  }

  return { taskMap, dependents, dependencies };
}

export async function runPipeline(
  pipeline: PipelineDefinition,
  options: RunOptions = {}
): Promise<PipelineRunReport> {
  const validation = validatePipeline(pipeline);
  if (!validation.valid) {
    throw new Error(`Pipeline validation failed: ${validation.errors.join(' | ')}`);
  }

  registerBuiltInTasks();

  const runId = options.runId || generateRunId();
  const logger = options.logger || createLogger('info');
  const cwd = options.cwd || process.cwd();
  const settings = buildSettings(pipeline, options);

  const context = createContext(pipeline, {
    cwd,
    env: options.env,
    vars: options.vars,
    runId,
    logger
  });
  if (!context.env.projectRoot) {
    context.env.projectRoot = cwd;
  }

  const { taskMap, dependents, dependencies } = buildTaskMaps(pipeline.tasks);
  const status = new Map<string, TaskStatus>();
  const records = new Map<string, TaskRunRecord>();
  const readyQueue: string[] = [];
  const running = new Map<string, Promise<void>>();

  for (const task of pipeline.tasks) {
    status.set(task.id, 'pending');
    const deps = dependencies.get(task.id) || [];
    if (deps.length === 0) readyQueue.push(task.id);
  }

  const startTask = (taskId: string) => {
    const task = taskMap.get(taskId);
    if (!task) return;
    status.set(taskId, 'running');
    const startedAt = Date.now();

    const handler = getTaskHandler(task.type);
    if (!handler) {
      const record: TaskRunRecord = {
        id: taskId,
        type: task.type,
        status: 'failed',
        startedAt,
        endedAt: Date.now(),
        durationMs: 0,
        error: `Unknown task type: ${task.type}`
      };
      records.set(taskId, record);
      status.set(taskId, 'failed');
      return;
    }

    const taskPromise = (async () => {
      let endedAt = startedAt;
      try {
        const inputs = resolveTemplates(task.with || {}, path => resolveContextPath(context, path));
        const output = await handler(task, context, inputs as Record<string, unknown>);
        endedAt = Date.now();
        const record: TaskRunRecord = {
          id: taskId,
          type: task.type,
          status: 'success',
          startedAt,
          endedAt,
          durationMs: endedAt - startedAt,
          output
        };
        records.set(taskId, record);
        status.set(taskId, 'success');
        context.taskOutputs[taskId] = output;
      } catch (err) {
        endedAt = Date.now();
        const record: TaskRunRecord = {
          id: taskId,
          type: task.type,
          status: 'failed',
          startedAt,
          endedAt,
          durationMs: endedAt - startedAt,
          error: String(err)
        };
        records.set(taskId, record);
        status.set(taskId, 'failed');
      }
    })();

    running.set(taskId, taskPromise);
    taskPromise.finally(() => {
      running.delete(taskId);
    });
  };

  const markSkipped = (taskId: string, reason: string) => {
    if (status.get(taskId) === 'skipped' || status.get(taskId) === 'success') return;
    if (status.get(taskId) === 'failed') return;
    const now = Date.now();
    records.set(taskId, {
      id: taskId,
      type: taskMap.get(taskId)?.type || 'unknown',
      status: 'skipped',
      startedAt: now,
      endedAt: now,
      durationMs: 0,
      skipReason: reason
    });
    status.set(taskId, 'skipped');
    for (const dep of dependents.get(taskId) || []) {
      markSkipped(dep, `Dependency ${taskId} skipped`);
    }
  };

  const updateQueue = (completedId: string) => {
    for (const dependent of dependents.get(completedId) || []) {
      const depList = dependencies.get(dependent) || [];
      const hasFailedDep = depList.some(dep => ['failed', 'skipped'].includes(status.get(dep) || 'pending'));
      if (hasFailedDep) {
        markSkipped(dependent, `Dependency ${completedId} failed`);
        continue;
      }
      const allDone = depList.every(dep => status.get(dep) === 'success');
      if (allDone && status.get(dependent) === 'pending') {
        readyQueue.push(dependent);
      }
    }
  };

  while (records.size < pipeline.tasks.length) {
    while (running.size < settings.maxConcurrency && readyQueue.length > 0) {
      const next = readyQueue.shift()!;
      if (status.get(next) !== 'pending') continue;
      startTask(next);
    }

    if (running.size === 0) {
      const pending = pipeline.tasks.filter(task => status.get(task.id) === 'pending');
      if (pending.length > 0) {
        for (const task of pending) {
          markSkipped(task.id, 'No runnable dependencies (cycle or missing dependency).');
        }
      }
      break;
    }

    const finishedId = await Promise.race(
      Array.from(running.keys()).map(id => running.get(id)!.then(() => id))
    );

    updateQueue(finishedId);

    if (settings.failFast && status.get(finishedId) === 'failed') {
      for (const task of pipeline.tasks) {
        if (status.get(task.id) === 'pending') {
          markSkipped(task.id, `Fail-fast after ${finishedId}`);
        }
      }
      break;
    }
  }

  const taskRecords = pipeline.tasks.map(task => records.get(task.id)!).filter(Boolean);
  const anyFailed = taskRecords.some(record => record.status === 'failed');
  const anySkipped = taskRecords.some(record => record.status === 'skipped');
  const statusSummary = anyFailed ? 'failed' : (anySkipped ? 'partial' : 'success');
  const endedAt = Date.now();

  return {
    runId,
    pipelineName: pipeline.name,
    status: statusSummary,
    startedAt: context.meta.startedAt,
    endedAt,
    durationMs: endedAt - context.meta.startedAt,
    settings,
    tasks: taskRecords,
    outputs: context.taskOutputs
  };
}
