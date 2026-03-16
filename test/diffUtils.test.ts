import { expect } from 'chai';
import {
  detectEol,
  splitLines,
  normalizePatchPath,
  parseUnifiedDiff,
  applyUnifiedDiffToText
} from '../src/diffUtils';

describe('diffUtils', () => {
  describe('detectEol', () => {
    it('should detect CRLF', () => {
      expect(detectEol('hello\r\nworld')).to.equal('\r\n');
    });

    it('should detect LF', () => {
      expect(detectEol('hello\nworld')).to.equal('\n');
    });

    it('should default to LF for no newlines', () => {
      expect(detectEol('hello')).to.equal('\n');
    });
  });

  describe('splitLines', () => {
    it('should split LF', () => {
      expect(splitLines('a\nb\nc')).to.deep.equal(['a', 'b', 'c']);
    });

    it('should split CRLF', () => {
      expect(splitLines('a\r\nb\r\nc')).to.deep.equal(['a', 'b', 'c']);
    });

    it('should return [""] for empty string', () => {
      expect(splitLines('')).to.deep.equal(['']);
    });

    it('should handle single line', () => {
      expect(splitLines('hello')).to.deep.equal(['hello']);
    });
  });

  describe('normalizePatchPath', () => {
    it('should strip a/ prefix', () => {
      expect(normalizePatchPath('a/src/file.ts')).to.equal('src/file.ts');
    });

    it('should strip b/ prefix', () => {
      expect(normalizePatchPath('b/src/file.ts')).to.equal('src/file.ts');
    });

    it('should return empty for /dev/null', () => {
      expect(normalizePatchPath('/dev/null')).to.equal('');
    });

    it('should handle paths without prefix', () => {
      expect(normalizePatchPath('src/file.ts')).to.equal('src/file.ts');
    });
  });

  describe('parseUnifiedDiff', () => {
    it('should parse a simple diff', () => {
      const diff = [
        '--- a/file.ts',
        '+++ b/file.ts',
        '@@ -1,3 +1,3 @@',
        ' line1',
        '-line2',
        '+line2_modified',
        ' line3'
      ].join('\n');

      const files = parseUnifiedDiff(diff);
      expect(files).to.have.length(1);
      expect(files[0].oldPath).to.equal('file.ts');
      expect(files[0].newPath).to.equal('file.ts');
      expect(files[0].hunks).to.have.length(1);
      expect(files[0].hunks[0].oldStart).to.equal(1);
      expect(files[0].hunks[0].lines).to.have.length(4);
    });

    it('should parse multiple files', () => {
      const diff = [
        '--- a/a.ts',
        '+++ b/a.ts',
        '@@ -1,1 +1,1 @@',
        '-old',
        '+new',
        '--- a/b.ts',
        '+++ b/b.ts',
        '@@ -1,1 +1,1 @@',
        '-old2',
        '+new2'
      ].join('\n');

      const files = parseUnifiedDiff(diff);
      expect(files).to.have.length(2);
    });

    it('should skip diff --git lines', () => {
      const diff = [
        'diff --git a/file.ts b/file.ts',
        '--- a/file.ts',
        '+++ b/file.ts',
        '@@ -1,1 +1,1 @@',
        '-old',
        '+new'
      ].join('\n');

      const files = parseUnifiedDiff(diff);
      expect(files).to.have.length(1);
    });

    it('should return empty for empty input', () => {
      expect(parseUnifiedDiff('')).to.deep.equal([]);
    });
  });

  describe('applyUnifiedDiffToText', () => {
    it('should apply a simple replacement', () => {
      const original = 'line1\nline2\nline3';
      const hunks = [{
        oldStart: 2,
        oldLines: 1,
        newStart: 2,
        newLines: 1,
        lines: ['-line2', '+line2_modified']
      }];

      const result = applyUnifiedDiffToText(original, hunks);
      expect(result.text).to.equal('line1\nline2_modified\nline3');
      expect(result.appliedHunks).to.equal(1);
    });

    it('should apply addition', () => {
      const original = 'line1\nline2';
      const hunks = [{
        oldStart: 2,
        oldLines: 1,
        newStart: 2,
        newLines: 2,
        lines: [' line2', '+new_line']
      }];

      const result = applyUnifiedDiffToText(original, hunks);
      expect(result.text).to.equal('line1\nline2\nnew_line');
      expect(result.appliedHunks).to.equal(1);
    });

    it('should apply deletion', () => {
      const original = 'line1\nline2\nline3';
      const hunks = [{
        oldStart: 2,
        oldLines: 1,
        newStart: 2,
        newLines: 0,
        lines: ['-line2']
      }];

      const result = applyUnifiedDiffToText(original, hunks);
      expect(result.text).to.equal('line1\nline3');
      expect(result.appliedHunks).to.equal(1);
    });

    it('should return error on context mismatch', () => {
      const original = 'line1\nline2\nline3';
      const hunks = [{
        oldStart: 1,
        oldLines: 1,
        newStart: 1,
        newLines: 1,
        lines: [' wrong_context']
      }];

      const result = applyUnifiedDiffToText(original, hunks);
      expect(result.error).to.equal('context mismatch');
    });

    it('should handle empty original', () => {
      const hunks = [{
        oldStart: 1,
        oldLines: 0,
        newStart: 1,
        newLines: 1,
        lines: ['+new_line']
      }];

      const result = applyUnifiedDiffToText('', hunks);
      expect(result.text).to.equal('new_line');
    });
  });
});
