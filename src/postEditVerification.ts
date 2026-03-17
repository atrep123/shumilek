import * as vscode from 'vscode';
import { exec as childProcessExec } from 'child_process';
import { VerificationCommandResult, VerificationSummary } from './validationPipeline';

export interface PostEditVerificationDeps {
  exec?: typeof childProcessExec;
  readFile?: typeof vscode.workspace.fs.readFile;
  workspaceFolders?: readonly vscode.WorkspaceFolder[] | undefined;
  joinPath?: typeof vscode.Uri.joinPath;
}

export async function runVerificationCommand(
  command: string,
  cwd: string,
  timeoutMs: number,
  execImpl: typeof childProcessExec = childProcessExec
): Promise<VerificationCommandResult> {
  return await new Promise(resolve => {
    execImpl(command, { cwd, windowsHide: true, timeout: timeoutMs, env: process.env, maxBuffer: 4 * 1024 * 1024 }, (err, stdout, stderr) => {
      const exitCode = err ? (typeof (err as any).code === 'number' ? (err as any).code : null) : 0;
      resolve({
        command,
        ok: !err,
        exitCode,
        stdout: String(stdout ?? ''),
        stderr: String(stderr ?? '')
      });
    });
  });
}

export async function runPostEditVerification(
  timeoutMs: number,
  deps: PostEditVerificationDeps = {}
): Promise<VerificationSummary> {
  const folders = deps.workspaceFolders ?? vscode.workspace.workspaceFolders;
  if (!folders || folders.length === 0) {
    return { ok: true, ran: [], failed: [] };
  }

  const root = folders[0].uri;
  const joinPath = deps.joinPath ?? vscode.Uri.joinPath;
  const packageUri = joinPath(root, 'package.json');
  const readFile = deps.readFile ?? vscode.workspace.fs.readFile.bind(vscode.workspace.fs);

  let scripts: Record<string, unknown> = {};
  try {
    const raw = await readFile(packageUri);
    const pkg = JSON.parse(Buffer.from(raw).toString('utf8'));
    scripts = (pkg?.scripts && typeof pkg.scripts === 'object') ? pkg.scripts : {};
  } catch {
    return { ok: true, ran: [], failed: [] };
  }

  const commands: string[] = [];
  if (typeof scripts.lint === 'string') commands.push('npm run -s lint');
  if (typeof scripts.test === 'string') commands.push('npm run -s test');
  if (typeof scripts.build === 'string') commands.push('npm run -s build');
  if (commands.length === 0) return { ok: true, ran: [], failed: [] };

  const cwd = root.fsPath;
  const execImpl = deps.exec ?? childProcessExec;
  const ran: VerificationCommandResult[] = [];
  for (const command of commands.slice(0, 3)) {
    const result = await runVerificationCommand(command, cwd, timeoutMs, execImpl);
    ran.push(result);
    if (!result.ok) break;
  }

  const failed = ran.filter(r => !r.ok);
  return { ok: failed.length === 0, ran, failed };
}