import { strict as assert } from 'assert';

import { normalizeTsTodoStorePathHandling } from '../scripts/botEval';

describe('botEval ts-todo store import normalization', () => {
  it('converts aliased node:crypto/path imports to require object pattern', () => {
    const src = [
      "import { randomUUID as uuid } from 'node:crypto';",
      "import { join as joinPath } from 'node:path';",
      "const p = joinPath('a', 'b');",
      'const id = uuid();',
      ''
    ].join('\n');

    const out = normalizeTsTodoStorePathHandling(src);

    assert.ok(/const \{ randomUUID: uuid \} = require\("node:crypto"\);/.test(out));
    assert.ok(/const \{ join: joinPath \} = require\("node:path"\);/.test(out));
    assert.ok(/^\s*declare const require:\s*any;\s*$/m.test(out));
  });

  it('converts uuid v4 imports to node:crypto randomUUID', () => {
    const src = [
      "import { v4 as uuidv4 } from 'uuid';",
      'const id = uuidv4();',
      ''
    ].join('\n');

    const out = normalizeTsTodoStorePathHandling(src);

    assert.ok(/const \{ randomUUID: uuidv4 \} = require\("node:crypto"\);/.test(out));
    assert.ok(!/from 'uuid'/.test(out));
  });

  it('normalizes JSON task shape and removes dummy fallback task objects', () => {
    const src = [
      'class TaskStore {',
      "  read(data: string) { return JSON.parse(data) || []; }",
      '  done(task: any) {',
      "    return task || { id: 'x', title: '', done: false, createdAt: '' };",
      '  }',
      '}',
      ''
    ].join('\n');

    const out = normalizeTsTodoStorePathHandling(src);

    assert.ok(/Array\.isArray\(parsed\?\.tasks\)/.test(out));
    assert.ok(/if \(!task\) throw new Error\('Task not found'\);/.test(out));
    assert.ok(/return task;/.test(out));
  });
});
