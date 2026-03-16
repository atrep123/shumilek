import { expect } from 'chai';
import { sanitizeMapSegment, formatProjectMapMarkdown } from '../src/projectMap';

describe('projectMap', () => {
  // ---- sanitizeMapSegment ----
  describe('sanitizeMapSegment', () => {
    it('passes through simple ASCII', () => {
      expect(sanitizeMapSegment('myProject')).to.equal('myProject');
    });

    it('replaces special characters with underscores', () => {
      expect(sanitizeMapSegment('my project!')).to.equal('my_project');
    });

    it('strips diacritics', () => {
      const result = sanitizeMapSegment('šumílek');
      expect(result).to.equal('sumilek');
    });

    it('returns root for empty string', () => {
      expect(sanitizeMapSegment('')).to.equal('root');
    });

    it('strips leading/trailing underscores', () => {
      expect(sanitizeMapSegment('__test__')).to.equal('test');
    });

    it('allows hyphens', () => {
      expect(sanitizeMapSegment('my-project')).to.equal('my-project');
    });
  });

  // ---- formatProjectMapMarkdown ----
  describe('formatProjectMapMarkdown', () => {
    it('formats empty project map', () => {
      const map = {
        tree: '',
        keyFiles: [],
        modules: [],
        lastUpdated: new Date('2026-01-01T00:00:00Z').getTime()
      };
      const result = formatProjectMapMarkdown(map);
      expect(result).to.include('# Project Map');
      expect(result).to.include('2026-01-01');
      expect(result).to.include('- (empty)');
      expect(result).to.include('- (none)');
    });

    it('includes tree content', () => {
      const map = {
        tree: 'src/\n  main.ts\n  utils.ts',
        keyFiles: [],
        modules: [],
        lastUpdated: Date.now()
      };
      const result = formatProjectMapMarkdown(map);
      expect(result).to.include('src/');
      expect(result).to.include('main.ts');
    });

    it('lists key files', () => {
      const map = {
        tree: '',
        keyFiles: ['package.json', 'tsconfig.json'],
        modules: [],
        lastUpdated: Date.now()
      };
      const result = formatProjectMapMarkdown(map);
      expect(result).to.include('- package.json');
      expect(result).to.include('- tsconfig.json');
    });

    it('lists modules with files', () => {
      const map = {
        tree: '',
        keyFiles: [],
        modules: [
          { name: 'core', summary: 'Core module', files: ['src/core.ts', 'src/types.ts'] }
        ],
        lastUpdated: Date.now()
      };
      const result = formatProjectMapMarkdown(map);
      expect(result).to.include('- core: Core module');
      expect(result).to.include('  - src/core.ts');
      expect(result).to.include('  - src/types.ts');
    });

    it('includes all sections', () => {
      const result = formatProjectMapMarkdown({
        tree: 'root',
        keyFiles: ['a.ts'],
        modules: [{ name: 'm', summary: 's', files: ['f.ts'] }],
        lastUpdated: Date.now()
      });
      expect(result).to.include('## Tree');
      expect(result).to.include('## Key Files');
      expect(result).to.include('## Modules');
    });
  });
});
