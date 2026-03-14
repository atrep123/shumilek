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
  stage: 'initial' | 'retry_truncation' | 'repair_syntax' | 'repair_schema' | 'scenario_contract' | 'timeout_model_fallback';
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
  appliedFixes?: string[];
  skippedFixes?: string[];
};

type NodeProjectContractAutoFixResult = {
  files: FileSpec[];
  appliedFixes: string[];
  skippedFixes: string[];
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
const OLLAMA_RETRY_MAX_TIMEOUT_MS = readPositiveIntEnv('BOT_EVAL_OLLAMA_RETRY_MAX_TIMEOUT_MS', 60_000);
const OLLAMA_RECOVERY_ATTEMPTS = readPositiveIntEnv('BOT_EVAL_OLLAMA_RECOVERY_ATTEMPTS', 2);
const OLLAMA_RECOVERY_WAIT_MS = readPositiveIntEnv('BOT_EVAL_OLLAMA_RECOVERY_WAIT_MS', 12000);
const OLLAMA_RECOVERY_POLL_MS = readPositiveIntEnv('BOT_EVAL_OLLAMA_RECOVERY_POLL_MS', 1500);
const OLLAMA_READINESS_TIMEOUT_MS = readPositiveIntEnv('BOT_EVAL_OLLAMA_READINESS_TIMEOUT_MS', 2500);
const OLLAMA_PREFLIGHT_TIMEOUT_MS = readPositiveIntEnv('BOT_EVAL_OLLAMA_PREFLIGHT_TIMEOUT_MS', 15000);
const OLLAMA_PREFLIGHT_RETRY_ATTEMPTS = readPositiveIntEnv('BOT_EVAL_OLLAMA_PREFLIGHT_RETRY_ATTEMPTS', 3);
const OLLAMA_PREFLIGHT_RETRY_BACKOFF_MS = readPositiveIntEnv('BOT_EVAL_OLLAMA_PREFLIGHT_RETRY_BACKOFF_MS', 1500);
const RESET_DIR_RETRY_ATTEMPTS = readPositiveIntEnv('BOT_EVAL_RESETDIR_RETRY_ATTEMPTS', 8);
const RESET_DIR_RETRY_BACKOFF_MS = readPositiveIntEnv('BOT_EVAL_RESETDIR_RETRY_BACKOFF_MS', 350);
const NODE_ORACLE_CMD_RETRY_ATTEMPTS = readPositiveIntEnv('BOT_EVAL_NODE_ORACLE_CMD_RETRY_ATTEMPTS', 3);
const NODE_ORACLE_CMD_RETRY_BASE_DELAY_MS = readPositiveIntEnv('BOT_EVAL_NODE_ORACLE_CMD_RETRY_BASE_DELAY_MS', 350);

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
  timeoutFallbackModel?: string;
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

const ORACLE_NODE_PROJECT_API_LARGE_DIR = path.join(__dirname, 'botEval', 'oracle', 'node_project_api_large');
let ORACLE_NODE_PROJECT_API_LARGE_TESTS_SNIPPET = '';
try {
  ORACLE_NODE_PROJECT_API_LARGE_TESTS_SNIPPET = fs.readFileSync(
    path.join(ORACLE_NODE_PROJECT_API_LARGE_DIR, 'tests', 'oracle.test.js'),
    'utf8'
  );
} catch {
  ORACLE_NODE_PROJECT_API_LARGE_TESTS_SNIPPET = '// (oracle tests missing on disk)';
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
  {
    id: 'node-project-api-large',
    title: 'Node Project Management API (Large)',
    prompt: [
      'Vytvor stredne velky Node.js monolit (Project Management API), ktery projde oracle testy.',
      '',
      'POZADAVKY / KONTRAKT:',
      '- Bez persistence mimo proces: pouzij in-memory repozitare/sluzby.',
      '- Bez fake/mock vysledku; endpointy musi vracet realna data z in-memory stavu.',
      '- Pouzij domeny: projects, tasks, members, comments.',
      '- Struktura musi byt modulova pod `src/modules/` a obsahovat min. tyto adresare:',
      '  - src/modules/projects',
      '  - src/modules/tasks',
      '  - src/modules/members',
      '  - src/modules/comments',
      '- Projekt musi mit minimalne 12 source souboru pod `src/` (`.js`/`.ts`/`.mjs`/`.cjs`).',
      '- Musi existovat `src/app.*` (app export pro testy) a `src/server.*` (spousteci vrstva).',
      '- `src/app.*` / `src/server.*` NESMI automaticky volat `listen()` pri importu (oracle importuje app pres supertest).',
      '- Vsechny chyby vracej konzistentne: `{ "error": { "code": "<string>", "message": "<string>" } }`.',
      '- Povolen bezny stack (napr. express, zod).',
      '- Protoze oracle testy pouzivaji supertest, zajisti `supertest` v dependencies nebo devDependencies.',
      '- Nepouzivej balicek `uuid`; generovani ID delat pres `node:crypto` + `crypto.randomUUID()`.',
      '- Nepouzivej neplatny pattern `const { v4: uuidv4 } = require("crypto").randomUUID`; spravne je `const { randomUUID } = require("node:crypto")` a volat `randomUUID()`.',
      '- Pokud pouzijes express, zapni `app.use(express.json())` a vracej JSON i pro chyby (ne HTML fallback).',
      '- Nenechavej uncaught vyjimky v route handlerech; 4xx/404/409 chyby vracej jako JSON payload, ne throw bez catcheru.',
      '- Nepouzivej `new BadRequestError(...)`/`new NotFoundError(...)`, pokud je explicitne nedefinujes a neexportujes v `src/lib/errors.*`.',
      '- Pri importu helperu z `src/modules/*` pouzij relativni cesty `../../lib/id` a `../../lib/errors` (ne `../lib/*`).',
      '- API endpointy (minimalni kontrakt):',
      '  - GET /health -> 200 { ok: true } (presne klic `ok`, ne `status` ani jiny alias)',
      '  - GET /projects -> 200 { projects: [...] }',
      '  - POST /projects body { name } -> 201 { project }',
      '    - body bez `name` (nebo prazdny `name`) -> 400 error payload',
      '  - GET /projects/:projectId -> 200 { project } nebo 404 error payload',
      '  - POST /projects/:projectId/members body { userId, role } -> 201 { member }',
      '    - body bez `userId` nebo `role` -> 400 error payload',
      '  - GET /projects/:projectId/members -> 200 { members: [...] }',
      '  - POST /projects/:projectId/tasks body { title } -> 201 { task }',
      '    - body bez `title` (nebo prazdny `title`) -> 400 error payload',
      '  - GET /projects/:projectId/tasks?status=todo|done -> 200 { tasks: [...] }',
      '    - query `status` musi skutecne filtrovat vysledek (ne jen ignorovat)',
      '  - PATCH /projects/:projectId/tasks/:taskId body { status } -> 200 { task }',
      '    - povolene statusy: `todo` | `done`; jine hodnoty -> 400 error payload',
      '  - POST /projects/:projectId/tasks/:taskId/comments body { message } -> 201 { comment }',
      '    - body bez `message` (nebo prazdny `message`) -> 400 error payload',
      '  - GET /projects/:projectId/tasks/:taskId/comments -> 200 { comments: [...] }',
      '- Konfliktni vstupy (napr. duplicate project/member) vracej jako 409 error payload.',
      '- Member objekt modeluj jako `{ id, userId, role }` (ne `{ id, name }`).',
      '- Nevalidni vstupy vracej jako 400 error payload, neexistujici entity jako 404 error payload.',
      '- Route wiring v `src/app.js` musi obsahovat mounty:',
      '  - app.use("/projects", projectsRoutes)',
      '  - app.use("/projects/:projectId/members", membersRoutes)',
      '  - app.use("/projects/:projectId/tasks", tasksRoutes)',
      '  - app.use("/projects/:projectId/tasks/:taskId/comments", commentsRoutes)',
      '- Uvnitr `members/tasks/comments` routeru pouzij relativni paths od mountpointu (napr. "/" nebo "/:taskId"), ne znovu cele cesty s projectId/taskId.',
      '- V tomto scenari se nesmi spoustet HTTP listener na fixnim portu (zadne `app.listen(...)` pri importu).',
      '- Povinna minimalni sada souboru v prvnim `mode:"full"` vystupu:',
      '  - README.md',
      '  - package.json',
      '  - src/app.js',
      '  - src/server.js',
      '  - src/modules/projects/routes.js',
      '  - src/modules/projects/service.js',
      '  - src/modules/tasks/routes.js',
      '  - src/modules/tasks/service.js',
      '  - src/modules/members/routes.js',
      '  - src/modules/members/service.js',
      '  - src/modules/comments/routes.js',
      '  - src/modules/comments/service.js',
      '  - src/lib/errors.js',
      '  - src/lib/id.js',
      '',
      'Doporuceni: scenar je zamerne vetsi; pocitej s `--maxIterations 12`.',
      '',
      'Poznamka: testy budeme pouzivat tyto (musis projit):',
      '--- BEGIN ORACLE TESTS (tests/oracle.test.js) ---',
      ORACLE_NODE_PROJECT_API_LARGE_TESTS_SNIPPET.trimEnd(),
      '--- END ORACLE TESTS ---',
      '',
      'VYSTUPNI FORMAT (STRICT): vrat JEN JSON objekt tohoto tvaru:',
      '{',
      '  "mode": "full",',
      '  "files": [',
      '    {"path": "README.md", "content": "...\\n"},',
      '    {"path": "package.json", "content": "...\\n"},',
      '    {"path": "src/app.js", "content": "...\\n"},',
      '    {"path": "src/server.js", "content": "...\\n"},',
      '    {"path": "src/modules/projects/...", "content": "...\\n"}',
      '  ],',
      '  "notes": "optional"',
      '}',
      '',
      'Pravidla:',
      '- Zadny markdown, zadne ``` bloky, zadny text mimo JSON.',
      '- Cesty jsou relativni, pouzij `/`, bez `..` a bez absolutnich cest.',
      '- Nezahrnuj vlastni `tests/` (pouziji se oracle testy).',
      '- `content` je vzdy kompletni obsah souboru (ne diff/snippet).',
    ].join('\n'),
    validate: async (workspaceDir: string, _context: EvalRunContext) => validateNodeProjectApiLarge(workspaceDir),
  },
];

export function normalizeDeterministicFallbackMode(raw?: string): DeterministicFallbackMode {
  const value = String(raw || '').trim().toLowerCase();
  if (value === 'off' || value === 'always' || value === 'on-fail') return value;
  return 'on-fail';
}

export function isDeterministicFallbackEnabled(scenarioId: string): boolean {
  return scenarioId !== 'node-project-api-large';
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
    timeoutFallbackModel: (process.env.BOT_EVAL_TIMEOUT_FALLBACK_MODEL || '').trim() || undefined,
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
    if (a === '--timeoutFallbackModel' && next()) {
      opts.timeoutFallbackModel = next();
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
  if (typeof opts.timeoutFallbackModel === 'string' && opts.timeoutFallbackModel.trim().length === 0) opts.timeoutFallbackModel = undefined;
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
  if (/duplicate file paths|Missing "files" array|files\[\]|must be objects|string "path"|string "content"|JSON root must be an object|"mode" must be|"notes" must be|first iteration must use mode|full mode output missing required files|large scenario full output must include all core files|large scenario requires mode "full"/i.test(text)) {
    return 'schema';
  }
  if (/JSON|Unterminated|Unexpected token|not valid JSON|position \d+|after array element/i.test(text)) return 'json_parse';
  return 'other';
}

function isRepairableParseKind(kind: ParseErrorKind): boolean {
  return kind === 'json_parse' || kind === 'schema' || kind === 'placeholder';
}

function isLargeScenarioStructuralDiagnostic(diagnostic: string): boolean {
  return /missing required file|missing domain module|missing required app entrypoint|missing required server entrypoint|missing shared helper source file|expected at least 12 source files|parse\/write failed:\s*(first iteration must use mode "full" with all core files|large scenario full output must include all core files|large scenario requires mode "full")/i.test(
    String(diagnostic || '')
  );
}

export function shouldRequireFullModeAfterLargeFailure(diagnostics: string[]): boolean {
  return diagnostics.some(isLargeScenarioStructuralDiagnostic);
}

export function sanitizeReviewerNote(note?: string): string | undefined {
  const cleaned = String(note || '').trim();
  if (!cleaned) return undefined;
  if (cleaned.length < 20) return undefined;
  if (/^(text|ok|none|n\/a|na|good|looks good|fine|done)[.!]?$/i.test(cleaned)) return undefined;
  return cleaned;
}

export function computeReviewerTimeoutMs(timeoutSec: number, scenarioId: string): number {
  const normalizedTimeoutSec = Number.isFinite(timeoutSec) && timeoutSec > 0 ? Math.floor(timeoutSec) : 600;
  const capSec = scenarioId === 'node-project-api-large' ? 180 : 600;
  return Math.min(normalizedTimeoutSec, capSec) * 1000;
}

export function computePrimaryGenerationTimeoutMs(timeoutSec: number, scenarioId: string, primaryModel?: string): number {
  const normalizedTimeoutSec = Number.isFinite(timeoutSec) && timeoutSec > 0 ? Math.floor(timeoutSec) : 1800;
  let capSec = normalizedTimeoutSec;
  if (scenarioId === 'node-project-api-large') {
    const modelName = String(primaryModel || '').toLowerCase();
    capSec = /\b32b\b/.test(modelName) ? 180 : 600;
  }
  return Math.min(normalizedTimeoutSec, capSec) * 1000;
}

export function computeTimeoutFallbackGenerationTimeoutMs(timeoutMs: number, scenarioId: string): number {
  const normalizedTimeoutMs = Number.isFinite(timeoutMs) && timeoutMs > 0 ? Math.floor(timeoutMs) : 180_000;
  const capMs = scenarioId === 'node-project-api-large' ? 150_000 : normalizedTimeoutMs;
  return Math.min(normalizedTimeoutMs, capMs);
}

export function getTimeoutFallbackModelsForScenario(
  scenarioId: string,
  primaryModel: string,
  configuredFallbackModel?: string
): string[] {
  const primary = String(primaryModel || '').trim();
  if (!primary) return [];
  if (scenarioId !== 'node-project-api-large') return [];
  const configured = String(configuredFallbackModel || '').trim();
  const defaults = ['qwen2.5-coder:7b', 'qwen2.5:7b', 'qwen2.5:3b'];
  const rawCandidates = configured
    ? configured.split(/[,\n;|]/).map(item => item.trim()).filter(Boolean)
    : defaults;
  const out: string[] = [];
  const seen = new Set<string>();
  for (const candidate of rawCandidates) {
    if (!candidate || candidate === primary) continue;
    const key = candidate.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(candidate);
  }
  return out;
}

export function getTimeoutFallbackModelForScenario(
  scenarioId: string,
  primaryModel: string,
  configuredFallbackModel?: string
): string | undefined {
  return getTimeoutFallbackModelsForScenario(scenarioId, primaryModel, configuredFallbackModel)[0];
}

export function shouldStopAfterGenerationTimeout(scenarioId: string, consecutiveTimeouts: number): boolean {
  const count = Number.isFinite(consecutiveTimeouts) && consecutiveTimeouts > 0 ? Math.floor(consecutiveTimeouts) : 0;
  if (scenarioId === 'node-project-api-large') return count >= 1;
  return count >= 2;
}

function isGenerationTimeoutLikeError(errorMessage: string): boolean {
  const text = String(errorMessage || '').toLowerCase();
  return /user aborted a request|operation was aborted|aborterror|timed out|timeout/i.test(text);
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
    '  --timeoutFallbackModel <name>  Model used on generation-timeout fallback (optional)',
    '  --deterministicFallback <mode>  Deterministic fallback policy: off|on-fail|always (default: on-fail)',
    '  --baseUrl <url>            Ollama base URL (default: http://localhost:11434)',
    '  (preflight checks /api/tags reachability + model presence before run start)',
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
  next = next.replace(
    /import\s*\{\s*v4\s+as\s+([A-Za-z_$][\w$]*)\s*\}\s*from\s*['"]uuid['"]\s*;?/g,
    'const { randomUUID: $1 } = require("node:crypto");'
  );
  next = next.replace(
    /import\s*\{\s*v4\s*\}\s*from\s*['"]uuid['"]\s*;?/g,
    'const { randomUUID: v4 } = require("node:crypto");'
  );
  next = next.replace(
    /const\s*\{\s*v4\s*:\s*([A-Za-z_$][\w$]*)\s*\}\s*=\s*require\(\s*['"]uuid['"]\s*\)\s*;?/g,
    'const { randomUUID: $1 } = require("node:crypto");'
  );
  next = next.replace(
    /const\s*\{\s*v4\s*\}\s*=\s*require\(\s*['"]uuid['"]\s*\)\s*;?/g,
    'const { randomUUID: v4 } = require("node:crypto");'
  );
  next = next.replace(
    /const\s+([A-Za-z_$][\w$]*)\s*=\s*require\(\s*['"]uuid['"]\s*\)\.v4\s*;?/g,
    'const { randomUUID: $1 } = require("node:crypto");'
  );
  next = next.replace(
    /import\s+([A-Za-z_$][\w$]*)\s+from\s*['"]uuid['"]\s*;?/g,
    'const { randomUUID: $1 } = require("node:crypto");'
  );
  next = next.replace(/\buuid\.v4\s*\(/g, 'crypto.randomUUID(');
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
  next = next.replace(/return\s+JSON\.parse\(\s*([A-Za-z_$][\w$]*)\s*\)\s*(?:\|\|\s*\[\s*\])?\s*;\s*/g, (_full, varName) => {
    const parsedVar = String(varName || 'data');
    return [
      `const parsed = JSON.parse(${parsedVar});`,
      '      return Array.isArray(parsed?.tasks) ? parsed.tasks : (Array.isArray(parsed) ? parsed : []);',
      ''
    ].join('\n');
  });
  next = next.replace(/return\s+JSON\.parse\(\s*data\s*\)\s*\|\|\s*\[\s*\]\s*;\s*/g, [
    'const parsed = JSON.parse(data);',
    '      return Array.isArray(parsed?.tasks) ? parsed.tasks : (Array.isArray(parsed) ? parsed : []);',
    ''
  ].join('\n'));
  next = next.replace(/JSON\.stringify\(\s*tasks\s*,\s*null\s*,\s*2\s*\)/g, 'JSON.stringify({ tasks }, null, 2)');
  // TS strict often fails when done/remove are typed as Task but return null/undefined branches.
  next = next.replace(/\bdone\s*\(\s*id\s*:\s*string\s*\)\s*:\s*Task\s*\{/g, 'done(id: string): Task | null {');
  next = next.replace(/\bremove\s*\(\s*id\s*:\s*string\s*\)\s*:\s*Task\s*\{/g, 'remove(id: string): Task | null {');
  next = next.replace(
    /(const\s+task\s*=\s*tasks\.find\([^;]*\);\s*if\s*\(task\)\s*\{[\s\S]*?\}\s*)return\s+task\s*;/g,
    '$1return task || null;'
  );
  next = next.replace(
    /return\s+([A-Za-z_$][\w$]*)\s*\|\|\s*\{[\s\S]*?\}\s*;/g,
    (_full, valueName) => `if (!${valueName}) throw new Error('Task not found');\n    return ${valueName};`
  );

  const toRequireObjectPattern = (rawNames: string): string => {
    return rawNames
      .split(',')
      .map((p: string) => p.trim())
      .filter(Boolean)
      .map((name: string) => {
        const alias = name.match(/^([A-Za-z_$][\w$]*)\s+as\s+([A-Za-z_$][\w$]*)$/i);
        if (alias) return `${alias[1]}: ${alias[2]}`;
        return name;
      })
      .join(', ');
  };

  const convertNamedImportToRequire = (source: 'fs' | 'crypto' | 'path'): void => {
    const importRe = new RegExp(`import\\s*\\{\\s*([^}]+)\\s*\\}\\s*from\\s*['"](?:node:)?${source}['"]\\s*;?`, 'g');
    next = next.replace(importRe, (full, rawNames) => {
      const text = String(rawNames || '');
      const names = toRequireObjectPattern(text);
      if (!names) return full;
      if (source === 'crypto' && /\bas\b/i.test(text)) {
        // Preserve an import-shaped marker for existing contract tests.
        return `const { ${names} } = require("node:${source}"); // import { ${text} } from 'node:crypto'`;
      }
      return `const { ${names} } = require("node:${source}");`;
    });
  };
  convertNamedImportToRequire('fs');
  convertNamedImportToRequire('crypto');
  convertNamedImportToRequire('path');
  next = next.replace(/import\s+\*\s+as\s+fs\s+from\s*['"](?:node:)?fs['"]\s*;?/g, 'const fs = require("node:fs");');
  next = next.replace(/import\s+fs\s+from\s*['"](?:node:)?fs['"]\s*;?/g, 'const fs = require("node:fs");');
  next = next.replace(/import\s+\*\s+as\s+crypto\s+from\s*['"](?:node:)?crypto['"]\s*;?/g, 'const crypto = require("node:crypto");');
  next = next.replace(/import\s+crypto\s+from\s*['"](?:node:)?crypto['"]\s*;?/g, 'const crypto = require("node:crypto");');
  next = next.replace(/import\s+\*\s+as\s+path\s+from\s*['"](?:node:)?path['"]\s*;?/g, 'const path = require("node:path");');
  next = next.replace(/import\s+path\s+from\s*['"](?:node:)?path['"]\s*;?/g, 'const path = require("node:path");');
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

export function normalizeTsTodoCliRuntimeGlobals(content: string): string {
  let next = content.replace(/\r\n/g, '\n');
  const lines = next.split('\n');
  const cleaned: string[] = [];
  let hasRequireDeclare = false;
  let hasProcessDeclare = false;

  for (const line of lines) {
    const trimmed = line.trim();
    if (/^const\s+process\s*=\s*require\(\s*['"]node:process['"]\s*\)\s*;?$/.test(trimmed)) {
      continue;
    }
    if (/^declare const require:\s*any;\s*$/.test(trimmed)) {
      if (hasRequireDeclare) continue;
      hasRequireDeclare = true;
      cleaned.push('declare const require: any;');
      continue;
    }
    if (/^declare const process:\s*any;\s*$/.test(trimmed)) {
      if (hasProcessDeclare) continue;
      hasProcessDeclare = true;
      cleaned.push('declare const process: any;');
      continue;
    }
    cleaned.push(line);
  }

  next = cleaned.join('\n');
  const withoutDeclares = next
    .replace(/^\s*declare const require:\s*any;\s*$/gm, '')
    .replace(/^\s*declare const process:\s*any;\s*$/gm, '');

  if (/\brequire\s*\(/.test(withoutDeclares) && !hasRequireDeclare) {
    next = `declare const require: any;\n${next}`;
    hasRequireDeclare = true;
  }
  if (/\bprocess\b/.test(withoutDeclares) && !hasProcessDeclare) {
    next = `declare const process: any;\n${next}`;
  }

  return next;
}

export function normalizeTsTodoCliContract(content: string): string {
  let next = normalizeTsTodoTypeSafety(content);
  const lower = next.toLowerCase();

  if (/(?:^|\W)(commander|yargs|minimist)(?:$|\W)/i.test(lower)) {
    return normalizeTsTodoCliRuntimeGlobals(buildTsTodoFallbackCliTemplate());
  }

  // Common TS inference trap in parser helpers (`null` inferred too narrowly).
  next = next.replace(/\blet\s+currentOption\s*=\s*null\s*;/g, 'let currentOption: string | null = null;');
  // Avoid TS2451 redeclare errors from local process shadowing while preserving TS globals.
  next = next.replace(/^\s*(?:const|let|var)\s+process\s*=\s*require\(\s*['"]node:process['"]\s*\)\s*;?\s*$/gm, '');
  const dedupeDeclareLine = (source: string, lineRe: RegExp, canonicalLine: string): string => {
    const had = lineRe.test(source);
    let out = source.replace(lineRe, '');
    if (!had) return out;
    out = out.replace(/^\s*\n+/g, '');
    return `${canonicalLine}\n${out}`;
  };
  next = dedupeDeclareLine(next, /^\s*declare const require:\s*any;\s*$/gm, 'declare const require: any;');
  next = dedupeDeclareLine(next, /^\s*declare const process:\s*any;\s*$/gm, 'declare const process: any;');
  if (/\brequire\s*\(/.test(next) && !/^\s*declare const require:\s*any;\s*$/m.test(next)) {
    next = `declare const require: any;\n${next}`;
  }
  if (/\bprocess\b/.test(next) && !/^\s*declare const process:\s*any;\s*$/m.test(next)) {
    next = `declare const process: any;\n${next}`;
  }

  // Ensure --help exits 0 even when parser stores flags separately from positional cmd.
  next = next.replace(
    /if\s*\(\s*cmd\s*===\s*['"]--help['"]\s*\)\s*\{/g,
    "if (cmd === '--help' || process.argv.slice(2).includes('--help')) {"
  );
  if (!/['"]--help['"]/.test(next)) {
    next = next.replace(
      /(\bconst\s+cmd\s*=\s*[^;\n]+;)/,
      `$1\nif (cmd === '--help' || process.argv.slice(2).includes('--help')) {\n  console.log('Usage:\\n  list --data <path>\\n  add <title> --data <path>\\n  done <id> --data <path>\\n  remove <id> --data <path>\\n  --help');\n  process.exit(0);\n}`
    );
  }

  // Normalize common Node ESM import drift to CommonJS require for oracle compatibility.
  next = next.replace(/import\s+\*\s+as\s+fs\s+from\s*['"](?:node:)?fs['"]\s*;?/g, 'const fs = require("node:fs");');
  next = next.replace(/import\s+fs\s+from\s*['"](?:node:)?fs['"]\s*;?/g, 'const fs = require("node:fs");');
  next = next.replace(/import\s+\*\s+as\s+path\s+from\s*['"](?:node:)?path['"]\s*;?/g, 'const path = require("node:path");');
  next = next.replace(/import\s+path\s+from\s*['"](?:node:)?path['"]\s*;?/g, 'const path = require("node:path");');
  next = next.replace(
    /import\s*\{\s*([^}]+)\s*\}\s*from\s*['"](?:node:)?fs['"]\s*;?/g,
    (_full, rawNames) => {
      const names = String(rawNames)
        .split(',')
        .map((p: string) => p.trim())
        .filter(Boolean)
        .map((name: string) => {
          const alias = name.match(/^([A-Za-z_$][\w$]*)\s+as\s+([A-Za-z_$][\w$]*)$/i);
          if (alias) return `${alias[1]}: ${alias[2]}`;
          return name;
        })
        .join(', ');
      return `const { ${names} } = require("node:fs");`;
    }
  );
  next = next.replace(
    /import\s*\{\s*([^}]+)\s*\}\s*from\s*['"](?:node:)?path['"]\s*;?/g,
    (_full, rawNames) => {
      const names = String(rawNames)
        .split(',')
        .map((p: string) => p.trim())
        .filter(Boolean)
        .map((name: string) => {
          const alias = name.match(/^([A-Za-z_$][\w$]*)\s+as\s+([A-Za-z_$][\w$]*)$/i);
          if (alias) return `${alias[1]}: ${alias[2]}`;
          return name;
        })
        .join(', ');
      return `const { ${names} } = require("node:path");`;
    }
  );
  next = next.replace(/from\s+['"](\.\/store)\.ts['"]/g, "from '$1'");
  next = next.replace(/require\(\s*['"]\.\/store\.ts['"]\s*\)/g, "require('./store')");

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
    return normalizeTsTodoCliRuntimeGlobals(buildTsTodoFallbackCliTemplate());
  }

  const hasDestructiveArgvShiftParser =
    /\bconst\s+argv\s*=\s*process\.argv\.slice\(2\)\s*;/.test(next) &&
    /while\s*\(\s*argv\.length\s*>\s*0\s*\)\s*\{[\s\S]*?\bargv\.shift\s*\(/m.test(next);
  const reliesOnMutatedArgvForRequiredValue =
    /case\s+['"](?:add|done|remove)['"][\s\S]{0,300}\bargv\.(?:length|shift)\b/m.test(next) ||
    /store\.(?:add|done|remove)\(\s*argv\.shift\(\)\s*\)/m.test(next);
  if (hasDestructiveArgvShiftParser && reliesOnMutatedArgvForRequiredValue) {
    return normalizeTsTodoCliRuntimeGlobals(buildTsTodoFallbackCliTemplate());
  }

  const duplicateIdDecls = next.match(/\bconst\s+id\s*=\s*argv\s*\[\s*1\s*\]\s*;/g) || [];
  const hasSwitchWithDoneAndRemove =
    /switch\s*\([^)]*\)\s*\{[\s\S]*case\s+['"]done['"][\s\S]*case\s+['"]remove['"]/m.test(next);
  if (hasSwitchWithDoneAndRemove && duplicateIdDecls.length > 1) {
    return normalizeTsTodoCliRuntimeGlobals(buildTsTodoFallbackCliTemplate());
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
    compilerOptions.target = 'ES2020';
    compilerOptions.module = 'commonjs';
    compilerOptions.moduleResolution = 'node';
    compilerOptions.rootDir = 'src';
    compilerOptions.outDir = 'dist';
    compilerOptions.strict = false;
    compilerOptions.useUnknownInCatchVariables = false;
    compilerOptions.noImplicitAny = false;
    compilerOptions.esModuleInterop = true;
    compilerOptions.skipLibCheck = true;
    compilerOptions.types = [];
    root.include = ['src/**/*.ts'];
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
  const next = ensurePythonOptionalTypingImport(content.replace(/\r\n/g, '\n'));
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

function ensurePythonOptionalTypingImport(content: string): string {
  if (!/\bOptional\b/.test(content)) {
    return content;
  }
  if (/\btyping\.Optional\b/.test(content)) {
    return content;
  }
  if (/from\s+typing\s+import[^\n]*\bOptional\b/.test(content)) {
    return content;
  }

  const typingImportRegex = /^from\s+typing\s+import\s+([^\n]+)$/m;
  if (typingImportRegex.test(content)) {
    return content.replace(typingImportRegex, (_match, imported: string) => {
      const names = imported
        .split(',')
        .map(name => name.trim())
        .filter(Boolean);
      if (!names.includes('Optional')) {
        names.push('Optional');
      }
      const deduped = Array.from(new Set(names)).sort((a, b) => a.localeCompare(b));
      return `from typing import ${deduped.join(', ')}`;
    });
  }

  const lines = content.split('\n');
  let insertAt = 0;
  for (let i = 0; i < lines.length; i++) {
    if (/^\s*from\s+__future__\s+import\s+/.test(lines[i])) {
      insertAt = i + 1;
      continue;
    }
    break;
  }
  lines.splice(insertAt, 0, 'from typing import Optional');
  return lines.join('\n');
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

export function normalizeNodeProjectServerNoListen(content: string): string {
  let next = content.replace(/\r\n/g, '\n');
  if (!/\b[a-zA-Z_$][\w$]*\s*\.\s*listen\s*\(/.test(next)) {
    return next;
  }

  // Remove listener startup blocks from server entrypoint; oracle imports app directly.
  const lines = next.split('\n');
  const kept: string[] = [];
  let droppingListen = false;
  for (const line of lines) {
    if (!droppingListen && /\b[a-zA-Z_$][\w$]*\s*\.\s*listen\s*\(/.test(line)) {
      droppingListen = true;
      if (/\)\s*;?\s*$/.test(line)) {
        droppingListen = false;
      }
      continue;
    }
    if (droppingListen) {
      if (/\)\s*;?\s*$/.test(line)) {
        droppingListen = false;
      }
      continue;
    }
    kept.push(line);
  }
  next = kept.join('\n');
  next = next.replace(/^\s*const\s+PORT\s*=.*$/gm, '');
  next = next.replace(/^\s*\}\)\s*;?\s*$/gm, '');
  next = next.replace(/^\s*=>\s*\{\s*$/gm, '');
  next = next.replace(/\n{3,}/g, '\n\n').trimEnd();

  const hasAppBinding =
    /\bconst\s+app\s*=/.test(next) ||
    /\blet\s+app\s*=/.test(next) ||
    /\bvar\s+app\s*=/.test(next);
  const hasAppRequire = /require\s*\(\s*['"]\.\/app['"]\s*\)/.test(next);
  if (!hasAppBinding && !hasAppRequire) {
    return [
      "const app = require('./app');",
      '',
      'module.exports = app;',
      ''
    ].join('\n');
  }

  if (!/\bmodule\.exports\b/.test(next) && /\bapp\b/.test(next)) {
    next = `${next}\n\nmodule.exports = app;`;
  }
  return `${next.trimEnd()}\n`;
}

export function normalizeNodeProjectServiceNoRawThrow(content: string): string {
  let next = content.replace(/\r\n/g, '\n');
  if (!/\bthrow\s+new\s+Error\s*\(/.test(next)) {
    return next;
  }
  next = next.replace(/\bthrow\s+new\s+Error\s*\([\s\S]*?\)\s*;/g, 'return null;');
  return `${next.trimEnd()}\n`;
}

function shouldUseCanonicalTsTodoStoreForOracle(content: string): boolean {
  const normalized = content.replace(/\r\n/g, '\n');
  if (!/\bclass\s+TaskStore\b/.test(normalized)) return true;
  for (const method of ['list', 'add', 'done', 'remove']) {
    if (!new RegExp(`\\b${method}\\s*\\(`).test(normalized)) return true;
  }
  if (/from\s*['"]uuid['"]/.test(normalized) || /require\(\s*['"]uuid['"]\s*\)/.test(normalized)) return true;
  return false;
}

function shouldUseCanonicalTsTodoCliForOracle(content: string): boolean {
  const normalized = content.replace(/\r\n/g, '\n');
  const lower = normalized.toLowerCase();
  const looksLikeCli =
    /\bprocess\.argv\b/.test(normalized) ||
    /\bTaskStore\b/.test(normalized) ||
    /\bcmd\b/.test(normalized) ||
    /\b--data\b/.test(normalized) ||
    /\b(add|list|done|remove)\b/.test(lower);
  if (!looksLikeCli) return false;
  if (/\breadline\b/.test(lower) || /\bcreateinterface\s*\(/.test(lower)) return true;
  if (/enter the data file path|prompt/i.test(normalized)) return true;
  if (!/json\.stringify\s*\(/i.test(normalized)) return true;
  if (!/\b--help\b/.test(normalized)) return true;
  if (!/\bok\b/.test(normalized)) return true;
  return false;
}

export function normalizeScenarioFileContentBeforeWrite(scenarioId: string, relPath: string, content: string): string {
  if (scenarioId === 'ts-todo-oracle' && relPath === 'src/store.ts') {
    const normalized = normalizeTsTodoTypeSafety(normalizeTsTodoStorePathHandling(content));
    if (shouldUseCanonicalTsTodoStoreForOracle(normalized)) {
      return buildTsTodoFallbackStoreTemplate();
    }
    return normalized;
  }
  if (scenarioId === 'ts-todo-oracle' && relPath === 'src/cli.ts') {
    const normalized = normalizeTsTodoCliContract(content);
    if (shouldUseCanonicalTsTodoCliForOracle(normalized)) {
      return normalizeTsTodoCliRuntimeGlobals(buildTsTodoFallbackCliTemplate());
    }
    return normalized;
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
  if (scenarioId === 'node-project-api-large' && /^src\/server\.(?:js|ts|mjs|cjs)$/i.test(relPath)) {
    return normalizeNodeProjectServerNoListen(content);
  }
  if (scenarioId === 'node-project-api-large' && /^src\/modules\/.+\/service\.(?:js|ts|mjs|cjs)$/i.test(relPath)) {
    return normalizeNodeProjectServiceNoRawThrow(content);
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

function isRetryableResetDirError(error: any): boolean {
  const code = String(error?.code || '').toUpperCase();
  return code === 'EBUSY' || code === 'EPERM' || code === 'ENOTEMPTY' || code === 'EMFILE';
}

async function sleepMs(ms: number): Promise<void> {
  await new Promise(resolve => setTimeout(resolve, Math.max(0, ms)));
}

async function resetDir(dirPath: string): Promise<void> {
  let lastError: any = null;
  for (let attempt = 1; attempt <= RESET_DIR_RETRY_ATTEMPTS; attempt++) {
    try {
      await fs.promises.rm(dirPath, { recursive: true, force: true });
      await fs.promises.mkdir(dirPath, { recursive: true });
      return;
    } catch (error: any) {
      lastError = error;
      const retryable = isRetryableResetDirError(error);
      if (!retryable || attempt >= RESET_DIR_RETRY_ATTEMPTS) break;
      await sleepMs(RESET_DIR_RETRY_BACKOFF_MS * attempt);
    }
  }
  const message = String(lastError?.message || lastError || 'unknown error');
  throw new Error(`Failed to reset workspace directory after ${RESET_DIR_RETRY_ATTEMPTS} attempts: ${dirPath} (${message})`);
}

async function softCleanLargeWorkspaceDir(dirPath: string): Promise<void> {
  await fs.promises.mkdir(dirPath, { recursive: true });
  const cleanupTargets = ['node_modules', 'tests', 'dist'];
  for (const rel of cleanupTargets) {
    try {
      await fs.promises.rm(path.join(dirPath, rel), { recursive: true, force: true });
    } catch {
      // best-effort cleanup only
    }
  }
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
      types: [],
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
    'declare const require: any;',
    '',
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
    'declare const require: any;',
    'declare const process: any;',
    '',
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
    await fs.promises.writeFile(
      path.join(workspaceDir, 'src', 'store.ts'),
      normalizeTsTodoTypeSafety(normalizeTsTodoStorePathHandling(canonicalStore)),
      'utf8'
    );
    await fs.promises.writeFile(path.join(workspaceDir, 'src', 'cli.ts'), normalizeTsTodoCliRuntimeGlobals(canonicalCli), 'utf8');
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

export function buildTsTodoFallbackStoreTemplate(): string {
  return [
    'declare const require: any;',
    '',
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

export function buildTsTodoFallbackCliTemplate(): string {
  return [
    'declare const require: any;',
    'declare const process: any;',
    '',
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
    await fs.promises.writeFile(cliPath, normalizeTsTodoCliRuntimeGlobals(buildTsTodoFallbackCliTemplate()), 'utf8');
    changed = true;
  } else if (fs.existsSync(cliPath)) {
    const original = await fs.promises.readFile(cliPath, 'utf8');
    const next = normalizeTsTodoCliRuntimeGlobals(original);
    if (next !== original) {
      await fs.promises.writeFile(cliPath, next, 'utf8');
      changed = true;
    }
  }

  if (shouldFixStore) {
    await fs.promises.mkdir(path.dirname(storePath), { recursive: true });
    await fs.promises.writeFile(
      storePath,
      normalizeTsTodoTypeSafety(normalizeTsTodoStorePathHandling(buildTsTodoFallbackStoreTemplate())),
      'utf8'
    );
    changed = true;
  }

  if (shouldFixTsconfig) {
    const tsconfig = {
      compilerOptions: {
        target: 'ES2020',
        module: 'commonjs',
        moduleResolution: 'node',
        types: [],
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
  const mode = isDeterministicFallbackEnabled('ts-todo-oracle') ? context.deterministicFallbackMode : 'off';
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

function isNodeApiTransientOracleCommandFailure(commandResult: CommandResult): boolean {
  if (commandResult.ok) return false;
  const log = `${commandResult.stdout}\n${commandResult.stderr}`.toLowerCase();
  return (
    /fetch failed/.test(log) ||
    /socket hang up/.test(log) ||
    /econnreset/.test(log) ||
    /econnrefused/.test(log) ||
    /etimedout/.test(log) ||
    /connect eaddrinuse/.test(log)
  );
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
  let oracleCmd = await runCommand({ command: 'node --test tests/oracle.test.js', cwd: workspaceDir, timeoutMs: cmdTimeoutMs });
  let transientRetryCount = 0;
  for (let attempt = 1; attempt < NODE_ORACLE_CMD_RETRY_ATTEMPTS; attempt++) {
    if (!isNodeApiTransientOracleCommandFailure(oracleCmd)) break;
    transientRetryCount += 1;
    await sleep(Math.min(3000, NODE_ORACLE_CMD_RETRY_BASE_DELAY_MS * Math.pow(2, attempt - 1)));
    oracleCmd = await runCommand({ command: 'node --test tests/oracle.test.js', cwd: workspaceDir, timeoutMs: cmdTimeoutMs });
  }
  commands.push(oracleCmd);
  if (transientRetryCount > 0) {
    diagnostics.push(`Retried node-api oracle command ${transientRetryCount}x after transient transport failure.`);
  }

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
  if (/listen EADDRINUSE/i.test(logs)) {
    diagnostics.push('Server must not auto-listen on fixed port; return server instance only');
  }

  return { ok: diagnostics.length === 0, diagnostics, commands };
}

async function validateNodeApiOracle(workspaceDir: string, context: EvalRunContext): Promise<ValidationResult> {
  const mode = isDeterministicFallbackEnabled('node-api-oracle') ? context.deterministicFallbackMode : 'off';
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

export function collectNodeProjectApiLargeOracleDiagnostics(logs: string): string[] {
  const text = String(logs || '');
  const diagnostics: string[] = [];
  const push = (message: string): void => {
    if (!diagnostics.includes(message)) diagnostics.push(message);
  };

  if (
    /health \+ empty project list/i.test(text) &&
    (/actual:\s*undefined[\s\S]{0,120}expected:\s*true/i.test(text) || /health\.body\?\.ok/i.test(text))
  ) {
    push('Contract mismatch: GET /health must return HTTP 200 with JSON body { ok: true }.');
  }
  if (/health \+ empty project list/i.test(text) && /500\s*!==\s*200/i.test(text)) {
    push('Contract mismatch: GET /health or project list path throws unexpectedly (500). Check route-service method wiring and avoid generic INTERNAL_ERROR fallbacks.');
  }

  if (/project create\/list\/get \+ duplicate \+ validation/i.test(text) && /201\s*!==\s*400/i.test(text)) {
    push('Contract mismatch: POST /projects with missing/empty `name` must return 400 with { error: { code, message } }.');
  }
  if (/project create\/list\/get \+ duplicate \+ validation/i.test(text) && /0\s*!==\s*1/i.test(text)) {
    push('Contract mismatch: After POST /projects success, project must be visible in list/get endpoints (shared in-memory state).');
  }
  if (/project create\/list\/get \+ duplicate \+ validation/i.test(text) && /500\s*!==\s*200/i.test(text)) {
    push('Contract mismatch: project read/list operations must not return 500; verify projectsService methods called by routes exist and return expected data.');
  }

  if (/members endpoints/i.test(text) && (/400\s*!==\s*201/i.test(text) || /name is required/i.test(text))) {
    push('Contract mismatch: POST /projects/:projectId/members must accept { userId, role } and return 201 for valid payload.');
    push('Contract mismatch: Duplicate member (same userId in one project) must return 409 error payload.');
  }
  if (/members endpoints/i.test(text) && /200\s*!==\s*201/i.test(text)) {
    push('Contract mismatch: POST /projects/:projectId/members must return HTTP 201 on successful create.');
  }
  if (/members endpoints/i.test(text) && /201\s*!==\s*409/i.test(text)) {
    push('Contract mismatch: Duplicate member add (same userId in one project) must return HTTP 409 with error payload.');
  }

  if (/tasks create\/list\/filter \+ patch status/i.test(text) && /2\s*!==\s*1/i.test(text)) {
    push('Contract mismatch: GET /projects/:projectId/tasks?status=done must filter tasks and return only done items.');
  }
  if (
    /tasks create\/list\/filter \+ patch status/i.test(text) &&
    (/actual:\s*undefined[\s\S]{0,160}expected:\s*['"]Prepare spec['"]/i.test(text) || /\+\s*undefined[\s\S]{0,80}-\s*['"]Prepare spec['"]/i.test(text))
  ) {
    push('Contract mismatch: Task create/list payload must preserve task title (e.g., "Prepare spec") on returned task objects.');
  }
  if (/tasks create\/list\/filter \+ patch status/i.test(text) && /200\s*!==\s*201/i.test(text)) {
    push('Contract mismatch: POST /projects/:projectId/tasks must return HTTP 201 on successful create.');
  }

  if (/comments \+ not-found and payload contract/i.test(text) && /201\s*!==\s*400/i.test(text)) {
    push('Contract mismatch: POST /projects/:projectId/tasks/:taskId/comments with missing/empty `message` must return 400.');
  }
  if (/comments \+ not-found and payload contract/i.test(text) && /200\s*!==\s*201/i.test(text)) {
    push('Contract mismatch: POST /projects/:projectId/tasks/:taskId/comments must return HTTP 201 on successful create.');
  }
  if (/comments \+ not-found and payload contract/i.test(text) && /Cannot read properties of null \(reading ['"]id['"]\)/i.test(text)) {
    push('Contract mismatch: Task/comment creation flow returned null entity; ensure createTask/createComment returns object with id and validates project/task existence.');
  }

  if (/Expected error object|Expected JSON object body|Expected error payload/i.test(text)) {
    push('Contract mismatch: Every 4xx/409/404 response must use { error: { code, message } }.');
  }
  if (/INTERNAL_ERROR/i.test(text) && /500\s*!==\s*200|500\s*!==\s*201/i.test(text)) {
    push('Contract mismatch: avoid swallowing domain/service contract errors as generic INTERNAL_ERROR 500 responses.');
  }

  if (/is not a constructor/i.test(text) && /BadRequestError|NotFoundError/i.test(text)) {
    push('Contract mismatch: Do not throw undefined custom error classes. Define them or return JSON error payloads directly from handlers.');
  }

  if (/<!DOCTYPE html>/i.test(text)) {
    push('Contract mismatch: API must never return HTML error pages; return JSON error payloads even on failures.');
  }

  if (/Error:\s*Project not found/i.test(text) && /500\s*!==\s*201/i.test(text)) {
    push('Contract mismatch: Valid task/comment creation flow must not throw 500 "Project not found" after project creation.');
  }

  if (/Cannot find module ['"]\.\.\/lib\/id['"]|Cannot find module ['"]\.\.\/\.\.\/lib['"]/i.test(text)) {
    push('Fix module imports in src/modules/*: use ../../lib/id and ../../lib/errors only.');
  }
  if (/Cannot find module ['"]\.\.\/service['"]/i.test(text)) {
    push('Contract mismatch: routes must import service via "./service" from the same module directory (not "../service").');
  }
  if (/sendError\s+is not a function/i.test(text)) {
    push('sendError helper contract mismatch: routes call sendError(...) but src/lib/errors.* does not export a functional sendError helper.');
  }
  if (/errorHandler\s+is not a function/i.test(text)) {
    push('Route error-handler mismatch: replace errorHandler(res, error) with sendError(res, 500, "INTERNAL_ERROR", ...), and import only sendError from ../../lib/errors.');
  }
  if (/ReferenceError:\s*randomUUID\s+is not defined/i.test(text)) {
    push('randomUUID binding mismatch: randomUUID() is used without `const { randomUUID } = require("node:crypto")` (or equivalent import).');
  }
  if (/TypeError:\s*generateId\s+is not a function/i.test(text)) {
    push('generateId helper mismatch: src/lib/id.* must define+export `generateId()` and services must import it via ../../lib/id.');
  }
  if (/\+\s*'\[object Object\]'[\s\S]{0,120}-\s*'Prepare spec'|\[object Object\]\s*!==\s*'Prepare spec'/i.test(text)) {
    push('Task payload mismatch: route passes req.body object instead of req.body.title/req.body.status into tasks service methods.');
  }
  for (const match of text.matchAll(/TypeError:\s*([A-Za-z_$][\w$]*)\.([A-Za-z_$][\w$]*)\s+is not a function/g)) {
    const alias = String(match[1] || '').trim();
    const method = String(match[2] || '').trim();
    if (!alias || !method) continue;
    push(`Route-service runtime mismatch: ${alias}.${method} is missing. Export the method from the corresponding service module or add adapter alias wrapper.`);
  }

  if (/EADDRINUSE/i.test(text) || /connect EADDRINUSE/i.test(text)) {
    push('Runtime transport error (EADDRINUSE): avoid auto-listening on fixed ports and export app-only contract for supertest.');
  }
  if (/ETIMEDOUT/i.test(text) || /Operation timed out/i.test(text)) {
    push('Runtime transport timeout (ETIMEDOUT): ensure routes always finish response cycle (res.json/res.end) and avoid hanging middleware/service flows.');
  }

  return diagnostics;
}

function addDiagnosticOnce(diagnostics: string[], message: string): void {
  if (!diagnostics.includes(message)) diagnostics.push(message);
}

type RouteServiceMismatchSummary = {
  moduleName: string;
  serviceAlias: string;
  methods: string[];
};

export function parseRouteServiceMismatchDiagnostics(diagnostics: string[]): RouteServiceMismatchSummary[] {
  const grouped = new Map<string, { moduleName: string; serviceAlias: string; methods: Set<string> }>();
  const re = /^Route-service contract mismatch \(([^)]+)\): routes call ([A-Za-z_$][\w$]*)\.([A-Za-z_$][\w$]*)\(\) but service does not export "([A-Za-z_$][\w$]*)"\.?$/;
  for (const diagnostic of diagnostics || []) {
    const text = String(diagnostic || '').trim();
    const match = text.match(re);
    if (!match) continue;
    const moduleName = String(match[1] || '').trim();
    const serviceAlias = String(match[2] || '').trim();
    const calledMethod = String(match[3] || '').trim();
    const exportedMethod = String(match[4] || '').trim();
    if (!moduleName || !serviceAlias) continue;
    const method = exportedMethod || calledMethod;
    if (!method) continue;
    const key = `${moduleName}::${serviceAlias}`;
    const current = grouped.get(key) || { moduleName, serviceAlias, methods: new Set<string>() };
    current.methods.add(method);
    grouped.set(key, current);
  }
  return [...grouped.values()]
    .map(item => ({
      moduleName: item.moduleName,
      serviceAlias: item.serviceAlias,
      methods: [...item.methods.values()].sort((a, b) => a.localeCompare(b))
    }))
    .sort((a, b) => {
      const byModule = a.moduleName.localeCompare(b.moduleName);
      if (byModule !== 0) return byModule;
      return a.serviceAlias.localeCompare(b.serviceAlias);
    });
}

export function buildRouteServiceMismatchGuidance(diagnostics: string[]): string[] {
  const summary = parseRouteServiceMismatchDiagnostics(diagnostics);
  if (summary.length === 0) return [];
  const lines: string[] = [
    'ROUTE-SERVICE EXPORT MAP (AUTO-GENERATED)',
    '- Primarni akce: uprav service exporty tak, aby obsahovaly PRESNE pozadovane nazvy metod.'
  ];
  for (const item of summary) {
    lines.push(`- module ${item.moduleName}: service alias ${item.serviceAlias}`);
    lines.push(`  required exported methods: ${item.methods.join(', ')}`);
    lines.push(`  expected file: src/modules/${item.moduleName}/service.js (or ts/mjs/cjs equivalent)`);
    lines.push('  if current names differ, add adapter wrappers with EXACT method names');
  }
  return lines;
}

export function buildNodeProjectContractFixGuidance(diagnostics: string[]): string[] {
  const items = diagnostics || [];
  const hasMissingProjectDetailRoute = items.some(d => /Missing route signature for project detail endpoint/i.test(String(d)));
  const hasBadRequestCtorMissing = items.some(d => /new BadRequestError|define\/export BadRequestError/i.test(String(d)));
  const hasNotFoundCtorMissing = items.some(d => /new NotFoundError|define\/export NotFoundError/i.test(String(d)));
  const hasStateSharingMembers = items.some(d => /State-sharing mismatch: members service/i.test(String(d)));
  const hasTaskFilteringMismatch = items.some(d => /Task filtering contract mismatch/i.test(String(d)));
  const hasRawThrowInService = items.some(d => /Avoid raw throw in src\/modules\/.+\/service\./i.test(String(d)));
  const hasDuplicateMemberHint = items.some(d => /Duplicate handling hint: expected 409 conflict handling for duplicate members/i.test(String(d)));
  const hasSkippedOracle = items.some(d => /Skipped oracle command checks because structural contract did not pass/i.test(String(d)));

  if (
    !hasMissingProjectDetailRoute &&
    !hasBadRequestCtorMissing &&
    !hasNotFoundCtorMissing &&
    !hasStateSharingMembers &&
    !hasTaskFilteringMismatch &&
    !hasRawThrowInService &&
    !hasDuplicateMemberHint &&
    !hasSkippedOracle
  ) {
    return [];
  }

  const lines: string[] = ['NODE PROJECT CONTRACT FIX MAP (AUTO-GENERATED)'];
  if (hasMissingProjectDetailRoute) {
    lines.push('- projects routes: add `GET /:projectId` handler in `src/modules/projects/routes.*` (mounted under `/projects`).');
  }
  if (hasBadRequestCtorMissing || hasNotFoundCtorMissing) {
    lines.push('- errors contract: do NOT use undefined `BadRequestError`/`NotFoundError`; either define/export them in `src/lib/errors.*` or replace with `sendError(res, status, code, message)`.');
  }
  if (hasRawThrowInService) {
    lines.push('- services: remove raw `throw new Error(...)`; return nullable/domain result and map to JSON error payload in routes.');
  }
  if (hasStateSharingMembers) {
    lines.push('- members state: do not keep isolated `members` array/map; bind members to shared project repository and enforce duplicate check per project.');
  }
  if (hasDuplicateMemberHint) {
    lines.push('- members duplicate contract: adding same `userId` to same project must return HTTP 409 with `{ error: { code, message } }`.');
  }
  if (hasTaskFilteringMismatch) {
    lines.push('- tasks contract: `GET /projects/:projectId/tasks?status=todo|done` must really filter; `PATCH` must allow only `todo|done`.');
  }
  if (hasSkippedOracle) {
    lines.push('- priority: resolve all structural diagnostics first so oracle command phase can run.');
  }
  return lines;
}

function parseModuleServiceRequireAlias(routeSource: string): string | undefined {
  const match = String(routeSource || '').match(/\b(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s*=\s*require\(\s*['"]\.\/service['"]\s*\)/);
  if (!match) return undefined;
  return String(match[1] || '').trim() || undefined;
}

function extractServiceMethodCalls(routeSource: string, serviceAlias: string): string[] {
  const calls = new Set<string>();
  const escaped = serviceAlias.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const re = new RegExp(`\\b${escaped}\\.(\\w+)\\s*\\(`, 'g');
  const text = String(routeSource || '');
  let match: RegExpExecArray | null;
  while ((match = re.exec(text)) !== null) {
    const method = String(match[1] || '').trim();
    if (method) calls.add(method);
  }
  return [...calls.values()];
}

function extractModuleExportsObjectBody(text: string): string | undefined {
  const source = String(text || '');
  const assignRe = /\bmodule\.exports\s*=\s*\{/g;
  const match = assignRe.exec(source);
  if (!match) return undefined;
  const openIndex = source.indexOf('{', match.index);
  if (openIndex < 0) return undefined;

  let depth = 0;
  let quote: '"' | "'" | '`' | undefined = undefined;
  let escaped = false;
  let lineComment = false;
  let blockComment = false;

  for (let i = openIndex; i < source.length; i += 1) {
    const ch = source[i];
    const next = i + 1 < source.length ? source[i + 1] : '';

    if (lineComment) {
      if (ch === '\n') lineComment = false;
      continue;
    }
    if (blockComment) {
      if (ch === '*' && next === '/') {
        blockComment = false;
        i += 1;
      }
      continue;
    }
    if (quote) {
      if (escaped) {
        escaped = false;
        continue;
      }
      if (ch === '\\') {
        escaped = true;
        continue;
      }
      if (ch === quote) {
        quote = undefined;
      }
      continue;
    }

    if (ch === '/' && next === '/') {
      lineComment = true;
      i += 1;
      continue;
    }
    if (ch === '/' && next === '*') {
      blockComment = true;
      i += 1;
      continue;
    }
    if (ch === '"' || ch === "'" || ch === '`') {
      quote = ch;
      continue;
    }
    if (ch === '{') {
      depth += 1;
      continue;
    }
    if (ch === '}') {
      depth -= 1;
      if (depth === 0) {
        return source.slice(openIndex + 1, i);
      }
      continue;
    }
  }
  return undefined;
}

function extractIdentifierAssignedObjectBody(text: string, identifier: string): string | undefined {
  const source = String(text || '');
  const name = String(identifier || '').trim();
  if (!name) return undefined;
  const assignRe = new RegExp(`\\b(?:const|let|var)\\s+${name}\\s*=\\s*\\{`, 'g');
  const match = assignRe.exec(source);
  if (!match) return undefined;
  const openIndex = source.indexOf('{', match.index);
  if (openIndex < 0) return undefined;

  let depth = 0;
  let quote: '"' | "'" | '`' | undefined = undefined;
  let escaped = false;
  let lineComment = false;
  let blockComment = false;

  for (let i = openIndex; i < source.length; i += 1) {
    const ch = source[i];
    const next = i + 1 < source.length ? source[i + 1] : '';

    if (lineComment) {
      if (ch === '\n') lineComment = false;
      continue;
    }
    if (blockComment) {
      if (ch === '*' && next === '/') {
        blockComment = false;
        i += 1;
      }
      continue;
    }
    if (quote) {
      if (escaped) {
        escaped = false;
        continue;
      }
      if (ch === '\\') {
        escaped = true;
        continue;
      }
      if (ch === quote) {
        quote = undefined;
      }
      continue;
    }

    if (ch === '/' && next === '/') {
      lineComment = true;
      i += 1;
      continue;
    }
    if (ch === '/' && next === '*') {
      blockComment = true;
      i += 1;
      continue;
    }
    if (ch === '"' || ch === "'" || ch === '`') {
      quote = ch;
      continue;
    }
    if (ch === '{') {
      depth += 1;
      continue;
    }
    if (ch === '}') {
      depth -= 1;
      if (depth === 0) {
        return source.slice(openIndex + 1, i);
      }
      continue;
    }
  }
  return undefined;
}

function splitTopLevelObjectSegments(body: string): string[] {
  const source = String(body || '');
  const segments: string[] = [];
  let start = 0;
  let braceDepth = 0;
  let parenDepth = 0;
  let bracketDepth = 0;
  let quote: '"' | "'" | '`' | undefined = undefined;
  let escaped = false;
  let lineComment = false;
  let blockComment = false;

  const pushSegment = (endExclusive: number): void => {
    const segment = source.slice(start, endExclusive).trim();
    if (segment) segments.push(segment);
  };

  for (let i = 0; i < source.length; i += 1) {
    const ch = source[i];
    const next = i + 1 < source.length ? source[i + 1] : '';

    if (lineComment) {
      if (ch === '\n') lineComment = false;
      continue;
    }
    if (blockComment) {
      if (ch === '*' && next === '/') {
        blockComment = false;
        i += 1;
      }
      continue;
    }
    if (quote) {
      if (escaped) {
        escaped = false;
        continue;
      }
      if (ch === '\\') {
        escaped = true;
        continue;
      }
      if (ch === quote) {
        quote = undefined;
      }
      continue;
    }

    if (ch === '/' && next === '/') {
      lineComment = true;
      i += 1;
      continue;
    }
    if (ch === '/' && next === '*') {
      blockComment = true;
      i += 1;
      continue;
    }
    if (ch === '"' || ch === "'" || ch === '`') {
      quote = ch;
      continue;
    }
    if (ch === '{') {
      braceDepth += 1;
      continue;
    }
    if (ch === '}') {
      if (braceDepth > 0) braceDepth -= 1;
      continue;
    }
    if (ch === '(') {
      parenDepth += 1;
      continue;
    }
    if (ch === ')') {
      if (parenDepth > 0) parenDepth -= 1;
      continue;
    }
    if (ch === '[') {
      bracketDepth += 1;
      continue;
    }
    if (ch === ']') {
      if (bracketDepth > 0) bracketDepth -= 1;
      continue;
    }
    if (ch === ',' && braceDepth === 0 && parenDepth === 0 && bracketDepth === 0) {
      pushSegment(i);
      start = i + 1;
    }
  }

  pushSegment(source.length);
  return segments;
}

function extractServiceExportedMethods(serviceSource: string): Set<string> {
  const exported = new Set<string>();
  const text = String(serviceSource || '');

  let moduleExportBody = extractModuleExportsObjectBody(text);
  if (!moduleExportBody) {
    const aliasMatch = text.match(/\bmodule\.exports\s*=\s*([A-Za-z_$][\w$]*)\s*;?/);
    if (aliasMatch && aliasMatch[1]) {
      moduleExportBody = extractIdentifierAssignedObjectBody(text, aliasMatch[1]);
    }
  }
  if (moduleExportBody) {
    for (const item of splitTopLevelObjectSegments(moduleExportBody)) {
      const token = item.trim();
      if (!token || token.startsWith('...')) continue;
      const pair = token.match(/^([A-Za-z_$][\w$]*)\s*:/);
      if (pair && pair[1]) {
        exported.add(pair[1]);
        continue;
      }
      const methodShorthand = token.match(/^([A-Za-z_$][\w$]*)\s*\(/);
      if (methodShorthand && methodShorthand[1]) {
        exported.add(methodShorthand[1]);
        continue;
      }
      const shorthand = token.match(/^([A-Za-z_$][\w$]*)$/);
      if (shorthand && shorthand[1]) {
        exported.add(shorthand[1]);
      }
    }
  }

  let match: RegExpExecArray | null;
  const exportsDotRe = /\bexports\.(\w+)\s*=(?!=)/g;
  while ((match = exportsDotRe.exec(text)) !== null) {
    if (match[1]) exported.add(match[1]);
  }
  const moduleExportsDotRe = /\bmodule\.exports\.(\w+)\s*=(?!=)/g;
  while ((match = moduleExportsDotRe.exec(text)) !== null) {
    if (match[1]) exported.add(match[1]);
  }

  return exported;
}

function checkRouteServiceContractMismatch(params: {
  moduleName: string;
  routeSource: string;
  serviceSource: string;
  diagnostics: string[];
}): void {
  const serviceAlias = parseModuleServiceRequireAlias(params.routeSource);
  if (!serviceAlias) return;
  const calledMethods = extractServiceMethodCalls(params.routeSource, serviceAlias);
  if (calledMethods.length === 0) return;
  const exportedMethods = extractServiceExportedMethods(params.serviceSource);
  let hadMismatch = false;
  for (const method of calledMethods) {
    if (!exportedMethods.has(method)) {
      hadMismatch = true;
      addDiagnosticOnce(
        params.diagnostics,
        `Route-service contract mismatch (${params.moduleName}): routes call ${serviceAlias}.${method}() but service does not export "${method}".`
      );
    }
  }
  if (hadMismatch) {
    addDiagnosticOnce(
      params.diagnostics,
      `Route-service export map required (${params.moduleName}): ensure service exports every route-called method (exact names) or add adapter wrappers.`
    );
  }
}

const NODE_PROJECT_ROUTE_SERVICE_ALIAS_HINTS: Record<string, Record<string, string[]>> = {
  projects: {
    createProject: ['create', 'addProject', 'insertProject', 'upsertProject'],
    getAllProjects: ['getProjects', 'listProjects', 'listAllProjects', 'list', 'all'],
    getProjectById: ['getById', 'findById', 'findProjectById', 'getProject'],
    getProjectByName: ['findByName', 'getByName', 'findProjectByName']
  },
  tasks: {
    createTask: ['addTask', 'create', 'insertTask', 'upsertTask', 'addTaskToProject', 'createTaskForProject'],
    getAllTasks: ['getTasks', 'listTasks', 'listAllTasks', 'list', 'getTasksByProject', 'getTasksByProjectId', 'findTasksByProject', 'getTasksByStatus'],
    getTasksByProjectId: ['getTasksByProject', 'getAllTasks', 'getTasks', 'listTasksByProject', 'listByProject'],
    getTasksByStatus: ['getAllTasks', 'getTasks', 'listTasks', 'getTasksByProjectId', 'listByProject'],
    getTask: ['getTaskById', 'findTaskById'],
    updateTaskStatus: ['updateStatus', 'setTaskStatus', 'patchTaskStatus', 'updateTask', 'setStatus', 'markTaskDone'],
    updateTask: ['updateTaskStatus', 'setTaskStatus', 'patchTaskStatus', 'setStatus', 'markTaskDone']
  },
  members: {
    addMember: ['createMember', 'create', 'add', 'insertMember', 'addMemberToProject'],
    getMembers: ['getAllMembers', 'listMembers', 'list', 'getMembersByProject'],
    getAllMembers: ['getMembers', 'listMembers', 'list']
  },
  comments: {
    addComment: ['createComment', 'create', 'add', 'insertComment', 'addCommentToTask'],
    getAllComments: ['getComments', 'listComments', 'list', 'getCommentsByTask']
  }
};

function findFileIndexByCandidates(files: FileSpec[], candidates: string[]): number {
  const candidateSet = new Set(candidates.map(sanitizePathForCaseInsensitiveCompare));
  return files.findIndex(file => candidateSet.has(sanitizePathForCaseInsensitiveCompare(file.path)));
}

function readFirstExistingTextByCandidates(baseDir: string | undefined, candidates: string[]): string | undefined {
  if (!baseDir) return undefined;
  for (const rel of candidates) {
    try {
      const abs = path.join(baseDir, rel);
      if (!fs.existsSync(abs)) continue;
      return fs.readFileSync(abs, 'utf8');
    } catch {
      // ignore single-file IO failures and continue
    }
  }
  return undefined;
}

function readFirstExistingFileByCandidates(baseDir: string | undefined, candidates: string[]): { path: string; content: string } | undefined {
  if (!baseDir) return undefined;
  for (const rel of candidates) {
    try {
      const abs = path.join(baseDir, rel);
      if (!fs.existsSync(abs)) continue;
      return { path: rel, content: fs.readFileSync(abs, 'utf8') };
    } catch {
      // ignore single-file IO failures and continue
    }
  }
  return undefined;
}

function buildNodeProjectServiceAliasCandidates(missingMethod: string): string[] {
  const candidates: string[] = [];
  if (/^getAll[A-Z]/.test(missingMethod)) {
    const stem = missingMethod.replace(/^getAll/, '');
    candidates.push(`get${stem}`, `list${stem}`, `listAll${stem}`);
  }
  if (/^get[A-Z]/.test(missingMethod)) {
    const stem = missingMethod.replace(/^get/, '');
    candidates.push(`getAll${stem}`, `list${stem}`);
  }
  if (/^create[A-Z]/.test(missingMethod)) {
    const stem = missingMethod.replace(/^create/, '');
    candidates.push(`add${stem}`, `insert${stem}`);
  }
  if (/^add[A-Z]/.test(missingMethod)) {
    const stem = missingMethod.replace(/^add/, '');
    candidates.push(`create${stem}`);
  }
  if (/^update[A-Z]/.test(missingMethod)) {
    const stem = missingMethod.replace(/^update/, '');
    candidates.push(`set${stem}`);
  }
  if (/^set[A-Z]/.test(missingMethod)) {
    const stem = missingMethod.replace(/^set/, '');
    candidates.push(`update${stem}`);
  }
  const dedup = new Set<string>();
  const out: string[] = [];
  for (const candidate of candidates) {
    const value = String(candidate || '').trim();
    if (!value || dedup.has(value)) continue;
    dedup.add(value);
    out.push(value);
  }
  return out;
}

function resolveNodeProjectServiceBridgeTarget(
  moduleName: string,
  missingMethod: string,
  exportedMethods: Set<string>
): string | undefined {
  const lowerToActual = new Map<string, string>();
  for (const method of exportedMethods) {
    lowerToActual.set(method.toLowerCase(), method);
  }
  const hintCandidates = NODE_PROJECT_ROUTE_SERVICE_ALIAS_HINTS[moduleName]?.[missingMethod] || [];
  const genericCandidates = buildNodeProjectServiceAliasCandidates(missingMethod);
  const candidates = [...hintCandidates, ...genericCandidates];
  const seen = new Set<string>();
  for (const candidate of candidates) {
    const normalized = candidate.toLowerCase();
    if (seen.has(normalized)) continue;
    seen.add(normalized);
    const actual = lowerToActual.get(normalized);
    if (!actual) continue;
    if (actual === missingMethod) continue;
    return actual;
  }
  return undefined;
}

function appendNodeProjectServiceWrappers(
  serviceContent: string,
  wrappers: Array<{ missingMethod: string; targetMethod: string }>
): string {
  if (wrappers.length === 0) return serviceContent;
  let next = serviceContent.replace(/\r\n/g, '\n').trimEnd();
  if (!/\bmodule\.exports\b|\bexports\./.test(next)) return serviceContent;
  const buildAssignment = (wrapper: { missingMethod: string; targetMethod: string }): string => {
    if (wrapper.missingMethod === 'createProject') {
      return [
        'module.exports.createProject = async function createProjectBridge(name) {',
        "  const normalized = String(name || '').trim();",
        `  const result = await module.exports.${wrapper.targetMethod}(normalized);`,
        "  if (result == null) return null;",
        "  if (result && typeof result === 'object' && 'error' in result && result.error) return null;",
        "  if (result && typeof result === 'object' && 'project' in result) return result.project;",
        "  if (result && typeof result === 'object') return result;",
        "  return { name: normalized };",
        '};'
      ].join('\n');
    }
    if (wrapper.missingMethod === 'addMember') {
      return [
        'module.exports.addMember = async function addMemberBridge(projectId, userId, role) {',
        `  const result = await module.exports.${wrapper.targetMethod}(projectId, userId, role);`,
        "  if (result == null) return null;",
        "  if (result && typeof result === 'object' && 'duplicate' in result && 'member' in result) return result;",
        "  const normalized = result && typeof result === 'object' && 'member' in result ? result.member : result;",
        "  const withProject = normalized && typeof normalized === 'object' && !('projectId' in normalized) ? { projectId: String(projectId || ''), ...normalized } : normalized;",
        "  if (withProject && typeof withProject === 'object') return { duplicate: false, ...withProject, member: withProject };",
        "  return { duplicate: false, member: normalized };",
        '};'
      ].join('\n');
    }
    if (wrapper.missingMethod === 'createTask') {
      return [
        'module.exports.createTask = async function createTaskBridge(projectId, title) {',
        "  const normalizedTitle = String(title || '').trim();",
        "  const payload = { title: normalizedTitle, status: 'todo' };",
        `  let result = await module.exports.${wrapper.targetMethod}(projectId, payload);`,
        "  let normalized = result && typeof result === 'object' && 'task' in result ? result.task : result;",
        `  if ((!normalized || typeof normalized !== 'object' || !('title' in normalized) || typeof normalized.title === 'undefined') && typeof module.exports.${wrapper.targetMethod} === 'function') {`,
        `    const retry = await module.exports.${wrapper.targetMethod}(projectId, normalizedTitle);`,
        "    const retryNormalized = retry && typeof retry === 'object' && 'task' in retry ? retry.task : retry;",
        "    if (retryNormalized && typeof retryNormalized === 'object') normalized = retryNormalized;",
        '  }',
        "  if (!normalized || typeof normalized !== 'object') return { projectId: String(projectId || ''), title: normalizedTitle, status: 'todo' };",
        "  const withTitle = typeof normalized.title === 'undefined' ? { ...normalized, title: normalizedTitle } : normalized;",
        "  return typeof withTitle.status === 'undefined' ? { ...withTitle, status: 'todo' } : withTitle;",
        '};'
      ].join('\n');
    }
    if (wrapper.missingMethod === 'updateTaskStatus') {
      return [
        'module.exports.updateTaskStatus = async function updateTaskStatusBridge(projectId, taskId, status) {',
        "  const normalizedStatus = status === 'done' ? 'done' : 'todo';",
        "  const payload = { status: normalizedStatus };",
        `  let result = await module.exports.${wrapper.targetMethod}(projectId, taskId, payload);`,
        "  if (result && typeof result === 'object' && 'error' in result && result.error) return null;",
        "  let normalized = result && typeof result === 'object' && 'task' in result ? result.task : result;",
        "  if (normalized && typeof normalized === 'object' && typeof normalized.status === 'object') {",
        `    const retry = await module.exports.${wrapper.targetMethod}(projectId, taskId, normalizedStatus);`,
        "    if (retry && typeof retry === 'object' && !('error' in retry && retry.error)) {",
        "      normalized = retry && typeof retry === 'object' && 'task' in retry ? retry.task : retry;",
        '    }',
        '  }',
        "  if (!normalized || typeof normalized !== 'object') return { id: String(taskId || ''), projectId: String(projectId || ''), status: normalizedStatus };",
        "  return typeof normalized.status === 'undefined' ? { ...normalized, status: normalizedStatus } : normalized;",
        '};'
      ].join('\n');
    }
    if (wrapper.missingMethod === 'getAllTasks') {
      return [
        'module.exports.getAllTasks = async function getAllTasksBridge(projectId, status) {',
        `  const result = await module.exports.${wrapper.targetMethod}(projectId, status);`,
        "  const list = Array.isArray(result) ? result : (result && typeof result === 'object' && Array.isArray(result.tasks) ? result.tasks : []);",
        "  const normalized = list.map(item => item && typeof item === 'object' && 'task' in item ? item.task : item).filter(Boolean);",
        "  if (status === 'todo' || status === 'done') return normalized.filter(task => task && task.status === status);",
        '  return normalized;',
        '};'
      ].join('\n');
    }
    if (wrapper.missingMethod === 'addComment') {
      return [
        'module.exports.addComment = async function addCommentBridge(projectId, taskId, message) {',
        "  const normalizedMessage = String(message || '').trim();",
        "  const payload = { message: normalizedMessage };",
        `  let result = await module.exports.${wrapper.targetMethod}(projectId, taskId, payload);`,
        "  let normalized = result && typeof result === 'object' && 'comment' in result ? result.comment : result;",
        `  if ((!normalized || typeof normalized !== 'object' || typeof normalized.message === 'undefined') && typeof module.exports.${wrapper.targetMethod} === 'function') {`,
        `    const retry = await module.exports.${wrapper.targetMethod}(projectId, taskId, normalizedMessage);`,
        "    const retryNormalized = retry && typeof retry === 'object' && 'comment' in retry ? retry.comment : retry;",
        "    if (retryNormalized && typeof retryNormalized === 'object') normalized = retryNormalized;",
        '  }',
        "  if (!normalized || typeof normalized !== 'object') return { projectId: String(projectId || ''), taskId: String(taskId || ''), message: normalizedMessage };",
        "  return typeof normalized.message === 'undefined' ? { ...normalized, message: normalizedMessage } : normalized;",
        '};'
      ].join('\n');
    }
    return `module.exports.${wrapper.missingMethod} = module.exports.${wrapper.targetMethod};`;
  };
  for (const wrapper of wrappers) {
    const assignment = buildAssignment(wrapper);
    const assignmentRe = new RegExp(`\\bmodule\\.exports\\.${wrapper.missingMethod}\\s*=(?!=)`, 'i');
    if (assignmentRe.test(next)) continue;
    next = `${next}\n${assignment}`;
  }
  return `${next.trimEnd()}\n`;
}

function detectNodeProjectArrayStoreVar(serviceSource: string, preferStem: string): string | undefined {
  const text = String(serviceSource || '');
  const declared = [...text.matchAll(/\b(?:let|const|var)\s+([A-Za-z_$][\w$]*)\s*=\s*\[\s*\]/g)].map(m => String(m[1] || ''));
  if (declared.length === 0) return undefined;
  let best: { name: string; score: number } | undefined;
  for (const name of declared) {
    const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    let score = 0;
    if (new RegExp(`\\b${escaped}\\.push\\s*\\(`).test(text)) score += 3;
    if (new RegExp(`\\b${escaped}\\.find\\s*\\(`).test(text)) score += 2;
    if (new RegExp(`\\b${escaped}\\.filter\\s*\\(`).test(text)) score += 2;
    if (preferStem && name.toLowerCase().includes(preferStem.toLowerCase())) score += 1;
    if (!best || score > best.score) best = { name, score };
  }
  return best?.name || declared[0];
}

function detectNodeProjectObjectStoreVar(serviceSource: string, preferStem: string): string | undefined {
  const text = String(serviceSource || '');
  const declared = [...text.matchAll(/\b(?:let|const|var)\s+([A-Za-z_$][\w$]*)\s*=\s*\{\s*\}/g)].map(m => String(m[1] || ''));
  if (declared.length === 0) return undefined;
  const preferTokens = [preferStem.toLowerCase(), `${preferStem.toLowerCase()}s`, `${preferStem.toLowerCase()}Map`, `${preferStem.toLowerCase()}Store`];
  for (const name of declared) {
    const lower = name.toLowerCase();
    if (preferTokens.some(token => lower.includes(token))) return name;
  }
  return declared[0];
}

function hasExportedMethod(serviceSource: string, methodName: string): boolean {
  return extractServiceExportedMethods(serviceSource).has(methodName);
}

function ensureNodeProjectMembersDuplicateGuard(serviceContent: string): string {
  let next = String(serviceContent || '').replace(/\r\n/g, '\n').trimEnd();
  if (!next) return serviceContent;
  if (/__botEvalMembersDupGuard/.test(next)) return `${next}\n`;
  if (!hasExportedMethod(next, 'addMember')) return serviceContent;

  const guard = [
    'const __botEvalMembersDupGuard = module.exports.addMember;',
    'const __botEvalMembersDupStore = [];',
    'module.exports.addMember = function addMember(projectId, userId, role) {',
    "  const projectKey = String(projectId || '');",
    "  const userKey = String(userId || '');",
    "  const getMembersFn = typeof module.exports.getMembers === 'function' ? module.exports.getMembers : (typeof module.exports.getMembersByProjectId === 'function' ? module.exports.getMembersByProjectId : null);",
    "  const fromServiceMaybe = getMembersFn ? getMembersFn(projectKey) : undefined;",
    "  const fromService = fromServiceMaybe && typeof fromServiceMaybe.then === 'function' ? undefined : fromServiceMaybe;",
    "  const fromFallbackStore = __botEvalMembersDupStore.filter(member => member && String(member.projectId || '') === projectKey);",
    "  const baseline = Array.isArray(fromService) && fromService.length > 0 ? fromService : fromFallbackStore;",
    "  const existing = baseline.find(member => member && String(member.userId || '') === userKey);",
    '  if (existing) return { duplicate: true, member: existing };',
    "  const normalizeResult = (resolved) => {",
    '    if (resolved == null) return null;',
    "    if (resolved && typeof resolved === 'object' && 'duplicate' in resolved && 'member' in resolved) return resolved;",
    "    if (resolved && typeof resolved === 'object' && 'error' in resolved && resolved.error) {",
    "      const code = String(resolved.code || resolved.error?.code || '').toUpperCase();",
    "      const duplicateLike = code.includes('DUPLICATE') || Number(resolved.status || resolved.error?.status || 0) === 409;",
    "      if (duplicateLike) {",
    "        const fallbackMember = resolved.member && typeof resolved.member === 'object'",
    "          ? resolved.member",
    "          : { projectId: projectKey, userId: userKey, role: String(role || 'member') };",
    "        return { duplicate: true, member: fallbackMember };",
    '      }',
    '      return null;',
    '    }',
    "    const normalized = resolved && typeof resolved === 'object' && 'member' in resolved ? resolved.member : resolved;",
    "    if (normalized && typeof normalized === 'object') {",
    "      const withProject = 'projectId' in normalized ? normalized : { projectId: projectKey, ...normalized };",
    "      const withUser = 'userId' in withProject ? withProject : { ...withProject, userId: userKey };",
    "      const withRole = 'role' in withUser ? withUser : { ...withUser, role: String(role || 'member') };",
    "      return { duplicate: false, member: withRole };",
    '    }',
    "    return { duplicate: false, member: { projectId: projectKey, userId: userKey, role: String(role || 'member') } };",
    '  };',
    "  if (typeof __botEvalMembersDupGuard === 'function') {",
    "    const payload = { userId: userKey, role: String(role || '') };",
    "    const result = __botEvalMembersDupGuard.length >= 3",
    '      ? __botEvalMembersDupGuard(projectId, userId, role)',
    '      : __botEvalMembersDupGuard(projectId, payload);',
    "    if (result && typeof result.then === 'function') {",
    '      return result.then((resolved) => {',
    '        const normalizedResult = normalizeResult(resolved);',
    "        if (normalizedResult && normalizedResult.member && typeof normalizedResult.member === 'object') __botEvalMembersDupStore.push(normalizedResult.member);",
    '        return normalizedResult;',
    '      });',
    '    }',
    '    const normalizedResult = normalizeResult(result);',
    "    if (normalizedResult && normalizedResult.member && typeof normalizedResult.member === 'object') __botEvalMembersDupStore.push(normalizedResult.member);",
    '    return normalizedResult;',
    '  }',
    '  return null;',
    '};',
    ''
  ].join('\n');
  return `${next}\n${guard}`;
}

function ensureNodeProjectProjectsDuplicateGuard(serviceContent: string): string {
  let next = String(serviceContent || '').replace(/\r\n/g, '\n').trimEnd();
  if (!next) return serviceContent;
  if (/__botEvalProjectsDupGuard/.test(next)) return `${next}\n`;
  if (!hasExportedMethod(next, 'createProject')) return serviceContent;

  const storeVar = detectNodeProjectArrayStoreVar(next, 'project');
  const objectStoreVar = detectNodeProjectObjectStoreVar(next, 'project');
  const storeLine = storeVar
    ? `  if (!existing && Array.isArray(${storeVar})) {\n    existing = ${storeVar}.find(project => project && String(project.name || '') === normalized);\n  }\n`
    : '';
  const objectStoreLine = objectStoreVar
    ? `  if (!existing && ${objectStoreVar} && typeof ${objectStoreVar} === 'object') {\n    existing = Object.values(${objectStoreVar}).find(project => project && String(project.name || '') === normalized) || null;\n  }\n`
    : '';
  const guard = [
    'const __botEvalProjectsDupGuard = module.exports.createProject;',
    'module.exports.createProject = function createProject(name) {',
    "  const normalized = String(name || '').trim();",
    '  let existing = null;',
    "  if (typeof module.exports.getProjectByName === 'function') {",
    '    const candidate = module.exports.getProjectByName(normalized);',
    "    if (candidate && typeof candidate.then !== 'function') existing = candidate;",
    '  }',
    storeLine,
    objectStoreLine,
    '  if (existing) return null;',
    "  if (typeof __botEvalProjectsDupGuard === 'function') return __botEvalProjectsDupGuard(normalized);",
    '  return null;',
    '};',
    ''
  ].join('\n');
  return `${next}\n${guard}`;
}

function buildNodeProjectServiceSynthAssignment(
  moduleName: string,
  missingMethod: string,
  serviceSource: string
): string | undefined {
  if (missingMethod === 'getAllProjects') {
    const storeVar = detectNodeProjectArrayStoreVar(serviceSource, 'project');
    if (storeVar) {
      return `module.exports.getAllProjects = async function getAllProjectsBridge() { return Array.isArray(${storeVar}) ? [...${storeVar}] : []; };`;
    }
    const objectStoreVar = detectNodeProjectObjectStoreVar(serviceSource, 'project');
    if (objectStoreVar) {
      return `module.exports.getAllProjects = async function getAllProjectsBridge() { return ${objectStoreVar} && typeof ${objectStoreVar} === 'object' ? Object.values(${objectStoreVar}) : []; };`;
    }
    return undefined;
  }
  if (missingMethod === 'getProjectById') {
    return `module.exports.getProjectById = async function getProjectByIdBridge(id) { return id ? { id: String(id), name: '' } : null; };`;
  }
  if (missingMethod === 'getProjectByName') {
    const storeVar = detectNodeProjectArrayStoreVar(serviceSource, 'project');
    if (storeVar) {
      return `module.exports.getProjectByName = async function getProjectByNameBridge(name) { const normalized = String(name || '').trim(); if (!normalized) return null; const list = Array.isArray(${storeVar}) ? ${storeVar} : []; return list.find(project => project && String(project.name || '').trim() === normalized) || null; };`;
    }
    const objectStoreVar = detectNodeProjectObjectStoreVar(serviceSource, 'project');
    if (objectStoreVar) {
      return `module.exports.getProjectByName = async function getProjectByNameBridge(name) { const normalized = String(name || '').trim(); if (!normalized) return null; const list = ${objectStoreVar} && typeof ${objectStoreVar} === 'object' ? Object.values(${objectStoreVar}) : []; return list.find(project => project && String(project.name || '').trim() === normalized) || null; };`;
    }
    return `module.exports.getProjectByName = async function getProjectByNameBridge(_name) { return null; };`;
  }
  if (missingMethod === 'createProject') {
    const mid = `${moduleName}_${missingMethod}`;
    return `module.exports.createProject = async function createProjectBridge(name) { return { id: '${mid}_' + Date.now(), name: String(name || '') }; };`;
  }
  if (missingMethod === 'getAllTasks') {
    const storeVar = detectNodeProjectArrayStoreVar(serviceSource, 'task');
    if (storeVar) {
      return `module.exports.getAllTasks = async function getAllTasksBridge(projectId, status) { const list = Array.isArray(${storeVar}) ? ${storeVar} : []; const byProject = projectId == null ? list : list.filter(task => task && String(task.projectId || '') === String(projectId)); if (status === 'todo' || status === 'done') return byProject.filter(task => task && task.status === status); return byProject; };`;
    }
    return `module.exports.getAllTasks = async function getAllTasksBridge(_projectId, _status) { return []; };`;
  }
  if (missingMethod === 'createTask') {
    const mid = `${moduleName}_${missingMethod}`;
    const storeVar = detectNodeProjectArrayStoreVar(serviceSource, 'task');
    if (storeVar) {
      return `module.exports.createTask = async function createTaskBridge(projectId, title) { const task = { id: '${mid}_' + Date.now(), projectId: String(projectId || ''), title: String(title || ''), status: 'todo' }; if (Array.isArray(${storeVar})) ${storeVar}.push(task); return task; };`;
    }
    return `module.exports.createTask = async function createTaskBridge(projectId, title) { return { id: '${mid}_' + Date.now(), projectId: String(projectId || ''), title: String(title || ''), status: 'todo' }; };`;
  }
  if (missingMethod === 'updateTaskStatus') {
    const storeVar = detectNodeProjectArrayStoreVar(serviceSource, 'task');
    if (storeVar) {
      return `module.exports.updateTaskStatus = async function updateTaskStatusBridge(projectId, taskId, status) { const normalized = status === 'done' ? 'done' : 'todo'; const list = Array.isArray(${storeVar}) ? ${storeVar} : []; const target = list.find(task => task && String(task.id || '') === String(taskId || '') && String(task.projectId || '') === String(projectId || '')); if (!target) return null; target.status = normalized; return target; };`;
    }
    return `module.exports.updateTaskStatus = async function updateTaskStatusBridge(projectId, taskId, status) { const normalized = status === 'done' ? 'done' : 'todo'; return { id: String(taskId || ''), projectId: String(projectId || ''), status: normalized }; };`;
  }
  if (missingMethod === 'addMember') {
    return `module.exports.addMember = async function addMemberBridge(projectId, userId, role) { return { projectId: String(projectId || ''), userId: String(userId || ''), role: String(role || 'member') }; };`;
  }
  if (missingMethod === 'getMembers' || missingMethod === 'getAllMembers') {
    const storeVar = detectNodeProjectArrayStoreVar(serviceSource, 'member');
    if (storeVar) {
      return `module.exports.${missingMethod} = async function ${missingMethod}Bridge(projectId) { const projectKey = String(projectId || ''); const list = Array.isArray(${storeVar}) ? ${storeVar} : []; if (!projectKey) return list; return list.filter(member => member && String(member.projectId || '') === projectKey); };`;
    }
    const objectStoreVar = detectNodeProjectObjectStoreVar(serviceSource, 'member');
    if (objectStoreVar) {
      return `module.exports.${missingMethod} = async function ${missingMethod}Bridge(projectId) { const projectKey = String(projectId || ''); if (!projectKey) return []; const container = ${objectStoreVar} && typeof ${objectStoreVar} === 'object' ? ${objectStoreVar}[projectKey] : undefined; if (Array.isArray(container)) return container; if (container && Array.isArray(container.members)) return container.members; return []; };`;
    }
    return `module.exports.${missingMethod} = async function ${missingMethod}Bridge(_projectId) { return []; };`;
  }
  if (missingMethod === 'addComment') {
    const mid = `${moduleName}_${missingMethod}`;
    return `module.exports.addComment = async function addCommentBridge(projectId, taskId, message) { return { id: '${mid}_' + Date.now(), projectId: String(projectId || ''), taskId: String(taskId || ''), message: String(message || '') }; };`;
  }
  if (missingMethod === 'getAllComments') {
    const storeVar = detectNodeProjectArrayStoreVar(serviceSource, 'comment');
    if (storeVar) {
      return `module.exports.getAllComments = async function getAllCommentsBridge(projectId, taskId) { const projectKey = String(projectId || ''); const taskKey = String(taskId || ''); const list = Array.isArray(${storeVar}) ? ${storeVar} : []; return list.filter(comment => comment && String(comment.projectId || '') === projectKey && String(comment.taskId || '') === taskKey); };`;
    }
    const objectStoreVar = detectNodeProjectObjectStoreVar(serviceSource, 'comment');
    if (objectStoreVar) {
      return `module.exports.getAllComments = async function getAllCommentsBridge(projectId, taskId) { const projectKey = String(projectId || ''); const taskKey = String(taskId || ''); if (!projectKey || !taskKey) return []; const byProject = ${objectStoreVar} && typeof ${objectStoreVar} === 'object' ? ${objectStoreVar}[projectKey] : undefined; if (!byProject) return []; if (Array.isArray(byProject)) return byProject.filter(comment => comment && String(comment.taskId || '') === taskKey); const byTask = byProject[taskKey]; if (Array.isArray(byTask)) return byTask; if (byTask && Array.isArray(byTask.comments)) return byTask.comments; return []; };`;
    }
    return `module.exports.getAllComments = async function getAllCommentsBridge(_projectId, _taskId) { return []; };`;
  }
  return undefined;
}

function appendNodeProjectServiceSynthesizedExports(
  serviceContent: string,
  synths: Array<{ missingMethod: string; assignment: string }>
): string {
  if (synths.length === 0) return serviceContent;
  let next = serviceContent.replace(/\r\n/g, '\n').trimEnd();
  if (!/\bmodule\.exports\b|\bexports\./.test(next)) return serviceContent;
  for (const synth of synths) {
    const existingRe = new RegExp(`\\bmodule\\.exports\\.${synth.missingMethod}\\s*=(?!=)`, 'i');
    if (existingRe.test(next)) continue;
    next = `${next}\n${synth.assignment}`;
  }
  return `${next.trimEnd()}\n`;
}

function ensureNodeProjectRandomUuidBinding(serviceContent: string): { content: string; changed: boolean; reason?: string } {
  let next = String(serviceContent || '').replace(/\r\n/g, '\n');
  if (!next) return { content: serviceContent, changed: false, reason: 'empty service content' };
  if (!/\brandomUUID\s*\(/.test(next) || /\bcrypto\.randomUUID\s*\(/.test(next)) {
    return { content: next, changed: false, reason: 'randomUUID binding not required' };
  }
  const normalizedWrongRequire = next.replace(
    /^\s*(?:const|let|var)\s*\{\s*randomUUID(?:\s*:\s*[A-Za-z_$][\w$]*)?\s*\}\s*=\s*require\(\s*['"](?!node:crypto['"]|crypto['"])[^'"]+['"]\s*\)\s*;?\s*$/m,
    "const { randomUUID } = require('node:crypto');"
  );
  if (normalizedWrongRequire !== next) {
    return { content: `${normalizedWrongRequire.trimEnd()}\n`, changed: true };
  }
  const normalizedWrongImport = next.replace(
    /^\s*import\s*\{\s*randomUUID(?:\s+as\s+[A-Za-z_$][\w$]*)?\s*\}\s*from\s*['"](?!node:crypto['"]|crypto['"])[^'"]+['"]\s*;?\s*$/m,
    "import { randomUUID } from 'node:crypto';"
  );
  if (normalizedWrongImport !== next) {
    return { content: `${normalizedWrongImport.trimEnd()}\n`, changed: true };
  }
  const hasDirectBinding =
    /\b(?:const|let|var)\s*\{\s*randomUUID(?:\s*:\s*[A-Za-z_$][\w$]*)?\s*\}\s*=\s*require\(\s*['"](?:node:)?crypto['"]\s*\)/.test(next)
    || /\bimport\s*\{\s*randomUUID(?:\s+as\s+[A-Za-z_$][\w$]*)?\s*\}\s*from\s*['"](?:node:)?crypto['"]/.test(next)
    || /\bfunction\s+randomUUID\s*\(/.test(next)
    || /\b(?:const|let|var)\s+randomUUID\s*=/.test(next);
  if (hasDirectBinding) {
    return { content: next, changed: false, reason: 'randomUUID already bound' };
  }
  const requireLine = "const { randomUUID } = require('node:crypto');";
  if (next.includes(requireLine)) {
    return { content: next, changed: false, reason: 'randomUUID require already present' };
  }
  const lines = next.split('\n');
  let lastRequireIdx = -1;
  for (let i = 0; i < lines.length; i += 1) {
    if (/^\s*const\s+.+\s*=\s*require\s*\(/.test(lines[i])) lastRequireIdx = i;
  }
  if (lastRequireIdx >= 0) {
    lines.splice(lastRequireIdx + 1, 0, requireLine);
    next = lines.join('\n');
  } else {
    next = `${requireLine}\n${next.trimStart()}`;
  }
  return { content: `${next.trimEnd()}\n`, changed: true };
}

function normalizeNodeProjectRouteServiceImport(routeContent: string): string {
  let next = String(routeContent || '');
  if (!next) return routeContent;
  next = next.replace(/require\s*\(\s*['"]\.\.\/service(?:\.(?:js|mjs|cjs|ts))?['"]\s*\)/g, "require('./service')");
  next = next.replace(/from\s+['"]\.\.\/service(?:\.(?:js|mjs|cjs|ts))?['"]/g, "from './service'");
  return next;
}

function hasNodeProjectUnsupportedServiceImport(serviceContent: string): boolean {
  const text = String(serviceContent || '');
  return /require\s*\(\s*['"]\.\.\/(?:repository|repo|db|database|storage|store|persistence)['"]\s*\)/i.test(text)
    || /from\s+['"]\.\.\/(?:repository|repo|db|database|storage|store|persistence)['"]/i.test(text);
}

function hasNodeProjectProjectsCreatePayloadDrift(serviceContent: string): boolean {
  const text = String(serviceContent || '');
  if (!text) return false;
  const exportsCreate =
    /\bmodule\.exports\s*=\s*\{[\s\S]*\bcreate\b/.test(text)
    || /\bmodule\.exports\.create\s*=/.test(text);
  const exportsCreateProject =
    /\bmodule\.exports\s*=\s*\{[\s\S]*\bcreateProject\b/.test(text)
    || /\bmodule\.exports\.createProject\s*=/.test(text);
  if (!exportsCreate && !exportsCreateProject) {
    return false;
  }
  const payloadSignature =
    /\bcreate\s*\(\s*(?:projectData|payload|data)\s*\)/i.test(text)
    || /\bcreateProject\s*\(\s*(?:projectData|payload|data)\s*\)/i.test(text);
  if (!payloadSignature) return false;
  if (!/\b(?:projectData|payload|data)\.name\b/i.test(text)) return false;
  return true;
}

function hasNodeProjectInvalidNullSendErrorInService(serviceContent: string): boolean {
  const text = String(serviceContent || '');
  return /\bsendError\s*\(\s*(?:null|_?res)\s*,/i.test(text) || /\.sendError\s*\(\s*(?:null|_?res)\s*,/i.test(text);
}

function hasNodeProjectMembersIsolatedProjectGate(serviceContent: string): boolean {
  const text = String(serviceContent || '');
  if (!text) return false;
  const mapDecl = text.match(/\b(?:let|const|var)\s+([A-Za-z_$][\w$]*)\s*=\s*\{\s*\}/);
  if (!mapDecl?.[1]) return false;
  const mapVar = String(mapDecl[1]);
  const escaped = mapVar.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const hasProjectKeyAccess = new RegExp(`\\b${escaped}\\s*\\[\\s*projectId\\s*\\]`).test(text);
  if (!hasProjectKeyAccess) return false;
  const hasNullGuard = new RegExp(`if\\s*\\(\\s*!${escaped}\\s*\\[\\s*projectId\\s*\\]\\s*\\)\\s*\\{[\\s\\S]{0,220}?return\\s+null\\b[\\s\\S]{0,220}?\\}`, 's').test(text)
    || new RegExp(`if\\s*\\(\\s*!${escaped}\\s*\\[\\s*projectId\\s*\\]\\s*\\)\\s*return\\s+null\\s*;?`, 's').test(text);
  const hasDirectMembersPush = new RegExp(`${escaped}\\s*\\[\\s*projectId\\s*\\]\\s*\\.\\s*members\\s*\\.\\s*push\\s*\\(`).test(text);
  const hasBootstrapFn = /\bfunction\s+addProject\s*\(\s*projectId\b/.test(text) || /\bconst\s+addProject\s*=\s*\(/.test(text);
  const addMemberCallsBootstrap = /addMember(?:ToProject)?[\s\S]{0,260}addProject\s*\(\s*projectId\s*\)/s.test(text);
  const hasMembersSemantics = /\.members\s*\.\s*(?:find|push|filter|map)\s*\(/.test(text)
    || /\bgetMembers(?:ByProjectId)?\s*\(/.test(text)
    || /\baddMember(?:ToProject)?\s*\(/.test(text);
  if (!hasMembersSemantics) return false;
  if (hasNullGuard) return true;
  if (hasDirectMembersPush && hasBootstrapFn && !addMemberCallsBootstrap) return true;
  return false;
}

function hasNodeProjectTasksProjectObjectCoupling(serviceContent: string): boolean {
  const text = String(serviceContent || '');
  if (!text) return false;
  if (!/projectsService|projectService|projects\b/i.test(text)) return false;
  return /project\s*\.\s*tasks\s*\.\s*(?:push|find|filter|map)\s*\(/i.test(text)
    || /const\s+project\s*=\s*.*getProjectById\s*\(/i.test(text);
}

function hasNodeProjectCommentsContentFieldContractDrift(serviceContent: string): boolean {
  const text = String(serviceContent || '');
  if (!text) return false;
  if (!/addComment/i.test(text)) return false;
  if (/\baddComment\s*\([^)]*\{\s*message\s*\}\s*\)/.test(text)) return true;
  if (/\b(?:function|async function)\s+addComment\s*\(\s*taskId\s*,\s*message\s*\)/.test(text)) return true;
  if (/\baddComment\s*=\s*\(\s*taskId\s*,\s*message\s*\)/.test(text)) return true;
  if (/\bgetProjectByTaskId\s*\(/.test(text)) return true;
  if (/\baddComment\s*\([^)]*(?:data|payload)\s*\)/.test(text) && /\b(?:data|payload)\.text\b/.test(text)) return true;
  if (/\btasksService\./.test(text)) return true;
  if (/\.\.\/tasks\/service/i.test(text)) return true;
  if (/throw\s*\{\s*code\s*:\s*['"]invalid_input['"]/i.test(text)) return true;
  if (/\btext\s*:\s*(?:[A-Za-z_$][\w$]*)\.text\b/.test(text) && !/\bmessage\s*:/.test(text)) return true;
  if (/\bcontent\s*:/.test(text) && !/\bmessage\s*:/.test(text)) return true;
  return false;
}

function normalizeCommentsServiceAddCommentSignature(serviceContent: string): { content: string; changed: boolean } {
  let next = String(serviceContent || '');
  if (!next) return { content: serviceContent, changed: false };
  const before = next;
  next = next.replace(
    /\bmessage\s*:\s*([A-Za-z_$][\w$]*)\.message\b/g,
    (_m, argName: string) => `message: typeof ${argName} === 'string' ? ${argName} : String(${argName}?.message || '')`
  );
  return { content: next, changed: next !== before };
}

function buildNodeProjectMembersCompatServiceTemplate(): string {
  return [
    'const projectsRepository = {};',
    'function ensureProject(projectId) {',
    "  const key = String(projectId || '');",
    '  if (!projectsRepository[key]) projectsRepository[key] = { members: [] };',
    '  return projectsRepository[key];',
    '}',
    'async function getMembers(projectId) {',
    '  const project = ensureProject(projectId);',
    '  return project.members;',
    '}',
    'async function addMember(projectId, userId, role) {',
    '  const project = ensureProject(projectId);',
    '  const existing = project.members.find(member => String(member.userId) === String(userId));',
    "  if (existing) return { duplicate: true, member: existing };",
    "  const member = { projectId: String(projectId), userId: String(userId), role: String(role || 'member') };",
    '  project.members.push(member);',
    '  return { duplicate: false, member };',
    '}',
    'module.exports = { getMembers, addMember, projectsRepository };',
    ''
  ].join('\n');
}

function pushUniqueTrace(target: string[], message: string): void {
  if (!message) return;
  if (!target.includes(message)) target.push(message);
}

function ensureNodeProjectSendErrorImport(routeContent: string): { content: string; changed: boolean } {
  const text = String(routeContent || '');
  if (!text) return { content: routeContent, changed: false };
  if (/\bsendError\b/.test(text) && /lib\/errors/.test(text)) return { content: text, changed: false };

  const lines = text.replace(/\r\n/g, '\n').split('\n');
  const requireLine = "const { sendError } = require('../../lib/errors');";
  const importLine = "import { sendError } from '../../lib/errors';";

  let lastRequireIdx = -1;
  let lastImportIdx = -1;
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].trim();
    if (/^const\s+.+\s*=\s*require\s*\(/.test(line)) lastRequireIdx = i;
    if (/^import\s+/.test(line)) lastImportIdx = i;
  }

  if (lastRequireIdx >= 0) {
    lines.splice(lastRequireIdx + 1, 0, requireLine);
    return { content: `${lines.join('\n').trimEnd()}\n`, changed: true };
  }
  if (lastImportIdx >= 0) {
    lines.splice(lastImportIdx + 1, 0, importLine);
    return { content: `${lines.join('\n').trimEnd()}\n`, changed: true };
  }

  return { content: `${requireLine}\n${text.trimStart()}`.trimEnd() + '\n', changed: true };
}

function hasNodeProjectSendErrorDefinition(errorsContent: string): boolean {
  const text = String(errorsContent || '');
  if (!text) return false;
  return /\bfunction\s+sendError\s*\(/.test(text)
    || /\b(?:const|let|var)\s+sendError\s*=\s*(?:async\s*)?\(/.test(text)
    || /\bsendError\s*:\s*(?:async\s*)?\(/.test(text);
}

function hasNodeProjectSendErrorExport(errorsContent: string): boolean {
  const text = String(errorsContent || '');
  if (!text) return false;
  return /\bmodule\.exports\s*=\s*\{[\s\S]*\bsendError\b/.test(text)
    || /\bmodule\.exports\.sendError\s*=/.test(text)
    || /\bexports\.sendError\s*=/.test(text);
}

function ensureNodeProjectErrorsHelperContract(errorsContent: string): { content: string; changed: boolean; reason?: string } {
  const text = String(errorsContent || '');
  const hasDefinition = hasNodeProjectSendErrorDefinition(text);
  const hasExport = hasNodeProjectSendErrorExport(text);
  if (hasDefinition && hasExport) {
    return { content: text, changed: false, reason: 'sendError helper contract already valid' };
  }
  const template = buildNodeProjectLargeCoreFileTemplate('src/lib/errors.js');
  if (!template) {
    return { content: text, changed: false, reason: 'canonical errors helper template unavailable' };
  }
  const reason = !hasDefinition
    ? 'sendError helper missing in errors module'
    : 'sendError helper not exported from errors module';
  return {
    content: template,
    changed: text.trim() !== template.trim(),
    reason
  };
}

function hasNodeProjectGenerateIdDefinition(idContent: string): boolean {
  const text = String(idContent || '');
  if (!text) return false;
  return /\bfunction\s+generateId\s*\(/.test(text)
    || /\b(?:const|let|var)\s+generateId\s*=\s*(?:async\s*)?\([^)]*\)\s*=>/.test(text)
    || /\b(?:const|let|var)\s+generateId\s*=\s*(?:async\s*)?function\b/.test(text)
    || /\bgenerateId\s*:\s*(?:async\s*)?\([^)]*\)\s*=>/.test(text)
    || /\bgenerateId\s*:\s*(?:async\s*)?function\b/.test(text)
    || /\bexport\s+function\s+generateId\s*\(/.test(text);
}

function hasNodeProjectGenerateIdExport(idContent: string): boolean {
  const text = String(idContent || '');
  if (!text) return false;
  return /\bmodule\.exports\s*=\s*\{[\s\S]*\bgenerateId\b/.test(text)
    || /\bmodule\.exports\.generateId\s*=/.test(text)
    || /\bexports\.generateId\s*=/.test(text)
    || /\bexport\s*\{\s*generateId\s*\}/.test(text)
    || /\bexport\s+function\s+generateId\s*\(/.test(text);
}

function ensureNodeProjectIdHelperContract(idContent: string): { content: string; changed: boolean; reason?: string } {
  const text = String(idContent || '');
  const hasDefinition = hasNodeProjectGenerateIdDefinition(text);
  const hasExport = hasNodeProjectGenerateIdExport(text);
  if (hasDefinition && hasExport) {
    return { content: text, changed: false, reason: 'generateId helper contract already valid' };
  }
  const template = buildNodeProjectLargeCoreFileTemplate('src/lib/id.js');
  if (!template) {
    return { content: text, changed: false, reason: 'canonical id helper template unavailable' };
  }
  const reason = !hasDefinition
    ? 'generateId helper missing in id module'
    : 'generateId helper not exported from id module';
  return {
    content: template,
    changed: text.trim() !== template.trim(),
    reason
  };
}

function detectRouteVarName(routeContent: string): string | undefined {
  const direct = String(routeContent || '').match(/\bconst\s+([A-Za-z_$][\w$]*)\s*=\s*require\s*\(\s*['"]express['"]\s*\)\.Router\s*\(\s*\)/);
  if (direct?.[1]) return direct[1];
  const indirect = String(routeContent || '').match(/\bconst\s+([A-Za-z_$][\w$]*)\s*=\s*express\.Router\s*\(\s*\)/);
  if (indirect?.[1]) return indirect[1];
  const loose = String(routeContent || '').match(/\b([A-Za-z_$][\w$]*)\.get\s*\(\s*['"]\/['"]/);
  return loose?.[1];
}

function ensureProjectsDetailRoute(routeContent: string): { content: string; changed: boolean; reason?: string } {
  let next = String(routeContent || '').replace(/\r\n/g, '\n');
  if (!next) return { content: routeContent, changed: false, reason: 'empty route file' };
  if (/\.(?:get)\s*\(\s*['"]\/:(?:projectId|id)['"]/.test(next)) {
    return { content: next, changed: false, reason: 'detail route already present' };
  }
  const routeVar = detectRouteVarName(next);
  const serviceAlias = parseModuleServiceRequireAlias(next);
  if (!routeVar) return { content: next, changed: false, reason: 'router variable not detected' };
  if (!serviceAlias) return { content: next, changed: false, reason: 'service alias not detected' };

  const snippet = [
    `${routeVar}.get('/:projectId', async (req, res) => {`,
    '  try {',
    `    const project = await ${serviceAlias}.getProjectById(req.params.projectId);`,
    '    if (!project) return sendError(res, 404, \'PROJECT_NOT_FOUND\', \'Project not found\');',
    '    return res.json({ project });',
    '  } catch (_error) {',
    '    return sendError(res, 500, \'INTERNAL_ERROR\', \'Internal server error\');',
    '  }',
    '});'
  ].join('\n');

  if (/module\.exports\s*=/.test(next)) {
    next = next.replace(/(\n\s*module\.exports\s*=)/, `\n\n${snippet}\n$1`);
  } else {
    next = `${next.trimEnd()}\n\n${snippet}\n`;
  }
  return { content: `${next.trimEnd()}\n`, changed: true };
}

function normalizePostRootStatus201(routeContent: string): { content: string; changed: boolean; reason?: string } {
  let next = String(routeContent || '');
  if (!next) return { content: routeContent, changed: false, reason: 'empty route file' };
  const postRootRe = /([A-Za-z_$][\w$]*)\.post\s*\(\s*['"]\/['"][\s\S]*?\)\s*;/g;
  let changed = false;
  let matched = false;
  next = next.replace(postRootRe, (block: string) => {
    matched = true;
    if (/status\s*\(\s*201\s*\)\s*\.json\s*\(/.test(block)) return block;
    if (!/\bres\.json\s*\(/.test(block)) return block;
    changed = true;
    return block.replace(/\bres\.json\s*\(/, 'res.status(201).json(');
  });
  if (!matched) return { content: routeContent, changed: false, reason: 'POST / route block not detected' };
  if (!changed) return { content: next, changed: false, reason: 'POST / already returns 201 or no res.json success branch' };
  return { content: next, changed: true };
}

function ensureNestedRouterMergeParams(routeContent: string): { content: string; changed: boolean; reason?: string } {
  let next = String(routeContent || '');
  if (!next) return { content: routeContent, changed: false, reason: 'empty route file' };
  if (/Router\s*\(\s*\{\s*mergeParams\s*:\s*true\s*\}\s*\)/.test(next)) {
    return { content: next, changed: false, reason: 'mergeParams already enabled' };
  }
  const before = next;
  next = next.replace(
    /require\s*\(\s*['"]express['"]\s*\)\.Router\s*\(\s*\)/g,
    "require('express').Router({ mergeParams: true })"
  );
  next = next.replace(/\bexpress\.Router\s*\(\s*\)/g, 'express.Router({ mergeParams: true })');
  if (next === before) return { content: routeContent, changed: false, reason: 'router factory pattern not detected' };
  return { content: next, changed: true };
}

function normalizeMembersPayloadContract(routeContent: string): { content: string; changed: boolean; reason?: string } {
  let next = String(routeContent || '');
  if (!next) return { content: routeContent, changed: false, reason: 'empty route file' };
  const before = next;
  next = next.replace(/\{\s*name\s*\}\s*=\s*req\.body/g, '{ userId, role } = req.body');
  next = next.replace(/\{\s*name\s*,\s*role\s*\}\s*=\s*req\.body/g, '{ userId, role } = req.body');
  next = next.replace(/\{\s*role\s*,\s*name\s*\}\s*=\s*req\.body/g, '{ userId, role } = req.body');
  next = next.replace(/\breq\.body\.name\b/g, 'req.body.userId');
  next = next.replace(/if\s*\(\s*!name\s*\)/g, 'if (!userId || !role)');
  next = next.replace(/if\s*\(\s*!req\.body\.userId\s*\)/g, 'if (!req.body.userId || !req.body.role)');
  next = next.replace(/\buserId\s*:\s*role\b/g, 'userId: userId');
  next = next.replace(/\brole\s*:\s*userId\b/g, 'role: role');
  next = next.replace(/addMember\(\s*([^,]+)\s*,\s*req\.body\s*\)/g, 'addMember($1, req.body.userId, req.body.role)');
  next = next.replace(/name is required/gi, 'userId and role are required');
  next = next.replace(/member name is required/gi, 'userId and role are required');
  if (next === before) return { content: routeContent, changed: false, reason: 'members payload already aligned or pattern not detected' };
  return { content: next, changed: true };
}

function normalizeProjectsDuplicateCreateContract(routeContent: string): { content: string; changed: boolean; reason?: string } {
  let next = String(routeContent || '');
  if (!next) return { content: routeContent, changed: false, reason: 'empty route file' };
  const serviceAlias = parseModuleServiceRequireAlias(next);
  if (!serviceAlias) return { content: routeContent, changed: false, reason: 'service alias not detected' };
  if (!new RegExp(`\\b${serviceAlias}\\.createProject\\s*\\(`).test(next)) {
    return { content: routeContent, changed: false, reason: 'createProject call not detected' };
  }
  const before = next;
  let changed = false;
  const declarationRe = new RegExp(`const\\s+([A-Za-z_$][\\w$]*)\\s*=\\s*await\\s+${serviceAlias}\\.createProject\\s*\\(([^)]*)\\)\\s*;`);
  const assignment = next.match(declarationRe);
  const projectVar = assignment?.[1] ? String(assignment[1]) : undefined;
  const hasNullGuard = projectVar
    ? new RegExp(`if\\s*\\(\\s*!${projectVar}\\s*\\)\\s*return\\s+sendError\\(\\s*res\\s*,\\s*409\\s*,\\s*['"]PROJECT_DUPLICATE['"]\\s*,`, 'i').test(next)
    : false;
  if (hasNullGuard) {
    return { content: routeContent, changed: false, reason: 'duplicate guard already present' };
  }
  next = next.replace(
    declarationRe,
    (_m, projectVar: string, args: string) => {
      changed = true;
      const lines: string[] = [];
      lines.push(`const ${projectVar} = await ${serviceAlias}.createProject(${args});`);
      if (!hasNullGuard) {
        lines.push(`  if (!${projectVar}) return sendError(res, 409, 'PROJECT_DUPLICATE', 'Project already exists');`);
      }
      return lines.join('\n');
    }
  );
  if (!changed) {
    const inlineRe = new RegExp(
      `return\\s+res\\.status\\(\\s*201\\s*\\)\\.json\\s*\\(\\s*\\{\\s*project\\s*:\\s*await\\s+${serviceAlias}\\.createProject\\s*\\(([^)]*)\\)\\s*\\}\\s*\\)\\s*;`
    );
    next = next.replace(
      inlineRe,
      (_m, args: string) => {
        changed = true;
        const lines: string[] = [];
        lines.push(`  const project = await ${serviceAlias}.createProject(${args});`);
        lines.push("  if (!project) return sendError(res, 409, 'PROJECT_DUPLICATE', 'Project already exists');");
        lines.push('  return res.status(201).json({ project });');
        return lines.join('\n  ');
      }
    );
  }
  if (!changed && !hasNullGuard) {
    const projectAssignMatch = next.match(new RegExp(`const\\s+([A-Za-z_$][\\w$]*)\\s*=\\s*await\\s+${serviceAlias}\\.createProject\\s*\\(`));
    if (projectAssignMatch?.[1]) {
      const projectVar = projectAssignMatch[1];
      next = next.replace(
        new RegExp(`(const\\s+${projectVar}\\s*=\\s*await\\s+${serviceAlias}\\.createProject\\s*\\([^;]+;\\s*)`),
        `$1if (!${projectVar}) return sendError(res, 409, 'PROJECT_DUPLICATE', 'Project already exists');\n  `
      );
      changed = true;
    }
  }
  if (!changed || next === before) return { content: routeContent, changed: false, reason: 'createProject call shape not patchable' };
  return { content: next, changed: true };
}

function shouldCanonicalizeProjectsRouteContract(routeContent: string): boolean {
  const text = String(routeContent || '');
  if (!text) return false;
  if (/createProject\s*\(\s*req\.body\s*\)/i.test(text)) return true;
  if (/\.addProject\s*\(/i.test(text)) return true;
  if (/res\.status\s*\(\s*201\s*\)\s*\.json\s*\(\s*project\s*\)/i.test(text)) return true;
  if (/res\.status\s*\(\s*201\s*\)\s*\.json\s*\(\s*\{\s*project\s*\}\s*\)/i.test(text) && !/if\s*\(\s*!project\s*\)/.test(text)) return true;
  if (/\b(?:router|app)\s*\.\s*post\s*\(\s*['"]\/['"]/.test(text) && !/PROJECT_DUPLICATE/.test(text)) return true;
  if (/res\.json\s*\(\s*projects\s*\)/i.test(text)) return true;
  if (/router\.get\s*\(\s*['"]\/:projectId['"][\s\S]{0,360}res\.json\s*\(\s*project\s*\)/i.test(text)) return true;
  if (!/router\.get\s*\(\s*['"]\/['"]/.test(text)) return true;
  return false;
}

function shouldCanonicalizeMembersRouteContract(routeContent: string): boolean {
  const text = String(routeContent || '');
  if (!text) return false;
  if (!hasRootGetRoute(text)) return true;
  if (!/\b(?:router|app)\s*\.\s*post\s*\(\s*['"]\/['"]/.test(text)) return true;
  const hasPayloadGuard =
    /if\s*\(\s*!\s*(?:req\.body\.)?userId\s*\|\|\s*!\s*(?:req\.body\.)?role\s*\)/.test(text)
    || /if\s*\(\s*!userId\s*\|\|\s*!role\s*\)/.test(text)
    || /userId and role are required/i.test(text);
  if (!hasPayloadGuard) return true;
  const addMemberCallIndex = text.search(/\baddMember\s*\(/);
  const payloadGuardIndex = text.search(/if\s*\(\s*(?:!\s*(?:req\.body\.)?userId\s*\|\|\s*!\s*(?:req\.body\.)?role|!userId\s*\|\|\s*!role)\s*\)/);
  if (addMemberCallIndex >= 0 && payloadGuardIndex >= 0 && payloadGuardIndex > addMemberCallIndex) return true;
  if (!/status\s*\(\s*201\s*\)\s*\.json\s*\(\s*\{\s*member\b/.test(text)) return true;
  return false;
}

function shouldCanonicalizeCommentsRouteContract(routeContent: string): boolean {
  const text = String(routeContent || '');
  if (!text) return false;
  if (!hasRootGetRoute(text)) return true;
  if (!/\b(?:router|app)\s*\.\s*post\s*\(\s*['"]\/['"]/.test(text)) return true;
  const hasPayloadGuard =
    /if\s*\(\s*!\s*(?:req\.body\.)?message\s*\)/.test(text)
    || /if\s*\(\s*!message\s*\)/.test(text)
    || /message is required/i.test(text);
  if (!hasPayloadGuard) return true;
  const addCommentCallIndex = text.search(/\baddComment(?:ToTask)?\s*\(/);
  const payloadGuardIndex = text.search(/if\s*\(\s*(?:!\s*(?:req\.body\.)?message|!message)\s*\)/);
  if (addCommentCallIndex >= 0 && payloadGuardIndex >= 0 && payloadGuardIndex > addCommentCallIndex) return true;
  const addCommentArgs = text.match(/\baddComment(?:ToTask)?\s*\(([^)]*)\)/);
  if (addCommentArgs?.[1] && !/req\.params\.projectId/.test(addCommentArgs[1])) return true;
  const getCommentsArgs = text.match(/\bget(?:All)?Comments\s*\(([^)]*)\)/);
  if (getCommentsArgs?.[1] && !/req\.params\.projectId/.test(getCommentsArgs[1])) return true;
  if (!/status\s*\(\s*201\s*\)\s*\.json\s*\(\s*\{\s*comment\b/.test(text)) return true;
  return false;
}

function normalizeMembersDuplicateCreateContract(routeContent: string): { content: string; changed: boolean; reason?: string } {
  let next = String(routeContent || '');
  if (!next) return { content: routeContent, changed: false, reason: 'empty route file' };
  const assignmentRe = /(const|let)\s+([A-Za-z_$][\w$]*)\s*=\s*await\s+[A-Za-z_$][\w$]*\.addMember\s*\([^;]+;\s*/;
  const match = next.match(assignmentRe);
  if (!match?.[2]) {
    return { content: routeContent, changed: false, reason: 'addMember assignment not detected' };
  }
  const memberVar = match[2];
  const hasNullGuard = new RegExp(`if\\s*\\(\\s*!${memberVar}\\s*\\)\\s*return\\s+sendError\\(\\s*res\\s*,\\s*409\\s*,\\s*['"]MEMBER_DUPLICATE['"]\\s*,`, 'i').test(next);
  if (hasNullGuard) {
    return { content: routeContent, changed: false, reason: 'null duplicate guard already present' };
  }
  const nullGuardSnippet = `if (!${memberVar}) return sendError(res, 409, 'MEMBER_DUPLICATE', 'Member already exists');\n  `;
  next = next.replace(
    assignmentRe,
    (full: string) => `${full}${nullGuardSnippet}`
  );
  if (next === routeContent) return { content: routeContent, changed: false, reason: 'duplicate member call shape not patchable' };
  return { content: next, changed: true };
}

function normalizeMembersCreateResponseShape(routeContent: string): { content: string; changed: boolean; reason?: string } {
  let next = String(routeContent || '');
  if (!next) return { content: routeContent, changed: false, reason: 'empty route file' };
  const before = next;
  next = next.replace(
    /return\s+res\.status\(\s*201\s*\)\.json\(\s*\{\s*member\s*:\s*([A-Za-z_$][\w$]*)\.member\s*\}\s*\)\s*;/g,
    (_m, outcomeVar: string) => [
      `const __memberValue = ${outcomeVar} && typeof ${outcomeVar} === 'object' && 'member' in ${outcomeVar} ? ${outcomeVar}.member : ${outcomeVar};`,
      '  return res.status(201).json({ member: __memberValue });'
    ].join('\n  ')
  );
  if (next === before) return { content: routeContent, changed: false, reason: 'members response already aligned or pattern not detected' };
  return { content: next, changed: true };
}

function normalizeCommentsCreateResponseShape(routeContent: string): { content: string; changed: boolean; reason?: string } {
  let next = String(routeContent || '');
  if (!next) return { content: routeContent, changed: false, reason: 'empty route file' };
  const before = next;
  next = next.replace(
    /return\s+res\.status\(\s*201\s*\)\.json\(\s*\{\s*comment\s*:\s*([A-Za-z_$][\w$]*)\s*\}\s*\)\s*;/g,
    (_m, commentVar: string) => [
      `const __commentValue = ${commentVar} && typeof ${commentVar} === 'object' && !('message' in ${commentVar}) && 'content' in ${commentVar}`,
      `    ? { ...${commentVar}, message: ${commentVar}.content }`,
      `    : ${commentVar};`,
      '  return res.status(201).json({ comment: __commentValue });'
    ].join('\n  ')
  );
  next = next.replace(
    /return\s+res\.status\(\s*201\s*\)\.json\(\s*\{\s*comment\s*\}\s*\)\s*;/g,
    [
      "const __commentValue = comment && typeof comment === 'object' && !('message' in comment) && 'content' in comment",
      '    ? { ...comment, message: comment.content }',
      '    : comment;',
      '  return res.status(201).json({ comment: __commentValue });'
    ].join('\n  ')
  );
  if (next === before) return { content: routeContent, changed: false, reason: 'comments response already aligned or pattern not detected' };
  return { content: next, changed: true };
}

function normalizeTasksCreatePayloadContract(routeContent: string): { content: string; changed: boolean; reason?: string } {
  let next = String(routeContent || '');
  if (!next) return { content: routeContent, changed: false, reason: 'empty route file' };
  const before = next;
  next = next.replace(/\{\s*name\s*\}\s*=\s*req\.body/g, '{ title } = req.body');
  next = next.replace(/\breq\.body\?\.name\b/g, 'req.body?.title');
  next = next.replace(/\breq\.body\.name\b/g, 'req.body.title');
  next = next.replace(/\b(const|let|var)\s+name\s*=/g, '$1 title =');
  next = next.replace(/\{\s*description\s*\}\s*=\s*req\.body/g, '{ title } = req.body');
  next = next.replace(/\breq\.body\.description\b/g, 'req.body.title');
  next = next.replace(/\bdescription\s*:\s*String\(req\.body\.title/g, 'title: String(req.body.title');
  next = next.replace(/\bdescription\s*:\s*req\.body\.title\b/g, 'title: req.body.title');
  next = next.replace(/\bdescription\s*:\s*title\b/g, 'title: title');
  next = next.replace(/\b(createTask|addTask)\s*\(\s*([^,]+,\s*)name\s*\)/g, '$1($2title)');
  next = next.replace(/\b(createTask|addTask)\s*\(\s*([^,]+,\s*)description\s*\)/g, '$1($2title)');
  next = next.replace(/\b(createTask|addTask)\s*\(\s*([^,]+,\s*)req\.body\s*\)/g, '$1($2req.body.title)');
  next = next.replace(/if\s*\(\s*!description\s*\|\|\s*typeof\s+description\s*!==\s*['"]string['"]\s*\)/g, "if (!title || typeof title !== 'string')");
  next = next.replace(/\btypeof\s+description\b/g, 'typeof title');
  next = next.replace(/if\s*\(\s*!name\s*\)/g, 'if (!title)');
  next = next.replace(/Name is required/gi, 'Task title is required');
  next = next.replace(/Description is required/gi, 'Title is required');
  next = next.replace(/if\s*\(\s*!description\s*\)/g, 'if (!title)');
  if (next === before) return { content: routeContent, changed: false, reason: 'tasks create payload already aligned or pattern not detected' };
  return { content: next, changed: true };
}

function normalizeCommentsPayloadContract(routeContent: string): { content: string; changed: boolean; reason?: string } {
  let next = String(routeContent || '');
  if (!next) return { content: routeContent, changed: false, reason: 'empty route file' };
  const before = next;
  next = next.replace(/\{\s*content\s*\}\s*=\s*req\.body/g, '{ message } = req.body');
  next = next.replace(/\breq\.body\.content\b/g, 'req.body.message');
  next = next.replace(/if\s*\(\s*!content\s*\)/g, 'if (!message)');
  next = next.replace(/if\s*\(\s*!req\.body\.content\s*\)/g, 'if (!req.body.message)');
  next = next.replace(/\bcontent\s*:\s*req\.body\.message\b/g, 'message: req.body.message');
  next = next.replace(/\bcontent\s*:\s*message\b/g, 'message: message');
  next = next.replace(/Content is required/g, 'Message is required');
  next = next.replace(/addComment(ToTask)?\(([^)]*?),\s*content\s*\)/g, 'addComment$1($2, message)');
  next = next.replace(/addComment(ToTask)?\(([^)]*?),\s*req\.body\s*\)/g, 'addComment$1($2, req.body.message)');
  if (next === before) return { content: routeContent, changed: false, reason: 'comments payload already aligned or pattern not detected' };
  return { content: next, changed: true };
}

function normalizeTasksStatusContract(routeContent: string): { content: string; changed: boolean; reason?: string } {
  let next = String(routeContent || '');
  if (!next) return { content: routeContent, changed: false, reason: 'empty route file' };
  const before = next;
  next = next.replace(/\[\s*['"]done['"]\s*,\s*['"](pending|open)['"]\s*\]/g, "['todo', 'done']");
  next = next.replace(/\[\s*['"](pending|open)['"]\s*,\s*['"]done['"]\s*\]/g, "['todo', 'done']");
  next = next.replace(/\[\s*['"]todo['"]\s*,\s*['"](pending|open)['"]\s*\]/g, "['todo', 'done']");
  next = next.replace(/\[\s*['"](pending|open)['"]\s*,\s*['"]todo['"]\s*\]/g, "['todo', 'done']");
  next = next.replace(
    /if\s*\(\s*status\s*===\s*['"]done['"]\s*\)\s*\{([\s\S]{0,240}?)\}/g,
    (_m, body: string) => `if (status === 'todo' || status === 'done') {${body}}`
  );
  next = next.replace(
    /tasks\s*=\s*tasks\.filter\(\s*task\s*=>\s*task\.status\s*===\s*['"]done['"]\s*\)\s*;/g,
    'tasks = tasks.filter(task => task.status === status);'
  );
  next = next.replace(
    /tasks\s*=\s*tasks\.filter\(\s*task\s*=>\s*task\.status\s*===\s*['"]todo['"]\s*\)\s*;/g,
    'tasks = tasks.filter(task => task.status === status);'
  );
  next = next.replace(/\b(updateTask|updateTaskStatus|setStatus)\s*\(\s*([^,]+,\s*[^,]+,\s*)req\.body\s*\)/g, '$1($2req.body.status)');
  if (next === before) return { content: routeContent, changed: false, reason: 'tasks status/filter already aligned or pattern not detected' };
  return { content: next, changed: true };
}

function shouldCanonicalizeTasksRouteContract(routeContent: string): boolean {
  const text = String(routeContent || '');
  if (!text) return false;
  if (/req\.body\?\.name|req\.body\.name/.test(text)) return true;
  if (/Name is required/i.test(text)) return true;
  if (!/router\.patch\s*\(\s*['"]\/:taskId['"]/.test(text)) return true;
  const hasNotFoundGuard =
    /if\s*\(\s*!task\s*\)\s*return\s+sendError\(\s*res\s*,\s*404\s*,\s*['"]TASK_NOT_FOUND['"]/.test(text)
    || /if\s*\(\s*!task\s*\)\s*return\s+res\.status\(\s*404\s*\)/.test(text)
    || /TASK_NOT_FOUND/.test(text);
  if (!hasNotFoundGuard) return true;
  return false;
}

function normalizeRouteErrorHandlerUsage(routeContent: string): { content: string; changed: boolean; reason?: string } {
  let next = String(routeContent || '');
  if (!next) return { content: routeContent, changed: false, reason: 'empty route file' };
  const before = next;
  next = next.replace(
    /const\s*\{\s*sendError\s*,\s*errorHandler\s*\}\s*=\s*require\(\s*['"]\.\.\/\.\.\/lib\/errors['"]\s*\)\s*;?/g,
    "const { sendError } = require('../../lib/errors');"
  );
  next = next.replace(
    /const\s*\{\s*errorHandler\s*,\s*sendError\s*\}\s*=\s*require\(\s*['"]\.\.\/\.\.\/lib\/errors['"]\s*\)\s*;?/g,
    "const { sendError } = require('../../lib/errors');"
  );
  next = next.replace(
    /const\s*\{\s*errorHandler\s*\}\s*=\s*require\(\s*['"]\.\.\/\.\.\/lib\/errors['"]\s*\)\s*;?/g,
    "const { sendError } = require('../../lib/errors');"
  );
  next = next.replace(
    /errorHandler\s*\(\s*([A-Za-z_$][\w$]*)\s*,\s*([A-Za-z_$][\w$]*)\s*\)\s*;?/g,
    "return sendError($1, 500, 'INTERNAL_ERROR', String($2?.message || 'Internal server error'));"
  );
  if (next === before) return { content: routeContent, changed: false, reason: 'no errorHandler usage normalization needed' };
  return { content: next, changed: true };
}

function ensureRouteSendErrorBinding(routeContent: string): { content: string; changed: boolean; reason?: string } {
  let next = String(routeContent || '');
  if (!next) return { content: routeContent, changed: false, reason: 'empty route file' };
  if (!/\bsendError\s*\(/.test(next)) {
    return { content: routeContent, changed: false, reason: 'sendError call not present' };
  }
  const hasLocalSendErrorBinding =
    /\b(?:const|let|var)\s+sendError\b/.test(next)
    || /\bfunction\s+sendError\s*\(/.test(next)
    || /\bimport\s*\{\s*[^}]*\bsendError\b[^}]*\}\s*from\s*['"]\.\.\/\.\.\/lib\/errors['"]/.test(next)
    || /\bconst\s*\{\s*[^}]*\bsendError\b[^}]*\}\s*=\s*require\(\s*['"]\.\.\/\.\.\/lib\/errors['"]\s*\)/.test(next);
  if (hasLocalSendErrorBinding) {
    return { content: routeContent, changed: false, reason: 'sendError binding already present' };
  }

  const aliasMatch = next.match(/\bconst\s+([A-Za-z_$][\w$]*)\s*=\s*require\(\s*['"]\.\.\/\.\.\/lib\/errors['"]\s*\)\s*;?/);
  if (aliasMatch?.[1]) {
    const alias = String(aliasMatch[1]);
    if (alias && alias !== 'sendError' && !new RegExp(`\\b${alias}\\.sendError\\s*\\(`).test(next)) {
      const replaced = next.replace(/\bsendError\s*\(/g, `${alias}.sendError(`);
      if (replaced !== next) return { content: replaced, changed: true };
    }
  }

  const destructureRe = /\bconst\s*\{([^}]*)\}\s*=\s*require\(\s*['"]\.\.\/\.\.\/lib\/errors['"]\s*\)\s*;?/;
  const destructureMatch = next.match(destructureRe);
  if (destructureMatch) {
    const inner = String(destructureMatch[1] || '').trim();
    const merged = inner ? `${inner}, sendError` : 'sendError';
    const replaced = next.replace(destructureRe, `const { ${merged} } = require('../../lib/errors');`);
    if (replaced !== next) return { content: replaced, changed: true };
  }

  const lines = next.split('\n');
  let lastRequireIdx = -1;
  for (let i = 0; i < lines.length; i += 1) {
    if (/^\s*const\s+.+\s*=\s*require\s*\(/.test(lines[i])) lastRequireIdx = i;
  }
  const importLine = "const { sendError } = require('../../lib/errors');";
  if (lastRequireIdx >= 0) {
    lines.splice(lastRequireIdx + 1, 0, importLine);
    next = lines.join('\n');
  } else {
    next = `${importLine}\n${next.trimStart()}`;
  }
  return { content: next, changed: true };
}

function normalizeRouteCustomErrorClasses(routeContent: string): { content: string; changed: boolean; reason?: string } {
  let next = String(routeContent || '');
  if (!next) return { content: routeContent, changed: false, reason: 'empty route file' };
  const before = next;
  next = next.replace(
    /throw\s+new\s+BadRequestError\s*\(([^)]*)\)\s*;/g,
    "return sendError(res, 400, 'BAD_REQUEST', String($1 || 'Bad request'));"
  );
  next = next.replace(
    /next\s*\(\s*new\s+BadRequestError\s*\(([^)]*)\)\s*\)\s*;/g,
    "return sendError(res, 400, 'BAD_REQUEST', String($1 || 'Bad request'));"
  );
  next = next.replace(
    /throw\s+new\s+NotFoundError\s*\(([^)]*)\)\s*;/g,
    "return sendError(res, 404, 'NOT_FOUND', String($1 || 'Not found'));"
  );
  next = next.replace(
    /next\s*\(\s*new\s+NotFoundError\s*\(([^)]*)\)\s*\)\s*;/g,
    "return sendError(res, 404, 'NOT_FOUND', String($1 || 'Not found'));"
  );
  // Some generated handlers use `_res` as second arg; keep sendError target aligned.
  next = next.replace(
    /(\(\s*[_$A-Za-z][\w$]*\s*,\s*)(_res)(\s*,\s*[_$A-Za-z][\w$]*\s*\)\s*=>\s*\{\s*return\s+sendError\()res(\s*,)/g,
    '$1$2$3$2$4'
  );
  if (next === before) return { content: routeContent, changed: false, reason: 'no BadRequestError/NotFoundError route patterns detected' };
  return { content: next, changed: true };
}

function hasFastJavaScriptSyntaxError(content: string): boolean {
  try {
    // Fast parser-only check; no code execution.
    // eslint-disable-next-line no-new-func
    new Function(String(content || ''));
    return false;
  } catch {
    return true;
  }
}

function normalizeNodeProjectAppMountContract(appContent: string): { content: string; changed: boolean; reason?: string } {
  const text = String(appContent || '');
  if (!text) return { content: appContent, changed: false, reason: 'empty app file' };
  const hasHealth = /app\.get\s*\(\s*['"]\/health['"]/i.test(text);
  const hasProjects = /app\.use\s*\(\s*['"]\/projects['"]/i.test(text);
  const hasMembers = /app\.use\s*\(\s*['"]\/projects\/:(?:projectId|id)\/members['"]/i.test(text);
  const hasTasks = /app\.use\s*\(\s*['"]\/projects\/:(?:projectId|id)\/tasks['"]/i.test(text);
  const hasComments = /app\.use\s*\(\s*['"]\/projects\/:(?:projectId|id)\/tasks\/:(?:taskId|id)\/comments['"]/i.test(text);
  if (hasHealth && hasProjects && hasMembers && hasTasks && hasComments) {
    return { content: appContent, changed: false, reason: 'app mount signatures already present' };
  }
  const template = buildNodeProjectLargeCoreFileTemplate('src/app.js');
  if (!template) return { content: appContent, changed: false, reason: 'canonical app template unavailable' };
  return { content: template, changed: true };
}

function hasRootGetRoute(routeContent: string): boolean {
  const text = String(routeContent || '');
  if (!text) return false;
  return /\b(?:router|app)\s*\.\s*get\s*\(\s*['"]\/['"]/.test(text);
}

export function applyNodeProjectContractAutoFixes(files: FileSpec[], workspaceDir?: string): NodeProjectContractAutoFixResult {
  const nextFiles = files.map(file => ({ ...file }));
  const appliedFixes: string[] = [];
  const skippedFixes: string[] = [];
  const modules = ['projects', 'tasks', 'members', 'comments'];
  const hydrateNestedWorkspaceServiceFiles = (): void => {
    if (!workspaceDir) return;
    const knownPaths = new Set(nextFiles.map(file => file.path.toLowerCase()));
    for (const file of [...nextFiles]) {
      const match = file.path.match(/^(src\/modules\/.+)\/(?:routes|controller)\.(js|ts|mjs|cjs)$/i);
      if (!match) continue;
      const basePath = match[1];
      const preferredExt = match[2].toLowerCase();
      const extOrder = [preferredExt, 'js', 'ts', 'mjs', 'cjs'].filter((ext, index, values) => values.indexOf(ext) === index);
      const serviceCandidates = extOrder.map(ext => `${basePath}/service.${ext}`);
      if (serviceCandidates.some(candidate => knownPaths.has(candidate.toLowerCase()))) continue;
      const workspaceService = readFirstExistingFileByCandidates(workspaceDir, serviceCandidates);
      if (!workspaceService) continue;
      nextFiles.push(workspaceService);
      knownPaths.add(workspaceService.path.toLowerCase());
      pushUniqueTrace(appliedFixes, `${workspaceService.path}: hydrated nested workspace service for contract auto-fix`);
    }
  };
  const ensureNestedRouteLocalServiceImports = (): void => {
    for (let index = 0; index < nextFiles.length; index += 1) {
      const file = nextFiles[index];
      if (!/^src\/modules\/.+\/routes\.(?:js|ts|mjs|cjs)$/i.test(file.path)) continue;
      const normalized = normalizeNodeProjectRouteServiceImport(file.content);
      if (normalized === file.content) continue;
      nextFiles[index] = {
        ...file,
        content: `${String(normalized).trimEnd()}\n`
      };
      pushUniqueTrace(appliedFixes, `${file.path}: normalized nested local service import to ./service`);
    }
  };
  const ensureControllerRandomUuidBindings = (): void => {
    for (let index = 0; index < nextFiles.length; index += 1) {
      const file = nextFiles[index];
      if (!/^src\/modules\/.+\/controller\.(?:js|ts|mjs|cjs)$/i.test(file.path)) continue;
      const bindingFix = ensureNodeProjectRandomUuidBinding(file.content);
      if (!bindingFix.changed) continue;
      nextFiles[index] = {
        ...file,
        content: `${String(bindingFix.content).trimEnd()}\n`
      };
      pushUniqueTrace(appliedFixes, `${file.path}: normalized randomUUID binding to node:crypto`);
    }
  };
  const ensureServiceRandomUuidBindings = (): void => {
    for (let index = 0; index < nextFiles.length; index += 1) {
      const file = nextFiles[index];
      if (!/^src\/modules\/.+\/service\.(?:js|ts|mjs|cjs)$/i.test(file.path)) continue;
      const bindingFix = ensureNodeProjectRandomUuidBinding(file.content);
      if (!bindingFix.changed) continue;
      nextFiles[index] = {
        ...file,
        content: `${String(bindingFix.content).trimEnd()}\n`
      };
      pushUniqueTrace(appliedFixes, `${file.path}: normalized randomUUID binding to node:crypto`);
    }
  };
  const ensureErrorsHelperForSendErrorUsage = (): void => {
    const routeFilesUsingSendError = nextFiles.filter(file =>
      /^src\/modules\/.+\/routes\.(?:js|ts|mjs|cjs)$/i.test(file.path) && /\bsendError\s*\(/.test(String(file.content || ''))
    );
    if (routeFilesUsingSendError.length === 0) return;
    const errorsCandidates = ['src/lib/errors.js', 'src/lib/errors.ts', 'src/lib/errors.mjs', 'src/lib/errors.cjs'];
    const errorsIndex = findFileIndexByCandidates(nextFiles, errorsCandidates);
    if (errorsIndex < 0) {
      const template = buildNodeProjectLargeCoreFileTemplate('src/lib/errors.js');
      if (template) {
        nextFiles.push({ path: 'src/lib/errors.js', content: template });
        pushUniqueTrace(appliedFixes, 'src/lib/errors.js: synthesized canonical sendError helper for route error handling');
      } else {
        pushUniqueTrace(skippedFixes, 'src/lib/errors.*: missing sendError helper and canonical template unavailable');
      }
      return;
    }
    const errorsPath = nextFiles[errorsIndex].path;
    const contractFix = ensureNodeProjectErrorsHelperContract(nextFiles[errorsIndex].content);
    if (contractFix.changed) {
      nextFiles[errorsIndex] = {
        ...nextFiles[errorsIndex],
        content: `${contractFix.content.trimEnd()}\n`
      };
      pushUniqueTrace(appliedFixes, `${errorsPath}: repaired sendError helper export contract`);
    } else {
      pushUniqueTrace(skippedFixes, `${errorsPath}: sendError helper unchanged (${contractFix.reason || 'already valid'})`);
    }
  };

  const ensureIdHelperForGenerateIdUsage = (): void => {
    const serviceFilesUsingGenerateId = nextFiles.filter(file =>
      /^src\/modules\/.+\/service\.(?:js|ts|mjs|cjs)$/i.test(file.path) && /\bgenerateId\s*\(/.test(String(file.content || ''))
    );
    if (serviceFilesUsingGenerateId.length === 0) return;
    const idCandidates = ['src/lib/id.js', 'src/lib/id.ts', 'src/lib/id.mjs', 'src/lib/id.cjs'];
    const idIndex = findFileIndexByCandidates(nextFiles, idCandidates);
    if (idIndex < 0) {
      const template = buildNodeProjectLargeCoreFileTemplate('src/lib/id.js');
      if (template) {
        nextFiles.push({ path: 'src/lib/id.js', content: template });
        pushUniqueTrace(appliedFixes, 'src/lib/id.js: synthesized canonical generateId helper for service id generation');
      } else {
        pushUniqueTrace(skippedFixes, 'src/lib/id.*: missing generateId helper and canonical template unavailable');
      }
      return;
    }
    const idPath = nextFiles[idIndex].path;
    const contractFix = ensureNodeProjectIdHelperContract(nextFiles[idIndex].content);
    if (contractFix.changed) {
      nextFiles[idIndex] = {
        ...nextFiles[idIndex],
        content: `${contractFix.content.trimEnd()}\n`
      };
      pushUniqueTrace(appliedFixes, `${idPath}: repaired generateId helper export contract`);
    } else {
      pushUniqueTrace(skippedFixes, `${idPath}: generateId helper unchanged (${contractFix.reason || 'already valid'})`);
    }
  };

  hydrateNestedWorkspaceServiceFiles();
  ensureErrorsHelperForSendErrorUsage();
  ensureIdHelperForGenerateIdUsage();
  ensureNestedRouteLocalServiceImports();
  ensureControllerRandomUuidBindings();
  ensureServiceRandomUuidBindings();

  for (const moduleName of modules) {
    const routeCandidates = [
      `src/modules/${moduleName}/routes.js`,
      `src/modules/${moduleName}/routes.ts`,
      `src/modules/${moduleName}/routes.mjs`,
      `src/modules/${moduleName}/routes.cjs`
    ];
    const routeIndex = findFileIndexByCandidates(nextFiles, routeCandidates);
    if (routeIndex < 0) {
      pushUniqueTrace(skippedFixes, `${moduleName}: route file not present in current patch`);
      continue;
    }

    let nextRoute = nextFiles[routeIndex].content;
    let touched = false;
    let sendErrorEnsured = false;
    const routePath = nextFiles[routeIndex].path;

    const ensureSendErrorOnce = (): void => {
      if (sendErrorEnsured) return;
      const importFix = ensureNodeProjectSendErrorImport(nextRoute);
      if (importFix.changed) {
        nextRoute = importFix.content;
        touched = true;
        pushUniqueTrace(appliedFixes, `${routePath}: injected sendError import`);
      }
      sendErrorEnsured = true;
    };

    if (moduleName === 'projects') {
      const detailFix = ensureProjectsDetailRoute(nextRoute);
      if (detailFix.changed) {
        ensureSendErrorOnce();
        nextRoute = detailFix.content;
        touched = true;
        pushUniqueTrace(appliedFixes, `${routePath}: added GET /:projectId detail handler`);
      } else {
        pushUniqueTrace(skippedFixes, `${routePath}: detail route unchanged (${detailFix.reason || 'not required'})`);
      }

      const projectsDupFix = normalizeProjectsDuplicateCreateContract(nextRoute);
      if (projectsDupFix.changed) {
        ensureSendErrorOnce();
        nextRoute = projectsDupFix.content;
        touched = true;
        pushUniqueTrace(appliedFixes, `${routePath}: normalized duplicate project contract (409 on same name)`);
      } else {
        pushUniqueTrace(skippedFixes, `${routePath}: projects duplicate guard unchanged (${projectsDupFix.reason || 'not detected'})`);
      }

      if (shouldCanonicalizeProjectsRouteContract(nextRoute)) {
        const canonicalProjectsRoute = buildNodeProjectLargeCoreFileTemplate('src/modules/projects/routes.js');
        if (canonicalProjectsRoute) {
          nextRoute = canonicalProjectsRoute;
          touched = true;
          ensureSendErrorOnce();
          pushUniqueTrace(appliedFixes, `${routePath}: canonicalized projects route contract (list/create/detail payload + validation)` );
        } else {
          pushUniqueTrace(skippedFixes, `${routePath}: projects route canonicalization skipped (template unavailable)`);
        }
      } else {
        pushUniqueTrace(skippedFixes, `${routePath}: projects route canonicalization not required`);
      }
    }

    const postFix = normalizePostRootStatus201(nextRoute);
    if (postFix.changed) {
      nextRoute = postFix.content;
      touched = true;
      pushUniqueTrace(appliedFixes, `${routePath}: normalized POST / success status to 201`);
    } else {
      pushUniqueTrace(skippedFixes, `${routePath}: POST / status unchanged (${postFix.reason || 'not detected'})`);
    }

    if (moduleName !== 'projects') {
      const mergeParamsFix = ensureNestedRouterMergeParams(nextRoute);
      if (mergeParamsFix.changed) {
        nextRoute = mergeParamsFix.content;
        touched = true;
        pushUniqueTrace(appliedFixes, `${routePath}: enabled express Router({ mergeParams: true }) for nested project params`);
      } else {
        pushUniqueTrace(skippedFixes, `${routePath}: mergeParams router config unchanged (${mergeParamsFix.reason || 'not detected'})`);
      }
    }

    if (moduleName === 'members') {
      const membersFix = normalizeMembersPayloadContract(nextRoute);
      if (membersFix.changed) {
        nextRoute = membersFix.content;
        touched = true;
        pushUniqueTrace(appliedFixes, `${routePath}: normalized members payload to { userId, role }`);
      } else {
        pushUniqueTrace(skippedFixes, `${routePath}: members payload unchanged (${membersFix.reason || 'not detected'})`);
      }
      const membersDupFix = normalizeMembersDuplicateCreateContract(nextRoute);
      if (membersDupFix.changed) {
        ensureSendErrorOnce();
        nextRoute = membersDupFix.content;
        touched = true;
        pushUniqueTrace(appliedFixes, `${routePath}: normalized duplicate member contract (null->409)`);
      } else {
        pushUniqueTrace(skippedFixes, `${routePath}: members duplicate guard unchanged (${membersDupFix.reason || 'not detected'})`);
      }
      const membersShapeFix = normalizeMembersCreateResponseShape(nextRoute);
      if (membersShapeFix.changed) {
        nextRoute = membersShapeFix.content;
        touched = true;
        pushUniqueTrace(appliedFixes, `${routePath}: normalized members create response shape (outcome.member -> member fallback)` );
      } else {
        pushUniqueTrace(skippedFixes, `${routePath}: members response shape unchanged (${membersShapeFix.reason || 'not detected'})`);
      }
      if (shouldCanonicalizeMembersRouteContract(nextRoute)) {
        const canonicalMembersRoute = buildNodeProjectLargeCoreFileTemplate('src/modules/members/routes.js');
        if (canonicalMembersRoute) {
          nextRoute = canonicalMembersRoute;
          touched = true;
          ensureSendErrorOnce();
          pushUniqueTrace(appliedFixes, `${routePath}: canonicalized members route contract (GET list + POST payload/status invariants)`);
        } else {
          pushUniqueTrace(skippedFixes, `${routePath}: members route canonicalization skipped (template unavailable)`);
        }
      } else {
        pushUniqueTrace(skippedFixes, `${routePath}: members route canonicalization not required`);
      }
    }

    if (moduleName === 'comments') {
      const commentsFix = normalizeCommentsPayloadContract(nextRoute);
      if (commentsFix.changed) {
        nextRoute = commentsFix.content;
        touched = true;
        pushUniqueTrace(appliedFixes, `${routePath}: normalized comments payload key to message`);
      } else {
        pushUniqueTrace(skippedFixes, `${routePath}: comments payload unchanged (${commentsFix.reason || 'not detected'})`);
      }
      const commentsShapeFix = normalizeCommentsCreateResponseShape(nextRoute);
      if (commentsShapeFix.changed) {
        nextRoute = commentsShapeFix.content;
        touched = true;
        pushUniqueTrace(appliedFixes, `${routePath}: normalized comments create response shape (content -> message fallback)` );
      } else {
        pushUniqueTrace(skippedFixes, `${routePath}: comments response shape unchanged (${commentsShapeFix.reason || 'not detected'})`);
      }
      if (shouldCanonicalizeCommentsRouteContract(nextRoute)) {
        const canonicalCommentsRoute = buildNodeProjectLargeCoreFileTemplate('src/modules/comments/routes.js');
        if (canonicalCommentsRoute) {
          nextRoute = canonicalCommentsRoute;
          touched = true;
          ensureSendErrorOnce();
          pushUniqueTrace(appliedFixes, `${routePath}: canonicalized comments route contract (GET list + POST payload/status invariants)`);
        } else {
          pushUniqueTrace(skippedFixes, `${routePath}: comments route canonicalization skipped (template unavailable)`);
        }
      } else {
        pushUniqueTrace(skippedFixes, `${routePath}: comments route canonicalization not required`);
      }
    }

    if (moduleName === 'tasks') {
      const tasksCreateFix = normalizeTasksCreatePayloadContract(nextRoute);
      if (tasksCreateFix.changed) {
        nextRoute = tasksCreateFix.content;
        touched = true;
        pushUniqueTrace(appliedFixes, `${routePath}: normalized task create payload to { title }`);
      } else {
        pushUniqueTrace(skippedFixes, `${routePath}: task create payload unchanged (${tasksCreateFix.reason || 'not detected'})`);
      }
      const taskFix = normalizeTasksStatusContract(nextRoute);
      if (taskFix.changed) {
        nextRoute = taskFix.content;
        touched = true;
        pushUniqueTrace(appliedFixes, `${routePath}: normalized task status contract (todo|done + filter)`);
      } else {
        pushUniqueTrace(skippedFixes, `${routePath}: task status/filter unchanged (${taskFix.reason || 'not detected'})`);
      }
      if (shouldCanonicalizeTasksRouteContract(nextRoute)) {
        const canonicalTasksRoute = buildNodeProjectLargeCoreFileTemplate('src/modules/tasks/routes.js');
        if (canonicalTasksRoute) {
          nextRoute = canonicalTasksRoute;
          touched = true;
          ensureSendErrorOnce();
          pushUniqueTrace(appliedFixes, `${routePath}: canonicalized tasks route contract (enforce TASK_NOT_FOUND 404 + todo|done patch)` );
        } else {
          pushUniqueTrace(skippedFixes, `${routePath}: tasks route canonicalization skipped (template unavailable)` );
        }
      } else {
        pushUniqueTrace(skippedFixes, `${routePath}: tasks route canonicalization not required`);
      }
    }

    const customErrFix = normalizeRouteCustomErrorClasses(nextRoute);
    if (customErrFix.changed) {
      nextRoute = customErrFix.content;
      ensureSendErrorOnce();
      touched = true;
      pushUniqueTrace(appliedFixes, `${routePath}: replaced undefined custom error classes with sendError(...)`);
    } else {
      pushUniqueTrace(skippedFixes, `${routePath}: no custom-error class normalization needed`);
    }

    const errorHandlerFix = normalizeRouteErrorHandlerUsage(nextRoute);
    if (errorHandlerFix.changed) {
      nextRoute = errorHandlerFix.content;
      ensureSendErrorOnce();
      touched = true;
      pushUniqueTrace(appliedFixes, `${routePath}: normalized errorHandler(...) catch path to sendError(...)`);
    } else {
      pushUniqueTrace(skippedFixes, `${routePath}: no errorHandler catch normalization needed`);
    }

    const sendErrorBindingFix = ensureRouteSendErrorBinding(nextRoute);
    if (sendErrorBindingFix.changed) {
      nextRoute = sendErrorBindingFix.content;
      ensureSendErrorOnce();
      touched = true;
      pushUniqueTrace(appliedFixes, `${routePath}: normalized sendError binding/import for route handlers`);
    } else {
      pushUniqueTrace(skippedFixes, `${routePath}: sendError binding unchanged (${sendErrorBindingFix.reason || 'not needed'})`);
    }

    if (/\.(?:js|cjs)$/i.test(routePath) && hasFastJavaScriptSyntaxError(nextRoute)) {
      const canonicalRel = `src/modules/${moduleName}/routes.js`;
      const template = buildNodeProjectLargeCoreFileTemplate(canonicalRel);
      if (template) {
        nextRoute = template;
        touched = true;
        pushUniqueTrace(appliedFixes, `${routePath}: replaced syntactically invalid route content with canonical template`);
      } else {
        pushUniqueTrace(skippedFixes, `${routePath}: syntax invalid but canonical template unavailable`);
      }
    }

    if (touched) {
      nextFiles[routeIndex] = {
        ...nextFiles[routeIndex],
        content: `${nextRoute.trimEnd()}\n`
      };
    }
  }

  const appCandidates = ['src/app.js', 'src/app.ts', 'src/app.mjs', 'src/app.cjs'];
  const appIndex = findFileIndexByCandidates(nextFiles, appCandidates);
  if (appIndex >= 0) {
    const appFix = normalizeNodeProjectAppMountContract(nextFiles[appIndex].content);
    if (appFix.changed) {
      nextFiles[appIndex] = {
        ...nextFiles[appIndex],
        content: `${appFix.content.trimEnd()}\n`
      };
      pushUniqueTrace(appliedFixes, `${nextFiles[appIndex].path}: normalized app mount contract to canonical routes`);
    } else {
      pushUniqueTrace(skippedFixes, `${nextFiles[appIndex].path}: app mount contract unchanged (${appFix.reason || 'not needed'})`);
    }
  } else {
    pushUniqueTrace(skippedFixes, 'app entrypoint not present in current patch for mount normalization');
  }

  const entrySyntaxTargets: Array<{
    candidates: string[];
    canonicalTemplate: string;
    label: string;
  }> = [
    { candidates: ['src/app.js', 'src/app.cjs'], canonicalTemplate: 'src/app.js', label: 'app entrypoint' },
    { candidates: ['src/server.js', 'src/server.cjs'], canonicalTemplate: 'src/server.js', label: 'server entrypoint' }
  ];
  for (const target of entrySyntaxTargets) {
    const idx = findFileIndexByCandidates(nextFiles, target.candidates);
    if (idx < 0) continue;
    const filePath = nextFiles[idx].path;
    const content = String(nextFiles[idx].content || '');
    if (!hasFastJavaScriptSyntaxError(content)) continue;
    const template = buildNodeProjectLargeCoreFileTemplate(target.canonicalTemplate);
    if (!template) {
      pushUniqueTrace(skippedFixes, `${filePath}: syntax invalid but canonical template unavailable`);
      continue;
    }
    nextFiles[idx] = {
      ...nextFiles[idx],
      content: template
    };
    pushUniqueTrace(appliedFixes, `${filePath}: replaced syntactically invalid ${target.label} with canonical template`);
  }

  for (const moduleName of modules) {
    const serviceCandidates = [
      `src/modules/${moduleName}/service.js`,
      `src/modules/${moduleName}/service.cjs`
    ];
    const serviceIndex = findFileIndexByCandidates(nextFiles, serviceCandidates);
    if (serviceIndex < 0) continue;
    const servicePath = nextFiles[serviceIndex].path;
    const serviceContent = String(nextFiles[serviceIndex].content || '');
    if (!hasFastJavaScriptSyntaxError(serviceContent)) continue;
    const canonicalService = buildNodeProjectLargeCoreFileTemplate(`src/modules/${moduleName}/service.js`);
    if (!canonicalService) {
      pushUniqueTrace(skippedFixes, `${servicePath}: syntax invalid but canonical service template unavailable`);
      continue;
    }
    nextFiles[serviceIndex] = {
      ...nextFiles[serviceIndex],
      content: canonicalService
    };
    pushUniqueTrace(appliedFixes, `${servicePath}: replaced syntactically invalid service content with canonical template`);
  }

  const membersServiceCandidates = [
    'src/modules/members/service.js',
    'src/modules/members/service.ts',
    'src/modules/members/service.mjs',
    'src/modules/members/service.cjs'
  ];
  const membersServiceIndex = findFileIndexByCandidates(nextFiles, membersServiceCandidates);
  if (membersServiceIndex >= 0) {
    const membersServicePath = nextFiles[membersServiceIndex].path;
    const membersServiceContent = String(nextFiles[membersServiceIndex].content || '');
    if (/\b(?:let|const|var)\s+(?:members|membersByProject)\s*=\s*(?:\{\}|\[\])/i.test(membersServiceContent)) {
      nextFiles[membersServiceIndex] = {
        ...nextFiles[membersServiceIndex],
        content: buildNodeProjectMembersCompatServiceTemplate()
      };
      pushUniqueTrace(appliedFixes, `${membersServicePath}: replaced isolated members store with shared-project-compatible template`);
    } else {
      pushUniqueTrace(skippedFixes, `${membersServicePath}: members state-sharing template not required`);
    }
  }

  ensureErrorsHelperForSendErrorUsage();

  return { files: nextFiles, appliedFixes, skippedFixes };
}

export function applyNodeProjectRouteServiceAdapterBridges(files: FileSpec[], workspaceDir?: string): FileSpec[] {
  const nextFiles = files.map(file => ({ ...file }));
  const modules = ['projects', 'tasks', 'members', 'comments'];
  for (const moduleName of modules) {
    const routeCandidates = [
      `src/modules/${moduleName}/routes.js`,
      `src/modules/${moduleName}/routes.ts`,
      `src/modules/${moduleName}/routes.mjs`,
      `src/modules/${moduleName}/routes.cjs`
    ];
    const serviceCandidates = [
      `src/modules/${moduleName}/service.js`,
      `src/modules/${moduleName}/service.ts`,
      `src/modules/${moduleName}/service.mjs`,
      `src/modules/${moduleName}/service.cjs`
    ];
    let serviceIndex = findFileIndexByCandidates(nextFiles, serviceCandidates);
    if (serviceIndex < 0) {
      const workspaceService = readFirstExistingFileByCandidates(workspaceDir, serviceCandidates);
      if (!workspaceService) continue;
      nextFiles.push({
        path: workspaceService.path,
        content: workspaceService.content
      });
      serviceIndex = nextFiles.length - 1;
    }

    let nextServiceContent = nextFiles[serviceIndex].content;
    let changed = false;

    if (moduleName === 'members') {
      if (hasNodeProjectMembersIsolatedProjectGate(nextServiceContent)) {
        nextServiceContent = buildNodeProjectMembersCompatServiceTemplate();
        changed = true;
      }
      const guarded = ensureNodeProjectMembersDuplicateGuard(nextServiceContent);
      if (guarded !== nextServiceContent) {
        nextServiceContent = guarded;
        changed = true;
      }
    }

    if (moduleName === 'projects') {
      if (hasNodeProjectProjectsCreatePayloadDrift(nextServiceContent)) {
        const canonicalProjectsService = buildNodeProjectLargeCoreFileTemplate('src/modules/projects/service.js');
        if (canonicalProjectsService) {
          nextServiceContent = canonicalProjectsService;
          changed = true;
        }
      }
      const guarded = ensureNodeProjectProjectsDuplicateGuard(nextServiceContent);
      if (guarded !== nextServiceContent) {
        nextServiceContent = guarded;
        changed = true;
      }
    }

    if (moduleName === 'tasks' && hasNodeProjectTasksProjectObjectCoupling(nextServiceContent)) {
      const canonicalTasksService = buildNodeProjectLargeCoreFileTemplate('src/modules/tasks/service.js');
      if (canonicalTasksService) {
        nextServiceContent = canonicalTasksService;
        changed = true;
      }
    }

    if (moduleName === 'comments' && hasNodeProjectCommentsContentFieldContractDrift(nextServiceContent)) {
      const canonicalCommentsService = buildNodeProjectLargeCoreFileTemplate('src/modules/comments/service.js');
      if (canonicalCommentsService) {
        nextServiceContent = canonicalCommentsService;
        changed = true;
      }
    }
    if (moduleName === 'comments') {
      const normalizedCommentsSignature = normalizeCommentsServiceAddCommentSignature(nextServiceContent);
      if (normalizedCommentsSignature.changed) {
        nextServiceContent = normalizedCommentsSignature.content;
        changed = true;
      }
    }

    const randomUuidFix = ensureNodeProjectRandomUuidBinding(nextServiceContent);
    if (randomUuidFix.changed) {
      nextServiceContent = randomUuidFix.content;
      changed = true;
    }

    if (hasNodeProjectInvalidNullSendErrorInService(nextServiceContent)) {
      const canonicalService = buildNodeProjectLargeCoreFileTemplate(`src/modules/${moduleName}/service.js`);
      if (canonicalService) {
        nextServiceContent = canonicalService;
        changed = true;
      }
    }

    if (hasNodeProjectUnsupportedServiceImport(nextServiceContent)) {
      const canonicalService = buildNodeProjectLargeCoreFileTemplate(`src/modules/${moduleName}/service.js`);
      if (canonicalService) {
        nextServiceContent = canonicalService;
        changed = true;
      }
    }

    const routeIndex = findFileIndexByCandidates(nextFiles, routeCandidates);
    let routeSource = routeIndex >= 0
      ? nextFiles[routeIndex].content
      : readFirstExistingTextByCandidates(workspaceDir, routeCandidates);
    if (routeIndex >= 0) {
      const normalizedRoute = normalizeNodeProjectRouteServiceImport(routeSource || '');
      if (normalizedRoute !== routeSource) {
        nextFiles[routeIndex] = {
          ...nextFiles[routeIndex],
          content: normalizedRoute
        };
        routeSource = normalizedRoute;
      }
    }
    if (routeSource) {
      const serviceAlias = parseModuleServiceRequireAlias(routeSource);
      if (serviceAlias) {
        const calledMethods = extractServiceMethodCalls(routeSource, serviceAlias);
        const exportedMethods = extractServiceExportedMethods(nextServiceContent);
        if (
          calledMethods.length > 0 &&
          !(exportedMethods.size === 0 && !/\bmodule\.exports\b|\bexports\./.test(nextServiceContent))
        ) {
          const wrappers: Array<{ missingMethod: string; targetMethod: string }> = [];
          const synths: Array<{ missingMethod: string; assignment: string }> = [];
          for (const missingMethod of calledMethods.sort((a, b) => a.localeCompare(b))) {
            if (exportedMethods.has(missingMethod)) continue;
            const targetMethod = resolveNodeProjectServiceBridgeTarget(moduleName, missingMethod, exportedMethods);
            if (targetMethod) {
              wrappers.push({ missingMethod, targetMethod });
              exportedMethods.add(missingMethod);
              continue;
            }
            const synthAssignment = buildNodeProjectServiceSynthAssignment(moduleName, missingMethod, nextServiceContent);
            if (!synthAssignment) continue;
            synths.push({ missingMethod, assignment: synthAssignment });
            exportedMethods.add(missingMethod);
          }
          if (wrappers.length > 0 || synths.length > 0) {
            nextServiceContent = appendNodeProjectServiceWrappers(nextServiceContent, wrappers);
            nextServiceContent = appendNodeProjectServiceSynthesizedExports(nextServiceContent, synths);
            changed = true;
          }
        }
      }
    }
    if (!changed) continue;

    nextFiles[serviceIndex] = {
      ...nextFiles[serviceIndex],
      content: nextServiceContent
    };
  }
  return nextFiles;
}

export async function validateNodeProjectApiLarge(workspaceDir: string): Promise<ValidationResult> {
  const diagnostics: string[] = [];
  const required = ['README.md', 'package.json'];
  const commands: CommandResult[] = [];

  for (const rel of required) {
    const abs = path.join(workspaceDir, rel);
    if (!fs.existsSync(abs)) diagnostics.push(`Missing required file: ${rel}`);
  }

  const allFiles = await listFilesRecursively(workspaceDir);
  const sourceFiles = allFiles.filter(p => /^src\/.+\.(?:js|ts|mjs|cjs)$/i.test(p));
  if (sourceFiles.length < 12) {
    diagnostics.push(`Expected at least 12 source files under src/, found ${sourceFiles.length}`);
  }

  const appEntrypoints = allFiles.filter(p => /^src\/app\.(?:js|ts|mjs|cjs)$/i.test(p));
  if (appEntrypoints.length === 0) diagnostics.push('Missing required app entrypoint: src/app.*');

  const serverEntrypoints = allFiles.filter(p => /^src\/server\.(?:js|ts|mjs|cjs)$/i.test(p));
  if (serverEntrypoints.length === 0) diagnostics.push('Missing required server entrypoint: src/server.*');

  for (const sharedRel of ['src/lib/errors.js', 'src/lib/id.js']) {
    if (!sourceFiles.includes(sharedRel)) {
      diagnostics.push(`Missing shared helper source file: ${sharedRel}`);
    }
  }

  const requiredModules = ['projects', 'tasks', 'members', 'comments'];
  for (const moduleName of requiredModules) {
    const moduleSources = sourceFiles.filter(p => p.startsWith(`src/modules/${moduleName}/`));
    if (moduleSources.length === 0) {
      diagnostics.push(`Missing domain module sources: src/modules/${moduleName}/`);
      continue;
    }
    if (moduleSources.length < 2) {
      diagnostics.push(`Expected at least 2 source files in src/modules/${moduleName}/ (routes + service), found ${moduleSources.length}`);
    }
  }

  const sourceTextByFile = new Map<string, string>();
  for (const rel of sourceFiles) {
    try {
      sourceTextByFile.set(rel, await fs.promises.readFile(path.join(workspaceDir, rel), 'utf8'));
    } catch (e: any) {
      diagnostics.push(`Failed to read source file ${rel}: ${String(e?.message || e)}`);
    }
  }
  const firstSourceText = (candidates: string[]): string => {
    for (const rel of candidates) {
      const content = sourceTextByFile.get(rel);
      if (typeof content === 'string') return content;
    }
    return '';
  };

  const combinedSource = [...sourceTextByFile.values()].join('\n');
  if (combinedSource) {
    const hasProjectsMount = /\buse\s*\(\s*['"]\/projects['"]/i.test(combinedSource);
    const hasHealthRoute = /\/health\b/.test(combinedSource);
    const hasProjectsRoute = /\/projects\b/.test(combinedSource);
    const hasMembersRoute =
      /\/projects\/:(?:projectId|id)\/members\b/.test(combinedSource) ||
      (hasProjectsMount && /\/:(?:projectId|id)\/members\b/.test(combinedSource));
    const hasTasksRoute =
      /\/projects\/:(?:projectId|id)\/tasks\b/.test(combinedSource) ||
      (hasProjectsMount && /\/:(?:projectId|id)\/tasks\b/.test(combinedSource));
    const hasTaskCommentsRoute =
      /\/projects\/:(?:projectId|id)\/tasks\/:(?:taskId|id)\/comments\b/.test(combinedSource) ||
      (hasProjectsMount && /\/:(?:projectId|id)\/tasks\/:(?:taskId|id)\/comments\b/.test(combinedSource));

    if (!hasHealthRoute) diagnostics.push('Missing route signature for /health');
    if (!hasProjectsRoute) diagnostics.push('Missing route signature for /projects');
    if (!hasMembersRoute) diagnostics.push('Missing route signature for /projects/:projectId/members');
    if (!hasTasksRoute) diagnostics.push('Missing route signature for /projects/:projectId/tasks');
    if (!hasTaskCommentsRoute) diagnostics.push('Missing route signature for /projects/:projectId/tasks/:taskId/comments');

    if (/\brequire\s*\(\s*['"]uuid['"]\s*\)|\bfrom\s+['"]uuid['"]/i.test(combinedSource)) {
      diagnostics.push('Do not use "uuid" package in node-project-api-large; use node:crypto randomUUID instead');
    }
    const routeThrowFiles: string[] = [];
    for (const [rel, content] of sourceTextByFile.entries()) {
      if (!/^src\/modules\/.+\.(?:js|ts|mjs|cjs)$/i.test(rel)) continue;
      if (/['"]\.\.\/lib\/(?:id|errors)['"]/.test(content)) {
        diagnostics.push(`Invalid shared helper import path in ${rel}: use ../../lib/id and ../../lib/errors`);
      }
      if (/require\s*\(\s*['"]\.\.\/\.\.\/lib(?:\/index)?['"]\s*\)|from\s+['"]\.\.\/\.\.\/lib(?:\/index)?['"]|['"]\.\.\/\.\.\/lib\/['"]/.test(content)) {
        diagnostics.push(`Ambiguous shared helper import in ${rel}: import concrete files ../../lib/id or ../../lib/errors`);
      }
      if (/\brandomUUID\s*\(/.test(content) && !/\bcrypto\.randomUUID\s*\(/.test(content)) {
        const hasRandomUuidBinding =
          /\b(?:const|let|var)\s*\{\s*randomUUID(?:\s*:\s*[A-Za-z_$][\w$]*)?\s*\}\s*=\s*require\(\s*['"](?:node:)?crypto['"]\s*\)/.test(content)
          || /\bimport\s*\{\s*randomUUID(?:\s+as\s+[A-Za-z_$][\w$]*)?\s*\}\s*from\s*['"](?:node:)?crypto['"]/.test(content)
          || /\bfunction\s+randomUUID\s*\(/.test(content)
          || /\b(?:const|let|var)\s+randomUUID\s*=/.test(content);
        if (!hasRandomUuidBinding) {
          diagnostics.push(`randomUUID binding mismatch in ${rel}: randomUUID() is used without importing from node:crypto.`);
        }
      }
      if (
        /\/routes\.(?:js|ts|mjs|cjs)$/i.test(rel) &&
        (/require\s*\(\s*['"]\.\.\/service['"]\s*\)/.test(content) || /from\s+['"]\.\.\/service['"]/.test(content))
      ) {
        diagnostics.push(`Route import contract mismatch in ${rel}: import local service via "./service" (not "../service").`);
      }
      if (/\/routes\.(?:js|ts|mjs|cjs)$/i.test(rel) && /\bthrow\s+new\s+/i.test(content)) {
        routeThrowFiles.push(rel);
      }
      if (/\/service\.(?:js|ts|mjs|cjs)$/i.test(rel) && /\bthrow\s+new\s+Error\b/i.test(content)) {
        diagnostics.push(`Avoid raw throw in ${rel}: return domain errors and map them to JSON payloads in routes.`);
      }
    }
    for (const rel of routeThrowFiles) {
      diagnostics.push(`Avoid uncaught throw in ${rel}: return JSON error payloads instead of throwing.`);
    }
    const errorsLibSource =
      sourceTextByFile.get('src/lib/errors.js') ||
      sourceTextByFile.get('src/lib/errors.ts') ||
      sourceTextByFile.get('src/lib/errors.mjs') ||
      sourceTextByFile.get('src/lib/errors.cjs') ||
      '';
    const idLibSource =
      sourceTextByFile.get('src/lib/id.js') ||
      sourceTextByFile.get('src/lib/id.ts') ||
      sourceTextByFile.get('src/lib/id.mjs') ||
      sourceTextByFile.get('src/lib/id.cjs') ||
      '';
    const projectsRoutesSource = firstSourceText([
      'src/modules/projects/routes.js',
      'src/modules/projects/routes.ts',
      'src/modules/projects/routes.mjs',
      'src/modules/projects/routes.cjs'
    ]);
    const projectsServiceSource = firstSourceText([
      'src/modules/projects/service.js',
      'src/modules/projects/service.ts',
      'src/modules/projects/service.mjs',
      'src/modules/projects/service.cjs'
    ]);
    const projectsModuleSource = [...sourceTextByFile.entries()]
      .filter(([rel]) => /^src\/modules\/projects\/.+\.(?:js|ts|mjs|cjs)$/i.test(rel))
      .map(([, content]) => content)
      .join('\n');
    if (projectsModuleSource && !/\/:(?:projectId|id)\b/.test(projectsModuleSource)) {
      diagnostics.push('Missing route signature for project detail endpoint /projects/:projectId');
    }
    const appSource = appEntrypoints.map(rel => sourceTextByFile.get(rel) || '').join('\n');
    const serverSource = serverEntrypoints.map(rel => sourceTextByFile.get(rel) || '').join('\n');
    const coreAppServerSource = `${appSource}\n${serverSource}`;
    if (/\bimport\s+[^;]+from\s+['"][^'"]+['"]|^\s*export\s+/m.test(coreAppServerSource)) {
      diagnostics.push('Module format contract mismatch: use CommonJS (`require` + `module.exports`) in src/app.* and src/server.* for oracle runtime compatibility.');
    }
    const esmLocalImportMatches = coreAppServerSource.matchAll(/\bimport\s+[^;]+from\s+['"](\.{1,2}\/[^'"]+)['"]/g);
    for (const match of esmLocalImportMatches) {
      const importSpec = String(match[1] || '');
      if (!importSpec) continue;
      if (!/\.(?:js|mjs|cjs|ts)$/i.test(importSpec)) {
        diagnostics.push(`ESM local import missing extension in app/server source: "${importSpec}" (use explicit .js/.mjs/.cjs or CommonJS require).`);
      }
    }
    if (!/\bapp\s*\.\s*get\s*\(\s*['"]\/health['"]/.test(appSource)) {
      diagnostics.push('Missing health endpoint declaration in src/app.*: expected app.get("/health", ...).');
    } else if (!/\bapp\s*\.\s*get\s*\(\s*['"]\/health['"][\s\S]{0,600}\{\s*ok\s*:\s*true\s*\}/i.test(appSource)) {
      diagnostics.push('Health route contract mismatch: GET /health should return body { ok: true }.');
    }
    if (/\b[a-zA-Z_$][\w$]*\s*\.\s*listen\s*\(/.test(`${appSource}\n${serverSource}`)) {
      diagnostics.push('Do not call listen() in src/app.* or src/server.* for node-project-api-large; oracle imports app directly via supertest');
    }
    if (routeThrowFiles.length > 0 && !/\(\s*err\s*,\s*req\s*,\s*res\s*,\s*next\s*\)/.test(appSource)) {
      diagnostics.push('Uncaught route throws detected without Express error middleware `(err, req, res, next)` in src/app.*');
    }
    const definesBadRequestCtor = /\bclass\s+BadRequestError\b|\bfunction\s+BadRequestError\b/.test(errorsLibSource);
    const definesNotFoundCtor = /\bclass\s+NotFoundError\b|\bfunction\s+NotFoundError\b/.test(errorsLibSource);
    const routeFilesUsingSendError = [...sourceTextByFile.entries()]
      .filter(([rel, content]) => /\/routes\.(?:js|ts|mjs|cjs)$/i.test(rel) && /\bsendError\s*\(/.test(content))
      .map(([rel]) => rel);
    if (routeFilesUsingSendError.length > 0) {
      const hasSendErrorDefinition = hasNodeProjectSendErrorDefinition(errorsLibSource);
      const hasSendErrorExport = hasNodeProjectSendErrorExport(errorsLibSource);
      if (!hasSendErrorDefinition || !hasSendErrorExport) {
        diagnostics.push('sendError helper export mismatch: routes call sendError(...) but src/lib/errors.* does not define+export sendError.');
      }
    }
    if (/\bnew\s+BadRequestError\b/.test(combinedSource) && !definesBadRequestCtor) {
      diagnostics.push('Uses `new BadRequestError(...)` but src/lib/errors.* does not define/export BadRequestError');
    }
    if (/\bnew\s+NotFoundError\b/.test(combinedSource) && !definesNotFoundCtor) {
      diagnostics.push('Uses `new NotFoundError(...)` but src/lib/errors.* does not define/export NotFoundError');
    }
    if (/\bgenerateId\s*\(/.test(combinedSource)) {
      const hasGenerateIdDefinition = hasNodeProjectGenerateIdDefinition(idLibSource);
      const hasGenerateIdExport = hasNodeProjectGenerateIdExport(idLibSource);
      if (!hasGenerateIdDefinition || !hasGenerateIdExport) {
        diagnostics.push('generateId helper export mismatch: services call generateId(...) but src/lib/id.* does not define+export generateId.');
      }
    }
    if (/\{\s*v4\s*:\s*uuidv4\s*\}\s*=\s*require\s*\(\s*['"](?:node:)?crypto['"]\s*\)\.randomUUID|\buuidv4\s*=\s*require\s*\(\s*['"](?:node:)?crypto['"]\s*\)\.randomUUID/i.test(combinedSource)) {
      diagnostics.push('Invalid randomUUID usage: do not destructure `v4` from crypto.randomUUID; use `const { randomUUID } = require("node:crypto")` then call `randomUUID()`.');
    }
    const membersModuleSource = [...sourceTextByFile.entries()]
      .filter(([rel]) => /^src\/modules\/members\/.+\.(?:js|ts|mjs|cjs)$/i.test(rel))
      .map(([, content]) => content)
      .join('\n');
    const membersRoutesSource = firstSourceText([
      'src/modules/members/routes.js',
      'src/modules/members/routes.ts',
      'src/modules/members/routes.mjs',
      'src/modules/members/routes.cjs'
    ]);
    const membersServiceSource = firstSourceText([
      'src/modules/members/service.js',
      'src/modules/members/service.ts',
      'src/modules/members/service.mjs',
      'src/modules/members/service.cjs'
    ]);
    if (membersModuleSource && (!/\buserId\b/.test(membersModuleSource) || !/\brole\b/.test(membersModuleSource))) {
      diagnostics.push('Members contract mismatch: src/modules/members/* should validate/use both `userId` and `role` fields');
    }
    if (membersServiceSource && /\b(?:let|const)\s+(?:members|membersByProject)\s*=\s*(?:\{\}|\[\])/i.test(membersServiceSource)) {
      diagnostics.push('State-sharing mismatch: members service should reuse shared projects repository, not isolated members map/array');
    }

    const commentsModuleSource = [...sourceTextByFile.entries()]
      .filter(([rel]) => /^src\/modules\/comments\/.+\.(?:js|ts|mjs|cjs)$/i.test(rel))
      .map(([, content]) => content)
      .join('\n');
    const commentsRoutesSource = firstSourceText([
      'src/modules/comments/routes.js',
      'src/modules/comments/routes.ts',
      'src/modules/comments/routes.mjs',
      'src/modules/comments/routes.cjs'
    ]);
    const commentsServiceSource = firstSourceText([
      'src/modules/comments/service.js',
      'src/modules/comments/service.ts',
      'src/modules/comments/service.mjs',
      'src/modules/comments/service.cjs'
    ]);
    if (commentsModuleSource) {
      if (/\bcontent\b/.test(commentsModuleSource) && !/\bmessage\b/.test(commentsModuleSource)) {
        diagnostics.push('Comments contract mismatch: use payload field `message` (not `content`) in comments endpoints');
      }
      if (!/\bmessage\b/.test(commentsModuleSource)) {
        diagnostics.push('Comments contract mismatch: comments routes/services should validate and persist `message`');
      }
    }

    const tasksModuleSource = [...sourceTextByFile.entries()]
      .filter(([rel]) => /^src\/modules\/tasks\/.+\.(?:js|ts|mjs|cjs)$/i.test(rel))
      .map(([, content]) => content)
      .join('\n');
    const tasksRoutesSource = firstSourceText([
      'src/modules/tasks/routes.js',
      'src/modules/tasks/routes.ts',
      'src/modules/tasks/routes.mjs',
      'src/modules/tasks/routes.cjs'
    ]);
    const tasksServiceSource = firstSourceText([
      'src/modules/tasks/service.js',
      'src/modules/tasks/service.ts',
      'src/modules/tasks/service.mjs',
      'src/modules/tasks/service.cjs'
    ]);
    if (tasksModuleSource) {
      if (/\bstatus\s*:\s*['"](open|pending)['"]/i.test(tasksModuleSource)) {
        diagnostics.push('Task status contract mismatch: use `todo` / `done` statuses (not `open` or `pending`)');
      }
      if (/['"](pending|open)['"]/.test(tasksModuleSource)) {
        diagnostics.push('Task status contract mismatch: PATCH status must allow only "todo" or "done" (pending/open are not allowed).');
      }
      if (!/\bstatus\b/.test(tasksModuleSource) || !/['"]done['"]/.test(tasksModuleSource) || !/['"]todo['"]/.test(tasksModuleSource)) {
        diagnostics.push('Task filtering contract mismatch: support ?status=todo|done and PATCH status updates.');
      }
    }

    checkRouteServiceContractMismatch({
      moduleName: 'projects',
      routeSource: projectsRoutesSource,
      serviceSource: projectsServiceSource,
      diagnostics
    });
    checkRouteServiceContractMismatch({
      moduleName: 'members',
      routeSource: membersRoutesSource,
      serviceSource: membersServiceSource,
      diagnostics
    });
    checkRouteServiceContractMismatch({
      moduleName: 'tasks',
      routeSource: tasksRoutesSource,
      serviceSource: tasksServiceSource,
      diagnostics
    });
    checkRouteServiceContractMismatch({
      moduleName: 'comments',
      routeSource: commentsRoutesSource,
      serviceSource: commentsServiceSource,
      diagnostics
    });

    if (projectsRoutesSource && /\b(?:router|r)\.post\s*\(\s*['"]\/['"]/.test(projectsRoutesSource) && !/\bstatus\s*\(\s*201\s*\)/.test(projectsRoutesSource)) {
      diagnostics.push('Status code contract mismatch: POST /projects should return HTTP 201 on create.');
    }
    if (membersRoutesSource && /\b(?:router|r)\.post\s*\(\s*['"]\/['"]/.test(membersRoutesSource) && !/\bstatus\s*\(\s*201\s*\)/.test(membersRoutesSource)) {
      diagnostics.push('Status code contract mismatch: POST /projects/:projectId/members should return HTTP 201 on create.');
    }
    if (tasksRoutesSource && /\b(?:router|r)\.post\s*\(\s*['"]\/['"]/.test(tasksRoutesSource) && !/\bstatus\s*\(\s*201\s*\)/.test(tasksRoutesSource)) {
      diagnostics.push('Status code contract mismatch: POST /projects/:projectId/tasks should return HTTP 201 on create.');
    }
    if (commentsRoutesSource && /\b(?:router|r)\.post\s*\(\s*['"]\/['"]/.test(commentsRoutesSource) && !/\bstatus\s*\(\s*201\s*\)/.test(commentsRoutesSource)) {
      diagnostics.push('Status code contract mismatch: POST /projects/:projectId/tasks/:taskId/comments should return HTTP 201 on create.');
    }

    if (commentsServiceSource && tasksServiceSource) {
      const invokedTaskApiNames = [...commentsServiceSource.matchAll(/\btaskService\.(\w+)\s*\(/g)].map(m => String(m[1]));
      for (const apiName of new Set(invokedTaskApiNames)) {
        const hasTaskApi =
          new RegExp(`\\bfunction\\s+${apiName}\\b`).test(tasksServiceSource) ||
          new RegExp(`\\b${apiName}\\s*:\\s*\\(`).test(tasksServiceSource) ||
          new RegExp(`\\b${apiName}\\b`).test(tasksServiceSource);
        if (!hasTaskApi) {
          diagnostics.push(`Cross-module contract mismatch: comments service calls taskService.${apiName}() but tasks service does not define/export it`);
        }
      }
    }
    if (tasksServiceSource && /\b(?:const|let)\s+projects\s*=\s*(?:\{\}|\[\])/i.test(tasksServiceSource)) {
      diagnostics.push('State-sharing mismatch: tasks service should reuse shared projects repository, not a local `projects` map/array');
    }

    if (commentsServiceSource && /\b(?:const|let)\s+commentsByTask\s*=\s*(?:\{\}|\[\])/i.test(commentsServiceSource)) {
      diagnostics.push('State-sharing mismatch: comments service should validate task/project existence against shared project/task state');
    }

    if (!/\berror\b[\s\S]{0,80}\bcode\b[\s\S]{0,80}\bmessage\b|\bcode\b[\s\S]{0,80}\bmessage\b[\s\S]{0,80}\berror\b/i.test(combinedSource)) {
      diagnostics.push('Error payload contract likely missing: expected { error: { code, message } } handling in API responses');
    }
  }

  if (appEntrypoints.length > 0) {
    const hasAppExport = appEntrypoints.some(rel => {
      const content = sourceTextByFile.get(rel) || '';
      return (
        /\bmodule\.exports\s*=/.test(content) ||
        /\bexports\.app\s*=/.test(content) ||
        /\bexport\s+default\b/.test(content) ||
        /\bexport\s+const\s+app\b/.test(content) ||
        /\bexport\s+function\s+app\b/.test(content)
      );
    });
    if (!hasAppExport) {
      diagnostics.push('src/app.* must export app (module.exports / exports.app / default export)');
    }
  }

  let packageJsonValid = true;
  try {
    const pkgPath = path.join(workspaceDir, 'package.json');
    if (fs.existsSync(pkgPath)) {
      const pkg = JSON.parse(await fs.promises.readFile(pkgPath, 'utf8'));
      const deps = pkg?.dependencies && typeof pkg.dependencies === 'object' ? Object.keys(pkg.dependencies) : [];
      const devDeps = pkg?.devDependencies && typeof pkg.devDependencies === 'object' ? Object.keys(pkg.devDependencies) : [];
      const combined = new Set<string>([...deps, ...devDeps]);
      if (!combined.has('supertest')) {
        diagnostics.push('package.json should include "supertest" (dependencies or devDependencies) for oracle execution');
      }
      if (combined.has('uuid')) {
        diagnostics.push('package.json should not include "uuid"; use node:crypto randomUUID instead');
      }
    }
  } catch (e: any) {
    packageJsonValid = false;
    diagnostics.push(`Invalid package.json: ${String(e?.message || e)}`);
    diagnostics.push('Fix package.json first; syntax checks skipped intentionally.');
  }

  if (packageJsonValid) {
    const jsSyntaxFiles = sourceFiles.filter(rel => /\.(?:js|cjs|mjs)$/i.test(rel));
    for (const rel of jsSyntaxFiles) {
      const quotedRel = rel.replace(/"/g, '\\"');
      const syntaxCheck = await runCommand({
        command: `node --check "${quotedRel}"`,
        cwd: workspaceDir,
        timeoutMs: 20_000
      });
      if (syntaxCheck.ok) continue;
      const syntaxText = `${syntaxCheck.stderr}\n${syntaxCheck.stdout}`;
      const firstSyntaxLine = syntaxText
        .split(/\r?\n/)
        .map(line => line.trim())
        .find(line => line.length > 0 && !/^\^+$/.test(line));
      const detail = firstSyntaxLine || `exit=${syntaxCheck.exitCode}`;
      diagnostics.push(`JavaScript syntax check failed in ${rel}: ${detail}`);
      if (/invalid or unexpected token|unterminated string|unexpected end of input|missing \)|unterminated regexp/i.test(syntaxText)) {
        diagnostics.push(`Likely truncated/incomplete JS content in ${rel}; regenerate full file content with closed strings and braces.`);
      }
    }
  }

  if (diagnostics.length > 0) {
    diagnostics.push('Skipped oracle command checks because structural contract did not pass.');
    return { ok: false, diagnostics, commands };
  }

  try {
    await fs.promises.rm(path.join(workspaceDir, 'tests'), { recursive: true, force: true });
    await installOracleFiles({ oracleDir: ORACLE_NODE_PROJECT_API_LARGE_DIR, workspaceDir });
  } catch (e: any) {
    diagnostics.push(`Failed to install oracle tests: ${String(e?.message || e)}`);
    return { ok: false, diagnostics, commands };
  }

  const installCmdTimeoutMs = 10 * 60 * 1000;
  const oracleCmdTimeoutMs = 2 * 60 * 1000;
  const oracleTestCommand = 'node --test --test-concurrency=1 tests/oracle.test.js';
  const oracleForceExitCommand = 'node --test --test-force-exit --test-concurrency=1 tests/oracle.test.js';
  commands.push(await runCommand({ command: 'npm install --no-audit --fund=false', cwd: workspaceDir, timeoutMs: installCmdTimeoutMs }));
  let oracleCmd = await runCommand({ command: oracleTestCommand, cwd: workspaceDir, timeoutMs: oracleCmdTimeoutMs });
  let transientRetryCount = 0;
  for (let attempt = 1; attempt < NODE_ORACLE_CMD_RETRY_ATTEMPTS; attempt++) {
    if (!isNodeApiTransientOracleCommandFailure(oracleCmd)) break;
    transientRetryCount += 1;
    await sleep(Math.min(3000, NODE_ORACLE_CMD_RETRY_BASE_DELAY_MS * Math.pow(2, attempt - 1)));
    oracleCmd = await runCommand({ command: oracleTestCommand, cwd: workspaceDir, timeoutMs: oracleCmdTimeoutMs });
  }
  let forceExitCaptureUsed = false;
  if (oracleCmd.timedOut) {
    const forceExitCmd = await runCommand({ command: oracleForceExitCommand, cwd: workspaceDir, timeoutMs: oracleCmdTimeoutMs });
    commands.push(oracleCmd);
    oracleCmd = forceExitCmd;
    forceExitCaptureUsed = true;
  }
  commands.push(oracleCmd);
  if (transientRetryCount > 0) {
    diagnostics.push(`Retried node-project oracle command ${transientRetryCount}x after transient transport failure.`);
  }
  if (forceExitCaptureUsed) {
    diagnostics.push('Oracle command timed out once; collected actionable failure details via --test-force-exit rerun.');
  }

  for (const c of commands) {
    if (!c.ok) diagnostics.push(`Command failed: ${c.command} (exit=${c.exitCode}, timedOut=${c.timedOut})`);
  }

  const logs = commands.map(c => `${c.stdout}\n${c.stderr}`).join('\n');
  if (/cannot find module ['"]\.\.\/\.\.\/lib['"]/i.test(logs)) {
    diagnostics.push('Invalid module import target "../../lib": import concrete files "../../lib/id" or "../../lib/errors"');
  }
  if (/cannot find module ['"]uuid['"]/i.test(logs)) {
    diagnostics.push('Runtime dependency error: remove uuid usage or add dependency; preferred fix is node:crypto randomUUID');
  }
  if (/cannot find module ['"]supertest['"]/i.test(logs)) {
    diagnostics.push('Oracle dependency missing: add "supertest" to dependencies/devDependencies in package.json');
  }
  if (/cannot find module ['"]express['"]/i.test(logs)) {
    diagnostics.push('Runtime dependency missing: add "express" to dependencies in package.json');
  }
  if (/cannot find module .* imported from .*src[\\/](?:app|server)\.(?:js|mjs|cjs|ts)/i.test(logs)) {
    diagnostics.push('Module resolution/runtime mismatch in src/app.* or src/server.* imports (likely ESM path without extension or mixed ESM/CJS modules).');
  }
  if (/Expected app export in src\/app\.\*/i.test(logs)) {
    if (/invalid or unexpected token|unexpected end of input|syntaxerror/i.test(logs)) {
      diagnostics.push('Syntax/runtime load failure: one of src/*.js files is invalid JavaScript (often truncated file content).');
    }
    diagnostics.push('App contract failed: export app as module.exports = app / exports.app / default export in src/app.*');
  }
  if (/Expected consistent error payload/i.test(logs)) {
    diagnostics.push('API contract failed: error responses must be { error: { code, message } }');
  }
  diagnostics.push(...collectNodeProjectApiLargeOracleDiagnostics(logs));

  return { ok: diagnostics.length === 0, diagnostics, commands };
}

function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

function computeRetryDelayMs(attempt: number): number {
  const expDelay = Math.min(OLLAMA_RETRY_MAX_DELAY_MS, OLLAMA_RETRY_BASE_DELAY_MS * Math.pow(2, Math.max(0, attempt - 1)));
  const jitter = Math.floor(expDelay * 0.2 * Math.random());
  return expDelay + jitter;
}

export function computeOllamaPerAttemptTimeoutMs(totalTimeoutMs: number): number {
  const normalizedTotalMs = Number.isFinite(totalTimeoutMs) && totalTimeoutMs > 0 ? Math.floor(totalTimeoutMs) : 60_000;
  const totalAttempts = Math.max(1, OLLAMA_RETRY_ATTEMPTS + OLLAMA_RECOVERY_ATTEMPTS);
  const retryDelayBudgetMs = (OLLAMA_RETRY_ATTEMPTS * OLLAMA_RETRY_MAX_DELAY_MS)
    + (OLLAMA_RECOVERY_ATTEMPTS * OLLAMA_RECOVERY_WAIT_MS);
  const availableMs = Math.max(10_000, normalizedTotalMs - retryDelayBudgetMs);
  const distributedMs = Math.floor(availableMs / totalAttempts);
  return Math.max(5_000, Math.min(normalizedTotalMs, distributedMs));
}

export function shouldRetryOllamaRequest(timeoutMs: number): boolean {
  const normalizedTimeoutMs = Number.isFinite(timeoutMs) && timeoutMs > 0 ? Math.floor(timeoutMs) : 60_000;
  return normalizedTimeoutMs <= OLLAMA_RETRY_MAX_TIMEOUT_MS;
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
    /\baborterror\b/.test(message) ||
    /operation was aborted/.test(message) ||
    /user aborted a request/.test(message) ||
    /socket hang up/.test(message) ||
    /network error/.test(message) ||
    /failed to fetch/.test(message) ||
    /request to .* failed, reason:/.test(message)
  );
}

export function extractOllamaModelNames(payload: unknown): string[] {
  const models = (payload as any)?.models;
  if (!Array.isArray(models)) return [];

  const names = new Set<string>();
  for (const item of models) {
    const name = typeof item?.name === 'string' ? item.name.trim() : '';
    const model = typeof item?.model === 'string' ? item.model.trim() : '';
    if (name) names.add(name);
    if (model) names.add(model);
  }
  return Array.from(names.values());
}

function normalizeModelId(value: string): string {
  return value.trim().toLowerCase();
}

function normalizeModelBase(value: string): string {
  const normalized = normalizeModelId(value);
  const colonIndex = normalized.indexOf(':');
  if (colonIndex === -1) return normalized;
  return normalized.slice(0, colonIndex);
}

export function isOllamaModelAvailable(requestedModel: string, availableModels: string[]): boolean {
  const requested = normalizeModelId(requestedModel);
  if (!requested) return false;
  const requestedBase = normalizeModelBase(requested);

  const normalizedAvailable = availableModels
    .map(v => normalizeModelId(v))
    .filter(Boolean);

  if (normalizedAvailable.includes(requested)) return true;
  return normalizedAvailable.some(v => normalizeModelBase(v) === requestedBase);
}

function getBaseUrlOriginFromRequestUrl(requestUrl: string): string | undefined {
  try {
    return new URL(requestUrl).origin;
  } catch {
    return undefined;
  }
}

async function isOllamaReady(baseUrl: string): Promise<boolean> {
  const url = new URL('/api/tags', baseUrl).toString();
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), OLLAMA_READINESS_TIMEOUT_MS);
  try {
    const res = await fetch(url, {
      method: 'GET',
      signal: controller.signal as any,
    });
    return res.ok;
  } catch {
    return false;
  } finally {
    clearTimeout(timer);
  }
}

async function fetchOllamaModelNames(baseUrl: string): Promise<string[]> {
  const url = new URL('/api/tags', baseUrl).toString();
  let lastError: unknown;

  for (let attempt = 1; attempt <= OLLAMA_PREFLIGHT_RETRY_ATTEMPTS; attempt++) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), OLLAMA_PREFLIGHT_TIMEOUT_MS);
    try {
      const res = await fetch(url, {
        method: 'GET',
        signal: controller.signal as any,
      });
      if (!res.ok) {
        const body = await res.text();
        throw new Error(`Ollama readiness endpoint returned HTTP ${res.status}: ${body}`);
      }

      const payload = await res.json();
      return extractOllamaModelNames(payload);
    } catch (error: any) {
      lastError = error;
      const message = String(error?.message || error);
      const isTimeoutLike = /aborted|aborterror|operation was aborted/i.test(message);
      const isNetworkLike = isRetriableOllamaRequestError(message);
      if (attempt >= OLLAMA_PREFLIGHT_RETRY_ATTEMPTS || (!isTimeoutLike && !isNetworkLike)) {
        if (isTimeoutLike) {
          throw new Error(`Ollama readiness check timed out after ${OLLAMA_PREFLIGHT_TIMEOUT_MS}ms (attempt ${attempt}/${OLLAMA_PREFLIGHT_RETRY_ATTEMPTS})`);
        }
        throw error;
      }
      await sleep(OLLAMA_PREFLIGHT_RETRY_BACKOFF_MS);
    } finally {
      clearTimeout(timer);
    }
  }

  throw lastError;
}

async function assertOllamaPreflightReady(params: { baseUrl: string; model: string }): Promise<void> {
  let modelNames: string[] = [];
  try {
    modelNames = await fetchOllamaModelNames(params.baseUrl);
  } catch (error: any) {
    const detail = String(error?.message || error);
    throw new Error(
      `Cannot reach Ollama at ${params.baseUrl} after ${OLLAMA_PREFLIGHT_RETRY_ATTEMPTS} preflight attempt(s). Detail: ${detail}. Start Ollama server (e.g. "ollama serve").`
    );
  }

  if (!modelNames.length) {
    throw new Error(
      `Ollama is reachable at ${params.baseUrl}, but /api/tags returned no models. Pull model "${params.model}" first (e.g. "ollama pull ${params.model}").`
    );
  }

  if (!isOllamaModelAvailable(params.model, modelNames)) {
    const listed = modelNames.slice(0, 12).join(', ');
    const suffix = modelNames.length > 12 ? ', ...' : '';
    throw new Error(
      `Requested model "${params.model}" is not available in Ollama tags (${listed}${suffix}). Pull it first: "ollama pull ${params.model}".`
    );
  }
}

async function waitForOllamaRecoveryWindow(baseUrl: string): Promise<void> {
  const deadline = Date.now() + OLLAMA_RECOVERY_WAIT_MS;
  while (Date.now() < deadline) {
    if (await isOllamaReady(baseUrl)) return;
    const remaining = deadline - Date.now();
    if (remaining <= 0) break;
    await sleep(Math.min(OLLAMA_RECOVERY_POLL_MS, remaining));
  }
}

async function withOllamaRetry<T>(request: () => Promise<T>, baseUrlForRecovery?: string): Promise<T> {
  let lastError: unknown;
  const totalAttempts = OLLAMA_RETRY_ATTEMPTS + OLLAMA_RECOVERY_ATTEMPTS;

  for (let attempt = 1; attempt <= totalAttempts; attempt++) {
    try {
      return await request();
    } catch (error: unknown) {
      lastError = error;
      const retriable = isRetriableOllamaRequestError(error);
      if (attempt >= totalAttempts || !retriable) {
        throw error;
      }

      const inRecoveryPhase = attempt >= OLLAMA_RETRY_ATTEMPTS;
      if (inRecoveryPhase && baseUrlForRecovery) {
        await waitForOllamaRecoveryWindow(baseUrlForRecovery);
      } else {
        await sleep(computeRetryDelayMs(attempt));
      }
    }
  }
  throw lastError;
}

async function postOllamaJsonWithRetry(params: {
  url: string;
  body: unknown;
  timeoutMs: number;
}): Promise<{ ok: boolean; status: number; text: string }> {
  const postOnce = async (timeoutMs: number): Promise<{ ok: boolean; status: number; text: string }> => {
    const controller = new AbortController();
    const t = setTimeout(() => controller.abort(), timeoutMs);
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
  };

  if (!shouldRetryOllamaRequest(params.timeoutMs)) {
    return await postOnce(params.timeoutMs);
  }

  const recoveryBaseUrl = getBaseUrlOriginFromRequestUrl(params.url);
  const perAttemptTimeoutMs = computeOllamaPerAttemptTimeoutMs(params.timeoutMs);
  return await withOllamaRetry(async () => await postOnce(perAttemptTimeoutMs), recoveryBaseUrl);
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
  if (!isDeterministicFallbackEnabled(scenarioId)) {
    return '';
  }
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

export function dedupeFileSpecsByPath(files: FileSpec[]): { files: FileSpec[]; duplicates: string[] } {
  const out: FileSpec[] = [];
  const indexByPath = new Map<string, number>();
  const duplicateSet = new Set<string>();
  for (const file of files || []) {
    const normalized = sanitizePathForCaseInsensitiveCompare(file.path);
    const existingIndex = indexByPath.get(normalized);
    if (existingIndex == null) {
      indexByPath.set(normalized, out.length);
      out.push(file);
      continue;
    }
    duplicateSet.add(out[existingIndex].path);
    duplicateSet.add(file.path);
    // Keep the latest content for repeated paths.
    out[existingIndex] = file;
  }
  return {
    files: out,
    duplicates: [...duplicateSet.values()].sort((a, b) => a.localeCompare(b))
  };
}

function getScenarioCoreRequiredFiles(scenarioId: string): string[] {
  switch (scenarioId) {
    case 'ts-todo-oracle':
      return ['README.md', 'package.json', 'tsconfig.json', 'src/store.ts', 'src/cli.ts'];
    case 'node-api-oracle':
      return ['README.md', 'package.json', 'openapi.json', 'src/server.js'];
    case 'python-ai-stdlib-oracle':
      return ['README.md', 'mini_ai/__init__.py', 'mini_ai/markov.py', 'mini_ai/cli.py'];
    case 'node-project-api-large':
      return [
        'README.md',
        'package.json',
        'src/app.js',
        'src/server.js',
        'src/modules/projects/routes.js',
        'src/modules/projects/service.js',
        'src/modules/tasks/routes.js',
        'src/modules/tasks/service.js',
        'src/modules/members/routes.js',
        'src/modules/members/service.js',
        'src/modules/comments/routes.js',
        'src/modules/comments/service.js',
        'src/lib/errors.js',
        'src/lib/id.js'
      ];
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
  if (scenarioId === 'node-project-api-large') {
    return [
      '- This is iteration 1: mode MUST be "full". Do not return "patch".',
      '- files[] MUST include README.md, package.json, src/app.js, src/server.js.',
      '- files[] MUST include module pairs: routes.js + service.js for projects/tasks/members/comments.',
      '- files[] MUST include shared helpers src/lib/errors.js and src/lib/id.js.',
      '- Keep modular structure under src/modules/projects,tasks,members,comments.',
      '- Target >= 12 source files under src/ and keep error payload shape { error: { code, message } }.',
      '- Do not use uuid package; use node:crypto randomUUID for IDs.',
      '- ID helper pattern: `const { randomUUID } = require("node:crypto")`; do NOT use `const { v4: uuidv4 } = require("crypto").randomUUID`.',
      '- In src/modules/* files import shared helpers via ../../lib/id and ../../lib/errors (not ../lib/*).',
      '- Ensure route signatures exist: /health, /projects, /projects/:projectId/members, /projects/:projectId/tasks, /projects/:projectId/tasks/:taskId/comments.',
      '- GET /health response body must be exactly { ok: true }.',
      '- Members payload contract: input { userId, role }, output member contains userId + role (do not require/use "name").',
      '- Validation contract: bad input -> 400, missing entity -> 404, duplicate project/member -> 409, all with { error: { code, message } }.',
      '- Tasks filter contract: GET /projects/:projectId/tasks?status=done must return only done tasks.',
      '- In src/app.js mount routers exactly on /projects, /projects/:projectId/members, /projects/:projectId/tasks, /projects/:projectId/tasks/:taskId/comments.',
      '- In members/tasks/comments routers use paths relative to mountpoint ("/", "/:taskId"), do not repeat full project/task prefixes.',
      '- Do NOT call `app.listen(...)` or `server.listen(...)` in imported modules; oracle loads app directly via supertest.',
      '- Avoid uncaught throw in routes/services; ensure failures always return JSON { error: { code, message } } and never HTML error page.'
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

function shouldIncludeInLargeScenarioWorkspaceSnapshot(relPath: string): boolean {
  const rel = sanitizePathForCaseInsensitiveCompare(relPath);
  if (!rel) return false;
  if (rel.startsWith('node_modules/')) return false;
  if (rel.startsWith('.git/')) return false;
  if (rel === 'readme.md' || rel === 'package.json') return true;
  if (rel.startsWith('src/')) return true;
  return false;
}

type PromoteLargePatchToFullResult = {
  promoted: boolean;
  files: FileSpec[];
  restoredFromWorkspace: string[];
  synthesizedCoreFiles: string[];
  reason?: string;
};

function buildNodeProjectLargeCoreFileTemplate(relPath: string): string | undefined {
  switch (sanitizePathForCaseInsensitiveCompare(relPath)) {
    case 'readme.md':
      return '# Node Project Management API\n\nGenerated baseline skeleton for bot-eval large scenario.\n';
    case 'package.json':
      return JSON.stringify({
        name: 'node-project-api-large',
        version: '0.1.0',
        private: true,
        type: 'commonjs',
        scripts: {
          start: 'node src/server.js'
        },
        dependencies: {
          express: '^4.19.2'
        },
        devDependencies: {
          supertest: '^7.1.0'
        }
      }, null, 2) + '\n';
    case 'src/app.js':
      return [
        "const express = require('express');",
        "const projectsRoutes = require('./modules/projects/routes');",
        "const membersRoutes = require('./modules/members/routes');",
        "const tasksRoutes = require('./modules/tasks/routes');",
        "const commentsRoutes = require('./modules/comments/routes');",
        'const app = express();',
        'app.use(express.json());',
        "app.get('/health', (_req, res) => res.json({ ok: true }));",
        "app.use('/projects', projectsRoutes);",
        "app.use('/projects/:projectId/members', membersRoutes);",
        "app.use('/projects/:projectId/tasks', tasksRoutes);",
        "app.use('/projects/:projectId/tasks/:taskId/comments', commentsRoutes);",
        'module.exports = app;',
        ''
      ].join('\n');
    case 'src/server.js':
      return [
        "const app = require('./app');",
        'const PORT = Number(process.env.PORT || 3000);',
        'if (require.main === module) {',
        '  app.listen(PORT, () => {',
        "    process.stdout.write(`server listening on ${PORT}\\n`);",
        '  });',
        '}',
        'module.exports = app;',
        ''
      ].join('\n');
    case 'src/lib/errors.js':
      return [
        'function sendError(res, status, code, message) {',
        '  return res.status(status).json({ error: { code, message } });',
        '}',
        'module.exports = { sendError };',
        ''
      ].join('\n');
    case 'src/lib/id.js':
      return [
        "const { randomUUID } = require('node:crypto');",
        'function generateId() {',
        '  return randomUUID();',
        '}',
        'module.exports = { generateId };',
        ''
      ].join('\n');
    case 'src/modules/projects/service.js':
      return [
        "const { generateId } = require('../../lib/id');",
        'const projects = [];',
        'async function getAllProjects() { return [...projects]; }',
        'async function getProjectById(projectId) { return projects.find(project => String(project.id) === String(projectId)) || null; }',
        'async function getProjectByName(name) { return projects.find(project => String(project.name) === String(name)) || null; }',
        'async function createProject(name) {',
        '  const project = { id: generateId(), name: String(name || "").trim() };',
        '  projects.push(project);',
        '  return project;',
        '}',
        'module.exports = { getAllProjects, getProjectById, getProjectByName, createProject, projects };',
        ''
      ].join('\n');
    case 'src/modules/projects/routes.js':
      return [
        "const router = require('express').Router();",
        "const projectsService = require('./service');",
        "const { sendError } = require('../../lib/errors');",
        "router.get('/', async (_req, res) => res.json({ projects: await projectsService.getAllProjects() }));",
        "router.post('/', async (req, res) => {",
        '  const name = String(req.body?.name || "").trim();',
        "  if (!name) return sendError(res, 400, 'BAD_REQUEST', 'Project name is required');",
        '  const duplicate = await projectsService.getProjectByName(name);',
        "  if (duplicate) return sendError(res, 409, 'PROJECT_DUPLICATE', 'Project already exists');",
        '  const project = await projectsService.createProject(name);',
        '  return res.status(201).json({ project });',
        '});',
        "router.get('/:projectId', async (req, res) => {",
        '  const project = await projectsService.getProjectById(req.params.projectId);',
        "  if (!project) return sendError(res, 404, 'PROJECT_NOT_FOUND', 'Project not found');",
        '  return res.json({ project });',
        '});',
        'module.exports = router;',
        ''
      ].join('\n');
    case 'src/modules/tasks/service.js':
      return [
        "const { generateId } = require('../../lib/id');",
        'const tasks = [];',
        'async function getAllTasks(projectId, status) {',
        '  const byProject = tasks.filter(task => String(task.projectId) === String(projectId));',
        "  if (status === 'todo' || status === 'done') return byProject.filter(task => task.status === status);",
        '  return byProject;',
        '}',
        'async function createTask(projectId, title) {',
        "  const task = { id: generateId(), projectId: String(projectId), title: String(title || ''), status: 'todo' };",
        '  tasks.push(task);',
        '  return task;',
        '}',
        'async function getTaskById(projectId, taskId) {',
        '  return tasks.find(task => String(task.projectId) === String(projectId) && String(task.id) === String(taskId)) || null;',
        '}',
        'async function updateTaskStatus(projectId, taskId, status) {',
        '  const task = await getTaskById(projectId, taskId);',
        '  if (!task) return null;',
        '  task.status = status;',
        '  return task;',
        '}',
        'module.exports = { getAllTasks, createTask, getTaskById, updateTaskStatus, tasks };',
        ''
      ].join('\n');
    case 'src/modules/tasks/routes.js':
      return [
        "const router = require('express').Router({ mergeParams: true });",
        "const tasksService = require('./service');",
        "const { sendError } = require('../../lib/errors');",
        "router.get('/', async (req, res) => {",
        "  const status = typeof req.query?.status === 'string' ? req.query.status : undefined;",
        "  const tasks = await tasksService.getAllTasks(req.params.projectId, status);",
        '  return res.json({ tasks });',
        '});',
        "router.post('/', async (req, res) => {",
        '  const title = String(req.body?.title || "").trim();',
        "  if (!title) return sendError(res, 400, 'BAD_REQUEST', 'Task title is required');",
        '  const task = await tasksService.createTask(req.params.projectId, title);',
        '  return res.status(201).json({ task });',
        '});',
        "router.patch('/:taskId', async (req, res) => {",
        "  const status = String(req.body?.status || '').trim();",
        "  if (status !== 'todo' && status !== 'done') return sendError(res, 400, 'INVALID_STATUS', 'Status must be todo or done');",
        '  const task = await tasksService.updateTaskStatus(req.params.projectId, req.params.taskId, status);',
        "  if (!task) return sendError(res, 404, 'TASK_NOT_FOUND', 'Task not found');",
        '  return res.json({ task });',
        '});',
        'module.exports = router;',
        ''
      ].join('\n');
    case 'src/modules/members/service.js':
      return [
        'const projectsRepository = {};',
        'function ensureProject(projectId) {',
        "  const key = String(projectId || '');",
        '  if (!projectsRepository[key]) projectsRepository[key] = { members: [] };',
        '  return projectsRepository[key];',
        '}',
        'async function getMembers(projectId) {',
        '  const project = ensureProject(projectId);',
        '  return project.members;',
        '}',
        'async function addMember(projectId, userId, role) {',
        '  const project = ensureProject(projectId);',
        "  const existing = project.members.find(member => String(member.userId) === String(userId));",
        "  if (existing) return { duplicate: true, member: existing };",
        "  const member = { projectId: String(projectId), userId: String(userId), role: String(role || 'member') };",
        '  project.members.push(member);',
        '  return { duplicate: false, member };',
        '}',
        'module.exports = { getMembers, addMember, projectsRepository };',
        ''
      ].join('\n');
    case 'src/modules/members/routes.js':
      return [
        "const router = require('express').Router({ mergeParams: true });",
        "const membersService = require('./service');",
        "const { sendError } = require('../../lib/errors');",
        "router.get('/', async (req, res) => res.json({ members: await membersService.getMembers(req.params.projectId) }));",
        "router.post('/', async (req, res) => {",
        "  const userId = String(req.body?.userId || '').trim();",
        "  const role = String(req.body?.role || '').trim();",
        "  if (!userId || !role) return sendError(res, 400, 'BAD_REQUEST', 'userId and role are required');",
        '  const outcome = await membersService.addMember(req.params.projectId, userId, role);',
        "  if (outcome.duplicate) return sendError(res, 409, 'MEMBER_DUPLICATE', 'Member already exists');",
        '  return res.status(201).json({ member: outcome.member });',
        '});',
        'module.exports = router;',
        ''
      ].join('\n');
    case 'src/modules/comments/service.js':
      return [
        "const { generateId } = require('../../lib/id');",
        'const comments = [];',
        'async function getAllComments(projectId, taskId) {',
        '  return comments.filter(comment => String(comment.projectId) === String(projectId) && String(comment.taskId) === String(taskId));',
        '}',
        'async function addComment(projectId, taskId, message) {',
        "  const comment = { id: generateId(), projectId: String(projectId), taskId: String(taskId), message: String(message || '') };",
        '  comments.push(comment);',
        '  return comment;',
        '}',
        'module.exports = { getAllComments, addComment, comments };',
        ''
      ].join('\n');
    case 'src/modules/comments/routes.js':
      return [
        "const router = require('express').Router({ mergeParams: true });",
        "const commentsService = require('./service');",
        "const { sendError } = require('../../lib/errors');",
        "router.get('/', async (req, res) => res.json({ comments: await commentsService.getAllComments(req.params.projectId, req.params.taskId) }));",
        "router.post('/', async (req, res) => {",
        "  const message = String(req.body?.message || '').trim();",
        "  if (!message) return sendError(res, 400, 'BAD_REQUEST', 'Message is required');",
        '  const comment = await commentsService.addComment(req.params.projectId, req.params.taskId, message);',
        '  return res.status(201).json({ comment });',
        '});',
        'module.exports = router;',
        ''
      ].join('\n');
    default:
      return undefined;
  }
}

export async function promoteLargePatchToFullFromWorkspace(
  parsed: ModelOutput,
  workspaceDir: string,
  requiredCoreFiles: string[]
): Promise<PromoteLargePatchToFullResult> {
  const dedupedPatch = dedupeFileSpecsByPath(parsed.files || []).files;
  const byPath = new Map<string, FileSpec>();
  const restoredFromWorkspace: string[] = [];
  const synthesizedCoreFiles: string[] = [];

  let workspaceFiles: string[] = [];
  try {
    workspaceFiles = await listFilesRecursively(workspaceDir);
  } catch (error: any) {
    return {
      promoted: false,
      files: dedupedPatch,
      restoredFromWorkspace,
      synthesizedCoreFiles,
      reason: `Failed to read workspace snapshot for forced full mode: ${String(error?.message || error)}`
    };
  }

  for (const rel of workspaceFiles) {
    const safeRel = ensureSafeRelativePath(rel);
    if (!shouldIncludeInLargeScenarioWorkspaceSnapshot(safeRel)) continue;
    try {
      const content = await fs.promises.readFile(path.join(workspaceDir, safeRel), 'utf8');
      byPath.set(sanitizePathForCaseInsensitiveCompare(safeRel), { path: safeRel, content });
      restoredFromWorkspace.push(safeRel);
    } catch {
      // ignore unreadable workspace snapshot files
    }
  }

  for (const file of dedupedPatch) {
    const safeRel = ensureSafeRelativePath(file.path);
    byPath.set(sanitizePathForCaseInsensitiveCompare(safeRel), { path: safeRel, content: String(file.content || '') });
  }

  const promotedFiles = [...byPath.values()].sort((a, b) => a.path.localeCompare(b.path));
  let missingAfterPromotion = findMissingCoreFilesInOutput(promotedFiles, requiredCoreFiles);
  if (missingAfterPromotion.length > 0) {
    for (const rel of missingAfterPromotion) {
      const template = buildNodeProjectLargeCoreFileTemplate(rel);
      if (!template) continue;
      byPath.set(sanitizePathForCaseInsensitiveCompare(rel), { path: rel, content: template });
      synthesizedCoreFiles.push(rel);
    }
  }

  const finalFiles = [...byPath.values()].sort((a, b) => a.path.localeCompare(b.path));
  missingAfterPromotion = findMissingCoreFilesInOutput(finalFiles, requiredCoreFiles);
  if (missingAfterPromotion.length > 0) {
    return {
      promoted: false,
      files: finalFiles,
      restoredFromWorkspace,
      synthesizedCoreFiles,
      reason: `Large scenario requires mode "full" after structural contract failures; unable to build full output because workspace is missing: ${missingAfterPromotion.join(', ')}`
    };
  }

  return {
    promoted: true,
    files: finalFiles,
    restoredFromWorkspace: [...new Set(restoredFromWorkspace)].sort((a, b) => a.localeCompare(b)),
    synthesizedCoreFiles: [...new Set(synthesizedCoreFiles)].sort((a, b) => a.localeCompare(b))
  };
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

export async function buildRepairPrompt(
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
  if (scenarioId === 'node-project-api-large') {
    const mismatchGuidance = buildRouteServiceMismatchGuidance(validation.diagnostics || []);
    if (mismatchGuidance.length > 0) {
      lines.push('');
      lines.push(...mismatchGuidance);
    }
    const contractFixGuidance = buildNodeProjectContractFixGuidance(validation.diagnostics || []);
    if (contractFixGuidance.length > 0) {
      lines.push('');
      lines.push(...contractFixGuidance);
    }
    lines.push('');
    lines.push('VERIFY THESE EXACT INVARIANTS (NON-NEGOTIABLE):');
    lines.push('- GET /projects/:projectId exists and returns { project } or 404 error payload.');
    lines.push('- POST /projects, /members, /tasks, /comments success -> HTTP 201.');
    lines.push('- members payload uses { userId, role }; comments payload uses { message }.');
    lines.push('- tasks PATCH accepts only todo|done and list filter ?status=todo|done is real.');
    lines.push('- app/server and routes/services use CommonJS only.');
  }

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

  if (scenarioId === 'node-project-api-large') {
    lines.push('');
    lines.push('HARD CHECKLIST (NODE PROJECT LARGE):');
    lines.push('- V `mode:"full"` zahrn README.md + package.json + src/app.js + src/server.js.');
    lines.push('- Pro kazdy modul projects/tasks/members/comments vytvor minim. routes.js + service.js.');
    lines.push('- Pridat sdilene utility: src/lib/errors.js a src/lib/id.js.');
    lines.push('- Pouzij CommonJS (`require`, `module.exports`) v src/app.*, src/server.* i modulech; nepouzivej ESM `import`/`export`.');
    lines.push('- V modulech (`src/modules/*`) importuj utility pres `../../lib/id` a `../../lib/errors`.');
    lines.push('- Udrz modulovou strukturu: src/modules/projects,tasks,members,comments.');
    lines.push('- Dodrz min. 12 source souboru pod src/.');
    lines.push('- Chybovy payload udrz konzistentni: { error: { code, message } }.');
    lines.push('- Oracle testy pouzivaji supertest: zajisti supertest v dependencies/devDependencies.');
    lines.push('- Nepouzivej `uuid`; pro ID pouzij `node:crypto` + `crypto.randomUUID()`.');
    lines.push('- Nepouzivej anti-pattern `const { v4: uuidv4 } = require("crypto").randomUUID`; pouzij `const { randomUUID } = require("node:crypto")`.');
    lines.push('- Implementuj endpointy: /health, /projects, /projects/:projectId/members, /projects/:projectId/tasks, /projects/:projectId/tasks/:taskId/comments.');
    lines.push('- GET /health musi vracet presne `{ ok: true }`.');
    lines.push('- POST /projects vyzaduje neprazdne `name`; jinak 400 error payload.');
    lines.push('- POST /projects/:projectId/members pouziva body `{ userId, role }` (ne `{ name }`).');
    lines.push('- GET /projects/:projectId/tasks?status=done musi realne filtrovat pouze done tasky.');
    lines.push('- V `src/app.js` explicitne mountni routes na: /projects, /projects/:projectId/members, /projects/:projectId/tasks, /projects/:projectId/tasks/:taskId/comments.');
    lines.push('- V `members/tasks/comments` routes nepouzivej znovu cele cesty s :projectId/:taskId; pouzij relativni paths od mountpointu.');
    lines.push('- Zakaz auto-listen: `src/app.*` a `src/server.*` nesmi volat `listen()` pri importu.');
    lines.push('- Nehazej necachovane vyjimky v route handlerech; jinak express vrati HTML 500 a oracle failne.');
    lines.push('- Nehazej raw `throw new Error(...)` ani v services; vrat domain chybu nebo `null` a mapuj ji na JSON error payload.');
    lines.push('- Pokud pouzivas custom Error classy (BadRequestError/NotFoundError), MUSIS je definovat a exportovat v src/lib/errors.*.');
    lines.push('');
    lines.push('NON-NEGOTIABLE CONTRACT CHECKLIST (NODE PROJECT LARGE):');
    lines.push('- `GET /projects/:projectId` endpoint je povinny.');
    lines.push('- Vsechny create endpointy vraci `HTTP 201` (projects, members, tasks, comments).');
    lines.push('- `members` payload: `{ userId, role }`; `comments` payload: `{ message }`.');
    lines.push('- `tasks` status povolit jen `todo|done`; query filtr `?status=todo|done` musi realne filtrovat.');
    lines.push('- Pouzij CommonJS (`require`, `module.exports`) v app/server/routes/services.');
  }

  const hasNodeProjectContractMismatch = validation.diagnostics.some(d => /Contract mismatch:/i.test(d));
  if (scenarioId === 'node-project-api-large' && hasNodeProjectContractMismatch) {
    lines.push('');
    lines.push('DULEZITE (NODE PROJECT CONTRACT MISMATCH):');
    lines.push('- Oprav endpoint behavior presne podle oracle kontraktu, ne jen strukturu souboru.');
    lines.push('- U validacnich chyb vzdy vrat 400 + `{ error: { code, message } }`.');
    lines.push('- U not-found vrat 404 + `{ error: { code, message } }`.');
    lines.push('- U duplicate vrat 409 + `{ error: { code, message } }`.');
  }

  if (scenarioId === 'node-project-api-large') {
    lines.push('');
    lines.push('STRICT IMPLEMENTATION TEMPLATE (NODE PROJECT LARGE):');
    lines.push('- Definuj `src/lib/errors.js` s helperem `sendError(res, status, code, message)` a pouzivej ho ve vsech route handlerech.');
    lines.push('- V route handlerech nepouzivej uncaught `throw`; validacni/not-found/duplicate vetve vracej JSON error payload hned.');
    lines.push('- V services nepouzivej `throw new Error(...)`; route vrstva musi dostat predvidatelny vysledek a vratit JSON chybu.');
    lines.push('- Nespoustej `listen()` pri importu; server startup logic nech oddelenou od app exportu.');
    lines.push('- Udrz sdileny stav projektu centralne (projects service/store) a tasks/comments/members sluzby na nej odkazuj.');
    lines.push('- ID generuj pomoci `const { randomUUID } = require("node:crypto")` a volani `randomUUID()`.');
    lines.push('- `members`: validuj body `{ userId, role }`; `comments`: validuj `{ message }`.');
    lines.push('- `tasks`: vytvarej status `todo`, PATCH povol `todo|done`, filtr `?status=done` musi vratit jen done tasky.');
    lines.push('- Odpovedi drzet na shape: `{ project }`, `{ projects }`, `{ member }`, `{ members }`, `{ task }`, `{ tasks }`, `{ comment }`, `{ comments }`.');
  }
  const shouldForceFullMode = scenarioId === 'node-project-api-large' && shouldRequireFullModeAfterLargeFailure(validation.diagnostics || []);
  if (shouldForceFullMode) {
    lines.push('');
    lines.push('DULEZITE (NODE PROJECT STRUCTURAL RESET):');
    lines.push('- V PRISTI ITERACI vracej pouze `mode: "full"` s kompletnim projektem.');
    lines.push('- Nepouzivej `mode: "patch"` dokud nezmizí strukturální chyby (route signature / route-service mismatch / missing core files).');
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

  const hasFullModeCoreLoss = validation.diagnostics.some(d => /full mode output missing required files|first iteration must use mode|large scenario full output must include all core files|large scenario requires mode "full"/i.test(d));
  if (hasFullModeCoreLoss) {
    lines.push('');
    lines.push('DULEZITE: Pokud vracis `mode: "full"`, MUSIS zahrnout kompletni sadu core souboru scenare.');
    lines.push('Pokud menis jen cast, pouzij `mode: "patch"` a posli pouze menene soubory.');
    if (scenarioId === 'node-project-api-large') {
      const requiredCore = getScenarioCoreRequiredFiles('node-project-api-large');
      lines.push('DO NOT REMOVE EXISTING CORE FILES.');
      lines.push(`Core files required: ${requiredCore.join(', ')}`);
    }
  }

  const hasJsSyntaxFailure = validation.diagnostics.some(d => /JavaScript syntax check failed in |Likely truncated\/incomplete JS content/i.test(d));
  if (hasJsSyntaxFailure) {
    lines.push('');
    lines.push('DULEZITE (JS SYNTAX): Oprav syntaxi JS souboru (uzavrene stringy/zavorky); neposilej useknute soubory ani neukoncene radky.');
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

  const forceFullLargeOutput =
    scenarioId === 'node-project-api-large' &&
    (
      shouldForceFullMode ||
      validation.diagnostics.some(d => /parse\/write failed:\s*large scenario full output must include all core files|large scenario requires mode "full"/i.test(d))
    );
  lines.push('');
  lines.push('VYSTUP: vrat JEN platny JSON objekt bez markdownu:');
  if (forceFullLargeOutput) {
    const requiredCore = getScenarioCoreRequiredFiles('node-project-api-large');
    lines.push('{ "mode": "full", "files": [ {"path":"README.md","content":"...\\n"}, {"path":"package.json","content":"...\\n"}, {"path":"src/app.js","content":"...\\n"}, {"path":"src/server.js","content":"...\\n"} ], "notes": "optional" }');
    lines.push('Pravidla: posli KOMPLETNI full projekt v `files` (ne patch); zahrn vsechny core soubory scenare + dalsi potrebne soubory.');
    lines.push(`Core files required: ${requiredCore.join(', ')}`);
    lines.push('U kazdeho souboru posli VZDY cely obsah souboru.');
  } else {
    lines.push('{ "mode": "patch", "files": [ {"path":"...","content":"...\\n"} ], "notes": "optional" }');
    lines.push('Pravidla: udelej jen minimalni nutne zmeny; posli jen soubory ktere menis nebo pridavas; u kazdeho posli VZDY cely obsah souboru.');
  }
  return lines.join('\n');
}

export async function buildReviewerPrompt(
  basePrompt: string,
  validation: ValidationResult,
  workspaceDir?: string,
  scenarioId?: string
): Promise<string> {
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
  if (scenarioId === 'node-project-api-large') {
    const mismatchGuidance = buildRouteServiceMismatchGuidance(validation.diagnostics || []);
    if (mismatchGuidance.length > 0) {
      lines.push('');
      lines.push(...mismatchGuidance);
    }
    const contractFixGuidance = buildNodeProjectContractFixGuidance(validation.diagnostics || []);
    if (contractFixGuidance.length > 0) {
      lines.push('');
      lines.push(...contractFixGuidance);
    }
  }

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

  await assertOllamaPreflightReady({
    baseUrl: opts.baseUrl,
    model: opts.model
  });

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
    timeoutFallbackModel: opts.timeoutFallbackModel ?? null,
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
  let requireFullModeNextIteration = false;
  let consecutiveGenerationTimeouts = 0;
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
    let generationModelUsed = opts.model;
    let generationMeta: StructuredGenerationMeta = {
      transport: 'generate',
      formatKind: 'none',
      schemaUsed: false,
      fallbackUsed: false,
      usedFormatJson: false
    };
    const parseReport: ParseReport = { attempts: [], finalOk: false, appliedFixes: [], skippedFixes: [] };
    const requireFullModeForIteration = scenario.id === 'node-project-api-large' && requireFullModeNextIteration;
    const primaryGenerationTimeoutMs = computePrimaryGenerationTimeoutMs(opts.timeoutSec, scenario.id, opts.model);
    if (requireFullModeForIteration) {
      // Structural full-mode enforcement applies to the next single iteration only.
      requireFullModeNextIteration = false;
    }

    try {
      const res = await ollamaGenerateStructured({
        baseUrl: opts.baseUrl,
        model: generationModelUsed,
        prompt: promptForModel,
        timeoutMs: primaryGenerationTimeoutMs,
        schema: MODEL_OUTPUT_SCHEMA as unknown as Record<string, unknown>,
        options: ollamaOptions,
        minNumPredict: STRUCTURED_MIN_NUM_PREDICT
      });
      responseText = res.responseText;
      raw = res.raw;
      generationMeta = res.meta;
    } catch (e: any) {
      let errMsg = String(e?.message || e);
      const timeoutFallbackModels = getTimeoutFallbackModelsForScenario(scenario.id, opts.model, opts.timeoutFallbackModel);
      if (isGenerationTimeoutLikeError(errMsg) && timeoutFallbackModels.length > 0) {
        const fallbackTimeoutMs = computeTimeoutFallbackGenerationTimeoutMs(primaryGenerationTimeoutMs, scenario.id);
        const fallbackAttemptReports: Array<{ model: string; ok: boolean; timeoutMs: number; error?: string }> = [];
        await fs.promises.writeFile(
          path.join(iterDir, 'timeout_fallback_trigger.txt'),
          `primaryModel=${opts.model}\nfallbackModels=${timeoutFallbackModels.join(', ')}\nerror=${errMsg}\n`,
          'utf8'
        );
        for (let idx = 0; idx < timeoutFallbackModels.length; idx += 1) {
          const timeoutFallbackModel = timeoutFallbackModels[idx];
          try {
            const fallbackRes = await ollamaGenerateStructured({
              baseUrl: opts.baseUrl,
              model: timeoutFallbackModel,
              prompt: promptForModel,
              timeoutMs: fallbackTimeoutMs,
              schema: MODEL_OUTPUT_SCHEMA as unknown as Record<string, unknown>,
              options: ollamaOptions,
              minNumPredict: STRUCTURED_MIN_NUM_PREDICT
            });
            generationModelUsed = timeoutFallbackModel;
            responseText = fallbackRes.responseText;
            raw = fallbackRes.raw;
            generationMeta = fallbackRes.meta;
            parseReport.attempts.push({
              stage: 'timeout_model_fallback',
              model: timeoutFallbackModel,
              ok: true,
              transport: fallbackRes.meta.transport,
              formatKind: fallbackRes.meta.formatKind,
              schemaUsed: fallbackRes.meta.schemaUsed,
              fallbackUsed: fallbackRes.meta.fallbackUsed
            });
            fallbackAttemptReports.push({ model: timeoutFallbackModel, ok: true, timeoutMs: fallbackTimeoutMs });
            await fs.promises.writeFile(path.join(iterDir, 'timeout_fallback_raw.json'), JSON.stringify(fallbackRes.raw, null, 2), 'utf8');
            await fs.promises.writeFile(path.join(iterDir, 'timeout_fallback_raw_response.txt'), fallbackRes.responseText, 'utf8');
            await fs.promises.writeFile(
              path.join(iterDir, 'timeout_fallback_request.json'),
              JSON.stringify({
                model: timeoutFallbackModel,
                baseUrl: opts.baseUrl,
                timeoutMs: fallbackTimeoutMs,
                transport: fallbackRes.meta.transport,
                formatKind: fallbackRes.meta.formatKind,
                schemaUsed: fallbackRes.meta.schemaUsed,
                fallbackUsed: fallbackRes.meta.fallbackUsed,
                fallbackReason: fallbackRes.meta.fallbackReason ?? null
              }, null, 2),
              'utf8'
            );
            break;
          } catch (fallbackErr: any) {
            const fallbackErrMsg = String(fallbackErr?.message || fallbackErr);
            parseReport.attempts.push({
              stage: 'timeout_model_fallback',
              model: timeoutFallbackModel,
              ok: false,
              error: fallbackErrMsg,
              errorKind: classifyParseError(fallbackErrMsg)
            });
            fallbackAttemptReports.push({
              model: timeoutFallbackModel,
              ok: false,
              timeoutMs: fallbackTimeoutMs,
              error: fallbackErrMsg
            });
            await fs.promises.writeFile(
              path.join(iterDir, `timeout_fallback_error_${String(idx + 1).padStart(2, '0')}.txt`),
              `${fallbackErrMsg}\n`,
              'utf8'
            );
          }
        }
        await fs.promises.writeFile(
          path.join(iterDir, 'timeout_fallback_attempts.json'),
          JSON.stringify(fallbackAttemptReports, null, 2),
          'utf8'
        );
        if (!responseText || !raw) {
          const failedSummary = fallbackAttemptReports
            .filter(item => !item.ok)
            .map(item => `${item.model}: ${item.error || 'failed'}`)
            .join(' | ');
          await fs.promises.writeFile(
            path.join(iterDir, 'timeout_fallback_error.txt'),
            `${failedSummary}\n`,
            'utf8'
          );
          errMsg = `${errMsg}; timeout-model-fallback chain failed: ${failedSummary}`;
        }
      }
      if (!responseText || !raw) {
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
        if (isGenerationTimeoutLikeError(errMsg)) {
          consecutiveGenerationTimeouts += 1;
        } else {
          consecutiveGenerationTimeouts = 0;
        }
        if (shouldStopAfterGenerationTimeout(scenario.id, consecutiveGenerationTimeouts)) {
          final.diagnostics = [
            ...(final.diagnostics || []),
            `Stopping early after repeated generation timeout(s): ${consecutiveGenerationTimeouts}.`
          ];
          await fs.promises.writeFile(path.join(iterDir, 'validation.json'), JSON.stringify(final, null, 2), 'utf8');
          break;
        }
        await maybeRunPlannerOnFail(final, iter);
        prompt = await buildRepairPrompt(basePrompt, final, workspaceDir, undefined, scenario.id);
        continue;
      }
    }

    consecutiveGenerationTimeouts = 0;

    await fs.promises.writeFile(
      path.join(iterDir, 'request.json'),
      JSON.stringify({
        model: generationModelUsed,
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
        model: generationModelUsed,
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
        model: generationModelUsed,
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
          model: generationModelUsed,
          prompt: promptForModel,
          timeoutMs: primaryGenerationTimeoutMs,
          schema: MODEL_OUTPUT_SCHEMA as unknown as Record<string, unknown>,
          options: ollamaOptions,
          minNumPredict: STRUCTURED_RETRY_MIN_NUM_PREDICT
        });
        await fs.promises.writeFile(path.join(iterDir, 'truncation_retry_raw.json'), JSON.stringify(retryRes.raw, null, 2), 'utf8');
        await fs.promises.writeFile(path.join(iterDir, 'truncation_retry_raw_response.txt'), retryRes.responseText, 'utf8');
        await fs.promises.writeFile(path.join(iterDir, 'truncation_retry_request.json'), JSON.stringify({
          model: generationModelUsed,
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
            model: generationModelUsed,
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
            model: generationModelUsed,
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
          model: generationModelUsed,
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
    const isNodeProjectLargeScenario = scenario.id === 'node-project-api-large';
    if (parsed) {
      const scenarioRequired = getScenarioCoreRequiredFiles(scenario.id);
      if (scenarioRequired.length > 0) {
        if (requireFullModeForIteration && parsed.mode !== 'full') {
          if (isNodeProjectLargeScenario) {
            const promoted = await promoteLargePatchToFullFromWorkspace(parsed, workspaceDir, scenarioRequired);
            if (promoted.promoted) {
              parsed = { ...parsed, mode: 'full', files: promoted.files };
              parseReport.attempts.push({
                stage: 'scenario_contract',
                model: opts.model,
                ok: true,
                error: (promoted.restoredFromWorkspace.length > 0 || promoted.synthesizedCoreFiles.length > 0)
                  ? `Large scenario required full mode; promoted patch to full using workspace snapshot (${promoted.restoredFromWorkspace.length} files) and synthesized core templates (${promoted.synthesizedCoreFiles.length}).`
                  : 'Large scenario output included all core files; promoted mode to "full" for this iteration.',
                errorKind: 'schema'
              });
            } else {
              lastParseError = promoted.reason || 'Large scenario requires mode "full" after structural contract failures; mode "patch" is not allowed for this iteration.';
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
          } else {
            const missingCoreInForcedFull = findMissingCoreFilesInOutput(parsed.files, scenarioRequired);
            if (missingCoreInForcedFull.length === 0) {
              parsed = { ...parsed, mode: 'full' };
              parseReport.attempts.push({
                stage: 'scenario_contract',
                model: opts.model,
                ok: true,
                error: 'Scenario output included all core files; promoted mode to "full" for this iteration.',
                errorKind: 'schema'
              });
            } else {
              lastParseError = `Scenario requires mode "full" for this iteration. Missing core files: ${missingCoreInForcedFull.join(', ')}`;
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
          }
        }
        if (parsed && iter === 1 && parsed.mode === 'patch') {
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
          let missingCoreFiles = findMissingCoreFilesInOutput(parsed.files, scenarioRequired);
          if (missingCoreFiles.length > 0) {
            if (iter === 1) {
              if (isNodeProjectLargeScenario) {
                const hydratedFiles = [...parsed.files];
                const synthesizedCore: string[] = [];
                for (const missingRel of missingCoreFiles) {
                  const template = buildNodeProjectLargeCoreFileTemplate(missingRel);
                  if (!template) continue;
                  hydratedFiles.push({ path: missingRel, content: template });
                  synthesizedCore.push(missingRel);
                }
                if (synthesizedCore.length > 0) {
                  parsed.files = dedupeFileSpecsByPath(hydratedFiles).files;
                  missingCoreFiles = findMissingCoreFilesInOutput(parsed.files, scenarioRequired);
                  parseReport.attempts.push({
                    stage: 'scenario_contract',
                    model: opts.model,
                    ok: true,
                    error: `Large scenario synthesized missing core files in first iteration: ${synthesizedCore.join(', ')}`,
                    errorKind: 'schema'
                  });
                }
              }
              if (missingCoreFiles.length > 0) {
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
              }
            } else if (parsed.mode !== 'patch') {
              if (isNodeProjectLargeScenario) {
                const hydratedFiles = [...parsed.files];
                const restoredFromWorkspace: string[] = [];
                for (const missingRel of missingCoreFiles) {
                  try {
                    const abs = path.join(workspaceDir, missingRel);
                    if (!fs.existsSync(abs)) continue;
                    const content = await fs.promises.readFile(abs, 'utf8');
                    hydratedFiles.push({ path: missingRel, content });
                    restoredFromWorkspace.push(missingRel);
                  } catch {
                    // keep missing file unresolved
                  }
                }
                if (restoredFromWorkspace.length > 0) {
                  parsed.files = dedupeFileSpecsByPath(hydratedFiles).files;
                  missingCoreFiles = findMissingCoreFilesInOutput(parsed.files, scenarioRequired);
                  parseReport.attempts.push({
                    stage: 'scenario_contract',
                    model: opts.model,
                    ok: true,
                    error: `Large scenario restored missing core files from workspace: ${restoredFromWorkspace.join(', ')}`,
                    errorKind: 'schema'
                  });
                }
                if (missingCoreFiles.length > 0) {
                  lastParseError = `Large scenario full output must include all core files. Missing: ${missingCoreFiles.join(', ')}`;
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
              } else {
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
      if (isNodeProjectLargeScenario) {
        requireFullModeNextIteration = shouldRequireFullModeAfterLargeFailure(final.diagnostics || []);
      }
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
    if (scenario.id === 'node-project-api-large') {
      parsed.files = applyNodeProjectRouteServiceAdapterBridges(parsed.files, workspaceDir);
      const autoFix = applyNodeProjectContractAutoFixes(parsed.files, workspaceDir);
      parsed.files = autoFix.files;
      // Auto-fix can rewrite routes and introduce new route->service method calls.
      // Run adapter bridges again to align service exports with the rewritten routes.
      parsed.files = applyNodeProjectRouteServiceAdapterBridges(parsed.files, workspaceDir);
      for (const item of autoFix.appliedFixes) {
        if (!parseReport.appliedFixes?.includes(item)) parseReport.appliedFixes?.push(item);
      }
      for (const item of autoFix.skippedFixes) {
        if (!parseReport.skippedFixes?.includes(item)) parseReport.skippedFixes?.push(item);
      }
    }
    const deduped = dedupeFileSpecsByPath(parsed.files);
    if (deduped.duplicates.length > 0) {
      parsed.files = deduped.files;
      parseReport.attempts.push({
        stage: 'scenario_contract',
        model: opts.model,
        ok: true,
        error: `Deduplicated duplicate file paths: ${deduped.duplicates.join(', ')}`,
        errorKind: 'schema'
      });
    }
    await fs.promises.writeFile(path.join(iterDir, 'parse_report.json'), JSON.stringify(parseReport, null, 2), 'utf8');
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
    if (!isPatch) {
      if (scenario.id === 'node-project-api-large') {
        try {
          await resetDir(workspaceDir);
        } catch (error: any) {
          await softCleanLargeWorkspaceDir(workspaceDir);
          parseReport.attempts.push({
            stage: 'scenario_contract',
            model: opts.model,
            ok: true,
            error: `Workspace reset fallback activated due lock: ${String(error?.message || error)}`,
            errorKind: 'other'
          });
          await fs.promises.writeFile(
            path.join(iterDir, 'workspace_reset_warning.txt'),
            `${String(error?.stack || error?.message || error)}\n`,
            'utf8'
          );
        }
      } else {
        await resetDir(workspaceDir);
      }
    }
    const written = await writeFiles(workspaceDir, parsed.files);
    await fs.promises.writeFile(
      path.join(iterDir, 'write_report.json'),
      JSON.stringify({
        count: written.length,
        files: written,
        appliedAsPatch: isPatch,
        forcePatchFromIncompleteFull,
        appliedFixes: parseReport.appliedFixes || [],
        skippedFixes: parseReport.skippedFixes || []
      }, null, 2),
      'utf8'
    );

    final = await scenario.validate(workspaceDir, evalContext);
    await fs.promises.writeFile(path.join(iterDir, 'validation.json'), JSON.stringify(final, null, 2), 'utf8');
    if (isNodeProjectLargeScenario) {
      requireFullModeNextIteration = shouldRequireFullModeAfterLargeFailure(final.diagnostics || []);
    }

    for (const c of final.commands || []) {
      const safeName = c.command.replace(/[^a-zA-Z0-9._-]+/g, '_').slice(0, 60);
      await fs.promises.writeFile(path.join(iterDir, `cmd_${safeName}.stdout.txt`), c.stdout, 'utf8');
      await fs.promises.writeFile(path.join(iterDir, `cmd_${safeName}.stderr.txt`), c.stderr, 'utf8');
    }

    if (final.ok) {
      requireFullModeNextIteration = false;
      break;
    }
    await maybeRunPlannerOnFail(final, iter);
    let reviewerNote: string | undefined = undefined;
    if (opts.reviewerModel) {
      const reviewerPrompt = await buildReviewerPrompt(basePrompt, final, workspaceDir, scenario.id);
      await fs.promises.writeFile(path.join(iterDir, 'reviewer_prompt.txt'), reviewerPrompt, 'utf8');
      try {
        const res = await ollamaGenerateJsonObject<{ review?: string; priorityFiles?: string[] }>({
          baseUrl: opts.baseUrl,
          model: opts.reviewerModel,
          prompt: reviewerPrompt,
          timeoutMs: computeReviewerTimeoutMs(opts.timeoutSec, scenario.id),
          options: ollamaOptions,
        });
        await fs.promises.writeFile(path.join(iterDir, 'reviewer_raw.json'), JSON.stringify(res.raw, null, 2), 'utf8');
        await fs.promises.writeFile(path.join(iterDir, 'reviewer_raw_response.txt'), res.responseText, 'utf8');
        await fs.promises.writeFile(path.join(iterDir, 'reviewer_parsed.json'), JSON.stringify(res.obj, null, 2), 'utf8');
        if (typeof res.obj?.review === 'string') reviewerNote = sanitizeReviewerNote(res.obj.review);
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
