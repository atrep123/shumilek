const mock = require('mock-require');
mock('vscode', {});

const { expect } = require('chai');
const { SvedomiValidator } = require('../src/svedomi');

describe('SvedomiValidator', () => {
  describe('parseValidationResponse', () => {
    it('should parse valid response with high score', () => {
      const validator = new SvedomiValidator();
      const output = 'SK\u00D3RE: 9\nVALIDN\u00CD: ANO\nD\u016eVOD: Odpov\u011b\u010f je p\u0159esn\u00e1 a bez chyb';
      const result = validator.parseValidationResponse(output);
      
      expect(result.score).to.equal(9);
      expect(result.isValid).to.be.true;
      expect(result.reason).to.include('p\u0159esn');
      expect(result.shouldRetry).to.be.false;
    });

    it('should parse invalid response with low score', () => {
      const validator = new SvedomiValidator();
      const output = 'SK\u00D3RE: 2\nVALIDN\u00CD: NE\nD\u016eVOD: Obsahuje halucinace a opakov\u00e1n\u00ed';
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
      
      const tooHigh = validator.parseValidationResponse('SK\u00D3RE: 15\nVALIDN\u00CD: ANO');
      expect(tooHigh.score).to.equal(10);
      
      const tooLow = validator.parseValidationResponse('SK\u00D3RE: 0\nVALIDN\u00CD: NE');
      expect(tooLow.score).to.equal(1);
    });

    it('should default validity based on score when not specified', () => {
      const validator = new SvedomiValidator();
      
      const highScore = validator.parseValidationResponse('SK\u00D3RE: 8');
      expect(highScore.isValid).to.be.true;
      
      const lowScore = validator.parseValidationResponse('SK\u00D3RE: 3');
      expect(lowScore.isValid).to.be.false;
    });

    it('should set shouldRetry true for score <= 3', () => {
      const validator = new SvedomiValidator();
      
      expect(validator.parseValidationResponse('SK\u00D3RE: 3').shouldRetry).to.be.true;
      expect(validator.parseValidationResponse('SK\u00D3RE: 4').shouldRetry).to.be.false;
    });
    it('should parse Czech diacritics format (SKÓRE, VALIDNÍ, DŮVOD)', () => {
      const validator = new SvedomiValidator();
      const output = 'SKÓRE: 8\nVALIDNÍ: ANO\nDŮVOD: Odpověď je korektní';
      const result = validator.parseValidationResponse(output);
      expect(result.score).to.equal(8);
      expect(result.isValid).to.be.true;
      expect(result.reason).to.include('korektní');
    });

    it('should parse ASCII fallback format (SKORE, VALIDNI, DUVOD)', () => {
      const validator = new SvedomiValidator();
      const output = 'SKORE: 4\nVALIDNI: NE\nDUVOD: Chybí kontext';
      const result = validator.parseValidationResponse(output);
      expect(result.score).to.equal(4);
      expect(result.isValid).to.be.false;
      expect(result.reason).to.include('kontext');
    });  });

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

    it('should evict expired entries on cache insert', () => {
      const validator = new SvedomiValidator() as any;
      // Insert an entry with timestamp in the past (expired)
      const oldResult = { isValid: true, score: 5, reason: 'Old', shouldRetry: false };
      validator.validationCache.set('oldkey', { result: oldResult, timestamp: Date.now() - 120000 });
      expect(validator.validationCache.size).to.equal(1);

      // Insert a new entry — should trigger eviction of expired
      validator.cacheResult('new prompt', 'new response', { isValid: true, score: 8, reason: 'New', shouldRetry: false });

      // Expired entry should be gone
      expect(validator.validationCache.has('oldkey')).to.be.false;
      // New entry should be present
      expect(validator.validationCache.size).to.equal(1);
    });

    it('should delete expired entry on cache miss', () => {
      const validator = new SvedomiValidator() as any;
      const expiredResult = { isValid: true, score: 7, reason: 'Expired', shouldRetry: false };
      const cacheKey = validator.getCacheKey('prompt x', 'response x');
      validator.validationCache.set(cacheKey, { result: expiredResult, timestamp: Date.now() - 120000 });

      // checkCache should delete expired entry and return null
      const hit = validator.getCachedResult('prompt x', 'response x');
      expect(hit).to.be.null;
      expect(validator.validationCache.has(cacheKey)).to.be.false;
    });

    it('should produce full-length SHA256 cache keys (64 hex chars)', () => {
      const validator = new SvedomiValidator() as any;
      const key = validator.getCacheKey('test prompt', 'test response');
      expect(key).to.have.length(64);
      expect(key).to.match(/^[0-9a-f]{64}$/);
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

    it('should clear timeout even when fetch throws non-AbortError', async () => {
      const v = new SvedomiValidator();
      let timeoutCleared = false;
      const origSetTimeout = globalThis.setTimeout;
      const origClearTimeout = globalThis.clearTimeout;
      let capturedId: any;
      globalThis.setTimeout = ((fn: any, ms: any) => {
        capturedId = origSetTimeout(fn, ms);
        return capturedId;
      }) as any;
      globalThis.clearTimeout = ((id: any) => {
        if (id === capturedId) timeoutCleared = true;
        origClearTimeout(id);
      }) as any;
      globalThis.fetch = async () => { throw new Error('ECONNREFUSED'); };
      try {
        await v.validate('prompt', 'response');
        expect(timeoutCleared).to.be.true;
      } finally {
        globalThis.setTimeout = origSetTimeout;
        globalThis.clearTimeout = origClearTimeout;
      }
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

  describe('eviction safety', () => {
    it('should use Array.from snapshot for overflow eviction', () => {
      const v = new SvedomiValidator() as any;
      // Fill cache beyond CACHE_MAX_SIZE
      const max = v.CACHE_MAX_SIZE;
      for (let i = 0; i < max + 10; i++) {
        v.validationCache.set(`key${i}`, { result: { isValid: true, score: 5, reason: '', shouldRetry: false }, timestamp: Date.now() });
      }
      // Trigger eviction
      v.evictStaleEntries();
      expect(v.validationCache.size).to.be.at.most(max);
    });
  });
});

