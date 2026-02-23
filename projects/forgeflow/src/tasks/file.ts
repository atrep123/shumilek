import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import { ExecutionContext } from '../runner/context';
import { PipelineTask } from '../runner/types';

function resolvePath(ctx: ExecutionContext, target: string): string {
  if (path.isAbsolute(target)) return target;
  return path.join(ctx.cwd, target);
}

export async function runFileRead(
  task: PipelineTask,
  ctx: ExecutionContext,
  inputs: Record<string, unknown>
): Promise<unknown> {
  const target = typeof inputs.path === 'string' ? inputs.path : '';
  if (!target) {
    throw new Error('file.read requires a path');
  }
  const resolved = resolvePath(ctx, target);
  const encoding = typeof inputs.encoding === 'string' ? inputs.encoding : 'utf-8';
  const maxBytes = typeof inputs.maxBytes === 'number' && inputs.maxBytes > 0
    ? Math.floor(inputs.maxBytes)
    : undefined;

  const stat = await fs.stat(resolved);
  let content = '';
  let truncated = false;
  if (!maxBytes || stat.size <= maxBytes) {
    content = await fs.readFile(resolved, { encoding: encoding as BufferEncoding });
  } else {
    const buffer = await fs.readFile(resolved);
    content = buffer.subarray(0, maxBytes).toString(encoding as BufferEncoding);
    truncated = true;
  }

  const lines = content ? content.split(/\r?\n/).length : 0;
  return {
    path: resolved,
    bytes: stat.size,
    lines,
    truncated,
    content
  };
}

export async function runFileWrite(
  task: PipelineTask,
  ctx: ExecutionContext,
  inputs: Record<string, unknown>
): Promise<unknown> {
  const target = typeof inputs.path === 'string' ? inputs.path : '';
  if (!target) {
    throw new Error('file.write requires a path');
  }
  const resolved = resolvePath(ctx, target);
  const encoding = typeof inputs.encoding === 'string' ? inputs.encoding : 'utf-8';
  const content = typeof inputs.content === 'string' ? inputs.content : '';

  await fs.mkdir(path.dirname(resolved), { recursive: true });
  await fs.writeFile(resolved, content, { encoding: encoding as BufferEncoding });

  return {
    path: resolved,
    bytes: Buffer.byteLength(content, encoding as BufferEncoding)
  };
}
