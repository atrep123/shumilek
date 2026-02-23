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

function resolveNpmCommand(): string {
  return process.platform === 'win32' ? 'npm.cmd' : 'npm';
}

export async function runNpmRun(
  task: PipelineTask,
  ctx: ExecutionContext,
  inputs: Record<string, unknown>
): Promise<unknown> {
  const script = typeof inputs.script === 'string' ? inputs.script : '';
  if (!script) {
    throw new Error('npm.run requires script');
  }

  const args = normalizeArgs(inputs.args);
  const cwd = typeof inputs.cwd === 'string' ? inputs.cwd : undefined;
  const env = normalizeEnv(inputs.env);
  const timeoutMs = typeof inputs.timeoutMs === 'number' ? inputs.timeoutMs : undefined;
  const shell = typeof inputs.shell === 'boolean' ? inputs.shell : process.platform === 'win32';
  const allowFailure = Boolean(inputs.allowFailure);

  const npmArgs = ['run', script];
  if (args.length > 0) {
    npmArgs.push('--', ...args);
  }

  const result = await runCommand({
    command: resolveNpmCommand(),
    args: npmArgs,
    cwd,
    env,
    timeoutMs,
    shell,
    allowFailure
  }, ctx, task.type);

  return {
    ...result,
    task: task.id
  };
}
