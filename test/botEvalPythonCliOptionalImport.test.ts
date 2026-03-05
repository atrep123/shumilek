import { strict as assert } from 'assert';

import { normalizePythonOracleCliContract } from '../scripts/botEval';

describe('botEval python cli Optional import normalization', () => {
  it('adds missing Optional typing import when Optional annotation is used', () => {
    const source = [
      'import argparse',
      'from mini_ai.markov import MarkovChain',
      '',
      'def main(argv: Optional[list[str]] = None) -> int:',
      '    parser = argparse.ArgumentParser()',
      '    parser.parse_args(argv)',
      '    return 0',
      ''
    ].join('\n');

    const out = normalizePythonOracleCliContract(source);
    assert.ok(out.includes('from typing import Optional'));
    assert.ok(out.includes('def main(argv: Optional[list[str]] = None) -> int:'));
  });
});
