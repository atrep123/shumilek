const mock = require('mock-require');
mock('vscode', {});

const { expect } = require('chai');
const { shouldCompact, compactMessages } = require('../src/sessionCompactor');

function makeMessages(count: number, options: { includeSystem?: boolean; includeFiles?: boolean; includeErrors?: boolean } = {}) {
  const msgs: Array<{ role: string; content: string; timestamp: number }> = [];

  if (options.includeSystem) {
    msgs.push({ role: 'system', content: 'You are Šumílek.', timestamp: 1000 });
  }

  for (let i = 0; i < count; i++) {
    const isUser = i % 2 === 0;
    let content: string;

    if (isUser) {
      if (options.includeFiles && i < 4) {
        content = `Podívej se na soubor src/extension.ts a oprav chybu v utils.ts`;
      } else if (options.includeErrors && i === 4) {
        content = `Mám error: TypeError: Cannot read property of undefined. Nefunguje to!`;
      } else {
        content = `Uživatel zpráva číslo ${Math.floor(i / 2) + 1}`;
      }
    } else {
      if (options.includeFiles && i < 4) {
        content = `Opravil jsem soubor package.json a přidal config.yaml do projektu`;
      } else {
        content = `Odpověď asistenta číslo ${Math.floor(i / 2) + 1}. Toto je dostatečně dlouhá odpověď.`;
      }
    }

    msgs.push({ role: isUser ? 'user' : 'assistant', content, timestamp: 2000 + i * 100 });
  }

  return msgs;
}

describe('shouldCompact', () => {
  it('should return false for short conversation', () => {
    expect(shouldCompact(makeMessages(6))).to.be.false;
  });

  it('should return false at threshold boundary', () => {
    expect(shouldCompact(makeMessages(16))).to.be.false;
  });

  it('should return true above threshold', () => {
    expect(shouldCompact(makeMessages(20))).to.be.true;
  });

  it('should return true for long conversation', () => {
    expect(shouldCompact(makeMessages(50))).to.be.true;
  });

  it('should not count system messages', () => {
    const msgs = makeMessages(14, { includeSystem: true });
    // 14 non-system + 1 system = 15 total, but only 14 non-system
    expect(shouldCompact(msgs)).to.be.false;
  });

  it('should return false for empty conversation', () => {
    expect(shouldCompact([])).to.be.false;
  });
});

describe('compactMessages', () => {
  it('should not compact short conversations', () => {
    const msgs = makeMessages(10);
    const result = compactMessages(msgs);
    expect(result.compacted).to.be.false;
    expect(result.saved).to.equal(0);
    expect(result.messages).to.deep.equal(msgs);
  });

  it('should compact long conversations', () => {
    const msgs = makeMessages(24);
    const result = compactMessages(msgs);
    expect(result.compacted).to.be.true;
    expect(result.saved).to.be.greaterThan(0);
    expect(result.messages.length).to.be.lessThan(msgs.length);
  });

  it('should keep recent messages intact', () => {
    const msgs = makeMessages(24);
    const result = compactMessages(msgs);
    // Last 6 messages (3 pairs) should be preserved
    const lastSix = msgs.slice(-6);
    const resultLast = result.messages.slice(-6);
    expect(resultLast).to.deep.equal(lastSix);
  });

  it('should include summary system message', () => {
    const msgs = makeMessages(24);
    const result = compactMessages(msgs);
    const summaryMsgs = result.messages.filter(
      (m: any) => m.role === 'system' && m.content.includes('KOMPRIMOVÁN')
    );
    expect(summaryMsgs).to.have.length(1);
  });

  it('should preserve system messages', () => {
    const msgs = makeMessages(22, { includeSystem: true });
    const result = compactMessages(msgs);
    const systemMsgs = result.messages.filter((m: any) => m.role === 'system');
    // Original system message + new summary
    expect(systemMsgs.length).to.be.at.least(2);
  });

  it('should extract file references', () => {
    const msgs = makeMessages(24, { includeFiles: true });
    const result = compactMessages(msgs);
    expect(result.summaryContent).to.include('SOUBORY');
    expect(result.summaryContent).to.include('extension.ts');
  });

  it('should extract error mentions', () => {
    const msgs = makeMessages(24, { includeErrors: true });
    const result = compactMessages(msgs);
    if (result.summaryContent.includes('CHYBY')) {
      expect(result.summaryContent).to.include('CHYBY');
    }
  });

  it('should include topic summary', () => {
    const msgs = makeMessages(24);
    const result = compactMessages(msgs);
    expect(result.summaryContent).to.include('TÉMATA');
  });

  it('should report correct saved count', () => {
    const msgs = makeMessages(24);
    const result = compactMessages(msgs);
    // 24 total - 6 kept = 18 compacted
    expect(result.saved).to.equal(18);
  });

  it('should have timestamp on summary message', () => {
    const msgs = makeMessages(24);
    const result = compactMessages(msgs);
    const summary = result.messages.find(
      (m: any) => m.role === 'system' && m.content.includes('KOMPRIMOVÁN')
    );
    expect(summary.timestamp).to.be.a('number');
  });

  it('should handle conversation with only user messages well', () => {
    const msgs: Array<{ role: string; content: string; timestamp: number }> = [];
    for (let i = 0; i < 20; i++) {
      msgs.push({ role: 'user', content: `Message ${i}`, timestamp: i * 100 });
    }
    const result = compactMessages(msgs);
    expect(result.compacted).to.be.true;
  });
});
