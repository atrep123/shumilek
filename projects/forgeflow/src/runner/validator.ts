import { PipelineDefinition, PipelineTask, ValidationResult } from './types';

const ALLOWED_TYPES = new Set([
  'file.read',
  'file.write',
  'http.request',
  'delay',
  'transform',
  'collect',
  'shell.exec',
  'git.exec',
  'npm.run',
  'zip.create',
  'json.merge'
]);

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function normalizeTasks(tasks: PipelineTask[]): PipelineTask[] {
  return tasks.map(task => ({
    ...task,
    dependsOn: Array.isArray(task.dependsOn) ? task.dependsOn : []
  }));
}

function detectCycles(tasks: PipelineTask[]): string[] {
  const errors: string[] = [];
  const graph = new Map<string, string[]>();
  for (const task of tasks) {
    graph.set(task.id, task.dependsOn || []);
  }

  const visiting = new Set<string>();
  const visited = new Set<string>();

  const visit = (node: string, path: string[]) => {
    if (visiting.has(node)) {
      errors.push(`Cycle detected: ${[...path, node].join(' -> ')}`);
      return;
    }
    if (visited.has(node)) return;
    visiting.add(node);
    const deps = graph.get(node) || [];
    for (const dep of deps) {
      visit(dep, [...path, node]);
    }
    visiting.delete(node);
    visited.add(node);
  };

  for (const task of tasks) {
    visit(task.id, []);
  }

  return errors;
}

export function validatePipeline(pipeline: unknown): ValidationResult {
  const errors: string[] = [];
  const warnings: string[] = [];

  if (!isRecord(pipeline)) {
    return { valid: false, errors: ['Pipeline must be a JSON object.'], warnings };
  }

  const name = pipeline.name;
  const version = pipeline.version;
  const tasks = pipeline.tasks;

  if (typeof name !== 'string' || !name.trim()) {
    errors.push('Pipeline.name must be a non-empty string.');
  }
  if (typeof version !== 'string' || !version.trim()) {
    errors.push('Pipeline.version must be a non-empty string.');
  }

  if (!Array.isArray(tasks) || tasks.length === 0) {
    errors.push('Pipeline.tasks must be a non-empty array.');
    return { valid: errors.length === 0, errors, warnings };
  }

  const normalized = normalizeTasks(tasks as PipelineTask[]);
  const ids = new Set<string>();

  for (const task of normalized) {
    if (typeof task.id !== 'string' || !task.id.trim()) {
      errors.push('Task.id must be a non-empty string.');
      continue;
    }
    if (!/^[a-zA-Z][a-zA-Z0-9_-]*$/.test(task.id)) {
      errors.push(`Task.id '${task.id}' must match /^[a-zA-Z][a-zA-Z0-9_-]*$/.`);
    }
    if (ids.has(task.id)) {
      errors.push(`Task.id '${task.id}' is duplicated.`);
    }
    ids.add(task.id);

    if (typeof task.type !== 'string' || !task.type.trim()) {
      errors.push(`Task '${task.id}' has missing type.`);
    } else if (!ALLOWED_TYPES.has(task.type)) {
      warnings.push(`Task '${task.id}' uses unknown type '${task.type}'.`);
    }

    if (task.dependsOn) {
      for (const dep of task.dependsOn) {
        if (typeof dep !== 'string') {
          errors.push(`Task '${task.id}' has non-string dependency.`);
        }
      }
    }
  }

  for (const task of normalized) {
    for (const dep of task.dependsOn || []) {
      if (!ids.has(dep)) {
        errors.push(`Task '${task.id}' depends on missing task '${dep}'.`);
      }
    }
  }

  errors.push(...detectCycles(normalized));

  return { valid: errors.length === 0, errors, warnings };
}
