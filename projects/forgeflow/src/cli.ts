import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import { loadConfig } from './config';
import { createLogger } from './logger';
import { runPipeline } from './runner/pipelineRunner';
import { validatePipeline } from './runner/validator';
import { writeReport } from './runner/reporter';
import { startServer } from './server';
import { PipelineDefinition } from './runner/types';

type FlagValue = string | boolean;

function parseArgs(argv: string[]): { command: string; args: string[]; flags: Record<string, FlagValue> } {
  const flags: Record<string, FlagValue> = {};
  const args: string[] = [];
  let command = '';

  for (let i = 0; i < argv.length; i += 1) {
    const token = argv[i];
    if (!command && !token.startsWith('-')) {
      command = token;
      continue;
    }
    if (token.startsWith('--')) {
      const [key, inlineValue] = token.slice(2).split('=');
      if (inlineValue !== undefined) {
        flags[key] = inlineValue;
      } else {
        const next = argv[i + 1];
        if (next && !next.startsWith('-')) {
          flags[key] = next;
          i += 1;
        } else {
          flags[key] = true;
        }
      }
    } else if (token.startsWith('-')) {
      flags[token.slice(1)] = true;
    } else {
      args.push(token);
    }
  }

  return { command, args, flags };
}

function printHelp(): void {
  console.log(`ForgeFlow CLI\n\nCommands:\n  init <dir>             Create sample config and pipeline\n  validate <file>        Validate a pipeline JSON\n  run <file>             Run a pipeline JSON\n  serve                  Start HTTP API server\n\nOptions:\n  --report <path>        Write run report to a JSON file\n  --json                 Output validation or run report as JSON\n  --port <port>          Port for HTTP server\n  --cwd <dir>            Working directory for pipeline execution\n`);
}

async function readPipeline(filePath: string): Promise<PipelineDefinition> {
  const raw = await fs.readFile(filePath, 'utf-8');
  return JSON.parse(raw) as PipelineDefinition;
}

async function handleInit(dir: string): Promise<void> {
  const target = path.resolve(dir);
  await fs.mkdir(target, { recursive: true });
  const configPath = path.join(target, 'forgeflow.config.json');
  const pipelinePath = path.join(target, 'sample.pipeline.json');

  const config = {
    projectRoot: '.',
    reportDir: 'reports',
    maxConcurrency: 2,
    failFast: true,
    serverPort: 7070,
    logLevel: 'info'
  };

  await fs.writeFile(configPath, JSON.stringify(config, null, 2), { encoding: 'utf-8' });

  const sampleSource = path.join(__dirname, '..', 'examples', 'sample.pipeline.json');
  await fs.copyFile(sampleSource, pipelinePath);

  console.log(`Initialized in ${target}`);
}

async function handleValidate(filePath: string, jsonOutput: boolean): Promise<void> {
  const pipeline = await readPipeline(filePath);
  const validation = validatePipeline(pipeline);
  if (jsonOutput) {
    console.log(JSON.stringify(validation, null, 2));
  } else {
    if (validation.valid) {
      console.log('Pipeline is valid.');
    } else {
      console.error('Pipeline is invalid:');
      for (const error of validation.errors) {
        console.error(`- ${error}`);
      }
    }
    if (validation.warnings.length > 0) {
      console.warn('Warnings:');
      for (const warning of validation.warnings) {
        console.warn(`- ${warning}`);
      }
    }
  }

  if (!validation.valid) process.exit(1);
}

async function handleRun(filePath: string, flags: Record<string, FlagValue>): Promise<void> {
  const config = loadConfig(process.cwd());
  const logger = createLogger(config.logLevel);
  const pipeline = await readPipeline(filePath);
  const report = await runPipeline(pipeline, {
    cwd: typeof flags.cwd === 'string' ? flags.cwd : config.projectRoot,
    maxConcurrency: config.maxConcurrency,
    failFast: config.failFast,
    logger
  });

  const reportPath = typeof flags.report === 'string'
    ? flags.report
    : path.join(config.reportDir, `${pipeline.name}-${report.runId}.json`);

  await writeReport(report, reportPath);

  if (flags.json) {
    console.log(JSON.stringify(report, null, 2));
  } else {
    console.log(`Run completed with status: ${report.status}`);
    console.log(`Report: ${reportPath}`);
  }

  if (report.status === 'failed') process.exit(1);
}

async function handleServe(flags: Record<string, FlagValue>): Promise<void> {
  const port = typeof flags.port === 'string' ? Number(flags.port) : undefined;
  await startServer(port);
}

async function main(): Promise<void> {
  const { command, args, flags } = parseArgs(process.argv.slice(2));
  if (!command || command === 'help' || command === '--help') {
    printHelp();
    return;
  }

  if (command === 'init') {
    const dir = args[0];
    if (!dir) {
      console.error('init requires a target directory');
      process.exit(1);
    }
    await handleInit(dir);
    return;
  }

  if (command === 'validate') {
    const filePath = args[0];
    if (!filePath) {
      console.error('validate requires a pipeline file');
      process.exit(1);
    }
    await handleValidate(filePath, Boolean(flags.json));
    return;
  }

  if (command === 'run') {
    const filePath = args[0];
    if (!filePath) {
      console.error('run requires a pipeline file');
      process.exit(1);
    }
    await handleRun(filePath, flags);
    return;
  }

  if (command === 'serve') {
    await handleServe(flags);
    return;
  }

  console.error(`Unknown command: ${command}`);
  printHelp();
  process.exit(1);
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});
