const mock = require('mock-require');
mock('vscode', {
  workspace: {
    textDocuments: [],
    fs: { stat: async () => ({ size: 0 }), readFile: async () => new Uint8Array() }
  }
});

import { expect } from 'chai';
import {
  BINARY_EXTENSIONS,
  asString,
  getFirstStringArg,
  formatTimestampForName,
  sanitizeFileName,
  normalizeExtension,
  extractExtensionFromName,
  inferExtensionFromTitle,
  inferExtensionFromContent,
  inferNameFromContent,
  buildAutoFileName,
  normalizeRouteText,
  tokenizeRouteText,
  computeContentHash,
  isBinaryExtension,
  isProbablyBinary
} from '../src/fileUtils';

describe('fileUtils', () => {
  describe('asString', () => {
    it('should return string for string input', () => {
      expect(asString('hello')).to.equal('hello');
    });

    it('should return undefined for number', () => {
      expect(asString(42)).to.be.undefined;
    });

    it('should return undefined for null', () => {
      expect(asString(null)).to.be.undefined;
    });

    it('should return empty string for empty string', () => {
      expect(asString('')).to.equal('');
    });
  });

  describe('getFirstStringArg', () => {
    it('should return first matching key value', () => {
      expect(getFirstStringArg({ a: 'hello', b: 'world' }, ['a', 'b'])).to.equal('hello');
    });

    it('should skip non-string values', () => {
      expect(getFirstStringArg({ a: 42, b: 'world' }, ['a', 'b'])).to.equal('world');
    });

    it('should return undefined when no match', () => {
      expect(getFirstStringArg({ a: 42 }, ['a', 'b'])).to.be.undefined;
    });
  });

  describe('formatTimestampForName', () => {
    it('should format a known date', () => {
      const d = new Date(2025, 2, 5, 14, 30); // March 5, 2025 14:30
      expect(formatTimestampForName(d)).to.equal('20250305-1430');
    });

    it('should return string of expected length', () => {
      const result = formatTimestampForName();
      expect(result).to.match(/^\d{8}-\d{4}$/);
    });
  });

  describe('sanitizeFileName', () => {
    it('should remove special characters', () => {
      expect(sanitizeFileName('hello/world?test')).to.equal('hello-world-test');
    });

    it('should collapse spaces to hyphens', () => {
      expect(sanitizeFileName('hello   world')).to.equal('hello-world');
    });

    it('should truncate long names', () => {
      const long = 'a'.repeat(200);
      expect(sanitizeFileName(long).length).to.be.at.most(120);
    });

    it('should strip leading dots', () => {
      expect(sanitizeFileName('...hidden')).to.equal('hidden');
    });

    it('should handle unicode by normalizing', () => {
      const result = sanitizeFileName('čeština');
      expect(result).to.be.a('string');
      expect(result.length).to.be.greaterThan(0);
    });
  });

  describe('normalizeExtension', () => {
    it('should add dot if missing', () => {
      expect(normalizeExtension('ts')).to.equal('.ts');
    });

    it('should keep dot if present', () => {
      expect(normalizeExtension('.ts')).to.equal('.ts');
    });

    it('should lowercase', () => {
      expect(normalizeExtension('.TS')).to.equal('.ts');
    });

    it('should return empty for undefined', () => {
      expect(normalizeExtension(undefined)).to.equal('');
    });

    it('should return empty for empty string', () => {
      expect(normalizeExtension('')).to.equal('');
    });
  });

  describe('extractExtensionFromName', () => {
    it('should extract .ts extension', () => {
      expect(extractExtensionFromName('file.ts')).to.equal('.ts');
    });

    it('should return empty for no extension', () => {
      expect(extractExtensionFromName('Makefile')).to.equal('');
    });

    it('should return empty for undefined', () => {
      expect(extractExtensionFromName(undefined)).to.equal('');
    });
  });

  describe('inferExtensionFromTitle', () => {
    it('should infer .ts for typescript', () => {
      expect(inferExtensionFromTitle('TypeScript file')).to.equal('.ts');
    });

    it('should infer .py for python', () => {
      expect(inferExtensionFromTitle('Python script')).to.equal('.py');
    });

    it('should infer .ino for arduino', () => {
      expect(inferExtensionFromTitle('Arduino sketch')).to.equal('.ino');
    });

    it('should return empty for unknown', () => {
      expect(inferExtensionFromTitle('some random title')).to.equal('');
    });

    it('should return empty for undefined', () => {
      expect(inferExtensionFromTitle(undefined)).to.equal('');
    });
  });

  describe('inferExtensionFromContent', () => {
    it('should detect JSON from brace', () => {
      expect(inferExtensionFromContent('{"key": "value"}')).to.equal('.json');
    });

    it('should detect HTML', () => {
      expect(inferExtensionFromContent('<!DOCTYPE html><html>')).to.equal('.html');
    });

    it('should detect markdown from heading', () => {
      expect(inferExtensionFromContent('# My Title\n\nSome text')).to.equal('.md');
    });

    it('should return empty for unknown', () => {
      expect(inferExtensionFromContent('random text here')).to.equal('');
    });
  });

  describe('inferNameFromContent', () => {
    it('should detect heading from markdown', () => {
      expect(inferNameFromContent('# My Document\n\nContent here')).to.equal('My-Document');
    });

    it('should detect title from front matter', () => {
      expect(inferNameFromContent('---\ntitle: My Page\n---\nContent')).to.equal('My-Page');
    });

    it('should detect class name', () => {
      const result = inferNameFromContent('export class MyComponent {\n}');
      expect(result).to.equal('MyComponent');
    });

    it('should return empty for empty content', () => {
      expect(inferNameFromContent('')).to.equal('');
    });
  });

  describe('buildAutoFileName', () => {
    it('should use suggested name', () => {
      expect(buildAutoFileName({ suggestedName: 'test.ts' })).to.equal('test.ts');
    });

    it('should use title', () => {
      const result = buildAutoFileName({ title: 'My Component' });
      expect(result).to.include('My-Component');
    });

    it('should default to .txt extension', () => {
      const result = buildAutoFileName({ suggestedName: 'readme' });
      expect(result).to.equal('readme.txt');
    });

    it('should use provided extension', () => {
      expect(buildAutoFileName({ suggestedName: 'code', extension: '.py' })).to.equal('code.py');
    });

    it('should generate timestamp for default name', () => {
      const result = buildAutoFileName({});
      expect(result).to.match(/^shumilek-output-\d{8}-\d{4}\.txt$/);
    });
  });

  describe('normalizeRouteText', () => {
    it('should lowercase and strip non-ascii', () => {
      expect(normalizeRouteText('Příliš')).to.equal('prilis');
    });

    it('should handle plain ascii', () => {
      expect(normalizeRouteText('Hello World')).to.equal('hello world');
    });
  });

  describe('tokenizeRouteText', () => {
    it('should split into meaningful tokens', () => {
      const tokens = tokenizeRouteText('Hello World Test');
      expect(tokens).to.deep.equal(['hello', 'world', 'test']);
    });

    it('should filter out short tokens', () => {
      const tokens = tokenizeRouteText('a bb ccc');
      expect(tokens).to.deep.equal(['bb', 'ccc']);
    });
  });

  describe('computeContentHash', () => {
    it('should return a 64-char hex string', () => {
      const hash = computeContentHash('hello');
      expect(hash).to.match(/^[0-9a-f]{64}$/);
    });

    it('should be deterministic', () => {
      expect(computeContentHash('test')).to.equal(computeContentHash('test'));
    });

    it('should differ for different inputs', () => {
      expect(computeContentHash('a')).to.not.equal(computeContentHash('b'));
    });
  });

  describe('BINARY_EXTENSIONS', () => {
    it('should contain common binary extensions', () => {
      expect(BINARY_EXTENSIONS.has('.png')).to.be.true;
      expect(BINARY_EXTENSIONS.has('.exe')).to.be.true;
      expect(BINARY_EXTENSIONS.has('.pdf')).to.be.true;
    });

    it('should not contain text extensions', () => {
      expect(BINARY_EXTENSIONS.has('.ts')).to.be.false;
      expect(BINARY_EXTENSIONS.has('.js')).to.be.false;
      expect(BINARY_EXTENSIONS.has('.md')).to.be.false;
    });
  });

  describe('isBinaryExtension', () => {
    it('should return true for binary files', () => {
      expect(isBinaryExtension('image.png')).to.be.true;
      expect(isBinaryExtension('app.exe')).to.be.true;
    });

    it('should return false for text files', () => {
      expect(isBinaryExtension('code.ts')).to.be.false;
      expect(isBinaryExtension('readme.md')).to.be.false;
    });
  });

  describe('isProbablyBinary', () => {
    it('should detect null bytes as binary', () => {
      expect(isProbablyBinary(new Uint8Array([72, 101, 0, 108]))).to.be.true;
    });

    it('should detect text as not binary', () => {
      const text = new TextEncoder().encode('Hello World');
      expect(isProbablyBinary(text)).to.be.false;
    });

    it('should return false for empty buffer', () => {
      expect(isProbablyBinary(new Uint8Array([]))).to.be.false;
    });

    it('should detect high ratio of control chars as binary', () => {
      const binary = new Uint8Array(10).fill(1);
      expect(isProbablyBinary(binary)).to.be.true;
    });
  });
});
