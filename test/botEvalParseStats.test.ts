import { strict as assert } from 'assert';

import {
  computeIterationParseFailureKind,
  computePlannerParseFailureKind,
} from '../scripts/botEval';

describe('botEval parse stats helpers', () => {
  it('does not count planner parse failure when planner finished OK', () => {
    const kind = computePlannerParseFailureKind({
      finalOk: true,
      finalError: 'Unexpected token } in JSON at position 10',
      finalErrorKind: 'json_parse'
    });
    assert.equal(kind, null);
  });

  it('uses explicit planner finalErrorKind when final fail happened', () => {
    const kind = computePlannerParseFailureKind({
      finalOk: false,
      finalError: 'Planner parse failed',
      finalErrorKind: 'schema'
    });
    assert.equal(kind, 'schema');
  });

  it('infers planner finalErrorKind from error text when missing', () => {
    const kind = computePlannerParseFailureKind({
      finalOk: false,
      finalError: 'Unexpected token , in JSON at position 55'
    });
    assert.equal(kind, 'json_parse');
  });

  it('does not count iteration parse failure when parsing eventually succeeded', () => {
    const parsed: any = { mode: 'patch', files: [] };
    const kind = computeIterationParseFailureKind(parsed, 'schema');
    assert.equal(kind, null);
  });

  it('counts iteration parse failure only when parsing finally failed', () => {
    const kind = computeIterationParseFailureKind(null, 'placeholder');
    assert.equal(kind, 'placeholder');
  });
});

