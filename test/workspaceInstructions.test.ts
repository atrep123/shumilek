const mock = require('mock-require');
const path = require('path');

const fakeFs: Record<string, { type: number; size: number; content: string }> = {};

const vscodeMock: any = {
  workspace: {
    workspaceFolders: [{ uri: { fsPath: '/workspace' } }],
    fs: {
      stat: async (uri: any) => {
        const entry = fakeFs[uri.fsPath];
        if (!entry) throw new Error('FileNotFound');
        return { type: entry.type, size: entry.size };
      },
      readFile: async (uri: any) => {
        const entry = fakeFs[uri.fsPath];
        if (!entry) throw new Error('FileNotFound');
        return Buffer.from(entry.content, 'utf8');
      }
    }
  },
  Uri: {
    joinPath: (base: any, ...segments: string[]) => ({
      fsPath: path.posix.join(base.fsPath, ...segments)
    })
  },
  FileType: { File: 1, Directory: 2 }
};

mock('vscode', vscodeMock);

import { expect } from 'chai';
import {
  loadWorkspaceInstructions,
  getInstructionFilePath,
  setWorkspaceInstructionsLogger
} from '../src/workspaceInstructions';

function resetFs() {
  for (const k of Object.keys(fakeFs)) delete fakeFs[k];
}

describe('workspaceInstructions', () => {
  beforeEach(() => {
    resetFs();
    vscodeMock.workspace.workspaceFolders = [{ uri: { fsPath: '/workspace' } }];
  });

  // ---------- loadWorkspaceInstructions ----------

  describe('loadWorkspaceInstructions', () => {
    it('returns empty string when no workspace folders', async () => {
      vscodeMock.workspace.workspaceFolders = undefined;
      expect(await loadWorkspaceInstructions()).to.equal('');
    });

    it('returns empty string when workspaceFolders is empty array', async () => {
      vscodeMock.workspace.workspaceFolders = [];
      expect(await loadWorkspaceInstructions()).to.equal('');
    });

    it('returns empty string when no instruction files exist', async () => {
      expect(await loadWorkspaceInstructions()).to.equal('');
    });

    it('loads .shumilek/AGENTS.md first', async () => {
      fakeFs['/workspace/.shumilek/AGENTS.md'] = { type: 1, size: 10, content: 'agent rules' };
      fakeFs['/workspace/AGENTS.md'] = { type: 1, size: 5, content: 'root' };

      const result = await loadWorkspaceInstructions();
      expect(result).to.include('agent rules');
      expect(result).to.include('.shumilek/AGENTS.md');
      expect(result).to.not.include('root');
    });

    it('falls back to AGENTS.md when .shumilek files missing', async () => {
      fakeFs['/workspace/AGENTS.md'] = { type: 1, size: 8, content: 'root md' };

      const result = await loadWorkspaceInstructions();
      expect(result).to.include('root md');
      expect(result).to.include('AGENTS.md');
    });

    it('skips files larger than 50KB', async () => {
      fakeFs['/workspace/.shumilek/AGENTS.md'] = { type: 1, size: 60_000, content: 'big' };
      fakeFs['/workspace/AGENTS.md'] = { type: 1, size: 5, content: 'small' };

      const result = await loadWorkspaceInstructions();
      expect(result).to.include('small');
    });

    it('skips directories', async () => {
      fakeFs['/workspace/.shumilek/AGENTS.md'] = { type: 2, size: 0, content: '' };
      fakeFs['/workspace/AGENTS.md'] = { type: 1, size: 4, content: 'ok' };

      const result = await loadWorkspaceInstructions();
      expect(result).to.include('ok');
    });

    it('skips empty files', async () => {
      fakeFs['/workspace/.shumilek/AGENTS.md'] = { type: 1, size: 0, content: '   ' };
      fakeFs['/workspace/AGENTS.md'] = { type: 1, size: 5, content: 'nonempty' };

      const result = await loadWorkspaceInstructions();
      expect(result).to.include('nonempty');
    });

    it('truncates content exceeding maxChars', async () => {
      const longContent = 'x'.repeat(200);
      fakeFs['/workspace/.shumilek/AGENTS.md'] = { type: 1, size: 200, content: longContent };

      const result = await loadWorkspaceInstructions(100);
      expect(result).to.include('zkráceno');
      expect(result.length).to.be.lessThan(200);
    });

    it('does not truncate content within maxChars', async () => {
      fakeFs['/workspace/.shumilek/AGENTS.md'] = { type: 1, size: 10, content: 'short text' };

      const result = await loadWorkspaceInstructions(4000);
      expect(result).to.not.include('zkráceno');
      expect(result).to.include('short text');
    });

    it('wraps result in WORKSPACE INSTRUKCE header', async () => {
      fakeFs['/workspace/.shumilek/AGENTS.md'] = { type: 1, size: 5, content: 'hello' };

      const result = await loadWorkspaceInstructions();
      expect(result).to.include('[WORKSPACE INSTRUKCE z .shumilek/AGENTS.md]');
    });
  });

  // ---------- getInstructionFilePath ----------

  describe('getInstructionFilePath', () => {
    it('returns null when no workspace folders', async () => {
      vscodeMock.workspace.workspaceFolders = undefined;
      expect(await getInstructionFilePath()).to.be.null;
    });

    it('returns null when no instruction file found', async () => {
      expect(await getInstructionFilePath()).to.be.null;
    });

    it('returns first matching relative path', async () => {
      fakeFs['/workspace/.shumilek/AGENTS.md'] = { type: 1, size: 5, content: 'x' };
      expect(await getInstructionFilePath()).to.equal('.shumilek/AGENTS.md');
    });

    it('falls back to later files', async () => {
      fakeFs['/workspace/.shumilek/SOUL.md'] = { type: 1, size: 5, content: 'x' };
      expect(await getInstructionFilePath()).to.equal('.shumilek/SOUL.md');
    });
  });

  // ---------- setWorkspaceInstructionsLogger ----------

  describe('setWorkspaceInstructionsLogger', () => {
    it('calls logger when file loaded', async () => {
      const logs: string[] = [];
      setWorkspaceInstructionsLogger((msg) => logs.push(msg));

      fakeFs['/workspace/.shumilek/AGENTS.md'] = { type: 1, size: 5, content: 'hello' };
      await loadWorkspaceInstructions();

      expect(logs.some(l => l.includes('Loaded'))).to.be.true;
      // Reset logger
      setWorkspaceInstructionsLogger(() => {});
    });

    it('calls logger when no file found', async () => {
      const logs: string[] = [];
      setWorkspaceInstructionsLogger((msg) => logs.push(msg));

      await loadWorkspaceInstructions();

      expect(logs.some(l => l.includes('No instruction file found'))).to.be.true;
      setWorkspaceInstructionsLogger(() => {});
    });
  });
});
