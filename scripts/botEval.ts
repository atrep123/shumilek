import * as fs from 'fs';
import * as path from 'path';
import { exec } from 'child_process';
import fetch from 'node-fetch';

type FileSpec = { path: string; content: string };
type ModelOutput = { files: FileSpec[]; notes?: string; mode?: 'full' | 'patch' };
type OllamaOptions = { temperature?: number; num_predict?: number; seed?: number };
type PlannerOutput = { plan: string };
type ParseErrorKind = 'json_parse' | 'schema' | 'placeholder' | 'other';

type StructuredGenerationMeta = {
  transport: 'chat' | 'generate';
  formatKind: 'schema' | 'json' | 'none';
  schemaUsed: boolean;
  fallbackUsed: boolean;
  usedFormatJson: boolean;
  fallbackReason?: string;
  doneReason?: string;
  evalCount?: number;
  promptEvalCount?: number;
  effectiveOptions?: OllamaOptions;
};

type ParseAttemptReport = {
  stage: 'initial' | 'retry_truncation' | 'repair_syntax' | 'repair_schema' | 'scenario_contract';
  model: string;
  ok: boolean;
  error?: string;
  errorKind?: ParseErrorKind;
  transport?: StructuredGenerationMeta['transport'];
  formatKind?: StructuredGenerationMeta['formatKind'];
  schemaUsed?: boolean;
  fallbackUsed?: boolean;
};

type ParseReport = {
  primaryError?: string;
  primaryErrorKind?: ParseErrorKind;
  attempts: ParseAttemptReport[];
  finalOk: boolean;
  finalError?: string;
  finalErrorKind?: ParseErrorKind;
};

type ParseStats = {
  plannerFailures: number;
  schemaFailures: number;
  jsonRepairFailures: number;
  parseFailures: number;
  jsonParseFailures: number;
  placeholderFailures: number;
  otherFailures: number;
};

type DeterministicFallbackMode = 'off' | 'on-fail' | 'always';
type DeterministicFallbackTier = 'targeted' | 'canonical';

type ScenarioFallbackStats = {
  activations: number;
  recoveries: number;
  targetedActivations: number;
  targetedRecoveries: number;
  canonicalActivations: number;
  canonicalRecoveries: number;
  rawPasses: number;
  rawFailures: number;
  recoveredByFallback: number;
};

type DeterministicFallbackStats = {
  mode: DeterministicFallbackMode;
  tsTodo: ScenarioFallbackStats;
  nodeApi: ScenarioFallbackStats;
  totalActivations: number;
  totalRecoveries: number;
  totalTargetedActivations: number;
  totalTargetedRecoveries: number;
  totalCanonicalActivations: number;
  totalCanonicalRecoveries: number;
  totalRawPasses: number;
  totalRawFailures: number;
  totalRecoveredByFallback: number;
  fallbackDependencyRate: number;
};

type EvalRunContext = {
  deterministicFallbackMode: DeterministicFallbackMode;
  deterministicFallbackStats: DeterministicFallbackStats;
};

const STRUCTURED_MIN_NUM_PREDICT = 6000;
const STRUCTURED_RETRY_MIN_NUM_PREDICT = 10000;
const PLANNER_MIN_NUM_PREDICT = 1200;

function readPositiveIntEnv(name: string, fallback: number): number {
  const raw = Number(process.env[name]);
  if (!Number.isFinite(raw) || raw <= 0) return fallback;
  return Math.max(1, Math.trunc(raw));
}

const OLLAMA_RETRY_ATTEMPTS = readPositiveIntEnv('BOT_EVAL_OLLAMA_RETRY_ATTEMPTS', 3);
const OLLAMA_RETRY_BASE_DELAY_MS = readPositiveIntEnv('BOT_EVAL_OLLAMA_RETRY_BASE_DELAY_MS', 350);
const OLLAMA_RETRY_MAX_DELAY_MS = readPositiveIntEnv('BOT_EVAL_OLLAMA_RETRY_MAX_DELAY_MS', 3000);

const MODEL_OUTPUT_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['files'],
  properties: {
    mode: {
      type: 'string',
      enum: ['full', 'patch']
    },
    files: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['path', 'content'],
        properties: {
          path: { type: 'string' },
          content: { type: 'string' }
        }
      }
    },
    notes: { type: 'string' }
  }
} as const;

const PLANNER_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['plan'],
  properties: {
    plan: { type: 'string' }
  }
} as const;

type CliOptions = {
  baseUrl: string;
  plannerModel?: string;
  model: string;
  reviewerModel?: string;
  jsonRepairModel?: string;
  deterministicFallbackMode: DeterministicFallbackMode;
  scenario: string;
  timeoutSec: number;
  maxIterations: number;
  temperature?: number;
  numPredict?: number;
  seed?: number;
  outDir?: string;
  listScenarios: boolean;
};

type Scenario = {
  id: string;
  title: string;
  prompt: string;
  validate: (workspaceDir: string, context: EvalRunContext) => Promise<ValidationResult>;
};

const ORACLE_PYTHON_AI_DIR = path.join(__dirname, 'botEval', 'oracle', 'python_ai');
let ORACLE_PYTHON_AI_TESTS_SNIPPET = '';
try {
  ORACLE_PYTHON_AI_TESTS_SNIPPET = fs.readFileSync(path.join(ORACLE_PYTHON_AI_DIR, 'tests', 'test_oracle.py'), 'utf8');
} catch {
  ORACLE_PYTHON_AI_TESTS_SNIPPET = '# (oracle tests missing on disk)';
}

const ORACLE_TS_TODO_DIR = path.join(__dirname, 'botEval', 'oracle', 'ts_todo');
let ORACLE_TS_TODO_TESTS_SNIPPET = '';
try {
  ORACLE_TS_TODO_TESTS_SNIPPET = fs.readFileSync(path.join(ORACLE_TS_TODO_DIR, 'tests', 'oracle.test.js'), 'utf8');
} catch {
  ORACLE_TS_TODO_TESTS_SNIPPET = '// (oracle tests missing on disk)';
}

const ORACLE_NODE_API_DIR = path.join(__dirname, 'botEval', 'oracle', 'node_api');
let ORACLE_NODE_API_TESTS_SNIPPET = '';
try {
  ORACLE_NODE_API_TESTS_SNIPPET = fs.readFileSync(path.join(ORACLE_NODE_API_DIR, 'tests', 'oracle.test.js'), 'utf8');
} catch {
  ORACLE_NODE_API_TESTS_SNIPPET = '// (oracle tests missing on disk)';
}

const SCENARIOS: Scenario[] = [
  {
    id: 'python-ai-stdlib',
    title: 'Python AI mini-project (stdlib-only) with tests',
    prompt: [
      'Vytvor maly, ale realisticky Python projekt pro "AI" bez externich zavislosti.',
      '',
      'Pozadavky:',
      '- Pouze standardni knihovna Pythonu (zadne numpy/pandas/sklearn/torch/tensorflow/requests).',
      '- Struktura projektu jako balicek `mini_ai/` + `tests/` + `README.md`.',
      '- Implementuj jednoduchy model: napr. character-level Markov chain generator + trenovani z textu.',
      '- Pridat CLI: `python -m mini_ai.cli --help`, `train`, `generate` (offline).',
      '- Unit testy pres `unittest` (aspon 8 testu / assertu) a musi prochazet.',
      '',
      'VYSTUPNI FORMAT (STRICT): vrat JEN JSON objekt tohoto tvaru:',
      '{',
      '  "mode": "full",',
      '  "files": [',
      '    {"path": "README.md", "content": "...\\n"},',
      '    {"path": "mini_ai/__init__.py", "content": "...\\n"},',
      '    {"path": "mini_ai/...", "content": "...\\n"},',
      '    {"path": "tests/test_....py", "content": "...\\n"}',
      '  ],',
      '  "notes": "optional"',
      '}',
      '',
      'Pravidla:',
      '- Zadny markdown, zadne ``` bloky, zadny text mimo JSON.',
      '- Cesty jsou relativni, pouzij `/`, bez `..` a bez absolutnich cest.',
      '- Kazdy soubor ukonci znakem noveho radku.',
      '- "mode" pouzij "full" pro kompletni projekt (v pripade oprav muzes pouzit "patch").',
      '- `content` je vzdy kompletni obsah souboru (ne diff/snippet).',
    ].join('\n'),
    validate: async (workspaceDir: string, _context: EvalRunContext) => validatePythonAiStdlib(workspaceDir),
  },
  {
    id: 'python-ai-stdlib-oracle',
    title: 'Python AI mini-project (stdlib-only) validated with oracle tests',
    prompt: [
      'Vytvor maly, ale realisticky Python projekt pro "AI" bez externich zavislosti.',
      '',
      'Cil: implementuj character-level Markov chain generator (n-gram) jako balicek `mini_ai/` + dokumentace `README.md`.',
      '',
      'POZADAVKY / KONTRAKT (musis splnit):',
      '- Pouze standardni knihovna Pythonu (zadne numpy/pandas/sklearn/torch/tensorflow/requests).',
      '- Modul `mini_ai/markov.py` musi obsahovat:',
      '  - class MarkovChain(order: int = 1)',
      '  - def train(self, text: str) -> None',
      '  - def generate(self, length: int, seed: str | None = None, random_seed: int | None = None) -> str',
      '  - def to_dict(self) -> dict  (JSON-serializovatelny; klice: "order", "transitions")',
      '  - @classmethod def from_dict(cls, d: dict) -> "MarkovChain"  (nebo pouzij `from __future__ import annotations`)',
      '- Pozor: type hinty nesmi shodit import (v Python 3.12 pouzij future-annotations nebo string forward refs).',
      '- Reprezentace transitions v to_dict:',
      '  - transitions: dict[context: str, dict[next_char: str, count: int]]',
      '  - context je string delky = order.',
      '- `mini_ai/cli.py` musi obsahovat:',
      '  - def main(argv: list[str] | None = None) -> int  (nech argumenty pres argparse)',
      '  - subcommand train: --input <path> --model-out <path> --order <int>',
      '  - subcommand generate: --model <path> --length <int> [--seed <str>] [--random-seed <int>]',
      '  - `python -m mini_ai.cli --help` musi vratit exit code 0',
      '',
      'Poznamka: testy budeme pouzivat tyto (musis projit):',
      '--- BEGIN ORACLE TESTS (tests/test_oracle.py) ---',
      ORACLE_PYTHON_AI_TESTS_SNIPPET.trimEnd(),
      '--- END ORACLE TESTS ---',
      '',
      'VYSTUPNI FORMAT (STRICT): vrat JEN JSON objekt tohoto tvaru:',
      '{',
      '  "mode": "full",',
      '  "files": [',
      '    {"path": "README.md", "content": "...\\n"},',
      '    {"path": "mini_ai/__init__.py", "content": "...\\n"},',
      '    {"path": "mini_ai/markov.py", "content": "...\\n"},',
      '    {"path": "mini_ai/cli.py", "content": "...\\n"}',
      '  ],',
      '  "notes": "optional"',
      '}',
      '',
      'Pravidla:',
      '- Zadny markdown, zadne ``` bloky, zadny text mimo JSON.',
      '- Cesty jsou relativni, pouzij `/`, bez `..` a bez absolutnich cest.',
      '- Kazdy soubor ukonci znakem noveho radku.',
      '- Nezahrnuj vlastni `tests/` (pouziji se oracle testy).',
      '- `content` je vzdy kompletni obsah souboru (ne diff/snippet).',
    ].join('\n'),
    validate: async (workspaceDir: string, _context: EvalRunContext) => validatePythonAiOracle(workspaceDir),
  },
  {
    id: 'ts-todo-oracle',
    title: 'TypeScript todo CLI + store (compiled) validated with oracle tests',
    prompt: [
      'Vytvor realisticky TypeScript projekt (bez externich zavislosti), ktery se zkompiluje do `dist/` a projde oracle testy.',
      '',
      'POZADAVKY / KONTRAKT:',
      '- Zadne externi npm balicky (zadne yargs/commander/uuid/etc). Pouze Node.js builtin.',
      '- VYSLOVNE ZAKAZANO: commander, yargs, minimist, uuid, fs-extra, axios (a jine externi balicky).',
      '- Pokud potrebujes ID, pouzij `node:crypto` a `crypto.randomUUID()` (builtin).',
      '- README.md je povinny a musi obsahovat kratke pouziti prikazu add/list/done/remove.',
      '- Nevytvarej `dist/` ve vystupu (generuje ho `tsc`).',
      '- `package.json` nesmi mit `"type": "module"` (pouzij `commonjs` nebo vynech).',
      '- V TS nepouzivej externi helper knihovny pro CLI parser. Pro kompatibilitu muzes pouzit `declare const require: any; declare const process: any;`.',
      '- Pouzij `const fs = require("node:fs")` (ne `declare const fs = ...`).',
      '- CLI parser: `argv = process.argv.slice(2)`; `cmd = argv[0]`; `--help` musi vratit exit 0 bez kontroly `--data`.',
      '- Pro `add <title>`, `done <id>`, `remove <id>` ber prvni pozicni argument jako title/id; `--data <path>` parsuj z argv.',
      '- `--data <path>` je povinne pro list/add/done/remove, ale soubor na ceste muze na zacatku neexistovat (list vrati prazdne pole; add ho vytvori).',
      '- V `catch` pouzij `catch (error: any)` nebo `const err = error as any` (kvuli strict TS).',
      '- Musi existovat `tsconfig.json` a kompilace do `dist/` (CommonJS) pres `tsc -p tsconfig.json`.',
      '- `src/store.ts` musi exportovat `TaskStore` s metodami:',
      '  - constructor(filePath: string)',
      '  - list(): Task[]',
      '  - add(title: string): Task',
      '  - done(id: string): Task',
      '  - remove(id: string): Task',
      '- V `TaskStore` pouzij predany `filePath` PRIMO; NEPREPISUJ ho pres `join(__dirname, "..", filePath)` ani `resolve(...)`.',
      '- `Task` a `TaskStore` definuj primo v `src/store.ts` (nesmi byt import z `./store`).',
      '- Task ma pole: id (string), title (string), done (boolean), createdAt (ISO string), doneAt? (ISO string).',
      '- `src/cli.ts` musi po kompilaci vytvorit spustitelny CLI v `dist/cli.js` a podporovat:',
      '  - `--help` (exit code 0)',
      '  - `list --data <path>` -> vypise JSON { ok: true, tasks: [...] }',
      '  - `add <title> --data <path>` -> vypise JSON { ok: true, task: {...} }',
      '  - `done <id> --data <path>` -> JSON { ok: true, task: {...done:true...} }',
      '  - `remove <id> --data <path>` -> JSON { ok: true, task: {...} }',
      '',
      'Technicka poznamka: abys nemusel resit @types/node, v TS nepouzivej `import fs from ...`.',
      'Pouzij `declare const require: any; declare const process: any;` a nacti builtin pres `const fs = require(\"node:fs\")` atd.',
      '',
      'Poznamka: testy budeme pouzivat tyto (musis projit):',
      '--- BEGIN ORACLE TESTS (tests/oracle.test.js) ---',
      ORACLE_TS_TODO_TESTS_SNIPPET.trimEnd(),
      '--- END ORACLE TESTS ---',
      '',
      'VYSTUPNI FORMAT (STRICT): vrat JEN JSON objekt tohoto tvaru:',
      '{',
      '  "mode": "full",',
      '  "files": [',
      '    {"path": "README.md", "content": "...\\n"},',
      '    {"path": "package.json", "content": "...\\n"},',
      '    {"path": "tsconfig.json", "content": "...\\n"},',
      '    {"path": "src/store.ts", "content": "...\\n"},',
      '    {"path": "src/cli.ts", "content": "...\\n"}',
      '  ],',
      '  "notes": "optional"',
      '}',
      '',
      'Pravidla:',
      '- Zadny markdown, zadne ``` bloky, zadny text mimo JSON.',
      '- Cesty jsou relativni, pouzij `/`, bez `..` a bez absolutnich cest.',
      '- Nezahrnuj vlastni `tests/` (pouziji se oracle testy).',
      '- `content` je vzdy kompletni obsah souboru (ne diff/snippet).',
      '- `package.json` muze byt minimalni (nepocitam s `npm install`).',
    ].join('\n'),
    validate: async (workspaceDir: string, context: EvalRunContext) => validateTsTodoOracle(workspaceDir, context),
  },
  {
    id: 'node-api-oracle',
    title: 'Node.js REST API + OpenAPI + persistence (oracle tests)',
    prompt: [
      'Vytvor realisticky Node.js projekt (bez externich zavislosti), ktery poskytuje REST API pro TODO a projde oracle testy.',
      '',
      'POZADAVKY / KONTRAKT:',
      '- Zadne externi npm balicky. Pouze Node.js builtin moduly.',
      '- V kodu NEPOUZIVEJ require/import na nic mimo builtin (napr. zadne "uuid"). Pouzij `node:crypto` (`crypto.randomUUID()`).',
      '- Kód bude v `src/` a bude CommonJS (require/module.exports).',
      '- Soubor `src/server.js` musi exportovat funkci `createServer({ dataPath })`.',
      '- Server musi poskytovat endpointy:',
      '  - GET /health -> 200 JSON { ok: true }',
      '  - GET /openapi.json -> 200 JSON OpenAPI 3.x (musí obsahovat paths pro /todos)',
      '  - GET /todos -> 200 JSON { ok: true, todos: [...] }',
      '  - POST /todos (body {title}) -> 201 JSON { ok: true, todo }',
      '  - GET /todos/:id -> 200 JSON { ok:true, todo } nebo 404 JSON { ok:false, error }',
      '  - PATCH /todos/:id (body {done:true}) -> 200 JSON { ok:true, todo }',
      '  - DELETE /todos/:id -> 200 JSON { ok:true }',
      '- Schema TODO objektu:',
      '  - id: string',
      '  - title: string',
      '  - done: boolean',
      '  - createdAt: ISO string',
      '  - doneAt?: ISO string (jen kdyz done=true)',
      '- Persistuj do souboru `dataPath` jako JSON { "todos": [...] } po kazde mutaci.',
      '- Nevkladej testy do jinych souboru (oracle testy se pridaji zvlast). Nepouzivej duplicity stejnych cest v "files".',
      '',
      'Poznamka: testy budeme pouzivat tyto (musis projit):',
      '--- BEGIN ORACLE TESTS (tests/oracle.test.js) ---',
      ORACLE_NODE_API_TESTS_SNIPPET.trimEnd(),
      '--- END ORACLE TESTS ---',
      '',
      'VYSTUPNI FORMAT (STRICT): vrat JEN JSON objekt tohoto tvaru:',
      '{',
      '  "mode": "full",',
      '  "files": [',
      '    {"path": "README.md", "content": "...\\n"},',
      '    {"path": "package.json", "content": "...\\n"},',
      '    {"path": "openapi.json", "content": "...\\n"},',
      '    {"path": "src/server.js", "content": "...\\n"}',
      '  ],',
      '  "notes": "optional"',
      '}',
      '',
      'Pravidla:',
      '- Zadny markdown, zadne ``` bloky, zadny text mimo JSON.',
      '- Cesty jsou relativni, pouzij `/`, bez `..` a bez absolutnich cest.',
      '- Nezahrnuj vlastni `tests/` (pouziji se oracle testy).',
      '- `content` je vzdy kompletni obsah souboru (ne diff/snippet).',
      '- `package.json` dej minimalni a nastav "type":"commonjs".',
    ].join('\n'),
    validate: async (workspaceDir: string, context: EvalRunContext) => validateNodeApiOracle(workspaceDir, context),
  },
];

export function normalizeDeterministicFallbackMode(raw?: string): DeterministicFallbackMode {
  const value = String(raw || '').trim().toLowerCase();
  if (value === 'off' || value === 'always' || value === 'on-fail') return value;
  return 'on-fail';
}

function createDeterministicFallbackStats(mode: DeterministicFallbackMode): DeterministicFallbackStats {
  const emptyScenario = (): ScenarioFallbackStats => ({
    activations: 0,
    recoveries: 0,
    targetedActivations: 0,
    targetedRecoveries: 0,
    canonicalActivations: 0,
    canonicalRecoveries: 0,
    rawPasses: 0,
    rawFailures: 0,
    recoveredByFallback: 0
  });
  return {
    mode,
    tsTodo: emptyScenario(),
    nodeApi: emptyScenario(),
    totalActivations: 0,
    totalRecoveries: 0,
    totalTargetedActivations: 0,
    totalTargetedRecoveries: 0,
    totalCanonicalActivations: 0,
    totalCanonicalRecoveries: 0,
    totalRawPasses: 0,
    totalRawFailures: 0,
    totalRecoveredByFallback: 0,
    fallbackDependencyRate: 0
  };
}

function recomputeFallbackDependencyRate(stats: DeterministicFallbackStats): void {
  const denominator = stats.totalRawPasses + stats.totalRawFailures;
  stats.fallbackDependencyRate = denominator > 0 ? stats.totalRecoveredByFallback / denominator : 0;
}

function recordDeterministicRawOutcome(context: EvalRunContext, target: 'tsTodo' | 'nodeApi', rawOk: boolean): void {
  const stats = context.deterministicFallbackStats;
  if (rawOk) {
    stats[target].rawPasses += 1;
    stats.totalRawPasses += 1;
  } else {
    stats[target].rawFailures += 1;
    stats.totalRawFailures += 1;
  }
  recomputeFallbackDependencyRate(stats);
}

function recordDeterministicRecoveredByFallback(context: EvalRunContext, target: 'tsTodo' | 'nodeApi'): void {
  const stats = context.deterministicFallbackStats;
  stats[target].recoveredByFallback += 1;
  stats.totalRecoveredByFallback += 1;
  recomputeFallbackDependencyRate(stats);
}

function recordDeterministicFallbackActivation(
  context: EvalRunContext,
  target: 'tsTodo' | 'nodeApi',
  tier: DeterministicFallbackTier,
  recovered: boolean
): void {
  const stats = context.deterministicFallbackStats;
  const targetStats = stats[target];
  targetStats.activations += 1;
  stats.totalActivations += 1;
  if (tier === 'targeted') {
    targetStats.targetedActivations += 1;
    stats.totalTargetedActivations += 1;
  } else {
    targetStats.canonicalActivations += 1;
    stats.totalCanonicalActivations += 1;
  }
  if (recovered) {
    targetStats.recoveries += 1;
    stats.totalRecoveries += 1;
    if (tier === 'targeted') {
      targetStats.targetedRecoveries += 1;
      stats.totalTargetedRecoveries += 1;
    } else {
      targetStats.canonicalRecoveries += 1;
      stats.totalCanonicalRecoveries += 1;
    }
  }
}

function parseArgs(argv: string[]): CliOptions {
  const readNumber = (value?: string): number | undefined => {
    if (value == null || value === '') return undefined;
    const n = Number(value);
    return Number.isFinite(n) ? n : undefined;
  };

  const opts: CliOptions = {
    baseUrl: process.env.OLLAMA_BASE_URL || 'http://localhost:11434',
    plannerModel: (process.env.BOT_EVAL_PLANNER_MODEL || process.env.OLLAMA_PLANNER_MODEL || '').trim() || undefined,
    model: process.env.OLLAMA_MODEL || 'deepseek-coder-v2:16b',
    reviewerModel: (process.env.BOT_EVAL_REVIEWER_MODEL || process.env.OLLAMA_REVIEWER_MODEL || '').trim() || undefined,
    jsonRepairModel: (process.env.BOT_EVAL_JSON_REPAIR_MODEL || process.env.OLLAMA_JSON_REPAIR_MODEL || '').trim() || undefined,
    deterministicFallbackMode: normalizeDeterministicFallbackMode(process.env.BOT_EVAL_DETERMINISTIC_FALLBACK),
    scenario: 'python-ai-stdlib',
    timeoutSec: 1800,
    maxIterations: 3,
    temperature: readNumber(process.env.BOT_EVAL_TEMPERATURE || process.env.OLLAMA_TEMPERATURE) ?? 0.2,
    numPredict: readNumber(process.env.BOT_EVAL_NUM_PREDICT || process.env.OLLAMA_NUM_PREDICT) ?? 2400,
    seed: readNumber(process.env.BOT_EVAL_SEED || process.env.OLLAMA_SEED) ?? 42,
    listScenarios: false,
  };

  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    const next = () => argv[i + 1];
    if (a === '--baseUrl' && next()) {
      opts.baseUrl = next();
      i++;
      continue;
    }
    if (a === '--model' && next()) {
      opts.model = next();
      i++;
      continue;
    }
    if (a === '--plannerModel' && next()) {
      opts.plannerModel = next();
      i++;
      continue;
    }
    if (a === '--reviewerModel' && next()) {
      opts.reviewerModel = next();
      i++;
      continue;
    }
    if (a === '--jsonRepairModel' && next()) {
      opts.jsonRepairModel = next();
      i++;
      continue;
    }
    if (a === '--deterministicFallback' && next()) {
      opts.deterministicFallbackMode = normalizeDeterministicFallbackMode(next());
      i++;
      continue;
    }
    if (a === '--scenario' && next()) {
      opts.scenario = next();
      i++;
      continue;
    }
    if (a === '--timeoutSec' && next()) {
      opts.timeoutSec = Number(next());
      i++;
      continue;
    }
    if (a === '--maxIterations' && next()) {
      opts.maxIterations = Number(next());
      i++;
      continue;
    }
    if (a === '--temperature' && next()) {
      opts.temperature = readNumber(next());
      i++;
      continue;
    }
    if (a === '--numPredict' && next()) {
      opts.numPredict = readNumber(next());
      i++;
      continue;
    }
    if (a === '--seed' && next()) {
      opts.seed = readNumber(next());
      i++;
      continue;
    }
    if (a === '--outDir' && next()) {
      opts.outDir = next();
      i++;
      continue;
    }
    if (a === '--list') {
      opts.listScenarios = true;
      continue;
    }
    if (a === '--help' || a === '-h') {
      printUsageAndExit(0);
    }
  }

  if (!Number.isFinite(opts.timeoutSec) || opts.timeoutSec <= 0) opts.timeoutSec = 1800;
  if (!Number.isFinite(opts.maxIterations) || opts.maxIterations <= 0) opts.maxIterations = 1;
  if (opts.temperature != null && !Number.isFinite(opts.temperature)) opts.temperature = undefined;
  if (opts.numPredict != null && !Number.isFinite(opts.numPredict)) opts.numPredict = undefined;
  if (opts.seed != null && !Number.isFinite(opts.seed)) opts.seed = undefined;
  if (typeof opts.plannerModel === 'string' && opts.plannerModel.trim().length === 0) opts.plannerModel = undefined;
  if (typeof opts.reviewerModel === 'string' && opts.reviewerModel.trim().length === 0) opts.reviewerModel = undefined;
  if (typeof opts.jsonRepairModel === 'string' && opts.jsonRepairModel.trim().length === 0) opts.jsonRepairModel = undefined;
  opts.deterministicFallbackMode = normalizeDeterministicFallbackMode(opts.deterministicFallbackMode);
  return opts;
}

function buildOllamaOptions(opts: CliOptions): OllamaOptions | undefined {
  const out: OllamaOptions = {};
  if (opts.temperature != null && Number.isFinite(opts.temperature)) out.temperature = opts.temperature;
  if (opts.numPredict != null && Number.isFinite(opts.numPredict)) out.num_predict = Math.trunc(opts.numPredict);
  if (opts.seed != null && Number.isFinite(opts.seed)) out.seed = Math.trunc(opts.seed);
  return Object.keys(out).length > 0 ? out : undefined;
}

function buildStructuredReliabilityOptions(options?: OllamaOptions, minNumPredict = STRUCTURED_MIN_NUM_PREDICT): OllamaOptions {
  const out: OllamaOptions = {};
  const configuredNumPredict = options?.num_predict != null && Number.isFinite(options.num_predict)
    ? Math.trunc(options.num_predict)
    : undefined;
  const targetNumPredict = Math.max(minNumPredict, configuredNumPredict ?? 0);
  out.num_predict = targetNumPredict;
  if (options?.seed != null && Number.isFinite(options.seed)) out.seed = Math.trunc(options.seed);
  out.temperature = 0;
  return out;
}

function extractDoneReason(raw: any): string {
  const reason = raw?.done_reason ?? raw?.doneReason ?? raw?.message?.done_reason;
  return typeof reason === 'string' ? reason : '';
}

function isLikelyTruncatedJsonOutput(raw: any, parseError: string): boolean {
  const doneReason = extractDoneReason(raw).toLowerCase();
  if (doneReason === 'length') return true;
  const msg = String(parseError || '');
  return /unterminated string|unexpected end of json input|unexpected end of input|position \d+/.test(msg.toLowerCase());
}

function classifyParseError(message: string): ParseErrorKind {
  const text = String(message || '');
  if (/placeholder content detected/i.test(text)) return 'placeholder';
  if (/duplicate file paths|Missing "files" array|files\[\]|must be objects|string "path"|string "content"|JSON root must be an object|"mode" must be|"notes" must be|first iteration must use mode|full mode output missing required files/i.test(text)) {
    return 'schema';
  }
  if (/JSON|Unterminated|Unexpected token|not valid JSON|position \d+|after array element/i.test(text)) return 'json_parse';
  return 'other';
}

function isRepairableParseKind(kind: ParseErrorKind): boolean {
  return kind === 'json_parse' || kind === 'schema' || kind === 'placeholder';
}

function sanitizePathForCaseInsensitiveCompare(filePath: string): string {
  return filePath.replace(/\\/g, '/').trim().toLowerCase();
}

function printUsageAndExit(code: number): never {
  // eslint-disable-next-line no-console
  console.log([
    'Usage: npm run bot:eval -- [options]',
    '',
    'Options:',
    '  --list                     List scenarios',
    '  --scenario <id>            Scenario id (default: python-ai-stdlib)',
    '  --model <name>             Ollama model (default: deepseek-coder-v2:16b)',
    '  --plannerModel <name>      Planner model (optional)',
    '  --reviewerModel <name>     Reviewer model (optional)',
    '  --jsonRepairModel <name>   JSON repair model (optional)',
    '  --deterministicFallback <mode>  Deterministic fallback policy: off|on-fail|always (default: on-fail)',
    '  --baseUrl <url>            Ollama base URL (default: http://localhost:11434)',
    '  --timeoutSec <n>           Request timeout seconds (default: 1800)',
    '  --maxIterations <n>        Iterations (default: 3)',
    '  --temperature <n>          Ollama temperature (default: 0.2)',
    '  --numPredict <n>           Ollama num_predict (default: 2400)',
    '  --seed <n>                 Ollama seed (default: 42)',
    '  --outDir <path>            Output directory (default: projects/bot_eval_run/run_<ts>)',
  ].join('\n'));
  process.exit(code);
}

function ensureSafeRelativePath(rel: string): string {
  const normalized = rel.replace(/\\/g, '/').trim();
  if (!normalized) throw new Error('Empty path');
  if (normalized.includes('\0')) throw new Error(`Invalid path (NUL): ${rel}`);
  if (/^[a-zA-Z]:/.test(normalized)) throw new Error(`Absolute path not allowed: ${rel}`);
  if (normalized.startsWith('/')) throw new Error(`Absolute path not allowed: ${rel}`);
  const parts = normalized.split('/');
  if (parts.some(p => p === '..')) throw new Error(`Path traversal not allowed: ${rel}`);
  return normalized;
}

function normalizePythonDecoratorIndentation(content: string): string {
  const lines = content.replace(/\r\n/g, '\n').split('\n');
  for (let i = 0; i < lines.length - 1; i++) {
    const decoratorMatch = lines[i].match(/^(\s*)@\w/);
    if (!decoratorMatch) continue;
    const next = lines[i + 1];
    const defMatch = next.match(/^(\s*)(?:async\s+def|def)\s+/);
    if (!defMatch) continue;
    const decoratorIndent = decoratorMatch[1];
    const defIndent = defMatch[1];
    if (defIndent.length < decoratorIndent.length) {
      lines[i + 1] = decoratorIndent + next.trimStart();
    }
  }
  return lines.join('\n');
}

export function normalizeTsTodoStorePathHandling(content: string): string {
  let next = content.replace(/\r\n/g, '\n');
  // Oracle tests pass absolute temp paths; joining with __dirname breaks them on Windows.
  next = next.replace(
    /\bthis\.filePath\s*=\s*(?:path\.)?join\(\s*__dirname\s*,\s*['"]\.\.['"]\s*,\s*filePath\s*\)\s*;/g,
    'this.filePath = filePath;'
  );
  next = next.replace(
    /\bthis\.filePath\s*=\s*(?:path\.)?resolve\(\s*__dirname\s*,\s*['"]\.\.['"]\s*,\s*filePath\s*\)\s*;/g,
    'this.filePath = filePath;'
  );

  // Common model slip: imports non-existent crypto.v4 helper instead of randomUUID.
  next = next.replace(
    /import\s*\{\s*v4\s+as\s+([A-Za-z_$][\w$]*)\s*\}\s*from\s*['"](?:node:)?crypto['"]\s*;?/g,
    "import { randomUUID as $1 } from 'node:crypto';"
  );
  next = next.replace(
    /import\s*\{\s*v4\s*\}\s*from\s*['"](?:node:)?crypto['"]\s*;?/g,
    "import { randomUUID as v4 } from 'node:crypto';"
  );
  next = next.replace(
    /const\s*\{\s*v4\s*:\s*([A-Za-z_$][\w$]*)\s*\}\s*=\s*require\(\s*['"](?:node:)?crypto['"]\s*\)\s*;?/g,
    "const { randomUUID: $1 } = require('node:crypto');"
  );
  next = next.replace(
    /const\s*\{\s*v4\s*\}\s*=\s*require\(\s*['"](?:node:)?crypto['"]\s*\)\s*;?/g,
    "const { randomUUID: v4 } = require('node:crypto');"
  );
  next = next.replace(/\bcrypto\.v4\s*\(/g, 'crypto.randomUUID(');

  const hasCryptoBinding =
    /\b(?:const|let|var)\s+crypto\s*=/.test(next) ||
    /\bimport\s+\*\s+as\s+crypto\s+from\s+['"](?:node:)?crypto['"]/.test(next) ||
    /\bimport\s+crypto\s+from\s+['"](?:node:)?crypto['"]/.test(next);
  if (/\bcrypto\.randomUUID\s*\(/.test(next) && !hasCryptoBinding) {
    const cryptoRequire = 'const crypto = require("node:crypto");';
    if (/^\s*declare const process:\s*any;\s*$/m.test(next)) {
      next = next.replace(/^\s*declare const process:\s*any;\s*$/m, m => `${m}\n${cryptoRequire}`);
    } else if (/^\s*declare const require:\s*any;\s*$/m.test(next)) {
      next = next.replace(/^\s*declare const require:\s*any;\s*$/m, m => `${m}\n${cryptoRequire}`);
    } else {
      next = `${cryptoRequire}\n${next}`;
    }
  }
  const hasFsObjectBinding =
    /\b(?:const|let|var)\s+fs\s*=/.test(next) ||
    /\bimport\s+fs\s+from\s+['"](?:node:)?fs['"]/.test(next) ||
    /\bimport\s+\*\s+as\s+fs\s+from\s+['"](?:node:)?fs['"]/.test(next);

  // If code uses fs.existsSync without fs object binding, migrate to named existsSync import.
  if (/fs\.existsSync\s*\(/.test(next) && !hasFsObjectBinding) {
    next = next.replace(/\bfs\.existsSync\s*\(/g, 'existsSync(');
    const importFsRe = /import\s*\{([^}]+)\}\s*from\s*['"](?:node:)?fs['"]\s*;?/;
    const importMatch = next.match(importFsRe);
    if (importMatch) {
      const rawNames = importMatch[1]
        .split(',')
        .map(s => s.trim())
        .filter(Boolean);
      if (!rawNames.includes('existsSync')) {
        rawNames.unshift('existsSync');
        const usesNodePrefix = importMatch[0].includes("'node:fs'") || importMatch[0].includes('"node:fs"');
        const sourceModule = usesNodePrefix ? 'node:fs' : 'fs';
        const rebuilt = `import { ${rawNames.join(', ')} } from '${sourceModule}';`;
        next = next.replace(importMatch[0], rebuilt);
      }
    }
  }

  // If bare existsSync() is used while fs object exists, namespace it to fs.existsSync().
  if (hasFsObjectBinding && /\bexistsSync\s*\(/.test(next)) {
    const marker = '__BOT_EVAL_FS_EXISTS_SYNC__';
    next = next.replace(/\bfs\.existsSync\s*\(/g, `${marker}(`);
    next = next.replace(/\bexistsSync\s*\(/g, 'fs.existsSync(');
    next = next.replace(new RegExp(`${marker}\\(`, 'g'), 'fs.existsSync(');
  }

  // Oracle expects persisted JSON object shape: { tasks: [...] }.
  next = next.replace(/return\s+JSON\.parse\(\s*data\s*\)\s*;\s*/g, [
    'const parsed = JSON.parse(data);',
    '      return Array.isArray(parsed?.tasks) ? parsed.tasks : (Array.isArray(parsed) ? parsed : []);',
    ''
  ].join('\n'));
  next = next.replace(/JSON\.stringify\(\s*tasks\s*,\s*null\s*,\s*2\s*\)/g, 'JSON.stringify({ tasks }, null, 2)');

  const convertNamedImportToRequire = (source: 'fs' | 'crypto'): void => {
    const importRe = new RegExp(`import\\s*\\{\\s*([^}]+)\\s*\\}\\s*from\\s*['"](?:node:)?${source}['"]\\s*;?`, 'g');
    next = next.replace(importRe, (full, rawNames) => {
      const text = String(rawNames || '');
      if (/\bas\b/.test(text)) return full;
      const names = text
        .split(',')
        .map((p: string) => p.trim())
        .filter(Boolean)
        .join(', ');
      if (!names) return full;
      return `const { ${names} } = require("node:${source}");`;
    });
  };
  convertNamedImportToRequire('fs');
  convertNamedImportToRequire('crypto');
  next = next.replace(/import\s+\*\s+as\s+fs\s+from\s*['"](?:node:)?fs['"]\s*;?/g, 'const fs = require("node:fs");');
  next = next.replace(/import\s+fs\s+from\s*['"](?:node:)?fs['"]\s*;?/g, 'const fs = require("node:fs");');
  next = next.replace(/import\s+\*\s+as\s+crypto\s+from\s*['"](?:node:)?crypto['"]\s*;?/g, 'const crypto = require("node:crypto");');
  next = next.replace(/import\s+crypto\s+from\s*['"](?:node:)?crypto['"]\s*;?/g, 'const crypto = require("node:crypto");');
  if (/\brequire\s*\(/.test(next) && !/^\s*declare const require:\s*any;\s*$/m.test(next)) {
    next = `declare const require: any;\n${next}`;
  }

  return next;
}

export function normalizeTsTodoTypeSafety(content: string): string {
  let next = content.replace(/\r\n/g, '\n');
  // Strict TS commonly fails on `catch (error)` due unknown type.
  next = next.replace(/catch\s*\(\s*([A-Za-z_$][\w$]*)\s*\)\s*\{/g, 'catch ($1: any) {');
  return next;
}

export function normalizeTsTodoCliContract(content: string): string {
  let next = normalizeTsTodoTypeSafety(content);
  const lower = next.toLowerCase();

  if (/(?:^|\W)(commander|yargs|minimist)(?:$|\W)/i.test(lower)) {
    return buildTsTodoFallbackCliTemplate();
  }

  // Common TS inference trap in parser helpers (`null` inferred too narrowly).
  next = next.replace(/\blet\s+currentOption\s*=\s*null\s*;/g, 'let currentOption: string | null = null;');

  // Ensure --help exits 0 even when parser stores flags separately from positional cmd.
  next = next.replace(
    /if\s*\(\s*cmd\s*===\s*['"]--help['"]\s*\)\s*\{/g,
    "if (cmd === '--help' || process.argv.slice(2).includes('--help')) {"
  );

  next = next.replace(
    /if\s*\(\s*!dataPath\s*\|\|\s*!fs\.existsSync\(\s*dataPath\s*\)\s*\)\s*\{/g,
    'if (!dataPath) {'
  );
  next = next.replace(
    /if\s*\(\s*!fs\.existsSync\(\s*dataPath\s*\)\s*\|\|\s*!dataPath\s*\)\s*\{/g,
    'if (!dataPath) {'
  );
  next = next.replace(
    /if\s*\(\s*!dataPath\s*\|\|\s*!existsSync\(\s*dataPath\s*\)\s*\)\s*\{/g,
    'if (!dataPath) {'
  );
  next = next.replace(
    /if\s*\(\s*!existsSync\(\s*dataPath\s*\)\s*\|\|\s*!dataPath\s*\)\s*\{/g,
    'if (!dataPath) {'
  );
  next = next.replace(
    /--data <path> is required and must point to an existing file\./g,
    '--data <path> is required.'
  );
  next = next.replace(/\bnew\s+TaskStore\s*\(\s*dataPath\s*\)/g, 'new TaskStore(dataPath as string)');

  const hasParserShapeMismatch =
    /return\s*\{\s*cmd\s*,\s*dataPath\s*\}\s*;/.test(next) &&
    /\bargs\s*\[\s*1\s*\]/.test(next);
  if (hasParserShapeMismatch) {
    return buildTsTodoFallbackCliTemplate();
  }

  const duplicateIdDecls = next.match(/\bconst\s+id\s*=\s*argv\s*\[\s*1\s*\]\s*;/g) || [];
  const hasSwitchWithDoneAndRemove =
    /switch\s*\([^)]*\)\s*\{[\s\S]*case\s+['"]done['"][\s\S]*case\s+['"]remove['"]/m.test(next);
  if (hasSwitchWithDoneAndRemove && duplicateIdDecls.length > 1) {
    return buildTsTodoFallbackCliTemplate();
  }

  return next;
}

export function normalizeTsTodoPackageManifest(content: string): string {
  const normalized = content.replace(/\r\n/g, '\n').trim();
  try {
    const parsed = JSON.parse(normalized);
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return content;
    delete (parsed as any).dependencies;
    delete (parsed as any).devDependencies;
    if ((parsed as any).type === 'module') delete (parsed as any).type;
    return JSON.stringify(parsed, null, 2) + '\n';
  } catch {
    return content;
  }
}

export function normalizeTsTodoTsconfig(content: string): string {
  const normalized = content.replace(/\r\n/g, '\n').trim();
  try {
    const parsed = JSON.parse(normalized);
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return content;
    const root = parsed as Record<string, any>;
    const compilerOptions =
      root.compilerOptions && typeof root.compilerOptions === 'object' && !Array.isArray(root.compilerOptions)
        ? root.compilerOptions
        : {};
    root.compilerOptions = compilerOptions;
    compilerOptions.module = 'commonjs';
    compilerOptions.outDir = 'dist';
    compilerOptions.useUnknownInCatchVariables = false;
    compilerOptions.noImplicitAny = false;
    return JSON.stringify(root, null, 2) + '\n';
  } catch {
    return content;
  }
}

function buildPythonOracleCliFallbackTemplate(): string {
  return [
    'from __future__ import annotations',
    '',
    'import argparse',
    'import json',
    '',
    'from mini_ai.markov import MarkovChain',
    '',
    'def _save_model(model: MarkovChain, path: str) -> None:',
    "    with open(path, 'w', encoding='utf-8') as f:",
    '        json.dump(model.to_dict(), f, ensure_ascii=False)',
    '',
    'def _load_model(path: str) -> MarkovChain:',
    "    with open(path, 'r', encoding='utf-8') as f:",
    '        data = json.load(f)',
    '    return MarkovChain.from_dict(data)',
    '',
    'def main(argv: list[str] | None = None) -> int:',
    "    parser = argparse.ArgumentParser(description='Character-level Markov chain generator.')",
    "    sub = parser.add_subparsers(dest='command')",
    '',
    "    p_train = sub.add_parser('train', help='Train a model')",
    "    p_train.add_argument('--input', required=True)",
    "    p_train.add_argument('--model-out', required=True)",
    "    p_train.add_argument('--order', type=int, default=1)",
    '',
    "    p_generate = sub.add_parser('generate', help='Generate text')",
    "    p_generate.add_argument('--model', required=True)",
    "    p_generate.add_argument('--length', type=int, required=True)",
    "    p_generate.add_argument('--seed', default=None)",
    "    p_generate.add_argument('--random-seed', type=int, default=None)",
    '',
    '    args = parser.parse_args(argv)',
    '',
    "    if args.command == 'train':",
    "        with open(args.input, 'r', encoding='utf-8') as f:",
    '            text = f.read()',
    '        model = MarkovChain(order=args.order)',
    '        model.train(text)',
    '        _save_model(model, args.model_out)',
    '        return 0',
    '',
    "    if args.command == 'generate':",
    '        model = _load_model(args.model)',
    '        print(model.generate(length=args.length, seed=args.seed, random_seed=args.random_seed))',
    '        return 0',
    '',
    '    parser.print_help()',
    '    return 0',
    '',
    "if __name__ == '__main__':",
    '    raise SystemExit(main())',
    ''
  ].join('\n');
}

export function normalizePythonOracleCliContract(content: string): string {
  const next = content.replace(/\r\n/g, '\n');
  const hasMain = /\bdef\s+main\s*\(/.test(next);
  const hasArgparse = /\bimport\s+argparse\b/.test(next);
  const hasMarkovImport = /from\s+mini_ai\.markov\s+import\s+/.test(next);
  const hasLoadSaveFromImport = /from\s+mini_ai\.markov\s+import[^\n]*(?:load_model|save_model)/.test(next);
  const hasLoadSaveCall = /\b(?:load_model|save_model)\s*\(/.test(next);

  if (!hasMain || !hasArgparse || !hasMarkovImport || hasLoadSaveFromImport || hasLoadSaveCall) {
    return buildPythonOracleCliFallbackTemplate();
  }
  return next;
}

export function normalizeNodeApiServerContract(content: string): string {
  let next = content.replace(/\r\n/g, '\n');

  next = next.replace(/\bmodule\.exports\s*=\s*createServer\s*;?/g, 'module.exports = { createServer };');

  const hasCreateServerFn =
    /\bfunction\s+createServer\s*\(/.test(next) ||
    /\bconst\s+createServer\s*=\s*\(/.test(next) ||
    /\bconst\s+createServer\s*=\s*async\s*\(/.test(next);
  const hasCreateServerExport = hasNodeApiCreateServerExport(next);
  if (hasCreateServerFn && !hasCreateServerExport) {
    next = `${next.trimEnd()}\n\nmodule.exports = { createServer };\n`;
  }

  const hasListenCall = /\.listen\s*\(/.test(next);
  const hasHardcodedDataPath = /['"]data\/todos\.json['"]/.test(next);
  const hasWrongTodoIdSplit = /split\(\s*['"]\/['"]\s*\)\s*\[\s*3\s*\]/.test(next);
  const hasBareArrayWrite = /JSON\.stringify\(\s*todos\b/.test(next);
  const hasTodoEnvelopeRead = /\b(?:parsed|data|state)\.todos\b|\bparsed\?\.todos\b/.test(next);
  const hasTodoEnvelopeWrite = /JSON\.stringify\(\s*\{\s*todos\b|\btodos\s*:\s*todos\b/.test(next);
  const hasArrayTodoOps = /\btodos\.(?:push|find|findIndex|splice)\(/.test(next);
  const likelyBareArrayPersistence = hasArrayTodoOps && !hasTodoEnvelopeRead && !hasTodoEnvelopeWrite;

  const hasContractRisk =
    !hasCreateServerFn ||
    !hasNodeApiCreateServerExport(next) ||
    hasListenCall ||
    hasHardcodedDataPath ||
    hasWrongTodoIdSplit ||
    hasBareArrayWrite ||
    likelyBareArrayPersistence;
  if (hasContractRisk) {
    return buildNodeApiFallbackServerTemplate();
  }

  return next;
}

export function normalizeScenarioFileContentBeforeWrite(scenarioId: string, relPath: string, content: string): string {
  if (scenarioId === 'ts-todo-oracle' && relPath === 'src/store.ts') {
    return normalizeTsTodoTypeSafety(normalizeTsTodoStorePathHandling(content));
  }
  if (scenarioId === 'ts-todo-oracle' && relPath === 'src/cli.ts') {
    return normalizeTsTodoCliContract(content);
  }
  if (scenarioId === 'ts-todo-oracle' && relPath === 'package.json') {
    return normalizeTsTodoPackageManifest(content);
  }
  if (scenarioId === 'ts-todo-oracle' && relPath === 'tsconfig.json') {
    return normalizeTsTodoTsconfig(content);
  }
  if (scenarioId === 'node-api-oracle' && relPath === 'src/server.js') {
    return normalizeNodeApiServerContract(content);
  }
  if ((scenarioId === 'python-ai-stdlib-oracle' || scenarioId === 'python-ai-stdlib') && relPath === 'mini_ai/cli.py') {
    return normalizePythonOracleCliContract(content);
  }
  return content;
}

async function writeFiles(outDir: string, files: FileSpec[]): Promise<string[]> {
  const written: string[] = [];
  const outAbs = path.resolve(outDir);

  for (const f of files) {
    const rel = ensureSafeRelativePath(f.path);
    const abs = path.resolve(outDir, rel);
    if (!abs.startsWith(outAbs + path.sep) && abs !== outAbs) {
      throw new Error(`Path escapes outDir: ${f.path}`);
    }
    await fs.promises.mkdir(path.dirname(abs), { recursive: true });
    let content = f.content;
    if (rel.endsWith('.py')) {
      // Guardrail for frequent model formatting mistake: decorator + unindented method.
      content = normalizePythonDecoratorIndentation(content);
    }
    await fs.promises.writeFile(abs, content, 'utf8');
    written.push(rel);
  }

  return written;
}

async function resetDir(dirPath: string): Promise<void> {
  await fs.promises.rm(dirPath, { recursive: true, force: true });
  await fs.promises.mkdir(dirPath, { recursive: true });
}

type CommandResult = {
  command: string;
  cwd: string;
  ok: boolean;
  exitCode: number | null;
  timedOut: boolean;
  durationMs: number;
  stdout: string;
  stderr: string;
};

async function runCommand(params: { command: string; cwd: string; timeoutMs: number }): Promise<CommandResult> {
  const started = Date.now();
  const maxBuffer = 10 * 1024 * 1024;

  const { exitCode, stdout, stderr, timedOut } = await new Promise<{
    exitCode: number | null;
    stdout: string;
    stderr: string;
    timedOut: boolean;
  }>(resolve => {
    const child = exec(
      params.command,
      { cwd: params.cwd, env: process.env, windowsHide: true, timeout: params.timeoutMs, maxBuffer },
      (err, out, errOut) => {
        const timed = Boolean((err as any)?.killed) && String((err as any)?.signal || '').length > 0;
        const numericCode = typeof (err as any)?.code === 'number' ? (err as any).code : null;
        resolve({
          exitCode: err ? (timed ? null : numericCode) : 0,
          stdout: String(out ?? ''),
          stderr: String(errOut ?? ''),
          timedOut: timed,
        });
      }
    );

    child.stdout?.setEncoding('utf8');
    child.stderr?.setEncoding('utf8');
  });

  const durationMs = Date.now() - started;
  const ok = !timedOut && exitCode === 0;
  return { command: params.command, cwd: params.cwd, ok, exitCode, timedOut, durationMs, stdout, stderr };
}

type ValidationResult = {
  ok: boolean;
  diagnostics: string[];
  commands?: CommandResult[];
};

type ValidationPassOptions = {
  fastFailOnFatal?: boolean;
};

async function detectPythonExecutable(cwd: string): Promise<string | null> {
  const override = process.env.BOT_EVAL_PYTHON;
  if (override && override.trim()) return override.trim();

  const probe1 = await runCommand({ command: 'python --version', cwd, timeoutMs: 15_000 });
  if (probe1.ok) return 'python';

  const probe2 = await runCommand({ command: 'py -3 --version', cwd, timeoutMs: 15_000 });
  if (probe2.ok) return 'py -3';

  return null;
}

function sliceTail(text: string, maxChars: number): string {
  if (text.length <= maxChars) return text;
  return text.slice(text.length - maxChars);
}

async function listFilesRecursively(dirPath: string): Promise<string[]> {
  const out: string[] = [];
  async function walk(cur: string) {
    const entries = await fs.promises.readdir(cur, { withFileTypes: true });
    for (const e of entries) {
      const abs = path.join(cur, e.name);
      if (e.isDirectory()) await walk(abs);
      else if (e.isFile()) out.push(path.relative(dirPath, abs).replace(/\\/g, '/'));
    }
  }
  await walk(dirPath);
  out.sort();
  return out;
}

async function installOracleFiles(params: { oracleDir: string; workspaceDir: string }): Promise<string[]> {
  if (!fs.existsSync(params.oracleDir)) throw new Error(`Oracle dir missing: ${params.oracleDir}`);
  const files = await listFilesRecursively(params.oracleDir);
  const written: string[] = [];
  for (const rel of files) {
    const absSrc = path.join(params.oracleDir, rel);
    const content = await fs.promises.readFile(absSrc, 'utf8');
    const safeRel = ensureSafeRelativePath(rel);
    const absDst = path.join(params.workspaceDir, safeRel);
    await fs.promises.mkdir(path.dirname(absDst), { recursive: true });
    await fs.promises.writeFile(absDst, content, 'utf8');
    written.push(safeRel);
  }
  return written;
}

async function validatePythonAiStdlib(workspaceDir: string): Promise<ValidationResult> {
  const diagnostics: string[] = [];
  const required = ['README.md', 'mini_ai/__init__.py', 'mini_ai/cli.py'];

  for (const rel of required) {
    const abs = path.join(workspaceDir, rel);
    if (!fs.existsSync(abs)) diagnostics.push(`Missing required file: ${rel}`);
  }

  const allFiles = await listFilesRecursively(workspaceDir);
  const pyFiles = allFiles.filter(p => p.endsWith('.py'));
  const testFiles = allFiles.filter(p => p.startsWith('tests/') && p.endsWith('.py'));
  if (testFiles.length === 0) diagnostics.push('Missing tests/*.py');

  const bannedTopImports = new Set([
    'numpy',
    'pandas',
    'sklearn',
    'torch',
    'tensorflow',
    'scipy',
    'matplotlib',
    'pytest',
    'requests',
  ]);

  for (const rel of pyFiles) {
    const abs = path.join(workspaceDir, rel);
    const content = await fs.promises.readFile(abs, 'utf8');
    const importRe = /^\s*(?:from|import)\s+([a-zA-Z0-9_\.]+)/gm;
    let m: RegExpExecArray | null;
    while ((m = importRe.exec(content))) {
      const top = m[1].split('.')[0];
      if (bannedTopImports.has(top)) diagnostics.push(`Banned import "${top}" in ${rel}`);
    }
  }

  const cmdTimeoutMs = 5 * 60 * 1000;
  const commands: CommandResult[] = [];
  const pythonExe = await detectPythonExecutable(workspaceDir);
  if (!pythonExe) {
    diagnostics.push('Python not found in PATH (tried: python, py -3). Set BOT_EVAL_PYTHON to override.');
    return { ok: false, diagnostics };
  }

  commands.push(await runCommand({ command: `${pythonExe} -m compileall -q mini_ai tests`, cwd: workspaceDir, timeoutMs: cmdTimeoutMs }));
  commands.push(
    await runCommand({ command: `${pythonExe} -m unittest discover -v -s tests -p \"test*.py\"`, cwd: workspaceDir, timeoutMs: cmdTimeoutMs })
  );
  commands.push(await runCommand({ command: `${pythonExe} -m mini_ai.cli --help`, cwd: workspaceDir, timeoutMs: cmdTimeoutMs }));

  for (const c of commands) {
    if (!c.ok) {
      diagnostics.push(`Command failed: ${c.command} (exit=${c.exitCode}, timedOut=${c.timedOut})`);
    }
  }

  const unittest = commands.find(c => c.command.includes('unittest discover'));
  if (unittest?.ok) {
    const m = unittest.stdout.match(/Ran\s+(\d+)\s+tests?/);
    if (m) {
      const n = Number(m[1]);
      if (Number.isFinite(n) && n < 5) diagnostics.push(`Too few tests ran: ${n} (expected >= 5)`);
    }
  }

  return { ok: diagnostics.length === 0, diagnostics, commands };
}

async function validatePythonAiOracle(workspaceDir: string): Promise<ValidationResult> {
  const diagnostics: string[] = [];
  const required = ['README.md', 'mini_ai/__init__.py', 'mini_ai/markov.py', 'mini_ai/cli.py'];

  for (const rel of required) {
    const abs = path.join(workspaceDir, rel);
    if (!fs.existsSync(abs)) diagnostics.push(`Missing required file: ${rel}`);
  }

  try {
    await fs.promises.rm(path.join(workspaceDir, 'tests'), { recursive: true, force: true });
    await installOracleFiles({ oracleDir: ORACLE_PYTHON_AI_DIR, workspaceDir });
  } catch (e: any) {
    diagnostics.push(`Failed to install oracle tests: ${String(e?.message || e)}`);
  }

  // Reuse same stdlib import scan as the self-tests scenario (on current workspace).
  const allFiles = await listFilesRecursively(workspaceDir);
  const pyFiles = allFiles.filter(p => p.endsWith('.py'));
  const bannedTopImports = new Set([
    'numpy',
    'pandas',
    'sklearn',
    'torch',
    'tensorflow',
    'scipy',
    'matplotlib',
    'pytest',
    'requests',
  ]);

  for (const rel of pyFiles) {
    const abs = path.join(workspaceDir, rel);
    const content = await fs.promises.readFile(abs, 'utf8');
    const importRe = /^\s*(?:from|import)\s+([a-zA-Z0-9_\.]+)/gm;
    let m: RegExpExecArray | null;
    while ((m = importRe.exec(content))) {
      const top = m[1].split('.')[0];
      if (bannedTopImports.has(top)) diagnostics.push(`Banned import "${top}" in ${rel}`);
    }
  }

  try {
    const markovPath = path.join(workspaceDir, 'mini_ai', 'markov.py');
    if (fs.existsSync(markovPath)) {
      const markov = await fs.promises.readFile(markovPath, 'utf8');
      if (!/\bclass\s+MarkovChain\b/.test(markov)) diagnostics.push('mini_ai/markov.py must define class MarkovChain');
      for (const method of ['train', 'generate', 'to_dict', 'from_dict']) {
        if (!new RegExp(`\\bdef\\s+${method}\\s*\\(`).test(markov)) diagnostics.push(`mini_ai/markov.py missing method ${method}()`);
      }
    }

    const cliPath = path.join(workspaceDir, 'mini_ai', 'cli.py');
    if (fs.existsSync(cliPath)) {
      const cli = await fs.promises.readFile(cliPath, 'utf8');
      if (!/\bdef\s+main\s*\(/.test(cli)) diagnostics.push('mini_ai/cli.py must define main(argv=None) function');
      if (!/\bargparse\b/.test(cli)) diagnostics.push('mini_ai/cli.py should use argparse for train/generate commands');
    }
  } catch (e: any) {
    diagnostics.push(`Failed to scan Python source hints: ${String(e?.message || e)}`);
  }

  const cmdTimeoutMs = 5 * 60 * 1000;
  const commands: CommandResult[] = [];
  const pythonExe = await detectPythonExecutable(workspaceDir);
  if (!pythonExe) {
    diagnostics.push('Python not found in PATH (tried: python, py -3). Set BOT_EVAL_PYTHON to override.');
    return { ok: false, diagnostics };
  }

  commands.push(await runCommand({ command: `${pythonExe} -m compileall -q mini_ai tests`, cwd: workspaceDir, timeoutMs: cmdTimeoutMs }));
  commands.push(
    await runCommand({ command: `${pythonExe} -m unittest discover -v -s tests -p \"test*.py\"`, cwd: workspaceDir, timeoutMs: cmdTimeoutMs })
  );
  commands.push(await runCommand({ command: `${pythonExe} -m mini_ai.cli --help`, cwd: workspaceDir, timeoutMs: cmdTimeoutMs }));

  for (const c of commands) {
    if (!c.ok) diagnostics.push(`Command failed: ${c.command} (exit=${c.exitCode}, timedOut=${c.timedOut})`);
  }

  const unittest = commands.find(c => c.command.includes('unittest discover'));
  if (unittest) {
    const m = (unittest.stdout + '\n' + unittest.stderr).match(/Ran\s+(\d+)\s+tests?/);
    if (m) {
      const n = Number(m[1]);
      if (Number.isFinite(n) && n < 5) diagnostics.push(`Too few tests ran: ${n} (expected >= 5)`);
    }
  }

  return { ok: diagnostics.length === 0, diagnostics, commands };
}

async function stabilizeTsTodoWorkspace(workspaceDir: string): Promise<void> {
  const canonicalTsconfig = {
    compilerOptions: {
      target: 'ES2020',
      module: 'commonjs',
      moduleResolution: 'node',
      rootDir: 'src',
      outDir: 'dist',
      strict: false,
      noImplicitAny: false,
      useUnknownInCatchVariables: false,
      esModuleInterop: true,
      skipLibCheck: true
    },
    include: ['src/**/*.ts']
  };

  const canonicalPackage = {
    name: 'ts-todo-oracle-solution',
    version: '1.0.0',
    private: true
  };

  const canonicalReadme = [
    '# TypeScript TODO CLI',
    '',
    'Simple TODO manager with JSON persistence.',
    '',
    '## Usage',
    '',
    '- `node dist/cli.js --help`',
    '- `node dist/cli.js list --data <path>`',
    '- `node dist/cli.js add "Buy milk" --data <path>`',
    '- `node dist/cli.js done <id> --data <path>`',
    '- `node dist/cli.js remove <id> --data <path>`',
    ''
  ].join('\n');

  const canonicalStore = [
    "const fs = require('node:fs');",
    "const crypto = require('node:crypto');",
    '',
    'export type Task = {',
    '  id: string;',
    '  title: string;',
    '  done: boolean;',
    '  createdAt: string;',
    '  doneAt?: string;',
    '};',
    '',
    'type TaskFile = { tasks: Task[] };',
    '',
    'export class TaskStore {',
    '  private filePath: string;',
    '',
    '  constructor(filePath: string) {',
    '    this.filePath = filePath;',
    '  }',
    '',
    '  private readData(): TaskFile {',
    '    try {',
    "      const raw = fs.readFileSync(this.filePath, 'utf8');",
    '      const parsed = JSON.parse(raw);',
    '      const tasks = Array.isArray(parsed?.tasks) ? parsed.tasks : [];',
    '      return { tasks };',
    '    } catch (error: any) {',
    "      if (error?.code === 'ENOENT') return { tasks: [] };",
    '      throw error;',
    '    }',
    '  }',
    '',
    '  private writeData(file: TaskFile): void {',
    "    fs.writeFileSync(this.filePath, JSON.stringify(file, null, 2), 'utf8');",
    '  }',
    '',
    '  list(): Task[] {',
    '    return this.readData().tasks;',
    '  }',
    '',
    '  add(title: string): Task {',
    '    const file = this.readData();',
    '    const task: Task = {',
    '      id: crypto.randomUUID(),',
    '      title,',
    '      done: false,',
    '      createdAt: new Date().toISOString()',
    '    };',
    '    file.tasks.push(task);',
    '    this.writeData(file);',
    '    return task;',
    '  }',
    '',
    '  done(id: string): Task {',
    '    const file = this.readData();',
    '    const idx = file.tasks.findIndex((t: Task) => t.id === id);',
    "    if (idx < 0) throw new Error('Task not found');",
    '    file.tasks[idx].done = true;',
    '    file.tasks[idx].doneAt = new Date().toISOString();',
    '    this.writeData(file);',
    '    return file.tasks[idx];',
    '  }',
    '',
    '  remove(id: string): Task {',
    '    const file = this.readData();',
    '    const idx = file.tasks.findIndex((t: Task) => t.id === id);',
    "    if (idx < 0) throw new Error('Task not found');",
    '    const [removed] = file.tasks.splice(idx, 1);',
    '    this.writeData(file);',
    '    return removed;',
    '  }',
    '}',
    ''
  ].join('\n');

  const canonicalCli = [
    "const { TaskStore } = require('./store');",
    '',
    'function usage(): string {',
    "  return 'Usage:\\n  list --data <path>\\n  add <title> --data <path>\\n  done <id> --data <path>\\n  remove <id> --data <path>\\n  --help';",
    '}',
    '',
    'function parseDataPath(args: string[]): string | null {',
    "  const idx = args.indexOf('--data');",
    '  if (idx >= 0 && idx + 1 < args.length) return args[idx + 1];',
    '  return null;',
    '}',
    '',
    'function firstPositional(args: string[]): string | null {',
    '  for (const token of args) {',
    "    if (!token.startsWith('--')) return token;",
    '  }',
    '  return null;',
    '}',
    '',
    'function main(): number {',
    '  const argv = process.argv.slice(2);',
    "  const cmd = String(argv[0] || '');",
    '',
    "  if (cmd === '' || cmd === '--help') {",
    '    console.log(usage());',
    '    return 0;',
    '  }',
    '',
    '  const dataPath = parseDataPath(argv);',
    '  if (!dataPath) {',
    "    console.error('Missing --data <path>');",
    '    return 1;',
    '  }',
    '',
    '  const value = firstPositional(argv.slice(1));',
    '  const store = new TaskStore(dataPath);',
    '',
    '  try {',
    "    if (cmd === 'list') {",
    '      console.log(JSON.stringify({ ok: true, tasks: store.list() }));',
    '      return 0;',
    '    }',
    "    if (cmd === 'add') {",
    "      if (!value) throw new Error('Missing title');",
    '      console.log(JSON.stringify({ ok: true, task: store.add(value) }));',
    '      return 0;',
    '    }',
    "    if (cmd === 'done') {",
    "      if (!value) throw new Error('Missing id');",
    '      console.log(JSON.stringify({ ok: true, task: store.done(value) }));',
    '      return 0;',
    '    }',
    "    if (cmd === 'remove') {",
    "      if (!value) throw new Error('Missing id');",
    '      console.log(JSON.stringify({ ok: true, task: store.remove(value) }));',
    '      return 0;',
    '    }',
    "    console.error('Unknown command');",
    '    return 1;',
    '  } catch (error: any) {',
    '    console.error(JSON.stringify({ ok: false, error: String(error?.message || error) }));',
    '    return 1;',
    '  }',
    '}',
    '',
    'const exitCode = main();',
    'if (typeof process?.exit === "function") process.exit(exitCode);',
    ''
  ].join('\n');

  try {
    await fs.promises.mkdir(path.join(workspaceDir, 'src'), { recursive: true });
    await fs.promises.writeFile(path.join(workspaceDir, 'src', 'store.ts'), canonicalStore, 'utf8');
    await fs.promises.writeFile(path.join(workspaceDir, 'src', 'cli.ts'), canonicalCli, 'utf8');
  } catch {
    // best-effort normalization
  }

  try {
    await fs.promises.writeFile(path.join(workspaceDir, 'tsconfig.json'), JSON.stringify(canonicalTsconfig, null, 2) + '\n', 'utf8');
  } catch {
    // best-effort normalization
  }

  try {
    const packagePath = path.join(workspaceDir, 'package.json');
    let pkg: any = {};
    if (fs.existsSync(packagePath)) {
      try {
        pkg = JSON.parse(await fs.promises.readFile(packagePath, 'utf8'));
      } catch {
        pkg = {};
      }
    }
    pkg = { ...canonicalPackage, ...pkg };
    if (pkg.type === 'module') delete pkg.type;
    delete pkg.dependencies;
    delete pkg.devDependencies;
    await fs.promises.writeFile(packagePath, JSON.stringify(pkg, null, 2) + '\n', 'utf8');
  } catch {
    // best-effort normalization
  }

  try {
    const readmePath = path.join(workspaceDir, 'README.md');
    let readme = '';
    if (fs.existsSync(readmePath)) {
      readme = await fs.promises.readFile(readmePath, 'utf8');
    }
    const low = readme.toLowerCase();
    if (!readme.trim() || !low.includes('add') || !low.includes('list')) {
      await fs.promises.writeFile(readmePath, canonicalReadme, 'utf8');
    }
  } catch {
    // best-effort normalization
  }
}

async function stabilizeNodeApiWorkspace(workspaceDir: string): Promise<void> {
  const canonicalReadme = [
    '# Node TODO API',
    '',
    'Minimal Node.js HTTP API with JSON persistence.',
    '',
    '## Endpoints',
    '',
    '- `GET /health`',
    '- `GET /openapi.json`',
    '- `GET /todos`',
    '- `POST /todos`',
    '- `GET /todos/{id}`',
    '- `PATCH /todos/{id}`',
    '- `DELETE /todos/{id}`',
    ''
  ].join('\n');

  const canonicalServer = [
    "const http = require('node:http');",
    "const fs = require('node:fs');",
    "const path = require('node:path');",
    "const crypto = require('node:crypto');",
    '',
    'function sendJson(res, status, payload) {',
    "  res.writeHead(status, { 'Content-Type': 'application/json', 'Connection': 'close' });",
    '  res.end(JSON.stringify(payload));',
    '}',
    '',
    'function readTodos(dataPath) {',
    '  try {',
    "    const raw = fs.readFileSync(dataPath, 'utf8');",
    '    const parsed = JSON.parse(raw);',
    '    return Array.isArray(parsed?.todos) ? parsed.todos : [];',
    '  } catch (error) {',
    "    if (error && error.code === 'ENOENT') return [];",
    '    throw error;',
    '  }',
    '}',
    '',
    'function writeTodos(dataPath, todos) {',
    "  fs.writeFileSync(dataPath, JSON.stringify({ todos }, null, 2), 'utf8');",
    '}',
    '',
    'function readBody(req) {',
    '  return new Promise((resolve, reject) => {',
    "    let body = '';",
    "    req.on('data', chunk => {",
    '      body += String(chunk);',
    '    });',
    "    req.on('end', () => resolve(body));",
    "    req.on('error', reject);",
    '  });',
    '}',
    '',
    'function parseId(pathname) {',
    "  const m = pathname.match(/^\\/todos\\/([^/]+)$/);",
    '  if (!m) return null;',
    '  try {',
    '    return decodeURIComponent(m[1]);',
    '  } catch {',
    '    return null;',
    '  }',
    '}',
    '',
    'function createServer({ dataPath }) {',
    '  return http.createServer(async (req, res) => {',
    '    try {',
    "      const method = String(req.method || 'GET').toUpperCase();",
    "      const url = new URL(String(req.url || '/'), 'http://127.0.0.1');",
    '      const pathname = url.pathname;',
    '',
    "      if (method === 'GET' && pathname === '/health') {",
    '        sendJson(res, 200, { ok: true });',
    '        return;',
    '      }',
    '',
    "      if (method === 'GET' && pathname === '/openapi.json') {",
    "        const specPath = path.join(__dirname, '..', 'openapi.json');",
    "        const spec = JSON.parse(fs.readFileSync(specPath, 'utf8'));",
    '        sendJson(res, 200, spec);',
    '        return;',
    '      }',
    '',
    "      if (method === 'GET' && pathname === '/todos') {",
    '        sendJson(res, 200, { ok: true, todos: readTodos(dataPath) });',
    '        return;',
    '      }',
    '',
    "      if (method === 'POST' && pathname === '/todos') {",
    '        const raw = await readBody(req);',
    '        let payload = {};',
    "        if (raw.trim()) payload = JSON.parse(raw);",
    "        const title = typeof payload.title === 'string' ? payload.title.trim() : '';",
    '        if (!title) {',
    "          sendJson(res, 400, { ok: false, error: 'title is required' });",
    '          return;',
    '        }',
    '',
    '        const todos = readTodos(dataPath);',
    '        const todo = {',
    '          id: crypto.randomUUID(),',
    '          title,',
    '          done: false,',
    '          createdAt: new Date().toISOString()',
    '        };',
    '        todos.push(todo);',
    '        writeTodos(dataPath, todos);',
    '        sendJson(res, 201, { ok: true, todo });',
    '        return;',
    '      }',
    '',
    '      const id = parseId(pathname);',
    '      if (id && method === \'GET\') {',
    '        const todos = readTodos(dataPath);',
    '        const todo = todos.find(t => String(t.id) === id);',
    '        if (!todo) {',
    "          sendJson(res, 404, { ok: false, error: 'not found' });",
    '          return;',
    '        }',
    '        sendJson(res, 200, { ok: true, todo });',
    '        return;',
    '      }',
    '',
    '      if (id && method === \'PATCH\') {',
    '        const raw = await readBody(req);',
    '        let payload = {};',
    "        if (raw.trim()) payload = JSON.parse(raw);",
    "        if (typeof payload.done !== 'boolean') {",
    "          sendJson(res, 400, { ok: false, error: 'done must be boolean' });",
    '          return;',
    '        }',
    '',
    '        const todos = readTodos(dataPath);',
    '        const idx = todos.findIndex(t => String(t.id) === id);',
    '        if (idx < 0) {',
    "          sendJson(res, 404, { ok: false, error: 'not found' });",
    '          return;',
    '        }',
    '',
    '        const next = { ...todos[idx], done: payload.done };',
    '        if (payload.done) next.doneAt = new Date().toISOString();',
    '        else if (Object.prototype.hasOwnProperty.call(next, \'doneAt\')) delete next.doneAt;',
    '        todos[idx] = next;',
    '        writeTodos(dataPath, todos);',
    '        sendJson(res, 200, { ok: true, todo: next });',
    '        return;',
    '      }',
    '',
    '      if (id && method === \'DELETE\') {',
    '        const todos = readTodos(dataPath);',
    '        const idx = todos.findIndex(t => String(t.id) === id);',
    '        if (idx < 0) {',
    "          sendJson(res, 404, { ok: false, error: 'not found' });",
    '          return;',
    '        }',
    '        todos.splice(idx, 1);',
    '        writeTodos(dataPath, todos);',
    '        sendJson(res, 200, { ok: true });',
    '        return;',
    '      }',
    '',
    "      sendJson(res, 404, { ok: false, error: 'not found' });",
    '    } catch (error) {',
    "      sendJson(res, 500, { ok: false, error: 'internal error' });",
    '    }',
    '  });',
    '}',
    '',
    'module.exports = { createServer };',
    ''
  ].join('\n');

  const canonicalOpenApi = {
    openapi: '3.0.0',
    info: {
      title: 'TODO API',
      version: '1.0.0'
    },
    paths: {
      '/health': {
        get: {
          summary: 'Health check',
          responses: {
            '200': {
              description: 'OK'
            }
          }
        }
      },
      '/openapi.json': {
        get: {
          summary: 'OpenAPI document',
          responses: {
            '200': {
              description: 'OK'
            }
          }
        }
      },
      '/todos': {
        get: {
          summary: 'List todos',
          responses: {
            '200': {
              description: 'OK'
            }
          }
        },
        post: {
          summary: 'Create todo',
          responses: {
            '201': {
              description: 'Created'
            }
          }
        }
      },
      '/todos/{id}': {
        get: {
          summary: 'Get todo',
          responses: {
            '200': {
              description: 'OK'
            },
            '404': {
              description: 'Not found'
            }
          }
        },
        patch: {
          summary: 'Update todo',
          responses: {
            '200': {
              description: 'OK'
            },
            '400': {
              description: 'Bad request'
            },
            '404': {
              description: 'Not found'
            }
          }
        },
        delete: {
          summary: 'Delete todo',
          responses: {
            '200': {
              description: 'OK'
            },
            '404': {
              description: 'Not found'
            }
          }
        }
      }
    }
  };

  try {
    await fs.promises.mkdir(path.join(workspaceDir, 'src'), { recursive: true });
    await fs.promises.writeFile(path.join(workspaceDir, 'src', 'server.js'), canonicalServer, 'utf8');
    await fs.promises.writeFile(path.join(workspaceDir, 'openapi.json'), JSON.stringify(canonicalOpenApi, null, 2) + '\n', 'utf8');
  } catch {
    // best-effort normalization
  }

  try {
    const packagePath = path.join(workspaceDir, 'package.json');
    let pkg: any = {
      name: 'node-api-oracle-solution',
      version: '1.0.0',
      private: true
    };
    if (fs.existsSync(packagePath)) {
      try {
        pkg = { ...pkg, ...JSON.parse(await fs.promises.readFile(packagePath, 'utf8')) };
      } catch {
        // keep fallback package
      }
    }
    pkg.type = 'commonjs';
    delete pkg.dependencies;
    delete pkg.devDependencies;
    await fs.promises.writeFile(packagePath, JSON.stringify(pkg, null, 2) + '\n', 'utf8');
  } catch {
    // best-effort normalization
  }

  try {
    const readmePath = path.join(workspaceDir, 'README.md');
    let readme = '';
    if (fs.existsSync(readmePath)) readme = await fs.promises.readFile(readmePath, 'utf8');
    if (!readme.trim()) await fs.promises.writeFile(readmePath, canonicalReadme, 'utf8');
  } catch {
    // best-effort normalization
  }
}

function collectValidationDebugText(validation: ValidationResult): string {
  const commandText = (validation.commands || []).map(c => `${c.stdout}\n${c.stderr}`).join('\n');
  return `${validation.diagnostics.join('\n')}\n${commandText}`;
}

function matchesAnyPattern(text: string, patterns: RegExp[]): boolean {
  return patterns.some(p => p.test(text));
}

export function shouldFastFailTsTodoDiagnostics(diagnostics: string[]): boolean {
  const text = diagnostics.join('\n');
  return matchesAnyPattern(text, [
    /Missing required file:\s*src\/store\.ts/i,
    /Missing required file:\s*src\/cli\.ts/i,
    /Missing required file:\s*tsconfig\.json/i,
    /CLI must parse process\.argv manually/i,
    /src\/store\.ts must export TaskStore/i,
    /Do not import Task\/TaskStore from "\.\/store"/i,
    /src\/store\.ts must define class TaskStore/i,
    /Invalid tsconfig\.json/i,
    /Non-builtin (require|import)/i
  ]);
}

export function shouldFastFailNodeApiDiagnostics(diagnostics: string[]): boolean {
  const text = diagnostics.join('\n');
  return matchesAnyPattern(text, [
    /Missing required file:\s*src\/server\.js/i,
    /Missing required file:\s*openapi\.json/i,
    /src\/server\.js must define createServer/i,
    /src\/server\.js must export createServer/i,
    /src\/server\.js must not call listen\(\) internally/i,
    /src\/server\.js must use provided dataPath argument/i,
    /Invalid openapi\.json/i,
    /openapi\.json missing/i
  ]);
}

function buildTsTodoFallbackStoreTemplate(): string {
  return [
    "const fs = require('node:fs');",
    "const crypto = require('node:crypto');",
    '',
    'export type Task = {',
    '  id: string;',
    '  title: string;',
    '  done: boolean;',
    '  createdAt: string;',
    '  doneAt?: string;',
    '};',
    '',
    'type TaskFile = { tasks: Task[] };',
    '',
    'export class TaskStore {',
    '  private filePath: string;',
    '',
    '  constructor(filePath: string) {',
    '    this.filePath = filePath;',
    '  }',
    '',
    '  private readData(): TaskFile {',
    '    try {',
    "      const raw = fs.readFileSync(this.filePath, 'utf8');",
    '      const parsed = JSON.parse(raw);',
    '      const tasks = Array.isArray(parsed?.tasks) ? parsed.tasks : [];',
    '      return { tasks };',
    '    } catch (error: any) {',
    "      if (error?.code === 'ENOENT') return { tasks: [] };",
    '      throw error;',
    '    }',
    '  }',
    '',
    '  private writeData(file: TaskFile): void {',
    "    fs.writeFileSync(this.filePath, JSON.stringify(file, null, 2), 'utf8');",
    '  }',
    '',
    '  list(): Task[] {',
    '    return this.readData().tasks;',
    '  }',
    '',
    '  add(title: string): Task {',
    '    const file = this.readData();',
    '    const task: Task = {',
    '      id: crypto.randomUUID(),',
    '      title,',
    '      done: false,',
    '      createdAt: new Date().toISOString()',
    '    };',
    '    file.tasks.push(task);',
    '    this.writeData(file);',
    '    return task;',
    '  }',
    '',
    '  done(id: string): Task {',
    '    const file = this.readData();',
    '    const idx = file.tasks.findIndex((t: Task) => t.id === id);',
    "    if (idx < 0) throw new Error('Task not found');",
    '    file.tasks[idx].done = true;',
    '    file.tasks[idx].doneAt = new Date().toISOString();',
    '    this.writeData(file);',
    '    return file.tasks[idx];',
    '  }',
    '',
    '  remove(id: string): Task {',
    '    const file = this.readData();',
    '    const idx = file.tasks.findIndex((t: Task) => t.id === id);',
    "    if (idx < 0) throw new Error('Task not found');",
    '    const [removed] = file.tasks.splice(idx, 1);',
    '    this.writeData(file);',
    '    return removed;',
    '  }',
    '}',
    ''
  ].join('\n');
}

function buildTsTodoFallbackCliTemplate(): string {
  return [
    "const { TaskStore } = require('./store');",
    '',
    'function usage(): string {',
    "  return 'Usage:\\n  list --data <path>\\n  add <title> --data <path>\\n  done <id> --data <path>\\n  remove <id> --data <path>\\n  --help';",
    '}',
    '',
    'function parseDataPath(args: string[]): string | null {',
    "  const idx = args.indexOf('--data');",
    '  if (idx >= 0 && idx + 1 < args.length) return args[idx + 1];',
    '  return null;',
    '}',
    '',
    'function firstPositional(args: string[]): string | null {',
    '  for (const token of args) {',
    "    if (!token.startsWith('--')) return token;",
    '  }',
    '  return null;',
    '}',
    '',
    'function main(): number {',
    '  const argv = process.argv.slice(2);',
    "  const cmd = String(argv[0] || '');",
    '',
    "  if (cmd === '' || cmd === '--help') {",
    '    console.log(usage());',
    '    return 0;',
    '  }',
    '',
    '  const dataPath = parseDataPath(argv);',
    '  if (!dataPath) {',
    "    console.error('Missing --data <path>');",
    '    return 1;',
    '  }',
    '',
    '  const value = firstPositional(argv.slice(1));',
    '  const store = new TaskStore(dataPath);',
    '',
    '  try {',
    "    if (cmd === 'list') {",
    '      console.log(JSON.stringify({ ok: true, tasks: store.list() }));',
    '      return 0;',
    '    }',
    "    if (cmd === 'add') {",
    "      if (!value) throw new Error('Missing title');",
    '      console.log(JSON.stringify({ ok: true, task: store.add(value) }));',
    '      return 0;',
    '    }',
    "    if (cmd === 'done') {",
    "      if (!value) throw new Error('Missing id');",
    '      console.log(JSON.stringify({ ok: true, task: store.done(value) }));',
    '      return 0;',
    '    }',
    "    if (cmd === 'remove') {",
    "      if (!value) throw new Error('Missing id');",
    '      console.log(JSON.stringify({ ok: true, task: store.remove(value) }));',
    '      return 0;',
    '    }',
    "    console.error('Unknown command');",
    '    return 1;',
    '  } catch (error: any) {',
    '    console.error(JSON.stringify({ ok: false, error: String(error?.message || error) }));',
    '    return 1;',
    '  }',
    '}',
    '',
    'const exitCode = main();',
    'if (typeof process?.exit === "function") process.exit(exitCode);',
    ''
  ].join('\n');
}

function hasNodeApiCreateServerExport(content: string): boolean {
  return (
    /\bmodule\.exports\.createServer\s*=/.test(content) ||
    /\bexports\.createServer\s*=/.test(content) ||
    /\bmodule\.exports\s*=\s*\{[\s\S]*\bcreateServer\b[\s\S]*\}/.test(content)
  );
}

function buildNodeApiFallbackServerTemplate(): string {
  return [
    "const http = require('node:http');",
    "const fs = require('node:fs');",
    "const path = require('node:path');",
    "const crypto = require('node:crypto');",
    '',
    'function sendJson(res, status, payload) {',
    "  res.writeHead(status, { 'Content-Type': 'application/json', 'Connection': 'close' });",
    '  res.end(JSON.stringify(payload));',
    '}',
    '',
    'function readTodos(dataPath) {',
    '  try {',
    "    const raw = fs.readFileSync(dataPath, 'utf8');",
    '    const parsed = JSON.parse(raw);',
    '    return Array.isArray(parsed?.todos) ? parsed.todos : [];',
    '  } catch (error) {',
    "    if (error && error.code === 'ENOENT') return [];",
    '    throw error;',
    '  }',
    '}',
    '',
    'function writeTodos(dataPath, todos) {',
    "  fs.writeFileSync(dataPath, JSON.stringify({ todos }, null, 2), 'utf8');",
    '}',
    '',
    'function readBody(req) {',
    '  return new Promise((resolve, reject) => {',
    "    let body = '';",
    "    req.on('data', chunk => { body += String(chunk); });",
    "    req.on('end', () => resolve(body));",
    "    req.on('error', reject);",
    '  });',
    '}',
    '',
    'function createServer({ dataPath }) {',
    '  return http.createServer(async (req, res) => {',
    '    try {',
    "      const method = String(req.method || 'GET').toUpperCase();",
    "      const url = new URL(String(req.url || '/'), 'http://127.0.0.1');",
    '      const pathname = url.pathname;',
    "      const idMatch = pathname.match(/^\\/todos\\/([^/]+)$/);",
    '      const id = idMatch ? decodeURIComponent(idMatch[1]) : null;',
    '',
    "      if (method === 'GET' && pathname === '/health') return sendJson(res, 200, { ok: true });",
    "      if (method === 'GET' && pathname === '/openapi.json') {",
    "        const spec = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'openapi.json'), 'utf8'));",
    '        return sendJson(res, 200, spec);',
    '      }',
    "      if (method === 'GET' && pathname === '/todos') return sendJson(res, 200, { ok: true, todos: readTodos(dataPath) });",
    "      if (method === 'POST' && pathname === '/todos') {",
    '        const body = await readBody(req);',
    '        const payload = body.trim() ? JSON.parse(body) : {};',
    "        const title = typeof payload.title === 'string' ? payload.title.trim() : '';",
    "        if (!title) return sendJson(res, 400, { ok: false, error: 'title is required' });",
    '        const todos = readTodos(dataPath);',
    '        const todo = { id: crypto.randomUUID(), title, done: false, createdAt: new Date().toISOString() };',
    '        todos.push(todo);',
    '        writeTodos(dataPath, todos);',
    '        return sendJson(res, 201, { ok: true, todo });',
    '      }',
    "      if (method === 'GET' && id) {",
    '        const todo = readTodos(dataPath).find(t => String(t.id) === id);',
    "        if (!todo) return sendJson(res, 404, { ok: false, error: 'not found' });",
    '        return sendJson(res, 200, { ok: true, todo });',
    '      }',
    "      if (method === 'PATCH' && id) {",
    '        const body = await readBody(req);',
    '        const payload = body.trim() ? JSON.parse(body) : {};',
    "        if (typeof payload.done !== 'boolean') return sendJson(res, 400, { ok: false, error: 'done must be boolean' });",
    '        const todos = readTodos(dataPath);',
    '        const idx = todos.findIndex(t => String(t.id) === id);',
    "        if (idx < 0) return sendJson(res, 404, { ok: false, error: 'not found' });",
    '        const next = { ...todos[idx], done: payload.done };',
    '        if (payload.done) next.doneAt = new Date().toISOString();',
    "        else if (Object.prototype.hasOwnProperty.call(next, 'doneAt')) delete next.doneAt;",
    '        todos[idx] = next;',
    '        writeTodos(dataPath, todos);',
    '        return sendJson(res, 200, { ok: true, todo: next });',
    '      }',
    "      if (method === 'DELETE' && id) {",
    '        const todos = readTodos(dataPath);',
    '        const idx = todos.findIndex(t => String(t.id) === id);',
    "        if (idx < 0) return sendJson(res, 404, { ok: false, error: 'not found' });",
    '        todos.splice(idx, 1);',
    '        writeTodos(dataPath, todos);',
    '        return sendJson(res, 200, { ok: true });',
    '      }',
    "      return sendJson(res, 404, { ok: false, error: 'not found' });",
    '    } catch {',
    "      return sendJson(res, 500, { ok: false, error: 'internal error' });",
    '    }',
    '  });',
    '}',
    '',
    'module.exports = { createServer };',
    ''
  ].join('\n');
}

async function applyTargetedTsTodoFallback(workspaceDir: string, previous: ValidationResult): Promise<boolean> {
  let changed = false;
  const fullText = collectValidationDebugText(previous);
  const lower = fullText.toLowerCase();

  const shouldFixCli = matchesAnyPattern(lower, [
    /src\/cli\.ts/,
    /expected json object on stdout/,
    /property 'data' does not exist on type/,
    /cannot redeclare block-scoped variable 'require'/,
    /cannot redeclare block-scoped variable 'process'/,
    /commander|yargs|minimist/
  ]);
  const shouldFixStore = matchesAnyPattern(lower, [
    /src\/store\.ts/,
    /taskstore export contract broken/,
    /dist\/store\.js missing/,
    /must export taskstore/,
    /self import/
  ]);
  const shouldFixTsconfig = matchesAnyPattern(lower, [
    /tsconfig\.json/,
    /compileroptions/,
    /typescript compiler not found/
  ]);

  const cliPath = path.join(workspaceDir, 'src', 'cli.ts');
  const storePath = path.join(workspaceDir, 'src', 'store.ts');
  const tsconfigPath = path.join(workspaceDir, 'tsconfig.json');
  const packagePath = path.join(workspaceDir, 'package.json');

  if (shouldFixCli) {
    await fs.promises.mkdir(path.dirname(cliPath), { recursive: true });
    await fs.promises.writeFile(cliPath, buildTsTodoFallbackCliTemplate(), 'utf8');
    changed = true;
  } else if (fs.existsSync(cliPath)) {
    const original = await fs.promises.readFile(cliPath, 'utf8');
    let next = original;
    next = next.replace(/^\s*declare const require:\s*any;\s*$/gm, '');
    next = next.replace(/^\s*declare const process:\s*any;\s*$/gm, '');
    if (next !== original) {
      await fs.promises.writeFile(cliPath, next, 'utf8');
      changed = true;
    }
  }

  if (shouldFixStore) {
    await fs.promises.mkdir(path.dirname(storePath), { recursive: true });
    await fs.promises.writeFile(storePath, buildTsTodoFallbackStoreTemplate(), 'utf8');
    changed = true;
  }

  if (shouldFixTsconfig) {
    const tsconfig = {
      compilerOptions: {
        target: 'ES2020',
        module: 'commonjs',
        moduleResolution: 'node',
        rootDir: 'src',
        outDir: 'dist',
        strict: false,
        noImplicitAny: false,
        useUnknownInCatchVariables: false,
        esModuleInterop: true,
        skipLibCheck: true
      },
      include: ['src/**/*.ts']
    };
    await fs.promises.writeFile(tsconfigPath, JSON.stringify(tsconfig, null, 2) + '\n', 'utf8');
    changed = true;
  }

  try {
    if (fs.existsSync(packagePath)) {
      const pkg = JSON.parse(await fs.promises.readFile(packagePath, 'utf8'));
      let touched = false;
      if (pkg.type === 'module') {
        delete pkg.type;
        touched = true;
      }
      if (pkg.dependencies && Object.keys(pkg.dependencies).length > 0) {
        delete pkg.dependencies;
        touched = true;
      }
      if (pkg.devDependencies && Object.keys(pkg.devDependencies).length > 0) {
        delete pkg.devDependencies;
        touched = true;
      }
      if (touched) {
        await fs.promises.writeFile(packagePath, JSON.stringify(pkg, null, 2) + '\n', 'utf8');
        changed = true;
      }
    }
  } catch {
    // keep best-effort fallback behavior
  }

  return changed;
}

async function applyTargetedNodeApiFallback(workspaceDir: string, previous: ValidationResult): Promise<boolean> {
  let changed = false;
  const fullText = collectValidationDebugText(previous);
  const lower = fullText.toLowerCase();
  const serverPath = path.join(workspaceDir, 'src', 'server.js');
  const openApiPath = path.join(workspaceDir, 'openapi.json');
  const packagePath = path.join(workspaceDir, 'package.json');

  if (fs.existsSync(serverPath)) {
    const original = await fs.promises.readFile(serverPath, 'utf8');
    let next = original;
    next = next.replace(/\bmodule\.exports\s*=\s*createServer\s*;?/g, 'module.exports = { createServer };');

    const hasCreateServerFn =
      /\bfunction\s+createServer\s*\(/.test(next) ||
      /\bconst\s+createServer\s*=\s*\(/.test(next) ||
      /\bconst\s+createServer\s*=\s*async\s*\(/.test(next);
    const hasCreateServerExport = hasNodeApiCreateServerExport(next);
    if (hasCreateServerFn && !hasCreateServerExport) {
      next = `${next.trimEnd()}\n\nmodule.exports = { createServer };\n`;
    }

    if (next !== original) {
      await fs.promises.writeFile(serverPath, next, 'utf8');
      changed = true;
    }
  }

  const severeServerIssue = matchesAnyPattern(lower, [
    /must define createserver/,
    /must not call listen\(\) internally/,
    /must use provided datapath argument/,
    /reading 'listen'/,
    /must export createserver/
  ]);
  if (severeServerIssue) {
    await fs.promises.mkdir(path.join(workspaceDir, 'src'), { recursive: true });
    await fs.promises.writeFile(serverPath, buildNodeApiFallbackServerTemplate(), 'utf8');
    changed = true;
  }

  try {
    if (fs.existsSync(openApiPath)) {
      const spec = JSON.parse(await fs.promises.readFile(openApiPath, 'utf8'));
      let touched = false;
      if (spec?.paths?.['/todos/{id}']?.delete?.responses?.['204'] && !spec?.paths?.['/todos/{id}']?.delete?.responses?.['200']) {
        spec.paths['/todos/{id}'].delete.responses['200'] = spec.paths['/todos/{id}'].delete.responses['204'];
        delete spec.paths['/todos/{id}'].delete.responses['204'];
        touched = true;
      }
      if (touched) {
        await fs.promises.writeFile(openApiPath, JSON.stringify(spec, null, 2) + '\n', 'utf8');
        changed = true;
      }
    }
  } catch {
    // ignore malformed openapi in targeted mode
  }

  try {
    if (fs.existsSync(packagePath)) {
      const pkg = JSON.parse(await fs.promises.readFile(packagePath, 'utf8'));
      let touched = false;
      if (pkg.type !== 'commonjs') {
        pkg.type = 'commonjs';
        touched = true;
      }
      if (pkg.dependencies && Object.keys(pkg.dependencies).length > 0) {
        delete pkg.dependencies;
        touched = true;
      }
      if (pkg.devDependencies && Object.keys(pkg.devDependencies).length > 0) {
        delete pkg.devDependencies;
        touched = true;
      }
      if (touched) {
        await fs.promises.writeFile(packagePath, JSON.stringify(pkg, null, 2) + '\n', 'utf8');
        changed = true;
      }
    }
  } catch {
    // best-effort only
  }

  return changed;
}

async function validateTsTodoOracleOnce(
  workspaceDir: string,
  applyDeterministicFallback: boolean,
  options?: ValidationPassOptions
): Promise<ValidationResult> {
  const diagnostics: string[] = [];
  const required = ['README.md', 'package.json', 'tsconfig.json', 'src/store.ts', 'src/cli.ts'];

  // Do cleanup first so previous failed iterations in patch mode do not poison the next validation.
  await fs.promises.rm(path.join(workspaceDir, 'dist'), { recursive: true, force: true });
  await fs.promises.rm(path.join(workspaceDir, 'node_modules'), { recursive: true, force: true });

  try {
    await fs.promises.rm(path.join(workspaceDir, 'tests'), { recursive: true, force: true });
    await installOracleFiles({ oracleDir: ORACLE_TS_TODO_DIR, workspaceDir });
  } catch (e: any) {
    diagnostics.push(`Failed to install oracle tests: ${String(e?.message || e)}`);
  }

  if (applyDeterministicFallback) {
    await stabilizeTsTodoWorkspace(workspaceDir);
  }

  for (const rel of required) {
    const abs = path.join(workspaceDir, rel);
    if (!fs.existsSync(abs)) diagnostics.push(`Missing required file: ${rel}`);
  }

  try {
    const files = await listFilesRecursively(workspaceDir);
    if (files.some(f => f.startsWith('dist/'))) diagnostics.push('Failed to clean dist/ before validation');
    if (files.some(f => f.startsWith('node_modules/'))) diagnostics.push('Failed to clean node_modules/ before validation');
  } catch (e: any) {
    diagnostics.push(`Failed to scan workspace files: ${String(e?.message || e)}`);
  }

  const readmePath = path.join(workspaceDir, 'README.md');
  if (fs.existsSync(readmePath)) {
    const readme = await fs.promises.readFile(readmePath, 'utf8');
    const low = readme.toLowerCase();
    if (!low.includes('add') || !low.includes('list')) diagnostics.push('README.md missing basic usage (add/list)');
  }

  // Validate package.json minimal deps
  try {
    const pkgPath = path.join(workspaceDir, 'package.json');
    const pkg = JSON.parse(await fs.promises.readFile(pkgPath, 'utf8'));
    const deps = pkg.dependencies && typeof pkg.dependencies === 'object' ? Object.keys(pkg.dependencies) : [];
    const devDeps = pkg.devDependencies && typeof pkg.devDependencies === 'object' ? Object.keys(pkg.devDependencies) : [];
    if (deps.length > 0 || devDeps.length > 0) {
      diagnostics.push('No dependencies allowed (dependencies/devDependencies must be empty or missing)');
    }
    if (pkg.type === 'module') diagnostics.push('package.json must not set "type": "module" (use commonjs or omit)');
  } catch (e: any) {
    diagnostics.push(`Invalid package.json: ${String(e?.message || e)}`);
  }

  try {
    const tsconfigPath = path.join(workspaceDir, 'tsconfig.json');
    const tsconfig = JSON.parse(await fs.promises.readFile(tsconfigPath, 'utf8'));
    const compilerOptions = (tsconfig && typeof tsconfig === 'object' ? tsconfig.compilerOptions : null) || {};
    if (compilerOptions.module && String(compilerOptions.module).toLowerCase() !== 'commonjs') {
      diagnostics.push('tsconfig.json should compile as CommonJS (compilerOptions.module = "commonjs")');
    }
    if (compilerOptions.outDir && String(compilerOptions.outDir).replace(/\\/g, '/') !== 'dist') {
      diagnostics.push('tsconfig.json should emit to dist/ (compilerOptions.outDir = "dist")');
    }
  } catch (e: any) {
    diagnostics.push(`Invalid tsconfig.json: ${String(e?.message || e)}`);
  }

  try {
    const storePath = path.join(workspaceDir, 'src', 'store.ts');
    if (fs.existsSync(storePath)) {
      const storeContent = await fs.promises.readFile(storePath, 'utf8');
      if (/from\s+['"]\.\/store['"]/.test(storeContent)) {
        diagnostics.push('Do not import Task/TaskStore from "./store" inside src/store.ts (self import)');
      }
      if (/declare\s+const\s+fs\s*=|declare\s+const\s+path\s*=|declare\s+const\s+crypto\s*=/i.test(storeContent)) {
        diagnostics.push('Do not use "declare const X = require(...)" in src/store.ts; use "const X = require(...)"');
      }
      if (!/\bclass\s+TaskStore\b/.test(storeContent)) diagnostics.push('src/store.ts must define class TaskStore');
      for (const method of ['list', 'add', 'done', 'remove']) {
        if (!new RegExp(`\\b${method}\\s*\\(`).test(storeContent)) {
          diagnostics.push(`src/store.ts missing TaskStore.${method}()`);
        }
      }
      const hasNamedTaskStoreExport =
        /\bexport\s+class\s+TaskStore\b/.test(storeContent) ||
        /\bexport\s*\{[^}]*\bTaskStore\b[^}]*\}/.test(storeContent);
      if (!hasNamedTaskStoreExport) diagnostics.push('src/store.ts must export TaskStore as named export (not default-only)');
    }
    const cliPath = path.join(workspaceDir, 'src', 'cli.ts');
    if (fs.existsSync(cliPath)) {
      const cliContent = await fs.promises.readFile(cliPath, 'utf8');
      if (/commander|yargs|minimist/i.test(cliContent)) {
        diagnostics.push('CLI must parse process.argv manually; do not use commander/yargs/minimist');
      }
      if (/import\s+TaskStore\s+from\s+['"]\.\/store['"]/.test(cliContent)) {
        diagnostics.push('src/cli.ts should import TaskStore as named import from ./store');
      }
      for (const cmd of ['add', 'list', 'done', 'remove']) {
        if (!new RegExp(`\\b${cmd}\\b`, 'i').test(cliContent)) diagnostics.push(`src/cli.ts should support command "${cmd}"`);
      }
      if (!/JSON\.stringify\s*\(/.test(cliContent)) diagnostics.push('src/cli.ts should print JSON outputs via JSON.stringify');
      if (!/\bok\b/.test(cliContent)) diagnostics.push('src/cli.ts outputs should include "ok" field in JSON responses');
    }
  } catch (e: any) {
    diagnostics.push(`Failed to scan TS source hints: ${String(e?.message || e)}`);
  }

  // Validate source only uses builtin modules (no external require/import)
  try {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const builtinModules: string[] = require('node:module').builtinModules || [];
    const builtin = new Set<string>(builtinModules.map((m: string) => (typeof m === 'string' ? m : String(m))));
    for (const m of [...builtin]) {
      if (m.startsWith('node:')) builtin.add(m.slice('node:'.length));
      else builtin.add(`node:${m}`);
    }

    const sourceFiles = (await listFilesRecursively(workspaceDir)).filter(p => {
      if (p.startsWith('tests/')) return false;
      if (p.startsWith('dist/')) return false;
      if (p.startsWith('node_modules/')) return false;
      return p.endsWith('.ts') || p.endsWith('.js');
    });
    const requireRe = /require\s*\(\s*['"]([^'"]+)['"]\s*\)/g;
    const importRe = /^\s*import\s+.*from\s+['"]([^'"]+)['"]/gm;

    for (const rel of sourceFiles) {
      const abs = path.join(workspaceDir, rel);
      const content = await fs.promises.readFile(abs, 'utf8');
      let m: RegExpExecArray | null;
      while ((m = requireRe.exec(content))) {
        const spec = m[1];
        if (!spec) continue;
        if (spec.startsWith('.') || spec.startsWith('/') || spec.startsWith('node:')) continue;
        if (!builtin.has(spec)) diagnostics.push(`Non-builtin require "${spec}" in ${rel}`);
      }
      while ((m = importRe.exec(content))) {
        const spec = m[1];
        if (!spec) continue;
        if (spec.startsWith('.') || spec.startsWith('/') || spec.startsWith('node:')) continue;
        if (!builtin.has(spec)) diagnostics.push(`Non-builtin import "${spec}" in ${rel}`);
      }
    }
  } catch (e: any) {
    diagnostics.push(`Failed to scan TS imports: ${String(e?.message || e)}`);
  }

  if (options?.fastFailOnFatal && shouldFastFailTsTodoDiagnostics(diagnostics)) {
    return {
      ok: false,
      diagnostics: ['Fast-fail: fatal TS contract signal detected before expensive command checks.', ...diagnostics],
      commands: []
    };
  }

  const repoRoot = path.resolve(__dirname, '..');
  const tscPath = path.join(repoRoot, 'node_modules', 'typescript', 'bin', 'tsc');
  if (!fs.existsSync(tscPath)) {
    diagnostics.push(`TypeScript compiler not found at ${tscPath}`);
    return { ok: false, diagnostics };
  }

  await fs.promises.rm(path.join(workspaceDir, 'dist'), { recursive: true, force: true });

  const cmdTimeoutMs = 10 * 60 * 1000;
  const commands: CommandResult[] = [];
  commands.push(await runCommand({ command: `node \"${tscPath}\" -p tsconfig.json`, cwd: workspaceDir, timeoutMs: cmdTimeoutMs }));
  commands.push(await runCommand({ command: 'node --test tests/oracle.test.js', cwd: workspaceDir, timeoutMs: cmdTimeoutMs }));
  commands.push(await runCommand({ command: 'node dist/cli.js --help', cwd: workspaceDir, timeoutMs: 60_000 }));

  for (const c of commands) {
    if (!c.ok) diagnostics.push(`Command failed: ${c.command} (exit=${c.exitCode}, timedOut=${c.timedOut})`);
  }

  const logs = commands.map(c => `${c.stdout}\n${c.stderr}`).join('\n');
  if (/cannot find module '\.\.\/dist\/store\.js'/i.test(logs)) {
    diagnostics.push('dist/store.js missing: ensure src/store.ts compiles and tsconfig emits to dist/');
  }
  if (/cannot find module '.*dist[\\\/]cli\.js'/i.test(logs)) {
    diagnostics.push('dist/cli.js missing: ensure src/cli.ts compiles to dist/cli.js');
  }
  if (/the specified path does not exist: 'tsconfig\.json'/i.test(logs)) {
    diagnostics.push('tsconfig.json missing or invalid for tsc -p tsconfig.json');
  }
  if (/TS7006: Parameter '.*' implicitly has an 'any' type/i.test(logs)) {
    diagnostics.push('TypeScript strict mode: annotate lambda/function params to avoid implicit any');
  }
  if (/ENOENT: no such file or directory, open '.*workspace\\\\[A-Z]:\\\\.*bot-eval-ts-todo/i.test(logs)) {
    diagnostics.push('TaskStore must use provided data path directly (do not join/resolve filePath with __dirname).');
  }
  if (/Expected JSON object on stdout/i.test(logs)) {
    diagnostics.push('CLI commands must print valid JSON object to stdout');
  }
  if (/Expected values to be strictly equal:[\s\S]*'undefined'[\s\S]*'function'/i.test(logs)) {
    diagnostics.push('TaskStore export contract broken: tests expect dist/store.js to export TaskStore constructor');
  }

  return { ok: diagnostics.length === 0, diagnostics, commands };
}

async function validateTsTodoOracle(workspaceDir: string, context: EvalRunContext): Promise<ValidationResult> {
  const mode = context.deterministicFallbackMode;
  const raw = await validateTsTodoOracleOnce(workspaceDir, false, { fastFailOnFatal: mode !== 'off' });
  recordDeterministicRawOutcome(context, 'tsTodo', raw.ok);

  if (mode === 'off') return raw;
  if (mode === 'on-fail' && raw.ok) return raw;

  const markers: string[] = [];
  const targetedApplied = await applyTargetedTsTodoFallback(workspaceDir, raw);
  if (targetedApplied) {
    const targeted = await validateTsTodoOracleOnce(workspaceDir, false);
    recordDeterministicFallbackActivation(context, 'tsTodo', 'targeted', targeted.ok);
    if (targeted.ok && !raw.ok) recordDeterministicRecoveredByFallback(context, 'tsTodo');
    markers.push(
      targeted.ok
        ? `Deterministic fallback activated (ts-todo-oracle, mode=${mode}, tier=targeted) and recovered validation.`
        : `Deterministic fallback activated (ts-todo-oracle, mode=${mode}, tier=targeted) but validation still failed.`
    );
    if (targeted.ok) {
      return {
        ...targeted,
        diagnostics: [...markers, ...targeted.diagnostics]
      };
    }
  } else if (mode === 'always') {
    markers.push('Deterministic fallback (tier=targeted) skipped: no targeted patch candidates found.');
  }

  const canonical = await validateTsTodoOracleOnce(workspaceDir, true);
  recordDeterministicFallbackActivation(context, 'tsTodo', 'canonical', canonical.ok);
  if (canonical.ok && !raw.ok) recordDeterministicRecoveredByFallback(context, 'tsTodo');
  markers.push(
    canonical.ok
      ? `Deterministic fallback activated (ts-todo-oracle, mode=${mode}, tier=canonical) and recovered validation.`
      : `Deterministic fallback activated (ts-todo-oracle, mode=${mode}, tier=canonical) but validation still failed.`
  );
  return {
    ...canonical,
    diagnostics: [...markers, ...canonical.diagnostics]
  };
}

async function validateNodeApiOracleOnce(
  workspaceDir: string,
  applyDeterministicFallback: boolean,
  options?: ValidationPassOptions
): Promise<ValidationResult> {
  const diagnostics: string[] = [];
  const required = ['README.md', 'package.json', 'openapi.json', 'src/server.js'];

  try {
    await fs.promises.rm(path.join(workspaceDir, 'tests'), { recursive: true, force: true });
    await installOracleFiles({ oracleDir: ORACLE_NODE_API_DIR, workspaceDir });
  } catch (e: any) {
    diagnostics.push(`Failed to install oracle tests: ${String(e?.message || e)}`);
  }

  if (applyDeterministicFallback) {
    await stabilizeNodeApiWorkspace(workspaceDir);
  }

  for (const rel of required) {
    const abs = path.join(workspaceDir, rel);
    if (!fs.existsSync(abs)) diagnostics.push(`Missing required file: ${rel}`);
  }

  // Validate package.json minimal deps + CJS
  try {
    const pkgPath = path.join(workspaceDir, 'package.json');
    const pkg = JSON.parse(await fs.promises.readFile(pkgPath, 'utf8'));
    if (pkg.type !== 'commonjs') diagnostics.push('package.json must set "type": "commonjs"');
    const deps = pkg.dependencies && typeof pkg.dependencies === 'object' ? Object.keys(pkg.dependencies) : [];
    const devDeps = pkg.devDependencies && typeof pkg.devDependencies === 'object' ? Object.keys(pkg.devDependencies) : [];
    if (deps.length > 0 || devDeps.length > 0) diagnostics.push('No dependencies allowed (dependencies/devDependencies must be empty or missing)');
  } catch (e: any) {
    diagnostics.push(`Invalid package.json: ${String(e?.message || e)}`);
  }

  try {
    const serverPath = path.join(workspaceDir, 'src', 'server.js');
    if (fs.existsSync(serverPath)) {
      const serverContent = await fs.promises.readFile(serverPath, 'utf8');
      const hasCreateServerFn =
        /\bfunction\s+createServer\s*\(/.test(serverContent) ||
        /\bconst\s+createServer\s*=\s*\(/.test(serverContent) ||
        /\bconst\s+createServer\s*=\s*async\s*\(/.test(serverContent);
      if (!hasCreateServerFn) diagnostics.push('src/server.js must define createServer({ dataPath })');

      const hasCreateServerExport =
        /\bmodule\.exports\.createServer\s*=/.test(serverContent) ||
        /\bexports\.createServer\s*=/.test(serverContent) ||
        /\bmodule\.exports\s*=\s*\{[\s\S]*\bcreateServer\b[\s\S]*\}/.test(serverContent);
      if (!hasCreateServerExport) {
        diagnostics.push('src/server.js must export createServer (e.g. module.exports = { createServer })');
      }
      if (/\.listen\s*\(/.test(serverContent)) {
        diagnostics.push('src/server.js must not call listen() internally; tests call listen() on returned server');
      }
      if (/['"]data\/todos\.json['"]/.test(serverContent)) {
        diagnostics.push('src/server.js must use provided dataPath argument (no hardcoded data/todos.json)');
      }
    }
  } catch (e: any) {
    diagnostics.push(`Failed to scan src/server.js: ${String(e?.message || e)}`);
  }

  // Validate server only uses builtin modules (no external require/import)
  try {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const builtinModules: string[] = require('node:module').builtinModules || [];
    const builtin = new Set<string>(builtinModules.map((m: string) => (typeof m === 'string' ? m : String(m))));
    // Some builtins appear without node: prefix; allow both forms.
    for (const m of [...builtin]) {
      if (m.startsWith('node:')) builtin.add(m.slice('node:'.length));
      else builtin.add(`node:${m}`);
    }

    const jsFiles = (await listFilesRecursively(workspaceDir)).filter(p => p.endsWith('.js'));
    const requireRe = /require\s*\(\s*['"]([^'"]+)['"]\s*\)/g;
    const importRe = /^\s*import\s+.*from\s+['"]([^'"]+)['"]/gm;

    for (const rel of jsFiles) {
      const abs = path.join(workspaceDir, rel);
      const content = await fs.promises.readFile(abs, 'utf8');
      let m: RegExpExecArray | null;
      while ((m = requireRe.exec(content))) {
        const spec = m[1];
        if (!spec) continue;
        if (spec.startsWith('.') || spec.startsWith('/') || spec.startsWith('node:')) continue;
        if (!builtin.has(spec)) diagnostics.push(`Non-builtin require "${spec}" in ${rel}`);
      }
      while ((m = importRe.exec(content))) {
        const spec = m[1];
        if (!spec) continue;
        if (spec.startsWith('.') || spec.startsWith('/') || spec.startsWith('node:')) continue;
        if (!builtin.has(spec)) diagnostics.push(`Non-builtin import "${spec}" in ${rel}`);
      }
    }
  } catch (e: any) {
    diagnostics.push(`Failed to scan JS imports: ${String(e?.message || e)}`);
  }

  // Validate openapi.json
  try {
    const specPath = path.join(workspaceDir, 'openapi.json');
    const spec = JSON.parse(await fs.promises.readFile(specPath, 'utf8'));
    if (typeof spec.openapi !== 'string') diagnostics.push('openapi.json missing "openapi" string');
    if (!spec.paths || typeof spec.paths !== 'object') diagnostics.push('openapi.json missing "paths" object');
    if (!spec.paths['/todos']) diagnostics.push('openapi.json missing "/todos" path');
    if (!spec.paths['/health']) diagnostics.push('openapi.json missing "/health" path');
    if (!spec.paths['/openapi.json']) diagnostics.push('openapi.json missing "/openapi.json" path');
    if (!spec.paths['/todos/{id}']) diagnostics.push('openapi.json missing "/todos/{id}" path');
    if (!spec.paths?.['/todos']?.get) diagnostics.push('openapi.json missing GET /todos');
    if (!spec.paths?.['/todos']?.post) diagnostics.push('openapi.json missing POST /todos');
    if (!spec.paths?.['/todos/{id}']?.get) diagnostics.push('openapi.json missing GET /todos/{id}');
    if (!spec.paths?.['/todos/{id}']?.patch) diagnostics.push('openapi.json missing PATCH /todos/{id}');
    if (!spec.paths?.['/todos/{id}']?.delete) diagnostics.push('openapi.json missing DELETE /todos/{id}');
  } catch (e: any) {
    diagnostics.push(`Invalid openapi.json: ${String(e?.message || e)}`);
  }

  if (options?.fastFailOnFatal && shouldFastFailNodeApiDiagnostics(diagnostics)) {
    return {
      ok: false,
      diagnostics: ['Fast-fail: fatal Node API contract signal detected before expensive command checks.', ...diagnostics],
      commands: []
    };
  }

  const cmdTimeoutMs = 10 * 60 * 1000;
  const commands: CommandResult[] = [];
  commands.push(await runCommand({ command: 'node --test tests/oracle.test.js', cwd: workspaceDir, timeoutMs: cmdTimeoutMs }));

  for (const c of commands) {
    if (!c.ok) diagnostics.push(`Command failed: ${c.command} (exit=${c.exitCode}, timedOut=${c.timedOut})`);
  }

  const logs = commands.map(c => `${c.stdout}\n${c.stderr}`).join('\n');
  if (/must export createServer/i.test(logs)) {
    diagnostics.push('src/server.js must export createServer (oracle assertion)');
  }
  if (/cannot read properties of undefined \(reading 'listen'\)/i.test(logs)) {
    diagnostics.push('Server startup failed: createServer export/return value is invalid');
  }
  if (/EADDRINUSE/i.test(logs)) {
    diagnostics.push('Server must not auto-listen on fixed port; return server instance only');
  }

  return { ok: diagnostics.length === 0, diagnostics, commands };
}

async function validateNodeApiOracle(workspaceDir: string, context: EvalRunContext): Promise<ValidationResult> {
  const mode = context.deterministicFallbackMode;
  const raw = await validateNodeApiOracleOnce(workspaceDir, false, { fastFailOnFatal: mode !== 'off' });
  recordDeterministicRawOutcome(context, 'nodeApi', raw.ok);

  if (mode === 'off') return raw;
  if (mode === 'on-fail' && raw.ok) return raw;

  const markers: string[] = [];
  const targetedApplied = await applyTargetedNodeApiFallback(workspaceDir, raw);
  if (targetedApplied) {
    const targeted = await validateNodeApiOracleOnce(workspaceDir, false);
    recordDeterministicFallbackActivation(context, 'nodeApi', 'targeted', targeted.ok);
    if (targeted.ok && !raw.ok) recordDeterministicRecoveredByFallback(context, 'nodeApi');
    markers.push(
      targeted.ok
        ? `Deterministic fallback activated (node-api-oracle, mode=${mode}, tier=targeted) and recovered validation.`
        : `Deterministic fallback activated (node-api-oracle, mode=${mode}, tier=targeted) but validation still failed.`
    );
    if (targeted.ok) {
      return {
        ...targeted,
        diagnostics: [...markers, ...targeted.diagnostics]
      };
    }
  } else if (mode === 'always') {
    markers.push('Deterministic fallback (tier=targeted) skipped: no targeted patch candidates found.');
  }

  const canonical = await validateNodeApiOracleOnce(workspaceDir, true);
  recordDeterministicFallbackActivation(context, 'nodeApi', 'canonical', canonical.ok);
  if (canonical.ok && !raw.ok) recordDeterministicRecoveredByFallback(context, 'nodeApi');
  markers.push(
    canonical.ok
      ? `Deterministic fallback activated (node-api-oracle, mode=${mode}, tier=canonical) and recovered validation.`
      : `Deterministic fallback activated (node-api-oracle, mode=${mode}, tier=canonical) but validation still failed.`
  );
  return {
    ...canonical,
    diagnostics: [...markers, ...canonical.diagnostics]
  };
}

function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

function computeRetryDelayMs(attempt: number): number {
  const expDelay = Math.min(OLLAMA_RETRY_MAX_DELAY_MS, OLLAMA_RETRY_BASE_DELAY_MS * Math.pow(2, Math.max(0, attempt - 1)));
  const jitter = Math.floor(expDelay * 0.2 * Math.random());
  return expDelay + jitter;
}

function parseOllamaHttpStatusFromError(message: string): number | null {
  const m = String(message || '').match(/ollama http\s+(\d{3})/i);
  if (!m) return null;
  const status = Number(m[1]);
  return Number.isFinite(status) ? status : null;
}

function isRetriableOllamaHttpStatus(status: number): boolean {
  return status === 408 || status === 409 || status === 425 || status === 429 || status === 500 || status === 502 || status === 503 || status === 504;
}

export function isRetriableOllamaRequestError(error: unknown): boolean {
  const message = String((error as any)?.message ?? error ?? '').toLowerCase();
  const status = parseOllamaHttpStatusFromError(message);
  if (status != null) return isRetriableOllamaHttpStatus(status);

  return (
    /\beaddrinuse\b/.test(message) ||
    /\beconnreset\b/.test(message) ||
    /\beconnrefused\b/.test(message) ||
    /\betimedout\b/.test(message) ||
    /\beconnaborted\b/.test(message) ||
    /\behostunreach\b/.test(message) ||
    /\benetunreach\b/.test(message) ||
    /\beai_again\b/.test(message) ||
    /socket hang up/.test(message) ||
    /network error/.test(message) ||
    /failed to fetch/.test(message) ||
    /request to .* failed, reason:/.test(message)
  );
}

async function withOllamaRetry<T>(request: () => Promise<T>): Promise<T> {
  let lastError: unknown;
  for (let attempt = 1; attempt <= OLLAMA_RETRY_ATTEMPTS; attempt++) {
    try {
      return await request();
    } catch (error: unknown) {
      lastError = error;
      if (attempt >= OLLAMA_RETRY_ATTEMPTS || !isRetriableOllamaRequestError(error)) {
        throw error;
      }
      await sleep(computeRetryDelayMs(attempt));
    }
  }
  throw lastError;
}

async function postOllamaJsonWithRetry(params: {
  url: string;
  body: unknown;
  timeoutMs: number;
}): Promise<{ ok: boolean; status: number; text: string }> {
  return await withOllamaRetry(async () => {
    const controller = new AbortController();
    const t = setTimeout(() => controller.abort(), params.timeoutMs);
    try {
      const res = await fetch(params.url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(params.body),
        signal: controller.signal as any,
      });
      const text = await res.text();
      if (!res.ok && isRetriableOllamaHttpStatus(res.status)) {
        throw new Error(`Ollama HTTP ${res.status}: ${text}`);
      }
      return { ok: res.ok, status: res.status, text };
    } finally {
      clearTimeout(t);
    }
  });
}

async function ollamaGenerate(params: {
  baseUrl: string;
  model: string;
  prompt: string;
  timeoutMs: number;
  options?: OllamaOptions;
}): Promise<{ responseText: string; raw: any; usedFormatJson: boolean }> {
  const url = new URL('/api/generate', params.baseUrl).toString();
  const payloadWithFormat: any = {
    model: params.model,
    prompt: params.prompt,
    stream: false,
    format: 'json',
  };
  if (params.options && Object.keys(params.options).length > 0) payloadWithFormat.options = params.options;

  const response = await postOllamaJsonWithRetry({
    url,
    body: payloadWithFormat,
    timeoutMs: params.timeoutMs
  });
  if (!response.ok) {
    // Fallback for older Ollama that rejects "format"
    if (response.text.includes('unknown field') && response.text.includes('format')) {
      return await ollamaGenerateWithoutFormat({ ...params, timeoutMs: params.timeoutMs });
    }
    throw new Error(`Ollama HTTP ${response.status}: ${response.text}`);
  }
  const raw = JSON.parse(response.text);
  return { responseText: String(raw?.response ?? ''), raw, usedFormatJson: true };
}

async function ollamaChatGenerateWithSchema(params: {
  baseUrl: string;
  model: string;
  prompt: string;
  timeoutMs: number;
  schema: Record<string, unknown>;
  options?: OllamaOptions;
}): Promise<{ responseText: string; raw: any }> {
  const url = new URL('/api/chat', params.baseUrl).toString();
  const body: any = {
    model: params.model,
    stream: false,
    format: params.schema,
    messages: [
      { role: 'user', content: params.prompt }
    ]
  };
  if (params.options && Object.keys(params.options).length > 0) body.options = params.options;
  const response = await postOllamaJsonWithRetry({
    url,
    body,
    timeoutMs: params.timeoutMs
  });
  if (!response.ok) throw new Error(`Ollama HTTP ${response.status}: ${response.text}`);
  const raw = JSON.parse(response.text);
  const responseText = String(raw?.message?.content ?? raw?.response ?? '');
  return { responseText, raw };
}

function shouldFallbackFromStructured(message: string): boolean {
  const text = String(message || '').toLowerCase();
  return (
    text.includes('empty content') ||
    text.includes('non-json content') ||
    text.includes('structured chat returned') ||
    text.includes('unknown field') ||
    text.includes('unsupported') ||
    text.includes('not found') ||
    text.includes('/api/chat') ||
    text.includes('messages') ||
    text.includes('format') ||
    text.includes('invalid') ||
    text.includes('model output is not valid json') ||
    text.includes('unexpected token')
  );
}

async function ollamaGenerateWithoutFormat(params: {
  baseUrl: string;
  model: string;
  prompt: string;
  timeoutMs: number;
  options?: OllamaOptions;
}): Promise<{ responseText: string; raw: any; usedFormatJson: boolean }> {
  const url = new URL('/api/generate', params.baseUrl).toString();
  const response = await postOllamaJsonWithRetry({
    url,
    body: {
      model: params.model,
      prompt: params.prompt,
      stream: false,
      ...(params.options && Object.keys(params.options).length > 0 ? { options: params.options } : {}),
    },
    timeoutMs: params.timeoutMs
  });
  if (!response.ok) throw new Error(`Ollama HTTP ${response.status}: ${response.text}`);
  const raw = JSON.parse(response.text);
  return { responseText: String(raw?.response ?? ''), raw, usedFormatJson: false };
}

async function ollamaGenerateStructuredObject<T = any>(params: {
  baseUrl: string;
  model: string;
  prompt: string;
  timeoutMs: number;
  schema: Record<string, unknown>;
  options?: OllamaOptions;
  minNumPredict?: number;
  validateObject?: (obj: any) => void;
}): Promise<{ obj: T; responseText: string; raw: any; meta: StructuredGenerationMeta }> {
  const reliabilityOptions = buildStructuredReliabilityOptions(
    params.options,
    params.minNumPredict ?? STRUCTURED_MIN_NUM_PREDICT
  );
  const parseAndValidate = (text: string): T => {
    const obj = parseAnyJson(text);
    if (params.validateObject) params.validateObject(obj);
    return obj as T;
  };

  const structured = await ollamaGenerateStructured({
    ...params,
    options: reliabilityOptions
  });
  try {
    const obj = parseAndValidate(structured.responseText);
    return { ...structured, obj };
  } catch (structuredParseErr: any) {
    const structuredErr = String(structuredParseErr?.message || structuredParseErr);
    if (structured.meta.transport !== 'chat' || structured.meta.fallbackUsed) {
      throw new Error(structuredErr);
    }
    const fallback = await ollamaGenerate({
      baseUrl: params.baseUrl,
      model: params.model,
      prompt: params.prompt,
      timeoutMs: params.timeoutMs,
      options: reliabilityOptions
    });
    try {
      const obj = parseAndValidate(fallback.responseText);
      return {
        obj,
        responseText: fallback.responseText,
        raw: fallback.raw,
        meta: {
          transport: 'generate',
          formatKind: fallback.usedFormatJson ? 'json' : 'none',
          schemaUsed: false,
          fallbackUsed: true,
          usedFormatJson: fallback.usedFormatJson,
          fallbackReason: structuredErr,
          doneReason: extractDoneReason(fallback.raw),
          evalCount: Number.isFinite(Number(fallback.raw?.eval_count)) ? Number(fallback.raw?.eval_count) : undefined,
          promptEvalCount: Number.isFinite(Number(fallback.raw?.prompt_eval_count)) ? Number(fallback.raw?.prompt_eval_count) : undefined,
          effectiveOptions: reliabilityOptions
        }
      };
    } catch (fallbackParseErr: any) {
      const fallbackErr = String(fallbackParseErr?.message || fallbackParseErr);
      throw new Error(`Structured object parse failed (${structuredErr}); generate fallback parse failed (${fallbackErr})`);
    }
  }
}

async function ollamaGenerateStructured(params: {
  baseUrl: string;
  model: string;
  prompt: string;
  timeoutMs: number;
  schema: Record<string, unknown>;
  options?: OllamaOptions;
  minNumPredict?: number;
}): Promise<{ responseText: string; raw: any; meta: StructuredGenerationMeta }> {
  const reliabilityOptions = buildStructuredReliabilityOptions(
    params.options,
    params.minNumPredict ?? STRUCTURED_MIN_NUM_PREDICT
  );
  try {
    const res = await ollamaChatGenerateWithSchema({
      baseUrl: params.baseUrl,
      model: params.model,
      prompt: params.prompt,
      timeoutMs: params.timeoutMs,
      schema: params.schema,
      options: reliabilityOptions
    });
    const chatResponseText = String(res.responseText || '');
    if (!chatResponseText.trim()) {
      throw new Error('Structured chat returned empty content');
    }
    // Some models reply in reasoning channel while message.content is empty/non-JSON.
    // Treat that as structured failure and fallback to legacy /api/generate.
    try {
      parseAnyJson(chatResponseText);
    } catch (parseErr: any) {
      const parseMsg = String(parseErr?.message || parseErr);
      throw new Error(`Structured chat returned non-JSON content: ${parseMsg}`);
    }
    return {
      responseText: chatResponseText,
      raw: res.raw,
      meta: {
        transport: 'chat',
        formatKind: 'schema',
        schemaUsed: true,
        fallbackUsed: false,
        usedFormatJson: false,
        doneReason: extractDoneReason(res.raw),
        evalCount: Number.isFinite(Number(res.raw?.eval_count)) ? Number(res.raw?.eval_count) : undefined,
        promptEvalCount: Number.isFinite(Number(res.raw?.prompt_eval_count)) ? Number(res.raw?.prompt_eval_count) : undefined,
        effectiveOptions: reliabilityOptions
      }
    };
  } catch (chatErr: any) {
    const chatMsg = String(chatErr?.message || chatErr);
    if (!shouldFallbackFromStructured(chatMsg) && !/position \d+|line \d+ column|expected ','|after array element/i.test(chatMsg.toLowerCase())) {
      throw new Error(`Structured chat failed: ${chatMsg}`);
    }
    const fallback = await ollamaGenerate({
      baseUrl: params.baseUrl,
      model: params.model,
      prompt: params.prompt,
      timeoutMs: params.timeoutMs,
      options: reliabilityOptions
    });
    return {
      responseText: fallback.responseText,
      raw: fallback.raw,
      meta: {
        transport: 'generate',
        formatKind: fallback.usedFormatJson ? 'json' : 'none',
        schemaUsed: false,
        fallbackUsed: true,
        usedFormatJson: fallback.usedFormatJson,
        fallbackReason: chatMsg,
        doneReason: extractDoneReason(fallback.raw),
        evalCount: Number.isFinite(Number(fallback.raw?.eval_count)) ? Number(fallback.raw?.eval_count) : undefined,
        promptEvalCount: Number.isFinite(Number(fallback.raw?.prompt_eval_count)) ? Number(fallback.raw?.prompt_eval_count) : undefined,
        effectiveOptions: reliabilityOptions
      }
    };
  }
}

function parseModelOutput(rawText: string): ModelOutput {
  const trimmed = rawText.trim();
  try {
    return JSON.parse(trimmed) as ModelOutput;
  } catch {
    const start = trimmed.indexOf('{');
    const end = trimmed.lastIndexOf('}');
    if (start >= 0 && end > start) {
      const slice = trimmed.slice(start, end + 1);
      return JSON.parse(slice) as ModelOutput;
    }
    throw new Error('Model output is not valid JSON');
  }
}

function parseAnyJson(rawText: string): any {
  const trimmed = rawText.trim();
  try {
    return JSON.parse(trimmed);
  } catch {
    const start = trimmed.indexOf('{');
    const end = trimmed.lastIndexOf('}');
    if (start >= 0 && end > start) {
      const slice = trimmed.slice(start, end + 1);
      return JSON.parse(slice);
    }
    throw new Error('Model output is not valid JSON');
  }
}

async function ollamaGenerateJsonObject<T = any>(params: {
  baseUrl: string;
  model: string;
  prompt: string;
  timeoutMs: number;
  options?: OllamaOptions;
}): Promise<{ obj: T; responseText: string; raw: any; usedFormatJson: boolean }> {
  const res = await ollamaGenerate(params);
  const obj = parseAnyJson(res.responseText) as T;
  return { ...res, obj };
}

function validateBasicSchema(obj: any): asserts obj is ModelOutput {
  if (!obj || typeof obj !== 'object') throw new Error('JSON root must be an object');
  if (!Array.isArray(obj.files)) throw new Error('Missing "files" array');
  for (const f of obj.files) {
    if (!f || typeof f !== 'object') throw new Error('files[] must be objects');
    if (typeof f.path !== 'string' || typeof f.content !== 'string') {
      throw new Error('files[] items must have string "path" and "content"');
    }
  }
  if (obj.notes != null && typeof obj.notes !== 'string') throw new Error('"notes" must be a string');
  if (obj.mode != null && obj.mode !== 'full' && obj.mode !== 'patch') throw new Error('"mode" must be "full" or "patch"');
}

function validatePlannerSchema(obj: any): asserts obj is PlannerOutput {
  if (!obj || typeof obj !== 'object') throw new Error('Planner JSON root must be an object');
  if (typeof obj.plan !== 'string' || !obj.plan.trim()) throw new Error('Planner output must contain non-empty "plan" string');
}

function normalizePlannerPlanText(plan: string): string {
  const normalized = String(plan || '').replace(/\r\n/g, '\n').trim();
  if (!normalized) return '';

  const reasoningLike = /^(let'?s|i\s+will|i\s+need|thinking|reasoning|analysis)\b/i;
  const lines = normalized
    .split('\n')
    .map(line => line.trim())
    .filter(Boolean)
    .filter(line => !reasoningLike.test(line));

  let steps = lines.filter(line => /^[-*]\s+/.test(line) || /^\d+[.)]\s+/.test(line));
  if (steps.length === 0) {
    steps = normalized
      .split(/(?<=[.!?])\s+/)
      .map(line => line.trim())
      .filter(Boolean)
      .filter(line => !reasoningLike.test(line));
  }
  if (steps.length === 0) return normalized.slice(0, 1200).trim();

  const compact = steps
    .map(line => line.replace(/^\d+[.)]\s*/, '').replace(/^[-*]\s*/, '').trim())
    .filter(Boolean)
    .slice(0, 12)
    .map(line => {
      const clipped = line.length > 200 ? `${line.slice(0, 200).trimEnd()}...` : line;
      return `- ${clipped}`;
    })
    .join('\n')
    .trim();

  return compact || normalized.slice(0, 1200).trim();
}

function buildDeterministicPlannerFallback(scenarioId: string): string {
  if (scenarioId === 'ts-todo-oracle') {
    return [
      '- Create full project files: README.md, package.json, tsconfig.json, src/store.ts, src/cli.ts.',
      '- In src/store.ts, persist JSON as { tasks: [...] } and read with fallback for missing file.',
      '- Keep TaskStore constructor using provided filePath directly (no path join/resolve).',
      '- Export TaskStore as named export and include list/add/done/remove methods.',
      '- In src/cli.ts, parse process.argv manually and return JSON objects with ok=true/false.',
      '- Ensure --help exits 0 without requiring --data.',
      '- For list/add/done/remove, require --data path but do NOT require the file to already exist.',
      '- Keep package.json without dependencies/devDependencies and avoid type=module.',
      '- Verify with tsc build, oracle tests, and cli --help.'
    ].join('\n');
  }
  if (scenarioId === 'node-api-oracle') {
    return [
      '- Create full files: README.md, package.json, openapi.json, src/server.js.',
      '- Export createServer via module.exports = { createServer } and never call listen() inside.',
      '- Use only Node builtins and keep package.json as commonjs with no dependencies.',
      '- Implement /health, /openapi.json, /todos, /todos/{id} with GET/POST/PATCH/DELETE.',
      '- Persist todos as { todos: [...] } in dataPath.',
      '- Verify with oracle tests.'
    ].join('\n');
  }
  if (scenarioId === 'python-ai-stdlib-oracle') {
    return [
      '- Create full files: README.md, mini_ai/__init__.py, mini_ai/markov.py, mini_ai/cli.py.',
      '- Implement MarkovChain with train/generate/to_dict/from_dict and ValueError for order <= 0.',
      '- Ensure generate(length, seed, random_seed) returns exactly `length` chars for trained model.',
      '- In cli, define main(argv=None)->int with train/generate argparse subcommands.',
      '- Save/load model JSON via to_dict()/from_dict() and avoid undefined load_model/save_model imports.',
      '- Verify with compileall, oracle unittest, and python -m mini_ai.cli --help.'
    ].join('\n');
  }
  return '';
}

function findDuplicateFilePaths(files: FileSpec[]): string[] {
  const counts = new Map<string, { firstPath: string; count: number }>();
  for (const file of files) {
    const key = sanitizePathForCaseInsensitiveCompare(file.path);
    const existing = counts.get(key);
    if (existing) {
      existing.count += 1;
    } else {
      counts.set(key, { firstPath: file.path, count: 1 });
    }
  }
  const duplicates: string[] = [];
  for (const entry of counts.values()) {
    if (entry.count > 1) duplicates.push(entry.firstPath);
  }
  return duplicates.sort();
}

function getScenarioCoreRequiredFiles(scenarioId: string): string[] {
  switch (scenarioId) {
    case 'ts-todo-oracle':
      return ['README.md', 'package.json', 'tsconfig.json', 'src/store.ts', 'src/cli.ts'];
    case 'node-api-oracle':
      return ['README.md', 'package.json', 'openapi.json', 'src/server.js'];
    case 'python-ai-stdlib-oracle':
      return ['README.md', 'mini_ai/__init__.py', 'mini_ai/markov.py', 'mini_ai/cli.py'];
    default:
      return [];
  }
}

function buildFirstIterationContractHint(scenarioId: string): string {
  if (scenarioId === 'ts-todo-oracle') {
    return [
      '- This is iteration 1: mode MUST be "full". Do not return "patch".',
      '- files[] MUST contain exactly the core project files: README.md, package.json, tsconfig.json, src/store.ts, src/cli.ts.',
      '- src/store.ts must define and named-export TaskStore with list/add/done/remove.',
      '- In TaskStore constructor keep `this.filePath = filePath`; never join/resolve with __dirname because tests pass absolute data paths.',
      '- src/cli.ts must parse process.argv manually and emit JSON { ok: ... }.',
      '- For list/add/done/remove, `--data` is required but the file may not exist yet.',
      '- No external dependencies in package.json.'
    ].join('\n');
  }
  if (scenarioId === 'node-api-oracle') {
    return [
      '- This is iteration 1: mode MUST be "full". Do not return "patch".',
      '- files[] MUST contain exactly: README.md, package.json, openapi.json, src/server.js.',
      '- src/server.js must export createServer and must NOT call listen().',
      '- openapi.json must include /health, /openapi.json, /todos, /todos/{id} with GET/POST/PATCH/DELETE coverage.',
      '- Use only Node builtins; no external dependencies.'
    ].join('\n');
  }
  if (scenarioId === 'python-ai-stdlib-oracle') {
    return [
      '- This is iteration 1: mode MUST be "full". Do not return "patch".',
      '- files[] MUST contain: README.md, mini_ai/__init__.py, mini_ai/markov.py, mini_ai/cli.py.',
      '- mini_ai/cli.py must import only MarkovChain from mini_ai.markov and use to_dict()/from_dict() for model JSON I/O.',
      '- Do NOT import load_model/save_model from mini_ai.markov unless you define them in markov.py.',
      '- MarkovChain.generate(length, seed, random_seed) must return exactly `length` characters for trained model.',
      '- main(argv) must return exit code 0 for train/generate success.'
    ].join('\n');
  }
  return '';
}

function buildPromptForIteration(basePrompt: string, scenarioId: string, iteration: number): string {
  if (iteration !== 1) return basePrompt;
  const hint = buildFirstIterationContractHint(scenarioId);
  if (!hint) return basePrompt;
  return `${basePrompt}\n\n---\nFIRST ITERATION RELIABILITY CONTRACT (RAW PASS PRIORITY):\n${hint}\n`;
}

function findMissingCoreFilesInOutput(files: FileSpec[], required: string[]): string[] {
  const present = new Set(files.map(f => sanitizePathForCaseInsensitiveCompare(f.path)));
  return required.filter(rel => !present.has(sanitizePathForCaseInsensitiveCompare(rel)));
}

function findPlaceholderFiles(files: FileSpec[]): string[] {
  const patterns = [
    /\.\.\.\s*\(.*?(remaining|rest).*?\)/i,
    /\bremaining part\b/i,
    /\brest of (the )?file\b/i,
    /\brest of the code\b/i,
    /\bfile remains unchanged\b/i,
  ];
  const bad: string[] = [];
  for (const f of files) {
    const content = f.content || '';
    if (patterns.some(p => p.test(content))) bad.push(f.path);
  }
  return bad;
}

function validateModelOutputForWrite(obj: any): asserts obj is ModelOutput {
  validateBasicSchema(obj);
  const placeholderFiles = findPlaceholderFiles(obj.files);
  if (placeholderFiles.length > 0) {
    throw new Error(`Placeholder content detected in files: ${placeholderFiles.join(', ')}`);
  }
  const duplicates = findDuplicateFilePaths(obj.files);
  if (duplicates.length > 0) {
    throw new Error(`Duplicate file paths in files[]: ${duplicates.join(', ')}`);
  }
}

function parseAndValidateModelOutput(rawText: string): ModelOutput {
  const parsed = parseModelOutput(rawText);
  validateModelOutputForWrite(parsed);
  return parsed;
}

export function computePlannerParseFailureKind(params: {
  finalOk: boolean;
  finalError?: string;
  finalErrorKind?: ParseErrorKind;
}): ParseErrorKind | null {
  if (params.finalOk) return null;
  if (params.finalErrorKind) return params.finalErrorKind;
  return classifyParseError(params.finalError || 'Planner parse failed');
}

export function computeIterationParseFailureKind(
  parsed: ModelOutput | null,
  lastParseKind: ParseErrorKind
): ParseErrorKind | null {
  if (parsed) return null;
  return lastParseKind;
}

function recordParseFailure(stats: ParseStats, kind: ParseErrorKind): void {
  stats.parseFailures += 1;
  if (kind === 'schema') {
    stats.schemaFailures += 1;
    return;
  }
  if (kind === 'json_parse') {
    stats.jsonParseFailures += 1;
    return;
  }
  if (kind === 'placeholder') {
    stats.placeholderFailures += 1;
    return;
  }
  stats.otherFailures += 1;
}

function sliceForPrompt(text: string, maxChars: number): string {
  const t = text.replace(/\r\n/g, '\n');
  if (t.length <= maxChars) return t;
  return t.slice(0, maxChars) + '\n...<snip>...\n';
}

function extractPythonPathsFromText(text: string): string[] {
  const out = new Set<string>();
  const exts = '(?:py|ts|js|json|md)';
  const winAbs = new RegExp(`[a-zA-Z]:\\\\[^\\r\\n\"']+?\\.${exts}`, 'g');
  const posixAbs = new RegExp(`/[^\\r\\n\"']+?\\.${exts}`, 'g');
  const relPath = new RegExp(`(?:^|\\s|\\\")([a-zA-Z0-9_./\\\\-]+?\\.${exts})(?:\\(|:|\\s|$)`, 'gm');

  for (const m of text.match(winAbs) || []) out.add(m);
  for (const m of text.match(posixAbs) || []) out.add(m);
  let match: RegExpExecArray | null;
  while ((match = relPath.exec(text))) {
    if (match[1]) out.add(match[1]);
  }
  return [...out];
}

function extractPythonSyntaxHints(text: string): Array<{ rawPath: string; line: number }> {
  const hints: Array<{ rawPath: string; line: number }> = [];
  const re1 = /File\s+"([^"]+?\.py)"\s*,\s*line\s+(\d+)/g;
  const re2 = /([a-zA-Z0-9_./\\-]+?\.py)\s*,\s*line\s+(\d+)/g;
  let m: RegExpExecArray | null;
  while ((m = re1.exec(text))) {
    const line = Number(m[2]);
    if (Number.isFinite(line) && line > 0) hints.push({ rawPath: m[1], line: Math.trunc(line) });
  }
  while ((m = re2.exec(text))) {
    const line = Number(m[2]);
    if (Number.isFinite(line) && line > 0) hints.push({ rawPath: m[1], line: Math.trunc(line) });
  }
  return hints;
}

function toRelativeExistingPath(workspaceDir: string, candidatePath: string): string | null {
  const candidate = candidatePath.replace(/\\/g, '/');
  const rel = path.isAbsolute(candidatePath)
    ? path.relative(workspaceDir, candidatePath).replace(/\\/g, '/')
    : candidate;
  if (!rel || rel.startsWith('..')) return null;
  const abs = path.join(workspaceDir, rel);
  return fs.existsSync(abs) ? rel : null;
}

function sliceLineWindow(content: string, line: number, radius: number): string {
  const lines = content.replace(/\r\n/g, '\n').split('\n');
  const target = Math.max(1, Math.min(line, lines.length));
  const start = Math.max(1, target - radius);
  const end = Math.min(lines.length, target + radius);
  const out: string[] = [];
  for (let i = start; i <= end; i++) {
    const marker = i === target ? '>>' : '  ';
    out.push(`${marker} ${String(i).padStart(4, ' ')} | ${lines[i - 1] ?? ''}`);
  }
  return out.join('\n');
}

function buildJsonRepairPrompt(rawText: string): string {
  return [
    'Jsi JSON opravovac. Dostanes text, ktery ma byt JEDEN validni JSON objekt.',
    'Schema kontrakt:',
    '{ "mode": "full|patch", "files": [ {"path":"...","content":"..."} ], "notes": "optional" }',
    'Tvuj ukol: vrat JEN validni JSON objekt bez markdownu a bez jineho textu.',
    'Pravidla:',
    '- Musi existovat pouze jeden root objekt.',
    '- Pole "files" musi byt pole OBJEKTU se string "path" a "content".',
    '- Nepouzivej duplicate root keys (napr. druhe "files").',
    '- Zachovej obsah souboru; neopravuj logiku, pouze strukturu/escaping JSON.',
    '- NEVKLADAJ zkratky ani placeholdery.',
    '',
    'TEXT:',
    '<<<',
    rawText.trim(),
    '>>>',
  ].join('\n');
}

function buildJsonSchemaRepairPrompt(rawText: string, failureReason: string): string {
  return [
    'Jsi schema repair validator. Musis vratit JEDEN validni JSON objekt v presnem kontraktu.',
    'Schema kontrakt:',
    '{ "mode": "full|patch", "files": [ {"path":"...","content":"..."} ], "notes": "optional" }',
    'Dulezite:',
    '- "files" je POVINNE pole objektu.',
    '- Kazda polozka files ma string "path" a string "content".',
    '- Zadny markdown, zadny text mimo JSON.',
    '- Zadne duplicate root keys.',
    '- Zachovej maximalne puvodni obsah souboru.',
    '',
    `Predchozi chyba: ${failureReason}`,
    '',
    'TEXT:',
    '<<<',
    rawText.trim(),
    '>>>'
  ].join('\n');
}

function buildPlannerRepairPrompt(rawResponseText: string, failureReason: string): string {
  return [
    'Jsi planner JSON repair validator.',
    'Vrat JEN validni JSON objekt: { "plan": "..." }',
    'Dulezite:',
    '- plan musi byt non-empty string',
    '- plan ma byt kratky seznam konkretne proveditelnych kroku',
    '- nepouzivej chain-of-thought nebo metakomenty typu "premyslim"',
    '- zadny markdown, zadny dalsi text',
    '',
    `Predchozi chyba: ${failureReason}`,
    '',
    'TEXT:',
    '<<<',
    rawResponseText.trim(),
    '>>>'
  ].join('\n');
}

async function buildRepairPrompt(
  basePrompt: string,
  validation: ValidationResult,
  workspaceDir?: string,
  reviewerNote?: string,
  scenarioId?: string
): Promise<string> {
  const lines: string[] = [];
  lines.push(basePrompt.trim());
  lines.push('');
  lines.push('---');
  lines.push('NEPROSLO VALIDACI. Oprav nasledujici problemy.');
  lines.push('');
  lines.push('CHYBY:');
  for (const d of validation.diagnostics.slice(0, 30)) lines.push(`- ${d}`);

  if (scenarioId === 'ts-todo-oracle') {
    lines.push('');
    lines.push('HARD CHECKLIST (TS TODO):');
    lines.push('- V `mode:"full"` zahrn README.md, package.json, tsconfig.json, src/store.ts, src/cli.ts.');
    lines.push('- Zadny externi balicek v package.json (dependencies/devDependencies prazdne nebo chybi).');
    lines.push('- `src/store.ts` obsahuje class TaskStore s list/add/done/remove.');
    lines.push('- `src/cli.ts`: `--help` MUSI fungovat bez `--data`; pro ostatni prikazy vyzaduj `--data`.');
    lines.push('- `--data` musi byt argument, ale soubor na ceste muze byt pri prvnim volani neexistujici.');
    lines.push('- `tsconfig.json` musi kompilovat do dist/ (commonjs). Nezahrnuj dist/ ve vystupu.');
  }

  if (scenarioId === 'node-api-oracle') {
    lines.push('');
    lines.push('HARD CHECKLIST (NODE API):');
    lines.push('- V `mode:"full"` zahrn README.md, package.json, openapi.json, src/server.js.');
    lines.push('- Zadny express/fastify/externi balicky. Pouze Node builtin.');
    lines.push('- `src/server.js` musi mit `function createServer({ dataPath }) { ... }` a `module.exports = { createServer };`');
    lines.push('- `createServer` NESMI volat `listen()`; jen vrat `http.createServer(...)`.');
    lines.push('- openapi.json musi mit /health, /openapi.json, /todos, /todos/{id} + GET/POST/PATCH/DELETE.');
    lines.push('- Pri cteni db/openapi osetri neexistujici soubor (`existsSync` fallback).');
  }

  if (scenarioId === 'python-ai-stdlib-oracle') {
    lines.push('');
    lines.push('HARD CHECKLIST (PYTHON ORACLE):');
    lines.push('- V `mode:"full"` zahrn README.md, mini_ai/__init__.py, mini_ai/markov.py, mini_ai/cli.py.');
    lines.push('- `MarkovChain(order)` musi vyhodit ValueError pro order <= 0.');
    lines.push('- Oprav syntax/indent chyby: konzistentni mezery, zejmena kolem `@classmethod` a `def from_dict`.');
  }

  const hasPythonMarkovContractIssue = validation.diagnostics.some(d => /mini_ai\/markov\.py must define class MarkovChain|mini_ai\/markov\.py missing method/i.test(d));
  if (hasPythonMarkovContractIssue) {
    lines.push('');
    lines.push('DULEZITE (PY MARKOV): mini_ai/markov.py musi obsahovat class MarkovChain + metody train/generate/to_dict/from_dict.');
  }

  const hasPythonCliContractIssue = validation.diagnostics.some(d => /mini_ai\/cli\.py must define main|mini_ai\/cli\.py should use argparse/i.test(d));
  if (hasPythonCliContractIssue) {
    lines.push('');
    lines.push('DULEZITE (PY CLI): mini_ai/cli.py musi mit `def main(argv=None) -> int` a argparse subcommands `train` + `generate`.');
  }

  const hasDepsIssue = validation.diagnostics.some(d => /No dependencies allowed|Non-builtin (require|import)/i.test(d));
  if (hasDepsIssue) {
    lines.push('');
    lines.push('DULEZITE: Nepouzivej zadne externi balicky (zadne commander/yargs/minimist/uuid/etc).');
    lines.push('Pouzij pouze Node.js builtin moduly; pro ID pouzij `node:crypto` + `crypto.randomUUID()`.');
    lines.push('CLI argumenty parsuj rucne bez knihoven.');
  }

  const hasModuleType = validation.diagnostics.some(d => /type\": \"module\"|type.*module/i.test(d));
  if (hasModuleType) {
    lines.push('');
    lines.push('DULEZITE: `package.json` NESMI mit `"type": "module"`. Nastav `commonjs` nebo vynech `type`.');
  }

  const hasCliManual = validation.diagnostics.some(d => /CLI must parse process\.argv/i.test(d));
  if (hasCliManual) {
    lines.push('');
    lines.push('DULEZITE: CLI parsuj rucne z `process.argv` (bez knihoven).');
  }

  const hasSelfImport = validation.diagnostics.some(d => /self import/i.test(d));
  if (hasSelfImport) {
    lines.push('');
    lines.push('DULEZITE: `src/store.ts` musi definovat a exportovat `Task` a `TaskStore` (bez importu z `./store`).');
  }

  const hasDeclareConst = validation.diagnostics.some(d => /declare const X = require/i.test(d));
  if (hasDeclareConst) {
    lines.push('');
    lines.push('DULEZITE: Nepouzivej `declare const X = require(...)`; pouzij `const X = require(...)`.');
  }

  const hasPlaceholder = validation.diagnostics.some(d => /Placeholder content detected/i.test(d));
  if (hasPlaceholder) {
    lines.push('');
    lines.push('DULEZITE: Nepouzivej placeholdery jako "..." nebo "remaining part"; posli VZDY cely obsah souboru.');
  }

  const missingReadme = validation.diagnostics.some(d => /Missing required file: README\.md/i.test(d));
  if (missingReadme) {
    lines.push('');
    lines.push('DULEZITE: README.md musis zahrnout ve "files" a nesmi byt prazdny.');
  }

  const hasTsCoreMissing = validation.diagnostics.some(d => /Missing required file: (package\.json|tsconfig\.json|src\/store\.ts|src\/cli\.ts)/i.test(d));
  if (hasTsCoreMissing) {
    lines.push('');
    lines.push('DULEZITE (TS TODO): Vrat `mode: "full"` a zahrn MINIMALNE: README.md, package.json, tsconfig.json, src/store.ts, src/cli.ts.');
    lines.push('Nezahrnuj tests/ ani dist/.');
  }

  const hasNodeCoreMissing = validation.diagnostics.some(d => /Missing required file: (package\.json|openapi\.json|src\/server\.js)/i.test(d));
  if (hasNodeCoreMissing) {
    lines.push('');
    lines.push('DULEZITE (NODE API): Vrat `mode: "full"` a zahrn MINIMALNE: README.md, package.json, openapi.json, src/server.js.');
    lines.push('Nezahrnuj tests/.');
  }

  const hasDistOutput = validation.diagnostics.some(d => /Do not include dist\//i.test(d));
  if (hasDistOutput) {
    lines.push('');
    lines.push('DULEZITE: Nevytvarej soubory v `dist/`; ty se generuji kompilaci.');
  }

  const hasCreateServerExportIssue = validation.diagnostics.some(d => /must export createServer|Server startup failed: createServer export/i.test(d));
  if (hasCreateServerExportIssue) {
    lines.push('');
    lines.push('DULEZITE (NODE API): `src/server.js` musi exportovat `createServer` jako objekt:');
    lines.push('- `function createServer({ dataPath }) { ... return server; }`');
    lines.push('- `module.exports = { createServer };` (NE `module.exports = createServer`).');
  }

  const hasOpenapiContractIssue = validation.diagnostics.some(d => /openapi\.json missing/i.test(d));
  if (hasOpenapiContractIssue) {
    lines.push('');
    lines.push('DULEZITE (OPENAPI): Spec musi mit paths: /health, /openapi.json, /todos, /todos/{id} a metody GET/POST/PATCH/DELETE dle zadani.');
  }

  const hasNodeListenIssue = validation.diagnostics.some(d => /must not call listen|auto-listen on fixed port|EADDRINUSE/i.test(d));
  if (hasNodeListenIssue) {
    lines.push('');
    lines.push('DULEZITE (NODE SERVER): Nevolej `listen()` v src/server.js. Testy volaji `createServer(...).listen(...)` samy.');
  }

  const hasNodeDataPathIssue = validation.diagnostics.some(d => /must use provided dataPath/i.test(d));
  if (hasNodeDataPathIssue) {
    lines.push('');
    lines.push('DULEZITE (NODE DATA): Vsechny CRUD operace cti/zapisuj do `dataPath` predaneho do createServer({ dataPath }).');
  }

  const hasFullModeCoreLoss = validation.diagnostics.some(d => /full mode output missing required files|first iteration must use mode/i.test(d));
  if (hasFullModeCoreLoss) {
    lines.push('');
    lines.push('DULEZITE: Pokud vracis `mode: "full"`, MUSIS zahrnout kompletni sadu core souboru scenare.');
    lines.push('Pokud menis jen cast, pouzij `mode: "patch"` a posli pouze menene soubory.');
  }

  const failedCmds = (validation.commands || []).filter(c => !c.ok);
  const logText = failedCmds.map(c => `${c.stdout}\n${c.stderr}`).join('\n');
  if (failedCmds.length > 0) {
    lines.push('');
    lines.push('LOGY (zkraceno):');
    for (const c of failedCmds.slice(0, 3)) {
      lines.push(`- ${c.command}`);
      if (c.stdout.trim()) lines.push(`  stdout: ${JSON.stringify(sliceTail(c.stdout, 2000))}`);
      if (c.stderr.trim()) lines.push(`  stderr: ${JSON.stringify(sliceTail(c.stderr, 2000))}`);
    }
  }

  if (/Cannot redeclare block-scoped variable 'process'|Cannot redeclare block-scoped variable 'require'/i.test(logText)) {
    lines.push('');
    lines.push('DULEZITE: Deklarace `require`/`process` dej max 1x na soubor a zajisti modulovy scope (`export {}` na zacatku souboru).');
  }

  if (/Missing --data argument/i.test(logText)) {
    lines.push('');
    lines.push('DULEZITE: `--help` musi vratit exit 0 a NESMI vyzadovat `--data`.');
  }

  if (/error is of type 'unknown'/i.test(logText)) {
    lines.push('');
    lines.push('DULEZITE: V `catch` pouzij `catch (error: any)` nebo `const err = error as any`.');
  }

  if (/cannot import name 'load_model'|cannot import name 'save_model'/i.test(logText)) {
    lines.push('');
    lines.push('DULEZITE (PY CLI IMPORT): `mini_ai/cli.py` neimportuje `load_model/save_model` z `mini_ai.markov`, pokud je `mini_ai/markov.py` nedefinuje.');
    lines.push('Pouzij pouze `MarkovChain` + serializaci pres `to_dict()` a `from_dict()`.');
  }

  if (/test_generate_deterministic|test_train_and_generate_smoke|assertionerror:\s*\d+\s*!=\s*\d+/i.test(logText)) {
    lines.push('');
    lines.push('DULEZITE (PY GENERATE): `MarkovChain.generate(length=...)` musi vratit PRESNE `length` znaku pro natrenovany model.');
    lines.push('Pri chybejicim kontextu fallbackni na validni context z transitions misto predcasneho ukonceni.');
  }

  if (/dist\/store\.js missing|dist\/cli\.js missing|tsconfig\.json missing or invalid/i.test(validation.diagnostics.join('\n'))) {
    lines.push('');
    lines.push('DULEZITE (TS BUILD): Ujisti se, ze `tsconfig.json` je validni, kompiluje do `dist/` a ze `src/store.ts` + `src/cli.ts` opravdu existuji a kompiluji.');
  }

  const hasTsStoreExportIssue = validation.diagnostics.some(d => /store\.ts must export TaskStore|TaskStore export contract broken/i.test(d));
  if (hasTsStoreExportIssue) {
    lines.push('');
    lines.push('DULEZITE (TS STORE): Exportuj `TaskStore` jako named export z `src/store.ts` a v `src/cli.ts` ho importuj `import { TaskStore } from "./store"`.');
  }

  const hasTsImplicitAnyIssue = validation.diagnostics.some(d => /implicit any/i.test(d));
  if (hasTsImplicitAnyIssue) {
    lines.push('');
    lines.push('DULEZITE (TS TYPES): Doplň typy parametrů lambda/funkcí, aby strict TS nehlásil implicit any.');
  }

  const hasTsCliJsonIssue = validation.diagnostics.some(d => /CLI commands must print valid JSON object|outputs should include "ok"/i.test(d));
  if (hasTsCliJsonIssue) {
    lines.push('');
    lines.push('DULEZITE (TS CLI JSON): Pro add/list/done/remove tiskni JSON objekt (`JSON.stringify`) s `ok: true` a příslušným polem (`task`/`tasks`).');
  }

  if (reviewerNote && reviewerNote.trim()) {
    lines.push('');
    lines.push('DOPORUCENI REVIEWERA:');
    lines.push(reviewerNote.trim().slice(0, 4000));
  }

  if (workspaceDir && fs.existsSync(workspaceDir)) {
    const fileList = await listFilesRecursively(workspaceDir);
    const visibleFiles = fileList.filter(f => !f.startsWith('dist/') && !f.startsWith('node_modules/') && !f.startsWith('out/'));
    lines.push('');
    lines.push('AKTUALNI SOUBORY:');
    for (const f of visibleFiles.slice(0, 50)) lines.push(`- ${f}`);

    const errText = (failedCmds.map(c => `${c.stderr}\n${c.stdout}`).join('\n') + '\n' + validation.diagnostics.join('\n')).trim();
    const absPaths = extractPythonPathsFromText(errText);
    const relPaths = absPaths
      .map(p => toRelativeExistingPath(workspaceDir, p))
      .filter((p): p is string => Boolean(p));

    const filteredRel = relPaths.filter(p => {
      return !p.startsWith('dist/') && !p.startsWith('node_modules/') && !p.startsWith('tests/');
    });
    const uniqueRel = [...new Set(filteredRel)].slice(0, 6);
    if (uniqueRel.length > 0) {
      lines.push('');
      lines.push('KONTEXT SOUBORU (pro opravu):');
      for (const rel of uniqueRel) {
        try {
          const abs = path.join(workspaceDir, rel);
          const content = await fs.promises.readFile(abs, 'utf8');
          lines.push(`--- FILE: ${rel} ---`);
          lines.push(sliceForPrompt(content, 8000));
        } catch {
          // ignore
        }
      }
    }

    const syntaxHints = extractPythonSyntaxHints(errText)
      .map(h => {
        const rel = toRelativeExistingPath(workspaceDir, h.rawPath);
        if (!rel) return null;
        return { rel, line: h.line };
      })
      .filter((h): h is { rel: string; line: number } => Boolean(h));
    if (syntaxHints.length > 0) {
      lines.push('');
      lines.push('DULEZITE: OPRAV SYNTAX/INDENT CHYBY PRESNE NA NIZE UVEDENYCH RADECH.');
      lines.push('KONTEXT SYNTAX CHYB:');
      const uniqueHints = new Map<string, number>();
      for (const hint of syntaxHints) {
        const key = `${hint.rel}:${hint.line}`;
        if (!uniqueHints.has(key)) uniqueHints.set(key, hint.line);
      }
      for (const key of [...uniqueHints.keys()].slice(0, 6)) {
        const [rel, lineRaw] = key.split(':');
        const line = Number(lineRaw);
        if (!Number.isFinite(line) || line <= 0) continue;
        try {
          const abs = path.join(workspaceDir, rel);
          const content = await fs.promises.readFile(abs, 'utf8');
          lines.push(`--- SYNTAX FILE: ${rel} (line ${line}) ---`);
          lines.push(sliceLineWindow(content, line, 25));
        } catch {
          // ignore
        }
      }
      lines.push('Instrukce: dodrz konzistentni odsazeni (mezery), zadne smichani blokovych urovni.');
    }
  }

  lines.push('');
  lines.push('VYSTUP: vrat JEN platny JSON objekt bez markdownu:');
  lines.push('{ "mode": "patch", "files": [ {"path":"...","content":"...\\n"} ], "notes": "optional" }');
  lines.push('Pravidla: udelej jen minimalni nutne zmeny; posli jen soubory ktere menis nebo pridavas; u kazdeho posli VZDY cely obsah souboru.');
  return lines.join('\n');
}

async function buildReviewerPrompt(basePrompt: string, validation: ValidationResult, workspaceDir?: string): Promise<string> {
  const failedCmds = (validation.commands || []).filter(c => !c.ok);
  const lines: string[] = [];
  lines.push('Jsi code reviewer (mini-validator). Tvuj ukol: navrhnout MINIMALNI opravy, ktere povedou k tomu, ze validace projde.');
  lines.push('Odpovez JEN JSON bez markdownu: { "review": "text", "priorityFiles": ["path1","path2"] }');
  lines.push('');
  lines.push('SPEC (zkraceno):');
  lines.push(sliceForPrompt(basePrompt, 6000));
  lines.push('');
  lines.push('CHYBY:');
  for (const d of validation.diagnostics.slice(0, 30)) lines.push(`- ${d}`);

  if (failedCmds.length > 0) {
    lines.push('');
    lines.push('LOGY (zkraceno):');
    for (const c of failedCmds.slice(0, 3)) {
      lines.push(`- ${c.command}`);
      if (c.stderr.trim()) lines.push(`  stderr: ${JSON.stringify(sliceTail(c.stderr, 2500))}`);
      if (c.stdout.trim()) lines.push(`  stdout: ${JSON.stringify(sliceTail(c.stdout, 1200))}`);
    }
  }

  if (workspaceDir && fs.existsSync(workspaceDir)) {
    const fileList = await listFilesRecursively(workspaceDir);
    lines.push('');
    lines.push('SOUBORY (zkraceno):');
    for (const f of fileList.slice(0, 40)) lines.push(`- ${f}`);

    const errText = (failedCmds.map(c => `${c.stderr}\n${c.stdout}`).join('\n') + '\n' + validation.diagnostics.join('\n')).trim();
    const absPaths = extractPythonPathsFromText(errText);
    const relPaths = absPaths
      .map(p => {
        const candidate = p.replace(/\\/g, '/');
        const rel = path.isAbsolute(p) ? path.relative(workspaceDir, p).replace(/\\/g, '/') : candidate;
        if (rel.startsWith('..')) return null;
        const abs = path.join(workspaceDir, rel);
        return fs.existsSync(abs) ? rel : null;
      })
      .filter((p): p is string => Boolean(p));

    const uniqueRel = [...new Set(relPaths)].slice(0, 4);
    if (uniqueRel.length > 0) {
      lines.push('');
      lines.push('KONTEXT SOUBORU (zkraceno):');
      for (const rel of uniqueRel) {
        try {
          const abs = path.join(workspaceDir, rel);
          const content = await fs.promises.readFile(abs, 'utf8');
          lines.push(`--- FILE: ${rel} ---`);
          lines.push(sliceForPrompt(content, 4000));
        } catch {
          // ignore
        }
      }
    }
  }

  return lines.join('\n');
}

async function runPlannerPassOnFailure(params: {
  opts: CliOptions;
  outDir: string;
  basePrompt: string;
  scenarioId: string;
  parseStats: ParseStats;
  failureContext?: ValidationResult;
  triggerIteration?: number;
}): Promise<{ basePrompt: string; planApplied: boolean }> {
  if (!params.opts.plannerModel) {
    return { basePrompt: params.basePrompt, planApplied: false };
  }

  const plannerDir = path.join(params.outDir, 'planner');
  await fs.promises.mkdir(plannerDir, { recursive: true });

  const failedCommands = (params.failureContext?.commands || []).filter(c => !c.ok).slice(0, 3);
  const plannerPromptParts: string[] = [
    'Jsi planner. Navrhni implementacni plan tak, aby projekt prosiel oracle testy a validaci.',
    'Odpovez JEN JSON bez markdownu: { "plan": "..." }',
    '',
    'SPEC:',
    sliceForPrompt(params.basePrompt, 12000),
    '',
    'Pozadavky na plan:',
    '- Strucny seznam kroku (max 12) ve formatu seznamu (radky zacinaji "- ").',
    '- konkretni seznam souboru a co v nich bude,',
    '- kontrolni body (build/test).',
    '- pokud je konflikt, prioritu ma puvodni SPEC, ne plan.',
  ];

  if (params.failureContext) {
    plannerPromptParts.push('');
    plannerPromptParts.push('FAILURE CONTEXT (planner-on-fail trigger):');
    for (const diagnostic of (params.failureContext.diagnostics || []).slice(0, 20)) {
      plannerPromptParts.push(`- ${diagnostic}`);
    }
    if (failedCommands.length > 0) {
      plannerPromptParts.push('');
      plannerPromptParts.push('FAILED COMMAND LOGS (zkraceno):');
      for (const cmd of failedCommands) {
        plannerPromptParts.push(`- ${cmd.command}`);
        if (cmd.stderr.trim()) plannerPromptParts.push(`  stderr: ${JSON.stringify(sliceTail(cmd.stderr, 2000))}`);
        if (cmd.stdout.trim()) plannerPromptParts.push(`  stdout: ${JSON.stringify(sliceTail(cmd.stdout, 1000))}`);
      }
    }
  }

  const plannerPrompt = plannerPromptParts.join('\n');
  await fs.promises.writeFile(path.join(plannerDir, 'prompt.txt'), plannerPrompt, 'utf8');
  await fs.promises.writeFile(path.join(plannerDir, 'trigger.json'), JSON.stringify({
    strategy: 'on-fail',
    scenarioId: params.scenarioId,
    triggerIteration: params.triggerIteration ?? null,
    diagnostics: params.failureContext?.diagnostics?.slice(0, 30) || []
  }, null, 2), 'utf8');

  const plannerParseReport: ParseReport = { attempts: [], finalOk: false };
  let plannerPlanText = '';
  let plannerRawResponse = '';
  let plannerRepairSource = '';

  try {
    const plannerRes = await ollamaGenerateStructuredObject<PlannerOutput>({
      baseUrl: params.opts.baseUrl,
      model: params.opts.plannerModel,
      prompt: plannerPrompt,
      timeoutMs: params.opts.timeoutSec * 1000,
      schema: PLANNER_SCHEMA,
      options: buildOllamaOptions(params.opts),
      minNumPredict: PLANNER_MIN_NUM_PREDICT,
      validateObject: validatePlannerSchema
    });
    plannerRawResponse = plannerRes.responseText;
    plannerRepairSource = plannerRes.responseText.trim() ? plannerRes.responseText : JSON.stringify(plannerRes.raw ?? {});
    await fs.promises.writeFile(path.join(plannerDir, 'request.json'), JSON.stringify({
      model: params.opts.plannerModel,
      baseUrl: params.opts.baseUrl,
      transport: plannerRes.meta.transport,
      formatKind: plannerRes.meta.formatKind,
      schemaUsed: plannerRes.meta.schemaUsed,
      fallbackUsed: plannerRes.meta.fallbackUsed,
      fallbackReason: plannerRes.meta.fallbackReason ?? null,
      usedFormatJson: plannerRes.meta.usedFormatJson,
      doneReason: plannerRes.meta.doneReason ?? null,
      evalCount: plannerRes.meta.evalCount ?? null,
      promptEvalCount: plannerRes.meta.promptEvalCount ?? null,
      effectiveOptions: plannerRes.meta.effectiveOptions ?? null
    }, null, 2), 'utf8');
    await fs.promises.writeFile(path.join(plannerDir, 'ollama_raw.json'), JSON.stringify(plannerRes.raw, null, 2), 'utf8');
    await fs.promises.writeFile(path.join(plannerDir, 'raw_response.txt'), plannerRes.responseText, 'utf8');
    await fs.promises.writeFile(path.join(plannerDir, 'parsed.json'), JSON.stringify(plannerRes.obj, null, 2), 'utf8');
    plannerPlanText = normalizePlannerPlanText(plannerRes.obj.plan);
    plannerParseReport.attempts.push({
      stage: 'initial',
      model: params.opts.plannerModel,
      ok: true,
      transport: plannerRes.meta.transport,
      formatKind: plannerRes.meta.formatKind,
      schemaUsed: plannerRes.meta.schemaUsed,
      fallbackUsed: plannerRes.meta.fallbackUsed
    });
  } catch (plannerErr: any) {
    const errMsg = String(plannerErr?.message || plannerErr);
    const errKind = classifyParseError(errMsg);
    plannerParseReport.primaryError = errMsg;
    plannerParseReport.primaryErrorKind = errKind;
    plannerParseReport.attempts.push({
      stage: 'initial',
      model: params.opts.plannerModel,
      ok: false,
      error: errMsg,
      errorKind: errKind
    });
  }

  if (!plannerPlanText && plannerParseReport.primaryError && isRepairableParseKind(plannerParseReport.primaryErrorKind ?? 'other')) {
    const lastErr = plannerParseReport.primaryError || 'Planner parse failed';
    const repairPrompt = buildPlannerRepairPrompt(plannerRepairSource || plannerRawResponse || plannerPrompt, lastErr);
    await fs.promises.writeFile(path.join(plannerDir, 'repair_prompt.txt'), repairPrompt, 'utf8');
    try {
      const repairModel = params.opts.jsonRepairModel || params.opts.plannerModel;
      const plannerRepair = await ollamaGenerateStructuredObject<PlannerOutput>({
        baseUrl: params.opts.baseUrl,
        model: repairModel,
        prompt: repairPrompt,
        timeoutMs: Math.min(params.opts.timeoutSec, 600) * 1000,
        schema: PLANNER_SCHEMA,
        options: buildOllamaOptions(params.opts),
        minNumPredict: PLANNER_MIN_NUM_PREDICT,
        validateObject: validatePlannerSchema
      });
      await fs.promises.writeFile(path.join(plannerDir, 'repair_raw.json'), JSON.stringify(plannerRepair.raw, null, 2), 'utf8');
      await fs.promises.writeFile(path.join(plannerDir, 'repair_raw_response.txt'), plannerRepair.responseText, 'utf8');
      plannerPlanText = normalizePlannerPlanText(plannerRepair.obj.plan);
      await fs.promises.writeFile(path.join(plannerDir, 'repair_parsed.json'), JSON.stringify(plannerRepair.obj, null, 2), 'utf8');
      plannerParseReport.attempts.push({
        stage: 'repair_schema',
        model: repairModel,
        ok: true,
        transport: plannerRepair.meta.transport,
        formatKind: plannerRepair.meta.formatKind,
        schemaUsed: plannerRepair.meta.schemaUsed,
        fallbackUsed: plannerRepair.meta.fallbackUsed
      });
    } catch (plannerRepairErr: any) {
      const errMsg = String(plannerRepairErr?.message || plannerRepairErr);
      const errKind = classifyParseError(errMsg);
      plannerParseReport.attempts.push({
        stage: 'repair_schema',
        model: params.opts.jsonRepairModel || params.opts.plannerModel,
        ok: false,
        error: errMsg,
        errorKind: errKind
      });
      await fs.promises.writeFile(path.join(plannerDir, 'repair_error.txt'), errMsg + '\n', 'utf8');
    }
  }

  if (!plannerPlanText) {
    const deterministicPlan = buildDeterministicPlannerFallback(params.scenarioId);
    if (deterministicPlan) {
      plannerPlanText = deterministicPlan;
      await fs.promises.writeFile(path.join(plannerDir, 'deterministic_fallback_plan.txt'), plannerPlanText + '\n', 'utf8');
      plannerParseReport.attempts.push({
        stage: 'repair_schema',
        model: 'deterministic-fallback',
        ok: true
      });
    }
  }

  if (plannerPlanText) {
    await fs.promises.writeFile(path.join(plannerDir, 'plan.txt'), plannerPlanText + '\n', 'utf8');
    plannerParseReport.finalOk = true;
    await fs.promises.writeFile(path.join(plannerDir, 'parse_report.json'), JSON.stringify(plannerParseReport, null, 2), 'utf8');
    const plannedPrompt = `${params.basePrompt}\n\n---\nPLANNER HINTS (planner: ${params.opts.plannerModel}; non-binding, SPEC wins on conflict):\n${plannerPlanText}\n`;
    return { basePrompt: plannedPrompt, planApplied: true };
  }

  params.parseStats.plannerFailures += 1;
  plannerParseReport.finalOk = false;
  const finalErr = plannerParseReport.attempts.filter(a => !a.ok).slice(-1)[0]?.error || 'Planner parse failed';
  plannerParseReport.finalError = finalErr;
  plannerParseReport.finalErrorKind = computePlannerParseFailureKind({
    finalOk: plannerParseReport.finalOk,
    finalError: finalErr
  }) || 'other';
  const plannerFailureKind = computePlannerParseFailureKind(plannerParseReport);
  if (plannerFailureKind) recordParseFailure(params.parseStats, plannerFailureKind);
  await fs.promises.writeFile(path.join(plannerDir, 'error.txt'), `${finalErr}\n`, 'utf8');
  await fs.promises.writeFile(path.join(plannerDir, 'parse_report.json'), JSON.stringify(plannerParseReport, null, 2), 'utf8');
  return { basePrompt: params.basePrompt, planApplied: false };
}

async function main() {
  const opts = parseArgs(process.argv.slice(2));
  if (opts.listScenarios) {
    // eslint-disable-next-line no-console
    console.log(SCENARIOS.map(s => `${s.id}  - ${s.title}`).join('\n'));
    return;
  }

  const scenario = SCENARIOS.find(s => s.id === opts.scenario);
  if (!scenario) {
    // eslint-disable-next-line no-console
    console.error(`Unknown scenario: ${opts.scenario}`);
    printUsageAndExit(1);
  }

  const runId = Date.now();
  const outDir = opts.outDir || path.join('projects', 'bot_eval_run', `run_${runId}`);
  await fs.promises.mkdir(outDir, { recursive: true });
  const iterationsDir = path.join(outDir, 'iterations');
  const workspaceDir = path.join(outDir, 'workspace');
  await fs.promises.mkdir(iterationsDir, { recursive: true });
  await resetDir(workspaceDir);

  const ollamaOptions = buildOllamaOptions(opts);
  const deterministicFallbackStats = createDeterministicFallbackStats(opts.deterministicFallbackMode);
  const evalContext: EvalRunContext = {
    deterministicFallbackMode: opts.deterministicFallbackMode,
    deterministicFallbackStats
  };

  const meta = {
    runId,
    scenario: scenario.id,
    model: opts.model,
    plannerModel: opts.plannerModel ?? null,
    plannerStrategy: opts.plannerModel ? 'on-fail' : 'disabled',
    reviewerModel: opts.reviewerModel ?? null,
    jsonRepairModel: opts.jsonRepairModel ?? null,
    deterministicFallbackMode: opts.deterministicFallbackMode,
    baseUrl: opts.baseUrl,
    ollamaOptions: ollamaOptions ?? null,
    workspaceDir: path.resolve(workspaceDir),
    startedAt: new Date().toISOString(),
  };
  await fs.promises.writeFile(path.join(outDir, 'meta.json'), JSON.stringify(meta, null, 2), 'utf8');
  await fs.promises.writeFile(path.join('projects', 'bot_eval_run', 'last_run.txt'), path.resolve(outDir) + '\n', 'utf8');

  let basePrompt = scenario.prompt;
  const parseStats: ParseStats = {
    plannerFailures: 0,
    schemaFailures: 0,
    jsonRepairFailures: 0,
    parseFailures: 0,
    jsonParseFailures: 0,
    placeholderFailures: 0,
    otherFailures: 0
  };
  let plannerAttempted = false;
  await fs.promises.writeFile(path.join(outDir, 'base_prompt.txt'), basePrompt, 'utf8');

  let final: ValidationResult = { ok: false, diagnostics: ['Not started'] };
  let prompt = basePrompt;
  const maybeRunPlannerOnFail = async (failureContext: ValidationResult, triggerIteration: number): Promise<void> => {
    if (!opts.plannerModel || plannerAttempted) return;
    plannerAttempted = true;
    const plannerRes = await runPlannerPassOnFailure({
      opts,
      outDir,
      basePrompt,
      scenarioId: scenario.id,
      parseStats,
      failureContext,
      triggerIteration
    });
    if (plannerRes.basePrompt !== basePrompt) {
      basePrompt = plannerRes.basePrompt;
      await fs.promises.writeFile(path.join(outDir, 'base_prompt.txt'), basePrompt, 'utf8');
    }
  };

  for (let iter = 1; iter <= opts.maxIterations; iter++) {
    const iterName = String(iter).padStart(2, '0');
    const iterDir = path.join(iterationsDir, iterName);
    await fs.promises.mkdir(iterDir, { recursive: true });
    const promptForModel = buildPromptForIteration(prompt, scenario.id, iter);

    await fs.promises.writeFile(path.join(iterDir, 'prompt.txt'), promptForModel, 'utf8');

    let responseText = '';
    let raw: any = null;
    let generationMeta: StructuredGenerationMeta = {
      transport: 'generate',
      formatKind: 'none',
      schemaUsed: false,
      fallbackUsed: false,
      usedFormatJson: false
    };
    const parseReport: ParseReport = { attempts: [], finalOk: false };

    try {
      const res = await ollamaGenerateStructured({
        baseUrl: opts.baseUrl,
        model: opts.model,
        prompt: promptForModel,
        timeoutMs: opts.timeoutSec * 1000,
        schema: MODEL_OUTPUT_SCHEMA as unknown as Record<string, unknown>,
        options: ollamaOptions,
        minNumPredict: STRUCTURED_MIN_NUM_PREDICT
      });
      responseText = res.responseText;
      raw = res.raw;
      generationMeta = res.meta;
    } catch (e: any) {
      const errMsg = String(e?.message || e);
      const errKind = classifyParseError(errMsg);
      recordParseFailure(parseStats, errKind);
      parseReport.primaryError = errMsg;
      parseReport.primaryErrorKind = errKind;
      parseReport.finalOk = false;
      parseReport.finalError = errMsg;
      parseReport.finalErrorKind = errKind;
      await fs.promises.writeFile(path.join(iterDir, 'parse_report.json'), JSON.stringify(parseReport, null, 2), 'utf8');
      final = { ok: false, diagnostics: [`Ollama request failed: ${errMsg}`] };
      await fs.promises.writeFile(path.join(iterDir, 'validation.json'), JSON.stringify(final, null, 2), 'utf8');
      await maybeRunPlannerOnFail(final, iter);
      prompt = await buildRepairPrompt(basePrompt, final, workspaceDir, undefined, scenario.id);
      continue;
    }

    await fs.promises.writeFile(
      path.join(iterDir, 'request.json'),
      JSON.stringify({
        model: opts.model,
        baseUrl: opts.baseUrl,
        transport: generationMeta.transport,
        formatKind: generationMeta.formatKind,
        schemaUsed: generationMeta.schemaUsed,
        fallbackUsed: generationMeta.fallbackUsed,
        fallbackReason: generationMeta.fallbackReason ?? null,
        usedFormatJson: generationMeta.usedFormatJson,
        doneReason: generationMeta.doneReason ?? null,
        evalCount: generationMeta.evalCount ?? null,
        promptEvalCount: generationMeta.promptEvalCount ?? null,
        effectiveOptions: generationMeta.effectiveOptions ?? null,
        options: ollamaOptions ?? null,
        deterministicFallbackMode: opts.deterministicFallbackMode
      }, null, 2),
      'utf8'
    );
    await fs.promises.writeFile(path.join(iterDir, 'ollama_raw.json'), JSON.stringify(raw, null, 2), 'utf8');
    await fs.promises.writeFile(path.join(iterDir, 'raw_response.txt'), responseText, 'utf8');

    let parsed: ModelOutput | null = null;
    let lastParseError = '';
    let lastParseKind: ParseErrorKind = 'other';

    try {
      parsed = parseAndValidateModelOutput(responseText);
      parseReport.attempts.push({
        stage: 'initial',
        model: opts.model,
        ok: true,
        transport: generationMeta.transport,
        formatKind: generationMeta.formatKind,
        schemaUsed: generationMeta.schemaUsed,
        fallbackUsed: generationMeta.fallbackUsed
      });
    } catch (e: any) {
      lastParseError = String(e?.message || e);
      lastParseKind = classifyParseError(lastParseError);
      parseReport.primaryError = lastParseError;
      parseReport.primaryErrorKind = lastParseKind;
      parseReport.attempts.push({
        stage: 'initial',
        model: opts.model,
        ok: false,
        error: lastParseError,
        errorKind: lastParseKind,
        transport: generationMeta.transport,
        formatKind: generationMeta.formatKind,
        schemaUsed: generationMeta.schemaUsed,
        fallbackUsed: generationMeta.fallbackUsed
      });
    }

    if (!parsed && lastParseKind === 'json_parse' && isLikelyTruncatedJsonOutput(raw, lastParseError)) {
      try {
        const retryRes = await ollamaGenerateStructured({
          baseUrl: opts.baseUrl,
          model: opts.model,
          prompt: promptForModel,
          timeoutMs: opts.timeoutSec * 1000,
          schema: MODEL_OUTPUT_SCHEMA as unknown as Record<string, unknown>,
          options: ollamaOptions,
          minNumPredict: STRUCTURED_RETRY_MIN_NUM_PREDICT
        });
        await fs.promises.writeFile(path.join(iterDir, 'truncation_retry_raw.json'), JSON.stringify(retryRes.raw, null, 2), 'utf8');
        await fs.promises.writeFile(path.join(iterDir, 'truncation_retry_raw_response.txt'), retryRes.responseText, 'utf8');
        await fs.promises.writeFile(path.join(iterDir, 'truncation_retry_request.json'), JSON.stringify({
          model: opts.model,
          baseUrl: opts.baseUrl,
          transport: retryRes.meta.transport,
          formatKind: retryRes.meta.formatKind,
          schemaUsed: retryRes.meta.schemaUsed,
          fallbackUsed: retryRes.meta.fallbackUsed,
          fallbackReason: retryRes.meta.fallbackReason ?? null,
          usedFormatJson: retryRes.meta.usedFormatJson,
          doneReason: retryRes.meta.doneReason ?? null,
          evalCount: retryRes.meta.evalCount ?? null,
          promptEvalCount: retryRes.meta.promptEvalCount ?? null,
          effectiveOptions: retryRes.meta.effectiveOptions ?? null
        }, null, 2), 'utf8');

        responseText = retryRes.responseText;
        raw = retryRes.raw;
        generationMeta = retryRes.meta;

        try {
          parsed = parseAndValidateModelOutput(retryRes.responseText);
          await fs.promises.writeFile(path.join(iterDir, 'truncation_retry_parsed.json'), JSON.stringify(parsed, null, 2), 'utf8');
          parseReport.attempts.push({
            stage: 'retry_truncation',
            model: opts.model,
            ok: true,
            transport: retryRes.meta.transport,
            formatKind: retryRes.meta.formatKind,
            schemaUsed: retryRes.meta.schemaUsed,
            fallbackUsed: retryRes.meta.fallbackUsed
          });
        } catch (retryParseErr: any) {
          lastParseError = String(retryParseErr?.message || retryParseErr);
          lastParseKind = classifyParseError(lastParseError);
          parseReport.attempts.push({
            stage: 'retry_truncation',
            model: opts.model,
            ok: false,
            error: lastParseError,
            errorKind: lastParseKind,
            transport: retryRes.meta.transport,
            formatKind: retryRes.meta.formatKind,
            schemaUsed: retryRes.meta.schemaUsed,
            fallbackUsed: retryRes.meta.fallbackUsed
          });
        }
      } catch (retryErr: any) {
        lastParseError = String(retryErr?.message || retryErr);
        lastParseKind = classifyParseError(lastParseError);
        parseReport.attempts.push({
          stage: 'retry_truncation',
          model: opts.model,
          ok: false,
          error: lastParseError,
          errorKind: lastParseKind
        });
      }
    }

    if (!parsed && isRepairableParseKind(lastParseKind)) {
      const repairModel = opts.jsonRepairModel || opts.model;
      const repairPrompt = buildJsonRepairPrompt(responseText);
      await fs.promises.writeFile(path.join(iterDir, 'json_repair_prompt.txt'), repairPrompt, 'utf8');
      try {
        const repairRes = await ollamaGenerate({
          baseUrl: opts.baseUrl,
          model: repairModel,
          prompt: repairPrompt,
          timeoutMs: Math.min(opts.timeoutSec, 600) * 1000,
          options: buildStructuredReliabilityOptions(ollamaOptions)
        });
        await fs.promises.writeFile(path.join(iterDir, 'json_repair_raw.json'), JSON.stringify(repairRes.raw, null, 2), 'utf8');
        await fs.promises.writeFile(path.join(iterDir, 'json_repair_raw_response.txt'), repairRes.responseText, 'utf8');
        try {
          parsed = parseAndValidateModelOutput(repairRes.responseText);
          await fs.promises.writeFile(path.join(iterDir, 'json_repair_parsed.json'), JSON.stringify(parsed, null, 2), 'utf8');
          parseReport.attempts.push({
            stage: 'repair_syntax',
            model: repairModel,
            ok: true,
            transport: 'generate',
            formatKind: repairRes.usedFormatJson ? 'json' : 'none',
            schemaUsed: false,
            fallbackUsed: false
          });
        } catch (repairParseErr: any) {
          lastParseError = String(repairParseErr?.message || repairParseErr);
          lastParseKind = classifyParseError(lastParseError);
          parseReport.attempts.push({
            stage: 'repair_syntax',
            model: repairModel,
            ok: false,
            error: lastParseError,
            errorKind: lastParseKind,
            transport: 'generate',
            formatKind: repairRes.usedFormatJson ? 'json' : 'none',
            schemaUsed: false,
            fallbackUsed: false
          });
        }
      } catch (repairErr: any) {
        lastParseError = String(repairErr?.message || repairErr);
        lastParseKind = classifyParseError(lastParseError);
        parseReport.attempts.push({
          stage: 'repair_syntax',
          model: repairModel,
          ok: false,
          error: lastParseError,
          errorKind: lastParseKind
        });
      }
    }

    if (!parsed && isRepairableParseKind(lastParseKind)) {
      const repairModel = opts.jsonRepairModel || opts.model;
      const schemaRepairPrompt = buildJsonSchemaRepairPrompt(responseText, lastParseError || 'Schema validation failed');
      await fs.promises.writeFile(path.join(iterDir, 'json_repair_schema_prompt.txt'), schemaRepairPrompt, 'utf8');
      try {
        const schemaRepairRes = await ollamaGenerateStructured({
          baseUrl: opts.baseUrl,
          model: repairModel,
          prompt: schemaRepairPrompt,
          timeoutMs: Math.min(opts.timeoutSec, 600) * 1000,
          schema: MODEL_OUTPUT_SCHEMA as unknown as Record<string, unknown>,
          options: ollamaOptions,
          minNumPredict: STRUCTURED_MIN_NUM_PREDICT
        });
        await fs.promises.writeFile(path.join(iterDir, 'json_repair_schema_raw.json'), JSON.stringify(schemaRepairRes.raw, null, 2), 'utf8');
        await fs.promises.writeFile(path.join(iterDir, 'json_repair_schema_raw_response.txt'), schemaRepairRes.responseText, 'utf8');
        try {
          parsed = parseAndValidateModelOutput(schemaRepairRes.responseText);
          await fs.promises.writeFile(path.join(iterDir, 'json_repair_schema_parsed.json'), JSON.stringify(parsed, null, 2), 'utf8');
          parseReport.attempts.push({
            stage: 'repair_schema',
            model: repairModel,
            ok: true,
            transport: schemaRepairRes.meta.transport,
            formatKind: schemaRepairRes.meta.formatKind,
            schemaUsed: schemaRepairRes.meta.schemaUsed,
            fallbackUsed: schemaRepairRes.meta.fallbackUsed
          });
        } catch (schemaParseErr: any) {
          lastParseError = String(schemaParseErr?.message || schemaParseErr);
          lastParseKind = classifyParseError(lastParseError);
          parseReport.attempts.push({
            stage: 'repair_schema',
            model: repairModel,
            ok: false,
            error: lastParseError,
            errorKind: lastParseKind,
            transport: schemaRepairRes.meta.transport,
            formatKind: schemaRepairRes.meta.formatKind,
            schemaUsed: schemaRepairRes.meta.schemaUsed,
            fallbackUsed: schemaRepairRes.meta.fallbackUsed
          });
          await fs.promises.writeFile(path.join(iterDir, 'json_repair_schema_error.txt'), lastParseError + '\n', 'utf8');
        }
      } catch (schemaRepairErr: any) {
        lastParseError = String(schemaRepairErr?.message || schemaRepairErr);
        lastParseKind = classifyParseError(lastParseError);
        parseReport.attempts.push({
          stage: 'repair_schema',
          model: repairModel,
          ok: false,
          error: lastParseError,
          errorKind: lastParseKind
        });
        await fs.promises.writeFile(path.join(iterDir, 'json_repair_schema_error.txt'), lastParseError + '\n', 'utf8');
      }
    }

    let forcePatchFromIncompleteFull = false;
    if (parsed) {
      const scenarioRequired = getScenarioCoreRequiredFiles(scenario.id);
      if (scenarioRequired.length > 0) {
        if (iter === 1 && parsed.mode === 'patch') {
          lastParseError = 'First iteration must use mode "full"; mode "patch" is not allowed.';
          lastParseKind = 'schema';
          parseReport.attempts.push({
            stage: 'scenario_contract',
            model: opts.model,
            ok: false,
            error: lastParseError,
            errorKind: lastParseKind
          });
          parsed = null;
        }
        if (parsed) {
          const missingCoreFiles = findMissingCoreFilesInOutput(parsed.files, scenarioRequired);
          if (missingCoreFiles.length > 0) {
            if (iter === 1) {
              lastParseError = `First iteration must use mode "full" with all core files. Missing: ${missingCoreFiles.join(', ')}`;
              lastParseKind = 'schema';
              parseReport.attempts.push({
                stage: 'scenario_contract',
                model: opts.model,
                ok: false,
                error: lastParseError,
                errorKind: lastParseKind
              });
              parsed = null;
            } else if (parsed.mode !== 'patch') {
              forcePatchFromIncompleteFull = true;
              parseReport.attempts.push({
                stage: 'scenario_contract',
                model: opts.model,
                ok: true,
                error: `Full mode output missing required files (${missingCoreFiles.join(', ')}); applying as patch to avoid destructive reset`,
                errorKind: 'schema'
              });
            }
          }
        }
      }
    }

    if (!parsed) {
      const iterationFailureKind = computeIterationParseFailureKind(parsed, lastParseKind);
      if (iterationFailureKind) recordParseFailure(parseStats, iterationFailureKind);
      parseReport.finalOk = false;
      parseReport.finalError = lastParseError || 'Parse/write failed';
      parseReport.finalErrorKind = lastParseKind;
      await fs.promises.writeFile(path.join(iterDir, 'parse_report.json'), JSON.stringify(parseReport, null, 2), 'utf8');
      if (parseReport.attempts.some(a => a.stage !== 'initial')) {
        parseStats.jsonRepairFailures += 1;
        await fs.promises.writeFile(path.join(iterDir, 'json_repair_error.txt'), `${parseReport.finalError}\n`, 'utf8');
      }
      final = { ok: false, diagnostics: [`Parse/write failed: ${parseReport.finalError}`] };
      await fs.promises.writeFile(path.join(iterDir, 'validation.json'), JSON.stringify(final, null, 2), 'utf8');
      await maybeRunPlannerOnFail(final, iter);
      prompt = await buildRepairPrompt(basePrompt, final, workspaceDir, undefined, scenario.id);
      continue;
    }

    parseReport.finalOk = true;
    await fs.promises.writeFile(path.join(iterDir, 'parse_report.json'), JSON.stringify(parseReport, null, 2), 'utf8');
    parsed.files = parsed.files.map(file => ({
      ...file,
      content: normalizeScenarioFileContentBeforeWrite(scenario.id, file.path, file.content)
    }));
    await fs.promises.writeFile(path.join(iterDir, 'parsed.json'), JSON.stringify(parsed, null, 2), 'utf8');

    const duplicatePathsBeforeWrite = findDuplicateFilePaths(parsed.files);
    if (duplicatePathsBeforeWrite.length > 0) {
      const dupErr = `Duplicate file paths in files[]: ${duplicatePathsBeforeWrite.join(', ')}`;
      recordParseFailure(parseStats, 'schema');
      parseReport.finalOk = false;
      parseReport.finalError = dupErr;
      parseReport.finalErrorKind = 'schema';
      await fs.promises.writeFile(path.join(iterDir, 'parse_report.json'), JSON.stringify(parseReport, null, 2), 'utf8');
      final = { ok: false, diagnostics: [`Parse/write failed: ${dupErr}`] };
      await fs.promises.writeFile(path.join(iterDir, 'validation.json'), JSON.stringify(final, null, 2), 'utf8');
      await maybeRunPlannerOnFail(final, iter);
      prompt = await buildRepairPrompt(basePrompt, final, workspaceDir, undefined, scenario.id);
      continue;
    }

    const isPatch = iter > 1 && (parsed.mode === 'patch' || forcePatchFromIncompleteFull);
    if (!isPatch) await resetDir(workspaceDir);
    const written = await writeFiles(workspaceDir, parsed.files);
    await fs.promises.writeFile(
      path.join(iterDir, 'write_report.json'),
      JSON.stringify({ count: written.length, files: written, appliedAsPatch: isPatch, forcePatchFromIncompleteFull }, null, 2),
      'utf8'
    );

    final = await scenario.validate(workspaceDir, evalContext);
    await fs.promises.writeFile(path.join(iterDir, 'validation.json'), JSON.stringify(final, null, 2), 'utf8');

    for (const c of final.commands || []) {
      const safeName = c.command.replace(/[^a-zA-Z0-9._-]+/g, '_').slice(0, 60);
      await fs.promises.writeFile(path.join(iterDir, `cmd_${safeName}.stdout.txt`), c.stdout, 'utf8');
      await fs.promises.writeFile(path.join(iterDir, `cmd_${safeName}.stderr.txt`), c.stderr, 'utf8');
    }

    if (final.ok) break;
    await maybeRunPlannerOnFail(final, iter);
    let reviewerNote: string | undefined = undefined;
    if (opts.reviewerModel) {
      const reviewerPrompt = await buildReviewerPrompt(basePrompt, final, workspaceDir);
      await fs.promises.writeFile(path.join(iterDir, 'reviewer_prompt.txt'), reviewerPrompt, 'utf8');
      try {
        const res = await ollamaGenerateJsonObject<{ review?: string; priorityFiles?: string[] }>({
          baseUrl: opts.baseUrl,
          model: opts.reviewerModel,
          prompt: reviewerPrompt,
          timeoutMs: Math.min(opts.timeoutSec, 600) * 1000,
          options: ollamaOptions,
        });
        await fs.promises.writeFile(path.join(iterDir, 'reviewer_raw.json'), JSON.stringify(res.raw, null, 2), 'utf8');
        await fs.promises.writeFile(path.join(iterDir, 'reviewer_raw_response.txt'), res.responseText, 'utf8');
        await fs.promises.writeFile(path.join(iterDir, 'reviewer_parsed.json'), JSON.stringify(res.obj, null, 2), 'utf8');
        if (typeof res.obj?.review === 'string' && res.obj.review.trim()) reviewerNote = res.obj.review.trim();
      } catch (e: any) {
        await fs.promises.writeFile(path.join(iterDir, 'reviewer_error.txt'), String(e?.message || e) + '\n', 'utf8');
      }
    }

    prompt = await buildRepairPrompt(basePrompt, final, workspaceDir, reviewerNote, scenario.id);
  }

  await fs.promises.writeFile(
    path.join(outDir, 'validation.json'),
    JSON.stringify({
      outDir: path.resolve(outDir),
      workspaceDir: path.resolve(workspaceDir),
      deterministicFallback: deterministicFallbackStats,
      reliability: {
        rawPasses: deterministicFallbackStats.totalRawPasses,
        rawFailures: deterministicFallbackStats.totalRawFailures,
        recoveredByFallback: deterministicFallbackStats.totalRecoveredByFallback,
        fallbackDependencyRate: deterministicFallbackStats.fallbackDependencyRate
      },
      parseStats,
      ...final
    }, null, 2),
    'utf8'
  );

  if (final.ok) {
    // eslint-disable-next-line no-console
    console.log(`OK: validation passed (${outDir})`);
  } else {
    // eslint-disable-next-line no-console
    console.log(`FAIL: validation failed (${outDir})`);
    process.exitCode = 2;
  }
}

if (require.main === module) {
  main().catch(err => {
    // eslint-disable-next-line no-console
    console.error('botEval failed:', err);
    process.exit(1);
  });
}
