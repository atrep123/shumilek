import { ExecutionContext } from '../runner/context';
import { PipelineTask } from '../runner/types';
import { runCommand } from './exec';

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function normalizeArgs(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.map(item => String(item));
}

function normalizeEnv(value: unknown): Record<string, string> | undefined {
  if (!isRecord(value)) return undefined;
  const env: Record<string, string> = {};
  for (const [key, val] of Object.entries(value)) {
    env[key] = String(val);
  }
  return env;
}

export async function runShellExec(
  task: PipelineTask,
  ctx: ExecutionContext,
  inputs: Record<string, unknown>
): Promise<unknown> {
  const command = typeof inputs.command === 'string' ? inputs.command : '';
  if (!command) {
    throw new Error('shell.exec requires command');
  }

  const args = normalizeArgs(inputs.args);
  const cwd = typeof inputs.cwd === 'string' ? inputs.cwd : undefined;
  const env = normalizeEnv(inputs.env);
  const timeoutMs = typeof inputs.timeoutMs === 'number' ? inputs.timeoutMs : undefined;
  const shell = Boolean(inputs.shell);
  const stdin = typeof inputs.stdin === 'string' ? inputs.stdin : undefined;
  const allowFailure = Boolean(inputs.allowFailure);

  const result = await runCommand({
    command,
    args,
    cwd,
    env,
    timeoutMs,
    shell,
    stdin,
    allowFailure
  }, ctx, task.type);

  return {
    ...result,
    task: task.id
  };
}
