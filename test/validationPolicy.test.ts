const mock = require('mock-require');
mock('vscode', {});

const { expect } = require('chai');
const { isMiniAccepted, shouldRetryMiniValidation, getMiniUnavailableMessage } = require('../src/validationPolicy');

describe('isMiniAccepted', () => {
  it('should accept null result', () => {
    expect(isMiniAccepted(null, 'fail-soft')).to.be.true;
    expect(isMiniAccepted(null, 'fail-closed')).to.be.true;
  });

  it('should accept score >= 5', () => {
    const result = { isValid: true, score: 7, reason: 'ok', shouldRetry: false };
    expect(isMiniAccepted(result, 'fail-soft')).to.be.true;
    expect(isMiniAccepted(result, 'fail-closed')).to.be.true;
  });

  it('should reject score < 5', () => {
    const result = { isValid: false, score: 3, reason: 'bad', shouldRetry: true };
    expect(isMiniAccepted(result, 'fail-soft')).to.be.false;
    expect(isMiniAccepted(result, 'fail-closed')).to.be.false;
  });

  it('should accept unavailable in fail-soft', () => {
    const result = { isValid: true, score: 0, reason: 'down', shouldRetry: false, unavailable: true };
    expect(isMiniAccepted(result, 'fail-soft')).to.be.true;
  });

  it('should reject unavailable in fail-closed', () => {
    const result = { isValid: true, score: 0, reason: 'down', shouldRetry: false, unavailable: true };
    expect(isMiniAccepted(result, 'fail-closed')).to.be.false;
  });
});

describe('shouldRetryMiniValidation', () => {
  it('should not retry null result', () => {
    expect(shouldRetryMiniValidation(null, 'fail-soft')).to.be.false;
    expect(shouldRetryMiniValidation(null, 'fail-closed')).to.be.false;
  });

  it('should retry when shouldRetry is true', () => {
    const result = { isValid: false, score: 3, reason: 'bad', shouldRetry: true };
    expect(shouldRetryMiniValidation(result, 'fail-soft')).to.be.true;
  });

  it('should retry unavailable in fail-closed', () => {
    const result = { isValid: true, score: 0, reason: 'down', shouldRetry: false, unavailable: true };
    expect(shouldRetryMiniValidation(result, 'fail-closed')).to.be.true;
  });

  it('should NOT retry unavailable in fail-soft', () => {
    const result = { isValid: true, score: 0, reason: 'down', shouldRetry: false, unavailable: true };
    expect(shouldRetryMiniValidation(result, 'fail-soft')).to.be.false;
  });
});

describe('getMiniUnavailableMessage', () => {
  it('should return fail-closed message', () => {
    expect(getMiniUnavailableMessage('fail-closed')).to.include('fail-closed');
  });

  it('should return fail-soft message', () => {
    expect(getMiniUnavailableMessage('fail-soft')).to.include('fail-soft');
  });

  it('should include verb when requested', () => {
    expect(getMiniUnavailableMessage('fail-closed', true)).to.include('je nedostupne');
  });
});
