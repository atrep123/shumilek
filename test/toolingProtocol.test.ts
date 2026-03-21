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

    it('classifies run_terminal_command as commands scope', () => {
      assert.equal(resolveToolPermissionScope('run_terminal_command'), 'commands');
    });

    it('classifies browser and mcp prefixes into dedicated scopes', () => {
      assert.equal(resolveToolPermissionScope('browser_open_page'), 'browser');
      assert.equal(resolveToolPermissionScope('mcp_git_status'), 'mcp');
    });

    it('normalizes tool names before scope resolution', () => {
      assert.equal(resolveToolPermissionScope('  WRITE_FILE  '), 'edit');
      assert.equal(resolveToolPermissionScope('\nRead_File\t'), 'read');
      assert.equal(resolveToolPermissionScope('  RUN_TERMINAL_COMMAND  '), 'commands');
    });

    it('keeps run_terminal_command variants out of edit scope', () => {
      const commandLikeTools = [
        'run_terminal_command',
        'run_terminal_command_v2',
        'run_terminal_command_with_timeout'
      ];
      for (const tool of commandLikeTools) {
        assert.equal(resolveToolPermissionScope(tool), 'commands');
      }
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

    it('parses array JSON fallback responses', () => {
      const input = '[{"name":"read_file","arguments":{"path":"README.md"}},{"name":"list_files","arguments":{}}]';
      const parsed = parseToolCalls(input);
      assert.equal(parsed.calls.length, 2);
      assert.equal(parsed.calls[0].name, 'read_file');
      assert.equal(parsed.calls[1].name, 'list_files');
      assert.equal(parsed.remainingText, '');
    });

    it('ignores non-json code fences in fallback mode', () => {
      const input = '```ts\nconst x = 1;\n```';
      const parsed = parseToolCalls(input);
      assert.equal(parsed.calls.length, 0);
      assert.equal(parsed.remainingText, input);
      assert.deepEqual(parsed.errors, []);
    });

    it('reports invalid json in fallback mode', () => {
      const input = '```json\n{"name":"read_file",}\n```';
      const parsed = parseToolCalls(input);
      assert.equal(parsed.calls.length, 0);
      assert.ok(parsed.errors.length > 0);
      assert.match(parsed.errors[0], /Invalid JSON/i);
    });

    it('skips fallback items missing required name', () => {
      const input = '[{"arguments":{"path":"README.md"}},{"name":"read_file","arguments":{}}]';
      const parsed = parseToolCalls(input);
      assert.equal(parsed.calls.length, 1);
      assert.equal(parsed.calls[0].name, 'read_file');
    });

    it('rejects array arguments (typeof array === object)', () => {
      const input = '<tool_call>{"name":"test_tool","arguments":["a","b"]}</tool_call>';
      const parsed = parseToolCalls(input);
      assert.equal(parsed.calls.length, 1);
      assert.equal(parsed.calls[0].name, 'test_tool');
      assert.equal(parsed.calls[0].arguments, undefined);
    });

    it('does not treat arbitrary JSON with name field as tool call in fallback mode', () => {
      const input = '{"name": "my-project", "version": "1.0.0"}';
      const parsed = parseToolCalls(input);
      assert.equal(parsed.calls.length, 0);
      assert.equal(parsed.remainingText, input);
    });

    it('does not discard text when JSON lacks arguments in fallback mode', () => {
      const input = 'Here is the package.json:\n```json\n{"name": "my-app", "version": "2.0"}\n```\nDone.';
      const parsed = parseToolCalls(input);
      assert.equal(parsed.calls.length, 0);
      assert.equal(parsed.remainingText, input);
    });

    it('caps errors array at 100 to prevent unbounded growth', () => {
      // Generate 150 invalid tool_call blocks
      const blocks = Array.from({ length: 150 }, () => '<tool_call>{invalid json!}</tool_call>').join('\n');
      const parsed = parseToolCalls(blocks);
      assert.equal(parsed.calls.length, 0);
      assert.ok(parsed.errors.length <= 100, `Expected <= 100 errors, got ${parsed.errors.length}`);
    });

    it('rejects empty or oversized tool names', () => {
      const emptyName = '<tool_call>{"name":"","arguments":{"a":1}}</tool_call>';
      const longName = `<tool_call>{"name":"${'x'.repeat(250)}","arguments":{"a":1}}</tool_call>`;
      const emptyResult = parseToolCalls(emptyName);
      assert.equal(emptyResult.calls.length, 0);
      assert.ok(emptyResult.errors.some(e => e.includes('Invalid tool name')));

      const longResult = parseToolCalls(longName);
      assert.equal(longResult.calls.length, 0);
      assert.ok(longResult.errors.some(e => e.includes('Invalid tool name')));
    });

    it('trims whitespace from tool names', () => {
      const input = '<tool_call>{"name":"  read_file  ","arguments":{"path":"a.ts"}}</tool_call>';
      const parsed = parseToolCalls(input);
      assert.equal(parsed.calls.length, 1);
      assert.equal(parsed.calls[0].name, 'read_file');
    });

    it('caps fallback candidates to prevent CPU exhaustion', () => {
      // Generate 100 fenced JSON blocks (more than 50 cap)
      const blocks = Array.from({ length: 100 }, (_, i) =>
        '```json\n{"name":"tool_' + i + '","arguments":{"i":' + i + '}}\n```'
      ).join('\n');
      const parsed = parseToolCalls(blocks);
      // Should have at most 50 candidates processed
      assert.ok(parsed.calls.length <= 50, `Expected <= 50 calls, got ${parsed.calls.length}`);
    });

    it('caps tagged tool_call blocks at 50', () => {
      const blocks = Array.from({ length: 80 }, (_, i) =>
        '<tool_call>{"name":"t_' + i + '","arguments":{"x":' + i + '}}</tool_call>'
      ).join('\n');
      const parsed = parseToolCalls(blocks);
      assert.equal(parsed.calls.length, 50);
      assert.equal(parsed.calls[49].name, 't_49');
    });
  });
});
