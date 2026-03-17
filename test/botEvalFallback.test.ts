import { strict as assert } from 'assert';
import fs from 'fs';
import os from 'os';
import path from 'path';

import {
  applyTargetedTsCsvFallback,
  hasTsCsvFilterReturnTypeDrift,
  normalizeNodeApiServerContract,
  normalizePythonOracleCliContract,
  normalizeScenarioFileContentBeforeWrite,
  normalizeDeterministicFallbackMode,
  normalizeTsTodoCliContract,
  normalizeTsTodoPackageManifest,
  normalizeTsTodoStorePathHandling,
  normalizeTsTodoTypeSafety,
  shouldFastFailNodeApiDiagnostics,
  shouldFastFailTsTodoDiagnostics,
  validateTsCsvOracleOnce,
} from '../scripts/botEval';

describe('botEval deterministic fallback helpers', () => {
  it('normalizes fallback mode with safe default', () => {
    assert.equal(normalizeDeterministicFallbackMode('off'), 'off');
    assert.equal(normalizeDeterministicFallbackMode('always'), 'always');
    assert.equal(normalizeDeterministicFallbackMode('on-fail'), 'on-fail');
    assert.equal(normalizeDeterministicFallbackMode('ON-FAIL'), 'on-fail');
    assert.equal(normalizeDeterministicFallbackMode('invalid'), 'on-fail');
    assert.equal(normalizeDeterministicFallbackMode(undefined), 'on-fail');
  });

  it('detects TS fatal diagnostics for fast-fail', () => {
    const fatal = [
      'src/store.ts must export TaskStore as named export (not default-only)',
      'CLI must parse process.argv manually; do not use commander/yargs/minimist'
    ];
    assert.equal(shouldFastFailTsTodoDiagnostics(fatal), true);

    const benign = ['README.md missing basic usage (add/list)'];
    assert.equal(shouldFastFailTsTodoDiagnostics(benign), false);
  });

  it('detects Node fatal diagnostics for fast-fail', () => {
    const fatal = [
      'src/server.js must export createServer (e.g. module.exports = { createServer })',
      'src/server.js must not call listen() internally; tests call listen() on returned server'
    ];
    assert.equal(shouldFastFailNodeApiDiagnostics(fatal), true);

    const additionalFatal = ['openapi.json missing "/openapi.json" path'];
    assert.equal(shouldFastFailNodeApiDiagnostics(additionalFatal), true);
  });

  it('normalizes ts-todo store path handling for absolute data paths', () => {
    const src = [
      "import { readFileSync, writeFileSync } from 'fs';",
      "import { join } from 'path';",
      '',
      'class TaskStore {',
      '  private filePath: string;',
      '  constructor(filePath: string) {',
      "    this.filePath = join(__dirname, '..', filePath);",
      '  }',
      '  list() {',
      "    const data = readFileSync(this.filePath, 'utf8');",
      '    return JSON.parse(data);',
      '  }',
      '  save(tasks: any[]) {',
      "    writeFileSync(this.filePath, JSON.stringify(tasks, null, 2));",
      '  }',
      '  fallbackList() {',
      '    if (fs.existsSync(this.filePath)) return [];',
      '    return [];',
      '  }',
      '}',
      ''
    ].join('\n');
    const out = normalizeTsTodoStorePathHandling(src);
    assert.ok(/this\.filePath\s*=\s*filePath;/.test(out));
    assert.ok(!/join\(__dirname,\s*'\.\.',\s*filePath\)/.test(out));
    assert.ok(/existsSync\(/.test(out));
    assert.ok(!/fs\.existsSync\(/.test(out));
    assert.ok(/const\s*\{\s*existsSync,\s*readFileSync,\s*writeFileSync\s*\}\s*=\s*require\("node:fs"\);/.test(out));
    assert.ok(/declare const require: any;/.test(out));
    assert.ok(/JSON\.stringify\(\{ tasks \}, null, 2\)/.test(out));
    assert.ok(/Array\.isArray\(parsed\?\.tasks\)/.test(out));
  });

  it('normalizes ts-todo store crypto + existsSync compatibility pitfalls', () => {
    const src = [
      "import { v4 as uuidv4 } from 'node:crypto';",
      "import fs from 'node:fs';",
      '',
      'class TaskStore {',
      '  private filePath: string;',
      '  constructor(filePath: string) {',
      '    this.filePath = filePath;',
      '  }',
      '  list() {',
      '    if (!existsSync(this.filePath)) return [];',
      "    const data = fs.readFileSync(this.filePath, 'utf8');",
      '    return JSON.parse(data).tasks || [];',
      '  }',
      '}',
      ''
    ].join('\n');
    const out = normalizeTsTodoStorePathHandling(src);
    assert.ok(/import\s*\{\s*randomUUID\s+as\s+uuidv4\s*\}\s*from\s*'node:crypto'/.test(out));
    assert.ok(!/\bv4\s+as\s+uuidv4\b/.test(out));
    assert.ok(/fs\.existsSync\(/.test(out));
  });

  it('normalizes ts-todo store JSON.parse(data) || [] pattern to task-envelope read', () => {
    const src = [
      "const fs = require('node:fs');",
      '',
      'export class TaskStore {',
      '  list() {',
      "    const data = fs.readFileSync('x.json', 'utf8');",
      '    return JSON.parse(data) || [];',
      '  }',
      '}',
      ''
    ].join('\n');
    const out = normalizeTsTodoStorePathHandling(src);
    assert.ok(out.includes('const parsed = JSON.parse(data);'));
    assert.ok(out.includes('Array.isArray(parsed?.tasks) ? parsed.tasks'));
    assert.ok(!out.includes('return JSON.parse(data) || [];'));
  });

  it('injects crypto require when store uses crypto.randomUUID without binding', () => {
    const src = [
      'declare const require: any;',
      'declare const process: any;',
      '',
      'export class TaskStore {',
      '  add(title: string) {',
      '    return { id: crypto.randomUUID(), title, done: false, createdAt: new Date().toISOString() };',
      '  }',
      '}',
      ''
    ].join('\n');
    const out = normalizeTsTodoStorePathHandling(src);
    assert.ok(out.includes('const crypto = require("node:crypto");'));
    assert.ok(/crypto\.randomUUID\(/.test(out));
  });

  it('normalizes ts-todo store done/remove signatures to avoid strict null/undefined return errors', () => {
    const src = [
      "const fs = require('node:fs');",
      '',
      'type Task = { id: string; done: boolean; title: string; createdAt: string };',
      '',
      'export class TaskStore {',
      '  done(id: string): Task {',
      '    const tasks: Task[] = [];',
      '    const task = tasks.find(t => t.id === id);',
      '    if (task) {',
      '      task.done = true;',
      '    }',
      '    return task;',
      '  }',
      '',
      '  remove(id: string): Task {',
      '    return null;',
      '  }',
      '}',
      ''
    ].join('\n');
    const out = normalizeTsTodoStorePathHandling(src);
    assert.ok(out.includes('done(id: string): Task | null {'));
    assert.ok(out.includes('remove(id: string): Task | null {'));
    assert.ok(out.includes('return task || null;'));
  });

  it('normalizes ts catch blocks to avoid unknown catch type failures', () => {
    const src = [
      'try {',
      '  doWork();',
      '} catch (error) {',
      '  console.error(error.message);',
      '}',
      ''
    ].join('\n');
    const out = normalizeTsTodoTypeSafety(src);
    assert.ok(out.includes('catch (error: any) {'));
  });

  it('detects ts-csv CsvFilter return-type drift that requires canonical csv fallback', () => {
    const src = [
      'export class CsvFilter {',
      '  where(predicate: (row: Record<string, string>) => boolean): CsvFilter {',
      '    return this;',
      '  }',
      '  select(columns: string[]): CsvFilter {',
      '    return this;',
      '  }',
      '  sortBy(column: string): CsvFilter {',
      '    return this;',
      '  }',
      '}',
      ''
    ].join('\n');
    assert.equal(hasTsCsvFilterReturnTypeDrift(src), true);
    const realistic = [
      'export class CsvFilter {',
      '  private rows: Record<string, string>[];',
      '  where(predicate: (row: Record<string, string>) => boolean): CsvFilter {',
      '    const filteredRows = this.rows.filter(predicate);',
      '    return new CsvFilter(filteredRows);',
      '  }',
      '}',
      ''
    ].join('\n');
    assert.equal(hasTsCsvFilterReturnTypeDrift(realistic), true);
    assert.equal(hasTsCsvFilterReturnTypeDrift('export class CsvFilter { count(): number { return 0; } }'), false);
  });

  it('recovers a raw ts-csv workspace through targeted csv fallback only', async function () {
    this.timeout(120000);
    const workspaceDir = fs.mkdtempSync(path.join(os.tmpdir(), 'bot-eval-ts-csv-targeted-'));

    try {
      fs.mkdirSync(path.join(workspaceDir, 'src'), { recursive: true });
      fs.writeFileSync(path.join(workspaceDir, 'README.md'), '# CSV tool\n\nMinimal workspace for oracle validation.\n', 'utf8');
      fs.writeFileSync(path.join(workspaceDir, 'package.json'), JSON.stringify({
        name: 'ts-csv-raw-repro',
        version: '1.0.0',
        private: true
      }, null, 2) + '\n', 'utf8');
      fs.writeFileSync(path.join(workspaceDir, 'tsconfig.json'), JSON.stringify({
        compilerOptions: {
          target: 'ES2020',
          module: 'commonjs',
          moduleResolution: 'node',
          rootDir: 'src',
          outDir: 'dist',
          strict: true,
          esModuleInterop: true,
          skipLibCheck: true
        },
        include: ['src']
      }, null, 2) + '\n', 'utf8');
      fs.writeFileSync(path.join(workspaceDir, 'src', 'csv.ts'), [
        'export class CsvParser {',
        '  parse(text: string): Record<string, string>[] {',
        '    const lines = text.trim().split(/\\r?\\n/);',
        '    if (lines.length === 0) return [];',
        "    const headers = lines[0].split(',');",
        '    return lines.slice(1).filter(Boolean).map(line => {',
        "      const values = line.split(',');",
        '      return headers.reduce((row, header, index) => {',
        "        row[header] = values[index] || '';",
        '        return row;',
        '      }, {} as Record<string, string>);',
        '    });',
        '  }',
        '',
        '  stringify(rows: Record<string, string>[]): string {',
        '    if (rows.length === 0) return "";',
        '    const headers = Object.keys(rows[0]);',
        '    const body = rows.map(row => headers.map(header => row[header] || "").join(","));',
        "    return [headers.join(','), ...body].join('\\n');",
        '  }',
        '}',
        '',
        'export class CsvFilter {',
        '  constructor(private rows: Record<string, string>[]) {}',
        '  where(predicate: (row: Record<string, string>) => boolean): CsvFilter {',
        '    return new CsvFilter(this.rows.filter(predicate));',
        '  }',
        '  select(columns: string[]): CsvFilter {',
        '    return new CsvFilter(this.rows.map(row => columns.reduce((out, column) => {',
        "      out[column] = row[column] || '';",
        '      return out;',
        '    }, {} as Record<string, string>)));',
        '  }',
        '  sortBy(column: string): CsvFilter {',
        '    return new CsvFilter([...this.rows].sort((left, right) => left[column].localeCompare(right[column])));',
        '  }',
        '  count(): number {',
        '    return this.rows.length;',
        '  }',
        '}',
        ''
      ].join('\n'), 'utf8');
      fs.writeFileSync(path.join(workspaceDir, 'src', 'cli.ts'), [
        'declare const require: any;',
        'declare const process: any;',
        "const fs = require('node:fs');",
        "import { CsvParser, CsvFilter } from './csv';",
        '',
        'function help() {',
        '  console.log(`Usage:\n  node dist/cli.js parse --input <file>\n  node dist/cli.js stats --input <file>\n  node dist/cli.js --help`);',
        '}',
        '',
        'if (process.argv.length < 3) {',
        '  help();',
        '  process.exit(1);',
        '}',
        '',
        'const command = process.argv[2];',
        '',
        "if (command === '--help') {",
        '  help();',
        '  process.exit(0);',
        "} else if (command === 'parse' || command === 'stats') {",
        "  const inputIndex = process.argv.indexOf('--input');",
        '  if (inputIndex === -1 || inputIndex + 1 >= process.argv.length) {',
        "    console.error('Missing --input argument');",
        '    process.exit(1);',
        '  }',
        '',
        '  const inputFile = process.argv[inputIndex + 1];',
        '  if (!fs.existsSync(inputFile)) {',
        '    console.error(`File not found: ${inputFile}`);',
        '    process.exit(1);',
        '  }',
        '',
        "  const fileContent = fs.readFileSync(inputFile, 'utf8');",
        '  const parser = new CsvParser();',
        '  const rows = parser.parse(fileContent);',
        '',
        "  if (command === 'parse') {",
        '    console.log(JSON.stringify(rows));',
        "  } else if (command === 'stats') {",
        '    const filter = new CsvFilter(rows);',
        '    console.log(`Rows: ${filter.count()}`);',
        '    console.log(`Columns: ${Object.keys(rows[0]).join(\', \')}`);',
        '  }',
        '} else {',
        "  console.error('Unknown command');",
        '  process.exit(1);',
        '}',
        '',
        ''
      ].join('\n'), 'utf8');

      const raw = await validateTsCsvOracleOnce(workspaceDir, false);
      assert.equal(raw.ok, false);
      assert.ok(raw.diagnostics.some(line => line.includes('Command failed: node --test tests/oracle.test.js')));

      const targetedApplied = await applyTargetedTsCsvFallback(workspaceDir, raw);
      assert.equal(targetedApplied, true);

      const targeted = await validateTsCsvOracleOnce(workspaceDir, false);
      assert.equal(targeted.ok, true, targeted.diagnostics.join('\n'));
    } finally {
      fs.rmSync(workspaceDir, { recursive: true, force: true });
    }
  });

  it('replaces risky ts cli switch redeclare pattern with canonical fallback cli', () => {
    const src = [
      'const argv = process.argv.slice(2);',
      "const cmd = String(argv[0] || '');",
      '',
      'switch (cmd) {',
      "  case 'done':",
      '    const id = argv[1];',
      '    console.log(id);',
      '    break;',
      "  case 'remove':",
      '    const id = argv[1];',
      '    console.log(id);',
      '    break;',
      '}',
      ''
    ].join('\n');
    const out = normalizeTsTodoCliContract(src);
    assert.ok(out.includes('function usage(): string {'));
    assert.ok(out.includes('const value = firstPositional(argv.slice(1));'));
    assert.equal((out.match(/\bconst\s+id\s*=\s*argv\s*\[\s*1\s*\]\s*;/g) || []).length, 0);
  });

  it('normalizes ts cli parser null inference and --help handling', () => {
    const src = [
      'function parseArgs(argv: string[]): { cmd: string, args: string[], options: Record<string, string> } {',
      '  const options: Record<string, string> = {};',
      '  let currentOption = null;',
      '  for (const arg of argv) {',
      '    if (arg.startsWith("--")) currentOption = arg.slice(2);',
      '  }',
      "  return { cmd: '', args: [], options };",
      '}',
      '',
      'function main() {',
      "  const { cmd } = parseArgs(process.argv.slice(2));",
      "  if (cmd === '--help') {",
      '    return 0;',
      '  }',
      '  return 1;',
      '}',
      ''
    ].join('\n');
    const out = normalizeTsTodoCliContract(src);
    assert.ok(out.includes('let currentOption: string | null = null;'));
    assert.ok(out.includes("if (cmd === '--help' || process.argv.slice(2).includes('--help')) {"));
  });

  it('removes local process require shadowing while preserving single TS global declarations', () => {
    const src = [
      'declare const require: any;',
      'declare const process: any;',
      "const process = require('node:process');",
      "const argv = process.argv.slice(2);",
      "const cmd = argv[0] || '--help';",
      "if (cmd === '--help') {",
      '  return 0;',
      '}',
      ''
    ].join('\n');
    const out = normalizeTsTodoCliContract(src);
    assert.equal((out.match(/declare const require:\s*any;/g) || []).length, 1);
    assert.equal((out.match(/declare const process:\s*any;/g) || []).length, 1);
    assert.ok(!/const process = require\('node:process'\);/.test(out));
    assert.ok(out.includes('process.argv.slice(2)'));
  });

  it('normalizes ts cli to not require existing --data file', () => {
    const src = [
      'declare const process: any;',
      'const fs = require("node:fs");',
      'const cmd = process.argv[2];',
      'let dataPath: string | undefined;',
      'class TaskStore { constructor(_p: string) {} }',
      '',
      'if (!dataPath || !fs.existsSync(dataPath)) {',
      "  console.error('Error: --data <path> is required and must point to an existing file.');",
      '  process.exit(1);',
      '}',
      'const store = new TaskStore(dataPath);',
      '',
      "if (cmd === '--help') {",
      '  process.exit(0);',
      '}',
      ''
    ].join('\n');
    const out = normalizeTsTodoCliContract(src);
    assert.ok(out.includes('if (!dataPath) {'));
    assert.ok(!out.includes('!fs.existsSync(dataPath)'));
    assert.ok(out.includes('--data <path> is required.'));
    assert.ok(out.includes('new TaskStore(dataPath as string)'));
  });

  it('replaces ts cli parser/output shape mismatch with canonical fallback cli', () => {
    const src = [
      'function parseArgs() {',
      "  const args = process.argv.slice(2);",
      '  const cmd = args[0];',
      "  const dataPath = 'tasks.json';",
      '  return { cmd, dataPath };',
      '}',
      '',
      'function main() {',
      '  const { cmd, dataPath } = parseArgs();',
      '  if (!args[1]) throw new Error("missing");',
      '  return { cmd, dataPath };',
      '}',
      ''
    ].join('\n');
    const out = normalizeTsTodoCliContract(src);
    assert.ok(out.includes('function usage(): string {'));
    assert.ok(out.includes("const store = new TaskStore(dataPath);"));
  });

  it('replaces ts cli destructive argv shift parser with canonical fallback cli', () => {
    const src = [
      "const process = require('node:process');",
      "const { TaskStore } = require('./store');",
      '',
      'const argv = process.argv.slice(2);',
      'let cmd = argv[0];',
      "let dataPath = '';",
      '',
      'while (argv.length > 0) {',
      "  if (argv[0] === '--data') {",
      '    argv.shift();',
      '    dataPath = argv.shift();',
      '  } else {',
      '    argv.shift();',
      '  }',
      '}',
      '',
      'const store = new TaskStore(dataPath as string);',
      'switch (cmd) {',
      "  case 'add':",
      '    if (argv.length < 1) throw new Error("missing title");',
      '    console.log(store.add(argv.shift()));',
      '    break;',
      "  case 'done':",
      '    if (argv.length < 1) throw new Error("missing id");',
      '    console.log(store.done(argv.shift()));',
      '    break;',
      '}',
      ''
    ].join('\n');
    const out = normalizeTsTodoCliContract(src);
    assert.ok(out.includes('function usage(): string {'));
    assert.ok(out.includes('const value = firstPositional(argv.slice(1));'));
    assert.ok(!out.includes('while (argv.length > 0)'));
  });

  it('normalizes ts package manifest to oracle policy', () => {
    const src = JSON.stringify({
      name: 'x',
      type: 'module',
      dependencies: { commander: '^1.0.0' },
      devDependencies: { typescript: '^5.0.0' }
    }, null, 2);
    const out = normalizeTsTodoPackageManifest(src);
    const parsed = JSON.parse(out);
    assert.equal(parsed.type, undefined);
    assert.equal(parsed.dependencies, undefined);
    assert.equal(parsed.devDependencies, undefined);
    assert.equal(parsed.name, 'x');
  });

  it('applies scenario normalization only for ts-todo store file', () => {
    const source = "this.filePath = join(__dirname, '..', filePath);";
    const tsTodo = normalizeScenarioFileContentBeforeWrite('ts-todo-oracle', 'src/store.ts', source);
    const otherFile = normalizeScenarioFileContentBeforeWrite('ts-todo-oracle', 'src/cli.ts', source);
    const otherScenario = normalizeScenarioFileContentBeforeWrite('node-api-oracle', 'src/store.ts', source);
    assert.ok(/this\.filePath\s*=\s*filePath;/.test(tsTodo));
    assert.equal(otherFile, source);
    assert.equal(otherScenario, source);
  });

  it('normalizes risky node-api server contract before write', () => {
    const source = [
      "const http = require('node:http');",
      "const fs = require('node:fs');",
      "function createServer({ dataPath }) {",
      '  return http.createServer((req, res) => {',
      "    if (req.method === 'GET' && req.url.startsWith('/todos')) {",
      "      const id = req.url.split('/')[3];",
      "      fs.readFile(dataPath, 'utf8', (_err, data) => {",
      '        const todos = JSON.parse(data);',
      "        res.end(JSON.stringify({ id, todos }));",
      '      });',
      '      return;',
      '    }',
      '    if (req.method === \"POST\" && req.url === \"/todos\") {',
      '      const todos = [];',
      '      todos.push({ title: "x" });',
      '      fs.writeFileSync(dataPath, JSON.stringify(todos));',
      '    }',
      '  });',
      '}',
      'module.exports = createServer;',
      ''
    ].join('\n');

    const out = normalizeNodeApiServerContract(source);
    assert.ok(out.includes('function createServer({ dataPath })'));
    assert.ok(out.includes('JSON.stringify({ todos }, null, 2)'));
    assert.ok(out.includes('module.exports = { createServer };'));
    assert.ok(out.includes("'Connection': 'close'"));
    assert.ok(!out.includes("split('/')[3]"));
    assert.ok(out.includes('done: false'));
  });

  it('applies node-api normalization only for src/server.js', () => {
    const source = "module.exports = createServer;";
    const nodeServer = normalizeScenarioFileContentBeforeWrite('node-api-oracle', 'src/server.js', source);
    const nodeOther = normalizeScenarioFileContentBeforeWrite('node-api-oracle', 'openapi.json', source);
    assert.ok(nodeServer.includes('module.exports = { createServer };'));
    assert.equal(nodeOther, source);
  });

  it('normalizes risky ts-csv csv contract before write', () => {
    const source = [
      'export class CsvParser {',
      '  parse(text: string): Record<string, string>[] {',
      '    return [];',
      '  }',
      '  stringify(rows: Record<string, string>[]): string {',
      '    return "";',
      '  }',
      '}',
      '',
      'export class CsvFilter {',
      '  constructor(private rows: Record<string, string>[]) {}',
      '  where(predicate: (row: Record<string, string>) => boolean): CsvFilter {',
      '    return new CsvFilter(this.rows.filter(predicate));',
      '  }',
      '  select(columns: string[]): CsvFilter {',
      '    return new CsvFilter(this.rows);',
      '  }',
      '  sortBy(column: string): CsvFilter {',
      '    return new CsvFilter(this.rows);',
      '  }',
      '  count(): number {',
      '    return this.rows.length;',
      '  }',
      '}',
      ''
    ].join('\n');

    const out = normalizeScenarioFileContentBeforeWrite('ts-csv-oracle', 'src/csv.ts', source);
    assert.equal(hasTsCsvFilterReturnTypeDrift(out), false);
    assert.ok(out.includes('where(predicate: (row: Record<string, string>) => boolean): Record<string, string>[]'));
    assert.ok(out.includes('private splitRow(line: string): string[]'));
    assert.ok(out.includes('private quoteField(field: string): string'));
  });

  it('normalizes risky ts-csv cli and compiler scaffolding before write', () => {
    const cliSource = [
      'declare const require: any;',
      'declare const process: any;',
      'const fs = require("node:fs");',
      '',
      'const command = process.argv[2];',
      'let inputFile: string | undefined;',
      'if (!inputFile) {',
      "  console.error('Missing --input option');",
      '  process.exit(1);',
      '}',
      'switch (command) {',
      "  case '--help':",
      '    process.exit(0);',
      '    break;',
      '}',
      ''
    ].join('\n');
    const packageSource = JSON.stringify({
      name: 'csv-processor',
      type: 'module',
      dependencies: { commander: '^1.0.0' },
      devDependencies: { typescript: '^5.0.0' }
    }, null, 2);
    const tsconfigSource = JSON.stringify({
      compilerOptions: {
        target: 'ES2020',
        module: 'commonjs',
        strict: true
      },
      include: ['src']
    }, null, 2);

    const cli = normalizeScenarioFileContentBeforeWrite('ts-csv-oracle', 'src/cli.ts', cliSource);
    const pkg = JSON.parse(normalizeScenarioFileContentBeforeWrite('ts-csv-oracle', 'package.json', packageSource));
    const tsconfig = JSON.parse(normalizeScenarioFileContentBeforeWrite('ts-csv-oracle', 'tsconfig.json', tsconfigSource));

    assert.ok(cli.includes("const { CsvParser } = require('./csv');"));
    assert.ok(cli.includes("if (command === '--help' || command === '-h' || command === '')"));
    assert.equal(pkg.type, undefined);
    assert.equal(pkg.dependencies, undefined);
    assert.equal(pkg.devDependencies, undefined);
    assert.deepEqual(tsconfig.compilerOptions.types, []);
    assert.equal(tsconfig.compilerOptions.rootDir, 'src');
    assert.equal(tsconfig.compilerOptions.outDir, 'dist');
  });

  it('normalizes risky python oracle cli contract before write', () => {
    const source = [
      'import argparse',
      'from mini_ai.markov import MarkovChain, load_model, save_model',
      '',
      'def main(args=None):',
      '  return 0',
      ''
    ].join('\n');
    const out = normalizePythonOracleCliContract(source);
    assert.ok(out.includes('from mini_ai.markov import MarkovChain'));
    assert.ok(!/from\s+mini_ai\.markov\s+import[^\n]*load_model/.test(out));
    assert.ok(!/from\s+mini_ai\.markov\s+import[^\n]*save_model/.test(out));
    assert.ok(out.includes('def main(argv: list[str] | None = None) -> int:'));
  });

  it('applies python cli normalization only for python scenarios', () => {
    const source = [
      'import argparse',
      'from mini_ai.markov import MarkovChain, load_model',
      '',
      'def main(args=None):',
      '  return 0',
      ''
    ].join('\n');
    const py = normalizeScenarioFileContentBeforeWrite('python-ai-stdlib-oracle', 'mini_ai/cli.py', source);
    const ts = normalizeScenarioFileContentBeforeWrite('ts-todo-oracle', 'mini_ai/cli.py', source);
    assert.ok(py.includes('def main(argv: list[str] | None = None) -> int:'));
    assert.equal(ts, source);
  });
});
