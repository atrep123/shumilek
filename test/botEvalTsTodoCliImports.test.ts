import { strict as assert } from 'assert';

import { normalizeTsTodoCliContract } from '../scripts/botEval';

describe('botEval ts-todo cli import normalization', () => {
  it('converts node builtin imports to require and strips .ts store suffix', () => {
    const src = [
      "import fs from 'node:fs';",
      "import * as path from 'node:path';",
      "import { join as joinPath } from 'node:path';",
      "const { TaskStore } = require('./store.ts');",
      'const argv = process.argv.slice(2);',
      "if (cmd === '--help') {",
      '  return 0;',
      '}',
      'if (!dataPath) {',
      "  console.error('--data <path> is required');",
      '}',
      ''
    ].join('\n');

    const out = normalizeTsTodoCliContract(src);

    assert.ok(/const fs = require\("node:fs"\);/.test(out));
    assert.ok(/const path = require\("node:path"\);/.test(out));
    assert.ok(/const \{ join: joinPath \} = require\("node:path"\);/.test(out));
    assert.ok(/require\('\.\/store'\)/.test(out));
    assert.ok(!/require\('\.\/store\.ts'\)/.test(out));
    assert.ok(/if \(!dataPath\) \{/.test(out));
  });
});
