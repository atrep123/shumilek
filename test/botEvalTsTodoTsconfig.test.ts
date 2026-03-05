import { strict as assert } from 'assert';

import { normalizeTsTodoTsconfig } from '../scripts/botEval';

describe('botEval ts-todo tsconfig normalization', () => {
  it('forces compilerOptions.types to empty array to avoid ambient node type drift', () => {
    const src = JSON.stringify(
      {
        compilerOptions: {
          target: 'ES2020',
          module: 'esnext',
          moduleResolution: 'node',
          types: ['node']
        },
        include: ['src/**/*.ts']
      },
      null,
      2
    );

    const out = normalizeTsTodoTsconfig(src);
    const parsed = JSON.parse(out);

    assert.deepEqual(parsed.compilerOptions.types, []);
    assert.equal(parsed.compilerOptions.module, 'commonjs');
    assert.equal(parsed.compilerOptions.moduleResolution, 'node');
    assert.equal(parsed.compilerOptions.strict, false);
    assert.equal(parsed.compilerOptions.target, 'ES2020');
    assert.deepEqual(parsed.include, ['src/**/*.ts']);
  });
});
