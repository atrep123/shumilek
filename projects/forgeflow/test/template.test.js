const test = require('node:test');
const assert = require('node:assert/strict');
const { resolveTemplates } = require('../dist/index.js');

test('resolveTemplates replaces placeholders', () => {
  const context = {
    env: { name: 'Forge' },
    tasks: { step: { value: 7 } },
    vars: { mode: 'fast' },
    meta: { runId: 'r1' }
  };
  const resolver = (path) => {
    const parts = path.split('.');
    let current = context;
    for (const part of parts) {
      current = current && current[part];
    }
    return current;
  };

  const result = resolveTemplates('Name={{env.name}} Value={{tasks.step.value}}', resolver);
  assert.equal(result, 'Name=Forge Value=7');
});
