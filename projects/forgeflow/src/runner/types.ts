export type TaskType =
  | 'file.read'
  | 'file.write'
  | 'http.request'
  | 'delay'
  | 'transform'
  | 'collect'
  | 'shell.exec'
  | 'git.exec'
  | 'npm.run'
  | 'zip.create'
  | 'json.merge';

export interface PipelineSettings {
  maxConcurrency?: number;
  failFast?: boolean;
}

export interface PipelineDefinition {
  name: string;
  version: string;
  env?: Record<string, string>;
  settings?: PipelineSettings;
  tasks: PipelineTask[];
}

export interface PipelineTask {
  id: string;
  type: TaskType | string;
  dependsOn?: string[];
  with?: Record<string, unknown>;
  description?: string;
}

export type TaskStatus = 'pending' | 'running' | 'success' | 'failed' | 'skipped';

export interface TaskRunRecord {
  id: string;
  type: string;
  status: TaskStatus;
  startedAt: number;
  endedAt: number;
  durationMs: number;
  output?: unknown;
  error?: string;
  skipReason?: string;
}

export interface PipelineRunReport {
  runId: string;
  pipelineName: string;
  status: 'success' | 'failed' | 'partial';
  startedAt: number;
  endedAt: number;
  durationMs: number;
  settings: Required<PipelineSettings>;
  tasks: TaskRunRecord[];
  outputs: Record<string, unknown>;
}

export interface ValidationResult {
  valid: boolean;
  errors: string[];
  warnings: string[];
}
