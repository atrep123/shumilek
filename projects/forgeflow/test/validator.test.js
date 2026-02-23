const test = require('node:test');
const assert = require('node:assert/strict');
const { validatePipeline } = require('../dist/index.js');

test('validatePipeline passes for valid pipeline', () => {
  const pipeline = {
    name: 'Valid',
    version: '1.0',
    tasks: [{ id: 'wait', type: 'delay', with: { ms: 1 } }]
  };
  const result = validatePipeline(pipeline);
  assert.equal(result.valid, true);
  assert.equal(result.errors.length, 0);
});

test('validatePipeline catches duplicate ids', () => {
  const pipeline = {
    name: 'Dup',
    version: '1.0',
    tasks: [
      { id: 'a', type: 'delay' },
      { id: 'a', type: 'delay' }
    ]
  };
  const result = validatePipeline(pipeline);
  assert.equal(result.valid, false);
  assert.ok(result.errors.some(err => err.includes('duplicated')));
});

test('validatePipeline catches missing dependency', () => {
  const pipeline = {
    name: 'Missing',
    version: '1.0',
    tasks: [
      { id: 'b', type: 'delay', dependsOn: ['a'] }
    ]
  };
  const result = validatePipeline(pipeline);
  assert.equal(result.valid, false);
  assert.ok(result.errors.some(err => err.includes('missing task')));
});

test('validatePipeline catches cycles', () => {
  const pipeline = {
    name: 'Cycle',
    version: '1.0',
    tasks: [
      { id: 'a', type: 'delay', dependsOn: ['b'] },
      { id: 'b', type: 'delay', dependsOn: ['a'] }
    ]
  };
  const result = validatePipeline(pipeline);
  assert.equal(result.valid, false);
  assert.ok(result.errors.some(err => err.includes('Cycle detected')));
});
