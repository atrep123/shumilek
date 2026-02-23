import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import { ExecutionContext } from '../runner/context';
import { PipelineTask } from '../runner/types';

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function resolvePath(ctx: ExecutionContext, target: string): string {
  if (path.isAbsolute(target)) return target;
  return path.join(ctx.cwd, target);
}

function cloneValue(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(item => cloneValue(item));
  if (isPlainObject(value)) {
    const out: Record<string, unknown> = {};
    for (const [key, val] of Object.entries(value)) {
      out[key] = cloneValue(val);
    }
    return out;
  }
  return value;
}

function mergeValues(
  base: unknown,
  next: unknown,
  options: { deep: boolean; arrayMode: 'replace' | 'concat' }
): unknown {
  if (base === undefined) return cloneValue(next);
  if (next === undefined) return cloneValue(base);

  if (options.deep && Array.isArray(base) && Array.isArray(next)) {
    return options.arrayMode === 'concat'
      ? [...base, ...next].map(item => cloneValue(item))
      : cloneValue(next);
  }

  if (options.deep && isPlainObject(base) && isPlainObject(next)) {
    const out: Record<string, unknown> = { ...base };
    for (const [key, val] of Object.entries(next)) {
      out[key] = mergeValues(out[key], val, options);
    }
    return out;
  }

  return cloneValue(next);
}

async function readJsonFile(filePath: string): Promise<unknown> {
  const raw = await fs.readFile(filePath, 'utf-8');
  return JSON.parse(raw);
}

export async function runJsonMerge(
  task: PipelineTask,
  ctx: ExecutionContext,
  inputs: Record<string, unknown>
): Promise<unknown> {
  const sourcesInput = Array.isArray(inputs.sources) ? inputs.sources : [];
  if (sourcesInput.length === 0) {
    throw new Error('json.merge requires sources');
  }

  const deep = inputs.deep !== false;
  const arrayMode = inputs.arrayMode === 'concat' ? 'concat' : 'replace';
  const indent = typeof inputs.indent === 'number' ? Math.max(0, Math.floor(inputs.indent)) : 2;

  let merged: unknown = undefined;
  const sourceSummary: Array<{ type: string; value: string }> = [];

  for (const source of sourcesInput) {
    if (typeof source === 'string') {
      const resolved = resolvePath(ctx, source);
      const parsed = await readJsonFile(resolved);
      merged = mergeValues(merged, parsed, { deep, arrayMode });
      sourceSummary.push({ type: 'file', value: resolved });
      continue;
    }
    if (isPlainObject(source) || Array.isArray(source)) {
      merged = mergeValues(merged, source, { deep, arrayMode });
      sourceSummary.push({ type: 'inline', value: 'object' });
      continue;
    }
    throw new Error('json.merge sources must be file paths or objects');
  }

  const destination = typeof inputs.destination === 'string' ? inputs.destination : '';
  let writtenTo: string | undefined;

  if (destination) {
    const resolved = resolvePath(ctx, destination);
    await fs.mkdir(path.dirname(resolved), { recursive: true });
    await fs.writeFile(resolved, JSON.stringify(merged, null, indent), { encoding: 'utf-8' });
    writtenTo = resolved;
  }

  return {
    merged,
    destination: writtenTo,
    sources: sourceSummary,
    task: task.id
  };
}
