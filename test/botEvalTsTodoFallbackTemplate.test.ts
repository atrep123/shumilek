import { strict as assert } from 'assert';

import { normalizeTsTodoCliContract } from '../scripts/botEval';

describe('botEval ts-todo fallback cli template', () => {
  it('keeps require/process declarations when commander triggers fallback template', () => {
    const src = [
      "import { Command } from 'commander';",
      'const program = new Command();',
      'program.parse(process.argv);',
      ''
    ].join('\n');

    const out = normalizeTsTodoCliContract(src);

    assert.ok(/^\s*declare const require:\s*any;\s*$/m.test(out));
    assert.ok(/^\s*declare const process:\s*any;\s*$/m.test(out));
  });

  it('keeps require/process declarations when parser-shape mismatch triggers fallback template', () => {
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

    assert.ok(/^\s*declare const require:\s*any;\s*$/m.test(out));
    assert.ok(/^\s*declare const process:\s*any;\s*$/m.test(out));
  });
});
