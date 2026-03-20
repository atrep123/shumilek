const mock = require('mock-require');
mock('vscode', {});

const { expect } = require('chai');
const {
  extractSessionFacts,
  compressConversation,
  buildCompressedMessages,
  estimateTokens
} = require('../src/contextMemory');

type ChatMessage = { role: 'system' | 'user' | 'assistant'; content: string };

function makeMessages(count: number, charsPer = 200): ChatMessage[] {
  const msgs: ChatMessage[] = [];
  for (let i = 0; i < count; i++) {
    const role = i % 2 === 0 ? 'user' : 'assistant';
    const content = `Message ${i}: ${'x'.repeat(charsPer)}`;
    msgs.push({ role, content } as ChatMessage);
  }
  return msgs;
}

describe('contextMemory', () => {
  describe('estimateTokens', () => {
    it('should estimate ~chars/4', () => {
      const msgs: ChatMessage[] = [{ role: 'user', content: 'a'.repeat(400) }];
      expect(estimateTokens(msgs)).to.equal(100);
    });

    it('should handle empty messages', () => {
      expect(estimateTokens([])).to.equal(0);
    });
  });

  describe('extractSessionFacts', () => {
    it('should extract file paths', () => {
      const msgs: ChatMessage[] = [
        { role: 'user', content: 'Edit src/extension.ts and test/utils.test.ts' },
        { role: 'assistant', content: 'I modified src/rozum.ts and package.json' }
      ];
      const facts = extractSessionFacts(msgs);
      expect(facts.files).to.include('src/extension.ts');
      expect(facts.files).to.include('test/utils.test.ts');
      expect(facts.files).to.include('src/rozum.ts');
      expect(facts.files).to.include('package.json');
    });

    it('should extract errors', () => {
      const msgs: ChatMessage[] = [
        { role: 'user', content: 'Error: Cannot find module "./utils" in the project' }
      ];
      const facts = extractSessionFacts(msgs);
      expect(facts.errors.length).to.be.greaterThan(0);
    });

    it('should extract decisions', () => {
      const msgs: ChatMessage[] = [
        { role: 'assistant', content: 'I decided to use compression for all API calls' }
      ];
      const facts = extractSessionFacts(msgs);
      // "decided" should match DECISION_PATTERN
      expect(facts.decisions.length).to.be.greaterThan(0);
    });

    it('should limit file count to 20', () => {
      const content = Array.from({ length: 30 }, (_, i) => `src/file${i}.ts`).join(' ');
      const msgs: ChatMessage[] = [{ role: 'user', content }];
      const facts = extractSessionFacts(msgs);
      expect(facts.files.length).to.be.at.most(20);
    });

    it('should deduplicate files', () => {
      const msgs: ChatMessage[] = [
        { role: 'user', content: 'Edit src/extension.ts' },
        { role: 'assistant', content: 'Modified src/extension.ts' }
      ];
      const facts = extractSessionFacts(msgs);
      const extCount = facts.files.filter(f => f === 'src/extension.ts').length;
      expect(extCount).to.equal(1);
    });

    it('should handle empty messages', () => {
      const facts = extractSessionFacts([]);
      expect(facts.files).to.deep.equal([]);
      expect(facts.decisions).to.deep.equal([]);
      expect(facts.errors).to.deep.equal([]);
      expect(facts.technicalDetails).to.deep.equal([]);
    });
  });

  describe('compressConversation', () => {
    it('should NOT compress short conversations', () => {
      const msgs = makeMessages(4, 50);
      const result = compressConversation(msgs, 8192);
      expect(result.wasCompressed).to.be.false;
      expect(result.recentMessages).to.deep.equal(msgs);
    });

    it('should compress long conversations exceeding budget', () => {
      // 40 messages * ~210 chars = ~8400 chars = ~2100 tokens
      // With contextTokens=2048, threshold=0.65 => budget ~1331
      // Should compress
      const msgs = makeMessages(40, 200);
      const result = compressConversation(msgs, 2048);
      expect(result.wasCompressed).to.be.true;
      expect(result.stats.summarizedCount).to.be.greaterThan(0);
      expect(result.stats.recentCount).to.be.lessThan(msgs.length);
    });

    it('should keep recent messages in full', () => {
      const msgs = makeMessages(40, 200);
      const result = compressConversation(msgs, 2048);
      if (result.wasCompressed) {
        // Last 8 conversation messages (4 pairs) should be preserved
        const lastUserMsg = msgs[msgs.length - 2];
        const lastAssistantMsg = msgs[msgs.length - 1];
        expect(result.recentMessages.some(m => m.content === lastUserMsg.content)).to.be.true;
        expect(result.recentMessages.some(m => m.content === lastAssistantMsg.content)).to.be.true;
      }
    });

    it('should produce a context block when compressed', () => {
      const msgs = makeMessages(40, 200);
      const result = compressConversation(msgs, 2048);
      if (result.wasCompressed) {
        expect(result.contextBlock).to.include('[SESSION CONTEXT]');
        expect(result.contextBlock).to.include('[END SESSION CONTEXT]');
      }
    });

    it('should report token savings', () => {
      const msgs = makeMessages(40, 200);
      const result = compressConversation(msgs, 2048);
      if (result.wasCompressed) {
        expect(result.stats.estimatedTokensSaved).to.be.greaterThan(0);
      }
    });

    it('should not compress when messages <= RECENT_PAIRS_FULL*2', () => {
      const msgs = makeMessages(8, 500); // 8 messages = 4 pairs, exactly at boundary
      const result = compressConversation(msgs, 512); // very small context
      expect(result.wasCompressed).to.be.false;
    });

    it('should exclude system messages from recentMessages', () => {
      const msgs: ChatMessage[] = [
        ...makeMessages(30, 200),
        { role: 'system', content: 'TOOL MODE instruction' }
      ];
      const result = compressConversation(msgs, 2048);
      // System messages should be filtered out — they are injected separately
      expect(result.recentMessages.every(m => m.role !== 'system')).to.be.true;
    });

    it('should exclude system messages from non-compressed path too', () => {
      const msgs: ChatMessage[] = [
        { role: 'system', content: 'old system message' },
        { role: 'user', content: 'hi' },
        { role: 'assistant', content: 'hello' }
      ];
      const result = compressConversation(msgs, 8192);
      expect(result.wasCompressed).to.be.false;
      expect(result.recentMessages.every(m => m.role !== 'system')).to.be.true;
      expect(result.recentMessages.length).to.equal(2);
    });
  });

  describe('buildCompressedMessages', () => {
    const systemPrompt = 'You are an AI assistant.';

    it('should pass through without compression for short conversations', () => {
      const msgs = makeMessages(4, 50);
      const { apiMessages, compressed } = buildCompressedMessages(systemPrompt, msgs, 8192);
      expect(compressed.wasCompressed).to.be.false;
      expect(apiMessages[0].role).to.equal('system');
      expect(apiMessages[0].content).to.equal(systemPrompt);
      expect(apiMessages.length).to.equal(msgs.length + 1);
    });

    it('should inject context block into system prompt when compressed', () => {
      const msgs = makeMessages(40, 200);
      const { apiMessages, compressed } = buildCompressedMessages(systemPrompt, msgs, 2048);
      if (compressed.wasCompressed) {
        expect(apiMessages[0].content).to.include('[SESSION CONTEXT]');
        expect(apiMessages[0].content).to.include(systemPrompt);
        // Compressed messages should be fewer
        expect(apiMessages.length).to.be.lessThan(msgs.length + 1);
      }
    });

    it('should always have system message as first', () => {
      const msgs = makeMessages(40, 200);
      const { apiMessages } = buildCompressedMessages(systemPrompt, msgs, 2048);
      expect(apiMessages[0].role).to.equal('system');
    });

    it('should not produce duplicate system messages when history contains system role', () => {
      const msgs: ChatMessage[] = [
        { role: 'system', content: 'old instruction from history' },
        ...makeMessages(4, 50)
      ];
      const { apiMessages, compressed } = buildCompressedMessages(systemPrompt, msgs, 8192);
      expect(compressed.wasCompressed).to.be.false;
      const systemCount = apiMessages.filter(m => m.role === 'system').length;
      expect(systemCount).to.equal(1, 'should have exactly one system message');
      expect(apiMessages[0].content).to.equal(systemPrompt);
    });
  });
});
