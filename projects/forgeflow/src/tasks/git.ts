import { ExecutionContext } from '../runner/context';
import { PipelineTask } from '../runner/types';
import { runCommand } from './exec';

function normalizeArgs(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.map(item => String(item));
}

function normalizeEnv(value: unknown): Record<string, string> | undefined {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return undefined;
  const env: Record<string, string> = {};
  for (const [key, val] of Object.entries(value)) {
    env[key] = String(val);
  }
  return env;
}

export async function runGitExec(
  task: PipelineTask,
  ctx: ExecutionContext,
  inputs: Record<string, unknown>
): Promise<unknown> {
  const args = normalizeArgs(inputs.args);
  const cwd = typeof inputs.cwd === 'string' ? inputs.cwd : undefined;
  const env = normalizeEnv(inputs.env);
  const timeoutMs = typeof inputs.timeoutMs === 'number' ? inputs.timeoutMs : undefined;
  const allowFailure = Boolean(inputs.allowFailure);

  const result = await runCommand({
    command: 'git',
    args,
    cwd,
    env,
    timeoutMs,
    allowFailure
  }, ctx, task.type);

  return {
    ...result,
    task: task.id
  };
}
