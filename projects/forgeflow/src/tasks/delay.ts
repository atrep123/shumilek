import { ExecutionContext } from '../runner/context';
import { PipelineTask } from '../runner/types';

export async function runDelay(
  task: PipelineTask,
  ctx: ExecutionContext,
  inputs: Record<string, unknown>
): Promise<unknown> {
  const msValue = inputs.ms;
  const ms = typeof msValue === 'number' && msValue >= 0 ? msValue : 0;
  ctx.logger.debug(`Delay ${ms}ms`, { task: task.id });
  await new Promise(resolve => setTimeout(resolve, ms));
  return { ms };
}
