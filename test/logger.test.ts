const { registerMock, flushModuleCache } = require('./helpers/mockLoader');

let appendedLines: string[] = [];
let channelCreated = false;

const loggerVscodeMock: any = {
  window: {
    createOutputChannel: (name: string) => {
      channelCreated = true;
      return {
        appendLine: (text: string) => { appendedLines.push(text); }
      };
    }
  }
};

registerMock('vscode', loggerVscodeMock, 'logger');
flushModuleCache('../src/logger');

const { expect } = require('chai');
const { Logger } = require('../src/logger');

describe('Logger', () => {
  before(() => {
    // Initialize once with mocked vscode
    Logger.initialize({} as any);
  });

  beforeEach(() => {
    appendedLines = [];
  });

  it('creates output channel on initialize', () => {
    expect(channelCreated).to.be.true;
  });

  it('logs info messages with timestamp and level', () => {
    Logger.info('hello world');
    expect(appendedLines).to.have.length(1);
    expect(appendedLines[0]).to.include('[INFO]');
    expect(appendedLines[0]).to.include('hello world');
  });

  it('logs debug messages', () => {
    Logger.debug('debug msg');
    expect(appendedLines[0]).to.include('[DEBUG]');
    expect(appendedLines[0]).to.include('debug msg');
  });

  it('logs warn messages', () => {
    Logger.warn('warning');
    expect(appendedLines[0]).to.include('[WARN]');
  });

  it('logs error messages', () => {
    Logger.error('something broke');
    expect(appendedLines[0]).to.include('[ERROR]');
    expect(appendedLines[0]).to.include('something broke');
  });

  it('appends Error.message to error log', () => {
    Logger.error('fail', new Error('details'));
    expect(appendedLines[0]).to.include('details');
  });

  it('appends string error to error log', () => {
    Logger.error('fail', 'string error');
    expect(appendedLines[0]).to.include('string error');
  });

  it('includes ISO-format timestamp', () => {
    Logger.info('ts check');
    // Pattern: [YYYY-MM-DD HH:MM:SS]
    expect(appendedLines[0]).to.match(/\[\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}\]/);
  });

  it('initialize with existing channel reuses it', () => {
    const lines: string[] = [];
    const existingChannel = { appendLine: (t: string) => lines.push(t) };
    // Create a fresh Logger by resetting the channel (hack via internal state)
    (Logger as any).channel = undefined;
    Logger.initialize({} as any, existingChannel as any);
    Logger.info('reuse test');
    expect(lines).to.have.length(1);
    expect(lines[0]).to.include('reuse test');
  });

  it('silently skips log when channel not initialized', () => {
    const saved = (Logger as any).channel;
    (Logger as any).channel = undefined;
    // Should not throw
    Logger.info('no channel');
    (Logger as any).channel = saved;
  });
});
