import { strict as assert } from 'assert';
import * as fs from 'fs';
import * as path from 'path';
import { fileURLToPath } from 'url';

describe('eslint TypeScript project config', () => {
  it('uses a dedicated tsconfig that includes scripts and tests', () => {
    const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
    const eslintConfig = fs.readFileSync(path.join(rootDir, 'eslint.config.cjs'), 'utf8');
    const eslintTsconfig = JSON.parse(
      fs.readFileSync(path.join(rootDir, 'tsconfig.eslint.json'), 'utf8')
    ) as {
      extends?: string;
      include?: string[];
      compilerOptions?: { rootDir?: string; noEmit?: boolean };
    };

    assert.match(eslintConfig, /tsconfig\.eslint\.json/);
    assert.equal(eslintTsconfig.extends, './tsconfig.test.json');
    assert.deepEqual(eslintTsconfig.include, ['src', 'test', 'scripts']);
    assert.equal(eslintTsconfig.compilerOptions?.rootDir, '.');
    assert.equal(eslintTsconfig.compilerOptions?.noEmit, true);
  });
});