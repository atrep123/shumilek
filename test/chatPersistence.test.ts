import { expect } from 'chai';
import {
  getLastAssistantMessage,
  extractPreferredFencedCodeBlock,
  sanitizeChatMessages,
  formatQualityReport,
  buildStructuredOutput,
  normalizeExternalScore
} from '../src/chatPersistence';

describe('chatPersistence', () => {
  // ---- getLastAssistantMessage ----
  describe('getLastAssistantMessage', () => {
    it('returns undefined for empty array', () => {
      expect(getLastAssistantMessage([])).to.be.undefined;
    });

    it('returns undefined when no assistant messages', () => {
      expect(getLastAssistantMessage([{ role: 'user', content: 'hi' }])).to.be.undefined;
    });

    it('returns last assistant message', () => {
      const messages = [
        { role: 'user' as const, content: 'hi' },
        { role: 'assistant' as const, content: 'hello' },
        { role: 'user' as const, content: 'more' },
        { role: 'assistant' as const, content: 'last' }
      ];
      expect(getLastAssistantMessage(messages)?.content).to.equal('last');
    });
  });

  // ---- extractPreferredFencedCodeBlock ----
  describe('extractPreferredFencedCodeBlock', () => {
    it('returns null for text without fenced blocks', () => {
      expect(extractPreferredFencedCodeBlock('no code here')).to.be.null;
    });

    it('returns null for empty fenced blocks', () => {
      expect(extractPreferredFencedCodeBlock('```\n\n```')).to.be.null;
    });

    it('extracts first code block', () => {
      const text = 'before\n```js\nconst x = 1;\n```\nafter';
      const result = extractPreferredFencedCodeBlock(text);
      expect(result).to.not.be.null;
      expect(result!.code).to.equal('const x = 1;');
      expect(result!.lang).to.equal('js');
    });

    it('prefers arduino/cpp blocks', () => {
      const text = '```js\nconst x = 1;\n```\n```cpp\nint main() {}\n```';
      const result = extractPreferredFencedCodeBlock(text);
      expect(result!.lang).to.equal('cpp');
    });

    it('returns code without lang tag', () => {
      const text = '```\nhello world\n```';
      const result = extractPreferredFencedCodeBlock(text);
      expect(result).to.not.be.null;
      expect(result!.lang).to.be.undefined;
      expect(result!.code).to.equal('hello world');
    });
  });

  // ---- sanitizeChatMessages ----
  describe('sanitizeChatMessages', () => {
    it('returns empty array for null/undefined', () => {
      expect(sanitizeChatMessages(null)).to.deep.equal([]);
      expect(sanitizeChatMessages(undefined)).to.deep.equal([]);
    });

    it('returns empty array for non-object', () => {
      expect(sanitizeChatMessages('string')).to.deep.equal([]);
    });

    it('sanitizes valid messages', () => {
      const result = sanitizeChatMessages({
        messages: [
          { role: 'user', content: 'hi' },
          { role: 'assistant', content: 'hello', timestamp: 123 }
        ]
      });
      expect(result).to.have.lengthOf(2);
      expect(result[0].role).to.equal('user');
      expect(result[1].timestamp).to.equal(123);
    });

    it('filters invalid messages', () => {
      const result = sanitizeChatMessages({
        messages: [
          { role: 'user', content: 'hi' },
          { role: 'invalid', content: 123 },
          null,
          { role: 'assistant', content: 'ok' }
        ]
      });
      expect(result).to.have.lengthOf(2);
    });

    it('truncates to 200 messages', () => {
      const messages = Array.from({ length: 250 }, (_, i) => ({
        role: 'user',
        content: `msg ${i}`
      }));
      const result = sanitizeChatMessages({ messages });
      expect(result).to.have.lengthOf(200);
    });
  });

  // ---- formatQualityReport ----
  describe('formatQualityReport', () => {
    it('returns empty string for empty results', () => {
      expect(formatQualityReport([])).to.equal('');
    });

    it('formats pass result', () => {
      const result = formatQualityReport([{ name: 'Test', ok: true }]);
      expect(result).to.include('PASS');
    });

    it('formats fail result with score', () => {
      const result = formatQualityReport([
        { name: 'Test', ok: false, score: 0.3, threshold: 0.5 }
      ]);
      expect(result).to.include('FAIL');
      expect(result).to.include('0.3');
      expect(result).to.include('0.5');
    });

    it('formats skipped result', () => {
      const result = formatQualityReport([
        { name: 'Test', ok: true, unavailable: true, details: 'not configured' }
      ]);
      expect(result).to.include('SKIPPED');
      expect(result).to.include('not configured');
    });

    it('includes raw score when different', () => {
      const result = formatQualityReport([
        { name: 'Test', ok: true, score: 0.85, rawScore: 85 }
      ]);
      expect(result).to.include('raw 85');
    });
  });

  // ---- buildStructuredOutput ----
  describe('buildStructuredOutput', () => {
    it('returns response without checks or summary', () => {
      const result = buildStructuredOutput('Hello', null, []);
      expect(result).to.equal('## Vysledek\n\nHello');
    });

    it('includes quality checks', () => {
      const result = buildStructuredOutput('Hello', null, [{ name: 'T', ok: true }]);
      expect(result).to.include('## Kontroly kvality');
    });

    it('includes summary', () => {
      const result = buildStructuredOutput('Hello', 'Summary here', []);
      expect(result).to.include('## Strucne shrnuti');
      expect(result).to.include('Summary here');
    });

    it('respects includeResponse=false', () => {
      const result = buildStructuredOutput('Hello', null, [], false);
      expect(result).to.equal('Hello');
      expect(result).to.not.include('## Vysledek');
    });
  });

  // ---- normalizeExternalScore ----
  describe('normalizeExternalScore', () => {
    it('returns undefined score for non-number input', () => {
      expect(normalizeExternalScore(undefined)).to.deep.equal({ score: undefined });
    });

    it('passes through score <= 1', () => {
      expect(normalizeExternalScore(0.85)).to.deep.equal({ score: 0.85, rawScore: 0.85 });
    });

    it('normalizes score > 1 to 0-1 range when threshold <= 1', () => {
      const result = normalizeExternalScore(85, 0.5);
      expect(result.score).to.equal(0.85);
      expect(result.rawScore).to.equal(85);
    });

    it('keeps score as-is when threshold > 1', () => {
      const result = normalizeExternalScore(85, 50);
      expect(result.score).to.equal(85);
      expect(result.rawScore).to.equal(85);
    });

    it('normalizes score > 1 without threshold', () => {
      const result = normalizeExternalScore(75);
      expect(result.score).to.equal(0.75);
      expect(result.rawScore).to.equal(75);
    });
  });
});
