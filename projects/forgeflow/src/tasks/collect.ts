import { ExecutionContext, resolveContextPath } from '../runner/context';
import { PipelineTask } from '../runner/types';

export async function runCollect(
  task: PipelineTask,
  ctx: ExecutionContext,
  inputs: Record<string, unknown>
): Promise<unknown> {
  const sources = Array.isArray(inputs.sources) ? inputs.sources : [];
  const out: Record<string, unknown> = {};
  for (const source of sources) {
    if (typeof source !== 'string') continue;
    out[source] = resolveContextPath(ctx, source);
  }
  return { collected: out };
}
