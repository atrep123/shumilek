import { expect } from 'chai';
import { 
  WorkspaceIndexer, 
  FileInfo, 
  SymbolInfo, 
  WorkspaceIndex 
} from '../src/workspace';

describe('WorkspaceIndexer', () => {
  describe('basic functionality', () => {
    it('should create instance', () => {
      const indexer = new WorkspaceIndexer();
      expect(indexer).to.be.instanceOf(WorkspaceIndexer);
    });

    it('should return null index initially', () => {
      const indexer = new WorkspaceIndexer();
      expect(indexer.getIndex()).to.be.null;
    });

    it('should clear index', () => {
      const indexer = new WorkspaceIndexer();
      indexer.clearIndex();
      expect(indexer.getIndex()).to.be.null;
    });
  });

  describe('file extension mapping', () => {
    it('should identify source files by extension', () => {
      const indexer = new WorkspaceIndexer();
      // Access private method via any cast for testing
      const getExt = (indexer as any).getExtension.bind(indexer);
      
      expect(getExt('test.ts')).to.equal('.ts');
      expect(getExt('test.tsx')).to.equal('.tsx');
      expect(getExt('test.py')).to.equal('.py');
      expect(getExt('file.min.js')).to.equal('.js');
      expect(getExt('noextension')).to.equal('');
    });

    it('should map extensions to languages', () => {
      const indexer = new WorkspaceIndexer();
      const getLang = (indexer as any).getLanguage.bind(indexer);
      
      expect(getLang('.ts')).to.equal('typescript');
      expect(getLang('.py')).to.equal('python');
      expect(getLang('.go')).to.equal('go');
      expect(getLang('.rs')).to.equal('rust');
      expect(getLang('.unknown')).to.be.undefined;
    });
  });

  describe('ignore patterns', () => {
    it('should ignore node_modules', () => {
      const indexer = new WorkspaceIndexer();
      const shouldIgnore = (indexer as any).shouldIgnore.bind(indexer);
      
      expect(shouldIgnore('node_modules')).to.be.true;
      expect(shouldIgnore('.git')).to.be.true;
      expect(shouldIgnore('dist')).to.be.true;
      expect(shouldIgnore('__pycache__')).to.be.true;
    });

    it('should not ignore regular folders', () => {
      const indexer = new WorkspaceIndexer();
      const shouldIgnore = (indexer as any).shouldIgnore.bind(indexer);
      
      expect(shouldIgnore('src')).to.be.false;
      expect(shouldIgnore('lib')).to.be.false;
      expect(shouldIgnore('components')).to.be.false;
    });

    it('should ignore files matching wildcard patterns', () => {
      const indexer = new WorkspaceIndexer();
      const shouldIgnore = (indexer as any).shouldIgnore.bind(indexer);
      
      expect(shouldIgnore('bundle.min.js')).to.be.true;
      expect(shouldIgnore('app.map')).to.be.true;
      expect(shouldIgnore('package-lock.json')).to.be.true;
    });
  });

  describe('symbol importance', () => {
    it('should have isImportantSymbol method', () => {
      const indexer = new WorkspaceIndexer();
      // The method exists, but relies on vscode.SymbolKind which is not available in test env
      expect((indexer as any).isImportantSymbol).to.be.a('function');
    });
  });

  describe('workspace summary', () => {
    it('should return message when not indexed', () => {
      const indexer = new WorkspaceIndexer();
      const summary = indexer.getWorkspaceSummary();
      expect(summary).to.include('nebyl indexován');
    });
  });

  describe('search', () => {
    it('should return empty array when no index', async () => {
      const indexer = new WorkspaceIndexer();
      // Manually set empty index to test search
      (indexer as any).index = {
        files: [],
        symbols: [],
        structure: '',
        summary: '',
        lastUpdated: Date.now()
      };
      
      const results = await indexer.searchFiles('test');
      expect(results).to.be.an('array').that.is.empty;
    });

    it('should find files by name match', async () => {
      const indexer = new WorkspaceIndexer();
      (indexer as any).index = {
        files: [
          { path: '/src/test.ts', relativePath: 'src/test.ts', name: 'test.ts', extension: '.ts', size: 100, isSource: true, language: 'typescript' },
          { path: '/src/other.ts', relativePath: 'src/other.ts', name: 'other.ts', extension: '.ts', size: 100, isSource: true, language: 'typescript' }
        ],
        symbols: [],
        structure: '',
        summary: '',
        lastUpdated: Date.now()
      };
      
      const results = await indexer.searchFiles('test');
      expect(results).to.have.length(1);
      expect(results[0].file.name).to.equal('test.ts');
    });

    it('should score path matches', async () => {
      const indexer = new WorkspaceIndexer();
      (indexer as any).index = {
        files: [
          { path: '/src/api/users.ts', relativePath: 'src/api/users.ts', name: 'users.ts', extension: '.ts', size: 100, isSource: true },
          { path: '/tests/api.test.ts', relativePath: 'tests/api.test.ts', name: 'api.test.ts', extension: '.ts', size: 100, isSource: true }
        ],
        symbols: [],
        structure: '',
        summary: '',
        lastUpdated: Date.now()
      };
      
      const results = await indexer.searchFiles('api');
      expect(results).to.have.length(2);
      // Both should match, but api.test.ts should score higher (name match)
    });
  });
});
