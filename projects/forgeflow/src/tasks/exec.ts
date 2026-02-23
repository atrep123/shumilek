import * as path from 'node:path';
import { spawn } from 'node:child_process';
import { ExecutionContext } from '../runner/context';

export interface ExecOptions {
  command: string;
  args?: string[];
  cwd?: string;
  env?: Record<string, string>;
  timeoutMs?: number;
  shell?: boolean;
  stdin?: string;
  allowFailure?: boolean;
}

export interface ExecResult {
  command: string;
  args: string[];
  exitCode: number;
  stdout: string;
  stderr: string;
  durationMs: number;
  ok: boolean;
  timedOut: boolean;
}

function resolveWorkingDir(ctx: ExecutionContext, cwd?: string): string {
  if (!cwd) return ctx.cwd;
  return path.isAbsolute(cwd) ? cwd : path.join(ctx.cwd, cwd);
}

function normalizeEnv(env?: Record<string, string>): Record<string, string> | undefined {
  if (!env) return undefined;
  const output: Record<string, string> = {};
  for (const [key, value] of Object.entries(env)) {
    output[key] = String(value);
  }
  return output;
}

export async function runCommand(
  options: ExecOptions,
  ctx: ExecutionContext,
  label: string
): Promise<ExecResult> {
  const command = options.command;
  const args = options.args || [];
  const cwd = resolveWorkingDir(ctx, options.cwd);
  const env = { ...process.env, ...(normalizeEnv(options.env) || {}) } as Record<string, string>;
  const timeoutMs = typeof options.timeoutMs === 'number' && options.timeoutMs > 0
    ? Math.floor(options.timeoutMs)
    : 0;
  const shell = Boolean(options.shell);
  const allowFailure = Boolean(options.allowFailure);

  ctx.logger.debug(`Executing ${label}`, { command, args, cwd });

  const start = Date.now();
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      cwd,
      env,
      shell,
      windowsHide: true
    });

    let stdout = '';
    let stderr = '';
    let timedOut = false;
    let timer: NodeJS.Timeout | undefined;

    if (child.stdout) {
      child.stdout.on('data', chunk => {
        stdout += chunk.toString();
      });
    }

    if (child.stderr) {
      child.stderr.on('data', chunk => {
        stderr += chunk.toString();
      });
    }

    if (options.stdin && child.stdin) {
      child.stdin.write(options.stdin);
      child.stdin.end();
    }

    if (timeoutMs > 0) {
      timer = setTimeout(() => {
        timedOut = true;
        try {
          child.kill();
        } catch {
          // ignore
        }
      }, timeoutMs);
    }

    child.on('error', err => {
      if (timer) clearTimeout(timer);
      reject(err);
    });

    child.on('close', code => {
      if (timer) clearTimeout(timer);
      const exitCode = typeof code === 'number' ? code : -1;
      const durationMs = Date.now() - start;
      const ok = exitCode === 0 && !timedOut;
      const result: ExecResult = {
        command,
        args,
        exitCode,
        stdout,
        stderr,
        durationMs,
        ok,
        timedOut
      };

      if (!ok && !allowFailure) {
        const reason = timedOut ? 'timeout' : `exit ${exitCode}`;
        const error = new Error(`${label} failed: ${reason}`);
        (error as Error & { result?: ExecResult }).result = result;
        reject(error);
        return;
      }

      resolve(result);
    });
  });
}
