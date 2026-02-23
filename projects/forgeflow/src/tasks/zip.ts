import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import { ExecutionContext } from '../runner/context';
import { PipelineTask } from '../runner/types';
import { runCommand } from './exec';

function resolvePath(ctx: ExecutionContext, target: string): string {
  if (path.isAbsolute(target)) return target;
  return path.join(ctx.cwd, target);
}

function normalizeSources(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.map(item => String(item));
}

function escapePowerShell(value: string): string {
  return `'${value.replace(/'/g, "''")}'`;
}

async function ensureWritable(target: string, overwrite: boolean): Promise<void> {
  if (!overwrite) {
    try {
      await fs.access(target);
      throw new Error('zip.create target already exists');
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code !== 'ENOENT') {
        throw err;
      }
    }
  }
  await fs.mkdir(path.dirname(target), { recursive: true });
}

export async function runZipCreate(
  task: PipelineTask,
  ctx: ExecutionContext,
  inputs: Record<string, unknown>
): Promise<unknown> {
  const target = typeof inputs.target === 'string' ? inputs.target : '';
  if (!target) {
    throw new Error('zip.create requires target');
  }
  const sources = normalizeSources(inputs.sources);
  if (sources.length === 0) {
    throw new Error('zip.create requires sources');
  }

  const cwd = typeof inputs.cwd === 'string' ? inputs.cwd : undefined;
  const overwrite = inputs.overwrite !== false;
  const timeoutMs = typeof inputs.timeoutMs === 'number' ? inputs.timeoutMs : undefined;
  const allowFailure = Boolean(inputs.allowFailure);

  const resolvedTarget = resolvePath(ctx, target);
  const resolvedSources = sources.map(source => resolvePath(ctx, source));

  await ensureWritable(resolvedTarget, overwrite);

  if (process.platform === 'win32') {
    const forceFlag = overwrite ? '-Force' : '';
    const sourceList = resolvedSources.map(escapePowerShell).join(',');
    const command = 'powershell';
    const script = `Compress-Archive -Path ${sourceList} -DestinationPath ${escapePowerShell(resolvedTarget)} ${forceFlag}`.trim();
    const args = ['-NoProfile', '-NonInteractive', '-Command', script];
    const result = await runCommand({
      command,
      args,
      cwd,
      timeoutMs,
      allowFailure
    }, ctx, task.type);

    return {
      ...result,
      task: task.id,
      target: resolvedTarget,
      sources: resolvedSources,
      method: 'powershell'
    };
  }

  const command = 'zip';
  const args = ['-r', resolvedTarget, ...resolvedSources];
  const result = await runCommand({
    command,
    args,
    cwd,
    timeoutMs,
    allowFailure
  }, ctx, task.type);

  return {
    ...result,
    task: task.id,
    target: resolvedTarget,
    sources: resolvedSources,
    method: 'zip'
  };
}
