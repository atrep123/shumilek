import { strict as assert } from 'assert';

import {
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
