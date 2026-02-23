import { ExecutionContext } from './context';
import { PipelineTask } from './types';
import { runDelay } from '../tasks/delay';
import { runFileRead, runFileWrite } from '../tasks/file';
import { runHttpRequest } from '../tasks/http';
import { runTransform } from '../tasks/transform';
import { runCollect } from '../tasks/collect';
import { runShellExec } from '../tasks/shell';
import { runGitExec } from '../tasks/git';
import { runNpmRun } from '../tasks/npm';
import { runZipCreate } from '../tasks/zip';
import { runJsonMerge } from '../tasks/json';

export type TaskHandler = (
  task: PipelineTask,
  ctx: ExecutionContext,
  inputs: Record<string, unknown>
) => Promise<unknown>;

const registry = new Map<string, TaskHandler>();
let initialized = false;

export function registerBuiltInTasks(): void {
  if (initialized) return;
  registry.set('delay', runDelay);
  registry.set('file.read', runFileRead);
  registry.set('file.write', runFileWrite);
  registry.set('http.request', runHttpRequest);
  registry.set('transform', runTransform);
  registry.set('collect', runCollect);
  registry.set('shell.exec', runShellExec);
  registry.set('git.exec', runGitExec);
  registry.set('npm.run', runNpmRun);
  registry.set('zip.create', runZipCreate);
  registry.set('json.merge', runJsonMerge);
  initialized = true;
}

export function getTaskHandler(type: string): TaskHandler | undefined {
  return registry.get(type);
}
