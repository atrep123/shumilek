import * as fs from 'node:fs';
import * as path from 'node:path';
import { LogLevel } from './logger';

export interface Config {
  projectRoot: string;
  reportDir: string;
  maxConcurrency: number;
  failFast: boolean;
  serverPort: number;
  logLevel: LogLevel;
}

const CONFIG_FILES = ['forgeflow.config.json', '.forgeflowrc.json'];

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function readConfigFile(filePath: string): Record<string, unknown> | null {
  try {
    if (!fs.existsSync(filePath)) return null;
    const raw = fs.readFileSync(filePath, 'utf-8');
    const parsed = JSON.parse(raw);
    return isRecord(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

export function loadConfig(cwd: string = process.cwd()): Config {
  let configData: Record<string, unknown> = {};
  for (const file of CONFIG_FILES) {
    const candidate = path.join(cwd, file);
    const loaded = readConfigFile(candidate);
    if (loaded) {
      configData = loaded;
      break;
    }
  }

  const projectRoot = typeof configData.projectRoot === 'string'
    ? configData.projectRoot
    : cwd;

  return {
    projectRoot,
    reportDir: typeof configData.reportDir === 'string' ? configData.reportDir : 'reports',
    maxConcurrency: typeof configData.maxConcurrency === 'number' && configData.maxConcurrency > 0
      ? Math.floor(configData.maxConcurrency)
      : 1,
    failFast: typeof configData.failFast === 'boolean' ? configData.failFast : true,
    serverPort: typeof configData.serverPort === 'number' && configData.serverPort > 0
      ? Math.floor(configData.serverPort)
      : 7070,
    logLevel: (configData.logLevel as LogLevel) || 'info'
  };
}
