import { strict as assert } from 'assert';

import { normalizeScenarioFileContentBeforeWrite } from '../scripts/botEval';

describe('botEval ts-todo scenario canonicalization', () => {
  it('promotes interactive readline cli to canonical non-interactive contract', () => {
    const src = [
      "import readline from 'node:readline';",
      "const cmd = process.argv[2] || '';",
      'const rl = readline.createInterface({ input: process.stdin, output: process.stdout });',
      "rl.question('Enter the data file path: ', () => {});",
      ''
    ].join('\n');

    const out = normalizeScenarioFileContentBeforeWrite('ts-todo-oracle', 'src/cli.ts', src);

    assert.ok(/Usage:/.test(out));
    assert.ok(/JSON\.stringify/.test(out));
    assert.ok(!/readline/i.test(out));
  });

  it('promotes incomplete TaskStore to canonical CRUD template', () => {
    const src = [
      'class TaskStore {',
      '  list() { return []; }',
      '}',
      ''
    ].join('\n');

    const out = normalizeScenarioFileContentBeforeWrite('ts-todo-oracle', 'src/store.ts', src);

    assert.ok(/class TaskStore/.test(out));
    assert.ok(/\blist\(\)/.test(out));
    assert.ok(/\badd\(/.test(out));
    assert.ok(/\bdone\(/.test(out));
    assert.ok(/\bremove\(/.test(out));
  });
});
