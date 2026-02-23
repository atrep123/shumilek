import { strict as assert } from 'assert';

import { parseBatchArgs } from '../scripts/botEvalBatch';

describe('botEvalBatch argument parsing', () => {
  it('uses default scenarios when no scenario flags are provided', () => {
    const opts = parseBatchArgs([]);
    assert.deepEqual(opts.scenarios, ['ts-todo-oracle', 'node-api-oracle', 'python-ai-stdlib-oracle']);
  });

  it('treats --scenario as explicit scenario selection (replaces defaults)', () => {
    const opts = parseBatchArgs(['--scenario', 'node-api-oracle']);
    assert.deepEqual(opts.scenarios, ['node-api-oracle']);
  });

  it('supports repeated --scenario values with de-duplication', () => {
    const opts = parseBatchArgs([
      '--scenario', 'node-api-oracle',
      '--scenario', 'ts-todo-oracle',
      '--scenario', 'node-api-oracle'
    ]);
    assert.deepEqual(opts.scenarios, ['node-api-oracle', 'ts-todo-oracle']);
  });

  it('combines --scenarios and --scenario in explicit mode', () => {
    const opts = parseBatchArgs([
      '--scenarios', 'node-api-oracle,ts-todo-oracle',
      '--scenario', 'python-ai-stdlib-oracle'
    ]);
    assert.deepEqual(opts.scenarios, ['node-api-oracle', 'ts-todo-oracle', 'python-ai-stdlib-oracle']);
  });

  it('falls back to defaults when explicit scenario list is empty', () => {
    const opts = parseBatchArgs(['--scenarios', ',']);
    assert.deepEqual(opts.scenarios, ['ts-todo-oracle', 'node-api-oracle', 'python-ai-stdlib-oracle']);
  });
});
