const mock = require('mock-require');
mock('vscode', {});

const { expect } = require('chai');
const { normalizeTaskWeight, humanizeApiError } = require('../src/utils');

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

describe('humanizeApiError', () => {
  it('should humanize ECONNREFUSED', () => {
    const result = humanizeApiError('FetchError: request to http://localhost:11434/api/chat failed, reason: connect ECONNREFUSED 127.0.0.1:11434');
    expect(result).to.include('Ollama');
    expect(result).to.include('ollama serve');
    expect(result).to.not.include('ECONNREFUSED');
  });

  it('should humanize ENOTFOUND / DNS failure', () => {
    const result = humanizeApiError('getaddrinfo ENOTFOUND my-server.local');
    expect(result).to.include('baseUrl');
    expect(result).to.not.include('getaddrinfo');
  });

  it('should humanize ETIMEDOUT', () => {
    const result = humanizeApiError('connect ETIMEDOUT 192.168.1.100:11434');
    expect(result).to.include('vypršelo');
  });

  it('should humanize socket hang up', () => {
    const result = humanizeApiError('socket hang up');
    expect(result).to.include('vypršelo');
  });

  it('should humanize ECONNRESET', () => {
    const result = humanizeApiError('read ECONNRESET');
    expect(result).to.include('přerušeno');
    expect(result).to.include('ollama serve');
  });

  it('should humanize model not found', () => {
    const result = humanizeApiError('model "deepseek-r1:8b" not found');
    expect(result).to.include('nenalezen');
    expect(result).to.include('ollama pull');
  });

  it('should humanize HTTP 500', () => {
    const result = humanizeApiError('HTTP 500: Internal Server Error');
    expect(result).to.include('5xx');
    expect(result).to.include('Restartujte');
  });

  it('should humanize HTTP 404', () => {
    const result = humanizeApiError('HTTP 404: Not Found');
    expect(result).to.include('404');
    expect(result).to.include('baseUrl');
  });

  it('should pass through abort errors unchanged', () => {
    const msg = 'The operation was aborted';
    expect(humanizeApiError(msg)).to.equal(msg);
  });

  it('should pass through unknown errors unchanged', () => {
    const msg = 'Something completely unexpected happened';
    expect(humanizeApiError(msg)).to.equal(msg);
  });
});
