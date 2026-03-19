const mock = require('mock-require');
mock('vscode', {});

const { expect } = require('chai');
const { SvedomiValidator } = require('../src/svedomi');

describe('SvedomiValidator', () => {
  describe('parseValidationResponse', () => {
    it('should parse valid response with high score', () => {
      const validator = new SvedomiValidator();
      const output = 'SKĂ“RE: 9\nVALIDNĂŤ: ANO\nDĹ®VOD: OdpovÄ›ÄŹ je pĹ™esnĂˇ a bez chyb';
      const result = validator.parseValidationResponse(output);
      
      expect(result.score).to.equal(9);
      expect(result.isValid).to.be.true;
      expect(result.reason).to.include('pĹ™esnĂˇ');
      expect(result.shouldRetry).to.be.false;
    });

    it('should parse invalid response with low score', () => {
      const validator = new SvedomiValidator();
      const output = 'SKĂ“RE: 2\nVALIDNĂŤ: NE\nDĹ®VOD: Obsahuje halucinace a opakovĂˇnĂ­';
      const result = validator.parseValidationResponse(output);
      
      expect(result.score).to.equal(2);
      expect(result.isValid).to.be.false;
      expect(result.shouldRetry).to.be.true;
    });

    it('should handle English format', () => {
      const validator = new SvedomiValidator();
      const output = 'SCORE: 7\nVALID: YES\nREASON: Good response overall';
      const result = validator.parseValidationResponse(output);
      
      expect(result.score).to.equal(7);
      expect(result.isValid).to.be.true;
    });

    it('should handle empty output', () => {
      const validator = new SvedomiValidator();
      const result = validator.parseValidationResponse('');
      
      expect(result.score).to.equal(0);
      expect(result.isValid).to.be.false;
      expect(result.unavailable).to.be.true;
      expect(result.errorCode).to.equal('empty_output');
    });

    it('should clamp score to 1-10 range', () => {
      const validator = new SvedomiValidator();
      
      const tooHigh = validator.parseValidationResponse('SKĂ“RE: 15\nVALIDNĂŤ: ANO');
      expect(tooHigh.score).to.equal(10);
      
      const tooLow = validator.parseValidationResponse('SKĂ“RE: 0\nVALIDNĂŤ: NE');
      expect(tooLow.score).to.equal(1);
    });

    it('should default validity based on score when not specified', () => {
      const validator = new SvedomiValidator();
      
      const highScore = validator.parseValidationResponse('SKĂ“RE: 8');
      expect(highScore.isValid).to.be.true;
      
      const lowScore = validator.parseValidationResponse('SKĂ“RE: 3');
      expect(lowScore.isValid).to.be.false;
    });

    it('should set shouldRetry true for score <= 3', () => {
      const validator = new SvedomiValidator();
      
      expect(validator.parseValidationResponse('SKĂ“RE: 3').shouldRetry).to.be.true;
      expect(validator.parseValidationResponse('SKĂ“RE: 4').shouldRetry).to.be.false;
    });
  });

  describe('validateInputs', () => {
    it('should return disabled result when disabled', () => {
      const validator = new SvedomiValidator();
      validator.configure('http://localhost:11434', 'qwen2.5:3b', false);
      
      const result = validator.validateInputs('prompt', 'response');
      expect(result).to.not.be.null;
      expect(result!.score).to.equal(10);
      expect(result!.reason).to.include('vypnut');
    });

    it('should reject empty response', () => {
      const validator = new SvedomiValidator();
      
      const result = validator.validateInputs('prompt', '');
      expect(result).to.not.be.null;
      expect(result!.isValid).to.be.false;
      expect(result!.score).to.equal(1);
      expect(result!.shouldRetry).to.be.true;
    });

    it('should handle missing prompt gracefully', () => {
      const validator = new SvedomiValidator();
      
      const result = validator.validateInputs('', 'some response');
      expect(result).to.not.be.null;
      expect(result!.isValid).to.be.true;
      expect(result!.score).to.equal(7);
    });

    it('should return null for valid inputs (proceed with validation)', () => {
      const validator = new SvedomiValidator();
      
      const result = validator.validateInputs('valid prompt', 'valid response');
      expect(result).to.be.null;
    });
  });

  describe('configuration', () => {
    it('should store configuration', () => {
      const validator = new SvedomiValidator();
      validator.configure('http://custom:8080', 'llama3:8b', true);
      
      expect(validator.isEnabled()).to.be.true;
      expect(validator.getModel()).to.equal('llama3:8b');
    });

    it('should be enabled by default', () => {
      const validator = new SvedomiValidator();
      expect(validator.isEnabled()).to.be.true;
    });
  });

  describe('caching', () => {
    it('should cache validation results', () => {
      const validator = new SvedomiValidator();
      const result = { isValid: true, score: 8, reason: 'Good', shouldRetry: false };
      
      validator.cacheResult('test prompt', 'test response', result);
      const cached = validator.getCachedResult('test prompt', 'test response');
      
      expect(cached).to.not.be.null;
      expect(cached!.score).to.equal(8);
    });

    it('should return null for uncached inputs', () => {
      const validator = new SvedomiValidator();
      const cached = validator.getCachedResult('new prompt', 'new response');
      expect(cached).to.be.null;
    });

    it('should clear cache', () => {
      const validator = new SvedomiValidator();
      const result = { isValid: true, score: 8, reason: 'Good', shouldRetry: false };
      
      validator.cacheResult('prompt', 'response', result);
      validator.clearCache();
      
      const cached = validator.getCachedResult('prompt', 'response');
      expect(cached).to.be.null;
    });

    it('should not collide on similar but different inputs', () => {
      const validator = new SvedomiValidator();
      const resultA = { isValid: true, score: 9, reason: 'Good', shouldRetry: false };
      const resultB = { isValid: false, score: 2, reason: 'Bad', shouldRetry: true };

      validator.cacheResult('prompt alpha', 'response alpha', resultA);
      validator.cacheResult('prompt beta', 'response beta', resultB);

      const cachedA = validator.getCachedResult('prompt alpha', 'response alpha');
      const cachedB = validator.getCachedResult('prompt beta', 'response beta');

      expect(cachedA).to.not.be.null;
      expect(cachedA!.score).to.equal(9);
      expect(cachedB).to.not.be.null;
      expect(cachedB!.score).to.equal(2);
    });
  });

  describe('buildValidationPrompt', () => {
    it('should build prompt without tasks', () => {
      const validator = new SvedomiValidator();
      const prompt = validator.buildValidationPrompt('User question', 'AI answer');
      
      expect(prompt).to.include('User question');
      expect(prompt).to.include('AI answer');
      expect(prompt).to.include('SKORE');
      expect(prompt).to.include('VALIDNI');
    });

    it('should include relevant tasks', () => {
      const validator = new SvedomiValidator();
      const tasks = [
        { id: '1', title: 'Check grammar', description: '', category: 'formatting' as const, errorExamples: [], weight: 8 }
      ];
      const prompt = validator.buildValidationPrompt('Question', 'Answer', tasks);
      
      expect(prompt).to.include('Check grammar');
      expect(prompt).to.include('Weight: 8');
    });

    it('should truncate long inputs', () => {
      const validator = new SvedomiValidator();
      const longPrompt = 'a'.repeat(10000);
      const longResponse = 'b'.repeat(10000);

      const prompt = validator.buildValidationPrompt(longPrompt, longResponse);

      // Should not contain full strings
      expect(prompt.length).to.be.lessThan(longPrompt.length + longResponse.length);
    });
  });

  describe('validate network error handling', () => {
    let savedFetch;
    let savedHeaders;
    beforeEach(() => {
      savedFetch = globalThis.fetch;
      savedHeaders = globalThis.Headers;
      globalThis.Headers = class { constructor() {} };
    });
    afterEach(() => {
      globalThis.fetch = savedFetch;
      globalThis.Headers = savedHeaders;
    });

    it('should return shouldRetry=true on HTTP 500', async () => {
      const v = new SvedomiValidator();
      globalThis.fetch = async () => ({ ok: false, status: 500, statusText: 'Internal Server Error' });
      const res = await v.validate('prompt', 'response');
      expect(res.isValid).to.be.false;
      expect(res.shouldRetry).to.be.true;
      expect(res.unavailable).to.be.true;
      expect(res.errorCode).to.equal('http_500');
    });

    it('should return shouldRetry=true on HTTP 503', async () => {
      const v = new SvedomiValidator();
      globalThis.fetch = async () => ({ ok: false, status: 503, statusText: 'Service Unavailable' });
      const res = await v.validate('prompt', 'response');
      expect(res.shouldRetry).to.be.true;
      expect(res.errorCode).to.equal('http_503');
    });

    it('should return shouldRetry=true on HTTP 429 (rate limit)', async () => {
      const v = new SvedomiValidator();
      globalThis.fetch = async () => ({ ok: false, status: 429, statusText: 'Too Many Requests' });
      const res = await v.validate('prompt', 'response');
      expect(res.shouldRetry).to.be.true;
      expect(res.errorCode).to.equal('http_429');
    });

    it('should return shouldRetry=false on HTTP 400 (client error)', async () => {
      const v = new SvedomiValidator();
      globalThis.fetch = async () => ({ ok: false, status: 400, statusText: 'Bad Request' });
      const res = await v.validate('prompt', 'response');
      expect(res.shouldRetry).to.be.false;
      expect(res.errorCode).to.equal('http_400');
    });

    it('should return shouldRetry=true on connection error', async () => {
      const v = new SvedomiValidator();
      globalThis.fetch = async () => { throw new Error('ECONNREFUSED'); };
      const res = await v.validate('prompt', 'response');
      expect(res.isValid).to.be.false;
      expect(res.shouldRetry).to.be.true;
      expect(res.unavailable).to.be.true;
      expect(res.errorCode).to.equal('exception');
    });

    it('should return shouldRetry=true on timeout', async () => {
      const v = new SvedomiValidator();
      globalThis.fetch = async () => { const e = new Error('aborted'); e.name = 'AbortError'; throw e; };
      const res = await v.validate('prompt', 'response');
      expect(res.shouldRetry).to.be.true;
      expect(res.errorCode).to.equal('timeout');
      expect(res.reason).to.include('timeout');
    });

    it('should return valid result on successful API call', async () => {
      const v = new SvedomiValidator();
      globalThis.fetch = async () => ({
        ok: true,
        json: async () => ({ response: 'SKORE: 8\nVALIDNI: ANO\nDUVOD: Vse v poradku' })
      });
      const res = await v.validate('prompt', 'response');
      expect(res.isValid).to.be.true;
      expect(res.score).to.equal(8);
      expect(res.shouldRetry).to.be.false;
    });
  });
});

