const mock = require('mock-require');
mock('vscode', {});

const { expect } = require('chai');
const { normalizeTaskWeight, humanizeApiError, isTransientError, isSafeUrl, getNonce } = require('../src/utils');

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

  it('should truncate very long error strings before regex matching (ReDoS prevention)', () => {
    // Build a 5000-char error string with ECONNREFUSED near the end (beyond 1000).
    // After truncation to 1000 chars, the pattern won't be found → passthrough (truncated raw returned).
    const longPrefix = 'x'.repeat(1500);
    const hugeMsg = longPrefix + ' ECONNREFUSED at end';
    const result = humanizeApiError(hugeMsg);
    // The ECONNREFUSED is beyond 1000 chars, so it should NOT be humanized
    expect(result).to.equal(hugeMsg);
  });

  it('should still humanize errors within the first 1000 chars', () => {
    const msg = 'ECONNREFUSED ' + 'y'.repeat(2000);
    const result = humanizeApiError(msg);
    expect(result).to.include('Ollama');
  });
});

describe('isTransientError', () => {
  it('should detect ECONNRESET', () => {
    expect(isTransientError(new Error('read ECONNRESET'))).to.be.true;
  });

  it('should detect ETIMEDOUT', () => {
    expect(isTransientError('connect ETIMEDOUT 192.168.1.100:11434')).to.be.true;
  });

  it('should detect socket hang up', () => {
    expect(isTransientError(new Error('socket hang up'))).to.be.true;
  });

  it('should detect network timeout', () => {
    expect(isTransientError('network timeout at: http://localhost:11434')).to.be.true;
  });

  it('should detect HTTP 5xx', () => {
    expect(isTransientError('HTTP 500: Internal Server Error')).to.be.true;
    expect(isTransientError(new Error('HTTP 502: Bad Gateway'))).to.be.true;
    expect(isTransientError('HTTP 503')).to.be.true;
  });

  it('should detect EPIPE', () => {
    expect(isTransientError(new Error('write EPIPE'))).to.be.true;
  });

  it('should detect ECONNABORTED', () => {
    expect(isTransientError('ECONNABORTED')).to.be.true;
  });

  it('should NOT detect ECONNREFUSED (permanent)', () => {
    expect(isTransientError('connect ECONNREFUSED 127.0.0.1:11434')).to.be.false;
  });

  it('should NOT detect model not found', () => {
    expect(isTransientError('model "qwen2.5" not found')).to.be.false;
  });

  it('should NOT detect unknown errors', () => {
    expect(isTransientError('Something weird happened')).to.be.false;
  });

  it('should handle Error objects with empty message', () => {
    expect(isTransientError(new Error(''))).to.be.false;
  });
});

describe('isSafeUrl', () => {
  it('should allow normal public URLs', async () => {
    expect(await isSafeUrl('https://example.com')).to.deep.include({ safe: true });
    expect(await isSafeUrl('http://github.com/repo')).to.deep.include({ safe: true });
    expect(await isSafeUrl('https://docs.python.org/3/library.html')).to.deep.include({ safe: true });
  });

  it('should block localhost', async () => {
    const r = await isSafeUrl('http://localhost:11434/api/tags');
    expect(r.safe).to.be.false;
    expect(r.reason).to.include('localhost');
  });

  it('should block 127.x.x.x', async () => {
    expect((await isSafeUrl('http://127.0.0.1:8080')).safe).to.be.false;
    expect((await isSafeUrl('http://127.0.0.1')).safe).to.be.false;
  });

  it('should block 10.x private range', async () => {
    expect((await isSafeUrl('http://10.0.0.1')).safe).to.be.false;
    expect((await isSafeUrl('http://10.255.255.255')).safe).to.be.false;
  });

  it('should block 192.168.x private range', async () => {
    expect((await isSafeUrl('http://192.168.1.1')).safe).to.be.false;
  });

  it('should block 172.16-31 private range', async () => {
    expect((await isSafeUrl('http://172.16.0.1')).safe).to.be.false;
    expect((await isSafeUrl('http://172.31.255.255')).safe).to.be.false;
  });

  it('should block cloud metadata endpoint', async () => {
    expect((await isSafeUrl('http://169.254.169.254/latest/meta-data')).safe).to.be.false;
    expect((await isSafeUrl('http://metadata.google.internal/computeMetadata')).safe).to.be.false;
  });

  it('should block non-http protocols', async () => {
    const r = await isSafeUrl('file:///etc/passwd');
    expect(r.safe).to.be.false;
    expect(r.reason).to.include('protokol');
    expect((await isSafeUrl('ftp://internal.host/data')).safe).to.be.false;
  });

  it('should reject invalid URLs', async () => {
    expect((await isSafeUrl('not-a-url')).safe).to.be.false;
    expect((await isSafeUrl('')).safe).to.be.false;
  });

  it('should block IPv6 loopback', async () => {
    expect((await isSafeUrl('http://[::1]:8080')).safe).to.be.false;
  });

  it('should fail-closed when DNS lookup throws', async () => {
    const dns = require('dns');
    const original = dns.promises.lookup;
    dns.promises.lookup = () => Promise.reject(new Error('DNS failed'));
    try {
      const r = await isSafeUrl('http://attacker-controlled.example.com');
      expect(r.safe).to.be.false;
      expect(r.reason).to.include('DNS lookup failed');
    } finally {
      dns.promises.lookup = original;
    }
  });

  it('should fail-closed when DNS lookup hangs beyond timeout', async () => {
    const dns = require('dns');
    const original = dns.promises.lookup;
    dns.promises.lookup = () => new Promise(() => {}); // never resolves
    try {
      const r = await isSafeUrl('http://slow-dns.example.com');
      expect(r.safe).to.be.false;
      expect(r.reason).to.include('DNS lookup failed');
    } finally {
      dns.promises.lookup = original;
    }
  }).timeout(10000);

  it('should block IPv4-mapped IPv6 addresses resolving to private IPs', async () => {
    const dns = require('dns');
    const original = dns.promises.lookup;
    dns.promises.lookup = () => Promise.resolve({ address: '::ffff:10.0.0.1', family: 6 });
    try {
      const r = await isSafeUrl('http://rebind.example.com');
      expect(r.safe).to.be.false;
      expect(r.reason).to.include('private IP');
    } finally {
      dns.promises.lookup = original;
    }
  });

  it('should block IPv4-mapped IPv6 cloud metadata address', async () => {
    const dns = require('dns');
    const original = dns.promises.lookup;
    dns.promises.lookup = () => Promise.resolve({ address: '::ffff:169.254.169.254', family: 6 });
    try {
      const r = await isSafeUrl('http://rebind-meta.example.com');
      expect(r.safe).to.be.false;
      expect(r.reason).to.include('private IP');
    } finally {
      dns.promises.lookup = original;
    }
  });
});

describe('getNonce', () => {
  it('should return a non-empty string', () => {
    const nonce = getNonce();
    expect(nonce).to.be.a('string');
    expect(nonce.length).to.be.greaterThan(0);
  });

  it('should return unique values on successive calls', () => {
    const nonces = new Set(Array.from({ length: 50 }, () => getNonce()));
    expect(nonces.size).to.equal(50);
  });

  it('should be URL-safe base64 (no +, /, =)', () => {
    for (let i = 0; i < 20; i++) {
      const nonce = getNonce();
      expect(nonce).to.not.match(/[+/=]/);
    }
  });
});

describe('surrogate pair safe truncation (pattern used in extension.ts)', () => {
  function safeTruncate(str: string, maxLen: number): string {
    let truncated = str.slice(0, maxLen);
    if (truncated.length === maxLen && truncated.charCodeAt(maxLen - 1) >= 0xD800 && truncated.charCodeAt(maxLen - 1) <= 0xDBFF) {
      truncated = truncated.slice(0, maxLen - 1);
    }
    return truncated;
  }

  it('should not split a surrogate pair at the boundary', () => {
    // U+1F600 (😀) is encoded as \uD83D\uDE00 in UTF-16
    const emoji = '\uD83D\uDE00'; // 😀
    const str = 'a'.repeat(1999) + emoji;
    const result = safeTruncate(str, 2000);
    // Should drop the high surrogate rather than including an orphan
    expect(result.length).to.equal(1999);
    expect(result.charCodeAt(result.length - 1)).to.equal(97); // 'a'
  });

  it('should keep full string if no surrogate at boundary', () => {
    const str = 'a'.repeat(2000);
    const result = safeTruncate(str, 2000);
    expect(result.length).to.equal(2000);
  });

  it('should handle string shorter than maxLen', () => {
    const str = 'hello';
    const result = safeTruncate(str, 2000);
    expect(result).to.equal('hello');
  });

  it('should handle string with surrogate pair well before boundary', () => {
    const emoji = '\uD83D\uDE00';
    const str = emoji + 'a'.repeat(2000);
    const result = safeTruncate(str, 2000);
    expect(result.length).to.equal(2000);
    // First two chars are the emoji surrogate pair, rest are 'a'
    expect(result.charCodeAt(0)).to.equal(0xD83D);
    expect(result.charCodeAt(1)).to.equal(0xDE00);
  });
});

describe('SHA-256 hash for prompt comparison (pattern used in extension.ts)', () => {
  const { createHash } = require('crypto');

  function hashString(str: string): string {
    const sample = str.toLowerCase().replace(/\s+/g, ' ').trim().slice(0, 300);
    return createHash('sha256').update(sample).digest('hex').slice(0, 16);
  }

  it('should produce deterministic 16-char hex output', () => {
    const h1 = hashString('test prompt');
    const h2 = hashString('test prompt');
    expect(h1).to.equal(h2);
    expect(h1).to.match(/^[0-9a-f]{16}$/);
  });

  it('should produce different hashes for different inputs', () => {
    const h1 = hashString('prompt A');
    const h2 = hashString('prompt B');
    expect(h1).to.not.equal(h2);
  });

  it('should normalize whitespace before hashing', () => {
    const h1 = hashString('hello   world');
    const h2 = hashString('hello world');
    expect(h1).to.equal(h2);
  });

  it('should be case-insensitive', () => {
    const h1 = hashString('Hello World');
    const h2 = hashString('hello world');
    expect(h1).to.equal(h2);
  });
});
