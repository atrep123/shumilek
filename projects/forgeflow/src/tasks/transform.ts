import { ExecutionContext } from '../runner/context';
import { PipelineTask } from '../runner/types';

export async function runTransform(
  task: PipelineTask,
  ctx: ExecutionContext,
  inputs: Record<string, unknown>
): Promise<unknown> {
  const template = typeof inputs.template === 'string' ? inputs.template : '';
  return { result: template };
}
