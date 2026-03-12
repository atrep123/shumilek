import { strict as assert } from 'assert';

import { normalizeTsTodoCliRuntimeGlobals } from '../scripts/botEval';

describe('botEval ts-todo cli runtime globals', () => {
  it('deduplicates declarations and removes node:process shadow import', () => {
    const src = [
      'declare const require: any;',
      'declare const process: any;',
      "const process = require('node:process');",
      'declare const require: any;',
      'declare const process: any;',
      "const fs = require('node:fs');",
      'console.log(process.argv[2]);',
      ''
    ].join('\n');

    const out = normalizeTsTodoCliRuntimeGlobals(src);

    assert.equal((out.match(/^\s*declare const require:\s*any;\s*$/gm) || []).length, 1);
    assert.equal((out.match(/^\s*declare const process:\s*any;\s*$/gm) || []).length, 1);
    assert.equal((out.match(/const\s+process\s*=\s*require\(\s*['"]node:process['"]\s*\)\s*;?/g) || []).length, 0);
  });
});
