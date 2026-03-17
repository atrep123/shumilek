const mock = require('mock-require');
const { strict: assert } = require('assert');

const { vscodeMock } = require('./helpers/vscodeMockShared');

function createPanel(messages) {
  return {
    visible: true,
    webview: {
      postMessage: async message => {
        messages.push(message);
        return true;
      }
    }
  };
}

function createDeps(overrides) {
  return {
    log: () => undefined,
    postToAllWebviews: () => undefined,
    getMutationHandlerDeps: () => ({}),
    ...overrides
  };
}

function loadToolExecution(overrides) {
  mock.stopAll();
  mock('vscode', vscodeMock);
  mock('../src/toolHandlers', {
    handleApplyPatchTool: async () => ({ ok: true, tool: 'apply_patch', message: 'ok' }),
    handleBrowserOpenPageTool: async () => ({ ok: true, tool: 'browser_open_page', message: 'ok' }),
    handleDeleteFileTool: async () => ({ ok: true, tool: 'delete_file', message: 'ok' }),
    handleGetActiveFileTool: async () => ({ ok: true, tool: 'get_active_file', message: 'ok' }),
    handleGetDefinitionTool: async () => ({ ok: true, tool: 'get_definition', message: 'ok' }),
    handleGetDiagnosticsTool: async () => ({ ok: true, tool: 'get_diagnostics', message: 'ok' }),
    handlePickSavePathTool: async () => ({ ok: true, tool: 'pick_save_path', message: 'ok' }),
    handleGetReferencesTool: async () => ({ ok: true, tool: 'get_references', message: 'ok' }),
    handleGetSymbolsTool: async () => ({ ok: true, tool: 'get_symbols', message: 'ok' }),
    handleGetTypeInfoTool: async () => ({ ok: true, tool: 'get_type_info', message: 'ok' }),
    handleGetWorkspaceSymbolsTool: async () => ({ ok: true, tool: 'get_workspace_symbols', message: 'ok' }),
    handleFetchWebpageTool: async () => ({ ok: true, tool: 'fetch_webpage', message: 'ok' }),
    handleListFilesTool: async () => ({ ok: true, tool: 'list_files', message: 'ok' }),
    handleReadFileTool: async () => ({ ok: true, tool: 'read_file', message: 'ok' }),
    handleRenameFileTool: async () => ({ ok: true, tool: 'rename_file', message: 'ok' }),
    handleReplaceLinesTool: async () => ({ ok: true, tool: 'replace_lines', message: 'ok' }),
    handleRouteFileTool: async () => ({ ok: true, tool: 'route_file', message: 'ok' }),
    handleRunTerminalCommandTool: async () => ({ ok: true, tool: 'run_terminal_command', message: 'ok' }),
    handleSearchInFilesTool: async () => ({ ok: true, tool: 'search_in_files', message: 'ok' }),
    handleWriteFileTool: async () => ({ ok: true, tool: 'write_file', message: 'ok' }),
    ...overrides
  });
  return mock.reRequire('../src/toolExecution');
}

describe('toolExecution', () => {
  afterEach(() => {
    vscodeMock.window.showInformationMessage = async () => 'Vytvorit';
    mock.stopAll();
  });

  it('asks for permission on non-edit scopes and returns denied result when rejected', async () => {
    const prompts = [];
    vscodeMock.window.showInformationMessage = async message => {
      prompts.push(message);
      return 'Zamitnout';
    };
    const { runToolCall } = loadToolExecution();

    const result = await runToolCall(
      createPanel([]),
      { name: 'run_terminal_command', arguments: { command: 'dir' } },
      true,
      undefined,
      undefined,
      createDeps()
    );

    assert.equal(result.ok, true);
    assert.equal(result.approved, false);
    assert.match(result.message, /akce zamitnuta/);
    assert.equal(prompts.length, 1);
    assert.match(prompts[0], /scope: commands/);
  });

  it('dispatches to the correct handler and posts tool status messages', async () => {
    const panelMessages = [];
    const broadcastMessages = [];
    const logs = [];
    const calls = [];
    const { runToolCall } = loadToolExecution({
      handleWriteFileTool: async (name, args, confirmEdits, autoApprove, deps, session) => {
        calls.push({ name, args, confirmEdits, autoApprove, deps, session });
        return { ok: true, tool: name, message: 'written' };
      }
    });
    const session = { hadMutations: false };

    const result = await runToolCall(
      createPanel(panelMessages),
      { name: 'write_file', arguments: { path: 'src/a.ts', text: 'x' } },
      true,
      session,
      undefined,
      createDeps({
        log: message => logs.push(message),
        postToAllWebviews: message => broadcastMessages.push(message)
      })
    );

    assert.equal(result.message, 'written');
    assert.equal(calls.length, 1);
    assert.equal(calls[0].name, 'write_file');
    assert.deepEqual(calls[0].args, { path: 'src/a.ts', text: 'x' });
    assert.equal(calls[0].confirmEdits, true);
    assert.equal(calls[0].session, session);
    assert.equal(calls[0].autoApprove.edit, false);
    assert.ok(logs.some(message => message.includes('[Tools] write_file')));
    assert.deepEqual(broadcastMessages, [{ type: 'toolEvent', name: 'write_file' }]);
    assert.ok(panelMessages.some(message => message.type === 'pipelineStatus' && message.text === 'Tool: write_file'));
  });

  it('routes browser_fetch_page through the fetch webpage handler', async () => {
    const calls = [];
    const { runToolCall } = loadToolExecution({
      handleFetchWebpageTool: async (name, args, deps) => {
        calls.push({ name, args, deps });
        return { ok: true, tool: name, message: 'fetched' };
      }
    });

    const result = await runToolCall(
      createPanel([]),
      { name: 'browser_fetch_page', arguments: { href: 'https://example.test' } },
      false,
      undefined,
      undefined,
      createDeps()
    );

    assert.equal(result.message, 'fetched');
    assert.equal(calls.length, 1);
    assert.equal(calls[0].name, 'browser_fetch_page');
    assert.deepEqual(calls[0].args, { href: 'https://example.test' });
  });

  it('returns unknown-tool and thrown-handler errors as tool results', async () => {
    const unknownLoad = loadToolExecution();
    const unknown = await unknownLoad.runToolCall(
      createPanel([]),
      { name: 'does_not_exist', arguments: {} },
      false,
      undefined,
      undefined,
      createDeps()
    );

    assert.equal(unknown.ok, false);
    assert.equal(unknown.message, 'neznamy nastroj');

    const thrownLoad = loadToolExecution({
      handleReadFileTool: async () => {
        throw new Error('boom');
      }
    });
    const thrown = await thrownLoad.runToolCall(
      createPanel([]),
      { name: 'read_file', arguments: { path: 'src/a.ts' } },
      false,
      undefined,
      undefined,
      createDeps()
    );

    assert.equal(thrown.ok, false);
    assert.match(thrown.message, /chyba: Error: boom/);
  });
});