const mock = require('mock-require');
mock('vscode', {});

const { expect } = require('chai');
const { normalizeTaskWeight } = require('../src/utils');

describe('normalizeTaskWeight', () => {
  it('should convert 0.1-1.0 scale to 1-10', () => {
    expect(normalizeTaskWeight(0.1)).to.equal(1);
    expect(normalizeTaskWeight(0.5)).to.equal(5);
    expect(normalizeTaskWeight(1.0)).to.equal(10);
  });

  it('should clamp values >1 to 1-10', () => {
    expect(normalizeTaskWeight(12)).to.equal(10);
    expect(normalizeTaskWeight(-1)).to.equal(1);
    expect(normalizeTaskWeight(undefined)).to.equal(5);
  });

  it('should handle NaN', () => {
    expect(normalizeTaskWeight(NaN)).to.equal(5);
  });

  it('should round decimal values', () => {
    expect(normalizeTaskWeight(0.35)).to.equal(4);
    expect(normalizeTaskWeight(7.6)).to.equal(8);
  });
});
