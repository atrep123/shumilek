import { strict as assert } from 'assert';

import { parseToolCalls, resolveToolPermissionScope } from '../src/toolingProtocol';

describe('toolingProtocol', () => {
  describe('resolveToolPermissionScope', () => {
    it('classifies route_file as read scope', () => {
      assert.equal(resolveToolPermissionScope('route_file'), 'read');
    });

    it('keeps unsupported pick_file_for_intent as commands scope', () => {
      assert.equal(resolveToolPermissionScope('pick_file_for_intent'), 'commands');
    });

    it('classifies edit tools as edit scope', () => {
      const editTools = ['write_file', 'replace_lines', 'apply_patch', 'rename_file', 'delete_file'];
      for (const tool of editTools) {
        assert.equal(resolveToolPermissionScope(tool), 'edit');
      }
    });
  });

  describe('parseToolCalls', () => {
    it('detects mixed text with tool_call blocks', () => {
      const input = [
        'Nejdriv nactu soubor.',
        '<tool_call>{"name":"read_file","arguments":{"path":"src/extension.ts"}}</tool_call>',
      ].join('\n');
      const parsed = parseToolCalls(input);
      assert.equal(parsed.calls.length, 1);
      assert.ok(parsed.remainingText.length > 0);
      assert.match(parsed.remainingText, /Nejdriv nactu soubor/i);
    });

    it('returns empty remainingText for pure tool_call payload', () => {
      const input = '<tool_call>{"name":"read_file","arguments":{"path":"src/extension.ts"}}</tool_call>';
      const parsed = parseToolCalls(input);
      assert.equal(parsed.calls.length, 1);
      assert.equal(parsed.remainingText, '');
      assert.deepEqual(parsed.errors, []);
    });

    it('parses plain JSON fallback responses', () => {
      const input = '{"name":"read_file","arguments":{"path":"src/extension.ts"}}';
      const parsed = parseToolCalls(input);
      assert.equal(parsed.calls.length, 1);
      assert.equal(parsed.calls[0].name, 'read_file');
      assert.equal(parsed.remainingText, '');
    });

    it('parses fenced JSON fallback responses', () => {
      const input = '```json\n{"name":"list_files","arguments":{"glob":"src/**/*.ts"}}\n```';
      const parsed = parseToolCalls(input);
      assert.equal(parsed.calls.length, 1);
      assert.equal(parsed.calls[0].name, 'list_files');
      assert.equal(parsed.remainingText, '');
    });
  });
});
