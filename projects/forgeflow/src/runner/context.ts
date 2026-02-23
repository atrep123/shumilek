import { Logger } from '../logger';
import { PipelineDefinition } from './types';
import { getPathValue } from './template';

export interface ExecutionContext {
  cwd: string;
  env: Record<string, string>;
  vars: Record<string, unknown>;
  taskOutputs: Record<string, unknown>;
  meta: {
    runId: string;
    startedAt: number;
  };
  logger: Logger;
}

export function createContext(
  pipeline: PipelineDefinition,
  options: {
    cwd: string;
    env?: Record<string, string>;
    vars?: Record<string, unknown>;
    runId: string;
    logger: Logger;
  }
): ExecutionContext {
  return {
    cwd: options.cwd,
    env: { ...(pipeline.env || {}), ...(options.env || {}) },
    vars: { ...(options.vars || {}) },
    taskOutputs: {},
    meta: {
      runId: options.runId,
      startedAt: Date.now()
    },
    logger: options.logger
  };
}

export function resolveContextPath(ctx: ExecutionContext, path: string): unknown {
  const [root, ...rest] = path.split('.');
  const remainder = rest.join('.');
  if (root === 'env') {
    return remainder ? getPathValue(ctx.env as Record<string, unknown>, remainder) : ctx.env;
  }
  if (root === 'vars') {
    return remainder ? getPathValue(ctx.vars, remainder) : ctx.vars;
  }
  if (root === 'tasks') {
    return remainder ? getPathValue(ctx.taskOutputs, remainder) : ctx.taskOutputs;
  }
  if (root === 'meta') {
    return remainder ? getPathValue(ctx.meta as Record<string, unknown>, remainder) : ctx.meta;
  }
  return getPathValue({ env: ctx.env, vars: ctx.vars, tasks: ctx.taskOutputs, meta: ctx.meta }, path);
}
