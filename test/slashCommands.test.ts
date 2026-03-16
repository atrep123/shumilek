const mock = require('mock-require');
mock('vscode', {});

const { expect } = require('chai');
const { isSlashCommand, executeSlashCommand } = require('../src/slashCommands');

function makeCtx(overrides: Record<string, any> = {}) {
  return {
    messages: [
      { role: 'system', content: 'sys', timestamp: 1 },
      { role: 'user', content: 'hello', timestamp: 2 },
      { role: 'assistant', content: 'hi', timestamp: 3 },
    ],
    guardianStats: {
      totalChecks: 5,
      loopsDetected: 1,
      repetitionsFixed: 2,
      retriesTriggered: 0,
      miniModelValidations: 3,
      miniModelRejections: 0,
      hallucinationsDetected: 1,
      similarResponsesBlocked: 0,
      truncationsRepaired: 0,
    },
    modelInfo: {
      main: 'qwen2.5-coder:14b',
      writer: 'qwen2.5-coder:14b',
      rozum: 'deepseek-r1:8b',
      svedomi: 'qwen2.5:3b',
      backend: 'ollama',
      baseUrl: 'http://localhost:11434',
    },
    orchestrationState: 'full',
    svedomiCacheSize: 12,
    responseHistoryStats: { total: 5, avgScore: 7.5 },
    saveMessages: async () => {},
    resetGuardian: () => {},
    runDoctor: async () => '### Doctor\nAll OK',
    compactSession: async () => ({ compacted: true, saved: 8 }),
    toolsInfo: {
      enabled: true,
      confirmEdits: false,
      autoApprove: {
        read: true,
        edit: false,
        commands: false,
        browser: false,
        mcp: false,
      },
    },
    getWorkspaceInstructions: async () => ({
      files: ['.shumilek/AGENTS.md'],
      totalChars: 123,
      truncated: false,
    }),
    ...overrides,
  };
}

describe('isSlashCommand', () => {
  it('should detect /help', () => {
    expect(isSlashCommand('/help')).to.be.true;
  });

  it('should detect /status with whitespace', () => {
    expect(isSlashCommand('  /status  ')).to.be.true;
  });

  it('should detect /doctor', () => {
    expect(isSlashCommand('/doctor')).to.be.true;
  });

  it('should not detect regular text', () => {
    expect(isSlashCommand('Hello world')).to.be.false;
  });

  it('should not detect forward slash in path', () => {
    expect(isSlashCommand('c:/users/test')).to.be.false;
  });

  it('should not detect empty string', () => {
    expect(isSlashCommand('')).to.be.false;
  });

  it('should not detect plain number after slash', () => {
    expect(isSlashCommand('/123')).to.be.false;
  });

  it('should detect /new', () => {
    expect(isSlashCommand('/new')).to.be.true;
  });

  it('should detect /compact', () => {
    expect(isSlashCommand('/compact')).to.be.true;
  });
});

describe('executeSlashCommand', () => {
  describe('/help', () => {
    it('should return help text', async () => {
      const result = await executeSlashCommand('/help', makeCtx());
      expect(result.handled).to.be.true;
      expect(result.response).to.include('/status');
      expect(result.response).to.include('/doctor');
      expect(result.response).to.include('/compact');
      expect(result.response).to.include('/new');
      expect(result.response).to.include('/tools');
      expect(result.response).to.include('/instructions');
    });

    it('should work with /h alias', async () => {
      const result = await executeSlashCommand('/h', makeCtx());
      expect(result.handled).to.be.true;
      expect(result.response).to.include('/help');
    });
  });

  describe('/status', () => {
    it('should include model info', async () => {
      const result = await executeSlashCommand('/status', makeCtx());
      expect(result.handled).to.be.true;
      expect(result.response).to.include('qwen2.5-coder:14b');
      expect(result.response).to.include('deepseek-r1:8b');
      expect(result.response).to.include('qwen2.5:3b');
      expect(result.response).to.include('ollama');
    });

    it('should include message count', async () => {
      const result = await executeSlashCommand('/status', makeCtx());
      expect(result.response).to.include('3');
    });

    it('should work with /s alias', async () => {
      const result = await executeSlashCommand('/s', makeCtx());
      expect(result.handled).to.be.true;
      expect(result.response).to.include('Status');
    });
  });

  describe('/stats', () => {
    it('should include guardian stats', async () => {
      const result = await executeSlashCommand('/stats', makeCtx());
      expect(result.handled).to.be.true;
      expect(result.response).to.include('Guardian');
      expect(result.response).to.include('5'); // totalChecks
      expect(result.response).to.include('1'); // loopsDetected
    });

    it('should include hallucination stats', async () => {
      const result = await executeSlashCommand('/stats', makeCtx());
      expect(result.response).to.include('Halucinace');
    });

    it('should include response history stats', async () => {
      const result = await executeSlashCommand('/stats', makeCtx());
      expect(result.response).to.include('7.5');
    });
  });

  describe('/new', () => {
    it('should set clearHistory flag', async () => {
      const result = await executeSlashCommand('/new', makeCtx());
      expect(result.handled).to.be.true;
      expect(result.clearHistory).to.be.true;
      expect(result.response).to.include('vymazána');
    });

    it('should work with /reset alias', async () => {
      const result = await executeSlashCommand('/reset', makeCtx());
      expect(result.handled).to.be.true;
      expect(result.clearHistory).to.be.true;
    });
  });

  describe('/compact', () => {
    it('should call compactSession callback', async () => {
      let called = false;
      const ctx = makeCtx({
        compactSession: async () => { called = true; return { compacted: true, saved: 8 }; },
      });
      const result = await executeSlashCommand('/compact', ctx);
      expect(result.handled).to.be.true;
      expect(called).to.be.true;
      expect(result.response).to.include('8');
    });

    it('should handle no compaction needed', async () => {
      const ctx = makeCtx({
        compactSession: async () => ({ compacted: false, saved: 0 }),
      });
      const result = await executeSlashCommand('/compact', ctx);
      expect(result.handled).to.be.true;
      expect(result.response).to.include('dostatečně krátký');
    });
  });

  describe('/doctor', () => {
    it('should call runDoctor callback', async () => {
      let called = false;
      const ctx = makeCtx({
        runDoctor: async () => { called = true; return '### Doctor report\nOK'; },
      });
      const result = await executeSlashCommand('/doctor', ctx);
      expect(result.handled).to.be.true;
      expect(called).to.be.true;
      expect(result.response).to.include('Doctor report');
    });

    it('should work with /doc alias', async () => {
      const result = await executeSlashCommand('/doc', makeCtx());
      expect(result.handled).to.be.true;
    });
  });

  describe('/tools', () => {
    it('should show tools runtime status', async () => {
      const result = await executeSlashCommand('/tools', makeCtx());
      expect(result.handled).to.be.true;
      expect(result.response).to.include('Tools enabled');
      expect(result.response).to.include('Auto-approve browser');
    });
  });

  describe('/instructions', () => {
    it('should show loaded instruction files', async () => {
      const result = await executeSlashCommand('/instructions', makeCtx());
      expect(result.handled).to.be.true;
      expect(result.response).to.include('.shumilek/AGENTS.md');
      expect(result.response).to.include('123');
    });

    it('should handle missing instruction files', async () => {
      const result = await executeSlashCommand('/instructions', makeCtx({
        getWorkspaceInstructions: async () => ({ files: [], totalChars: 0, truncated: false })
      }));
      expect(result.handled).to.be.true;
      expect(result.response).to.include('Nebyl nalezen');
    });
  });

  describe('unknown command', () => {
    it('should return error for unknown command', async () => {
      const result = await executeSlashCommand('/foo', makeCtx());
      expect(result.handled).to.be.true;
      expect(result.response).to.include('Neznámý příkaz');
      expect(result.response).to.include('/foo');
      expect(result.response).to.include('/help');
    });
  });

  describe('malformed input', () => {
    it('should not handle non-slash input', async () => {
      const result = await executeSlashCommand('hello', makeCtx());
      expect(result.handled).to.be.false;
    });

    it('should not handle empty string', async () => {
      const result = await executeSlashCommand('', makeCtx());
      expect(result.handled).to.be.false;
    });
  });
});
