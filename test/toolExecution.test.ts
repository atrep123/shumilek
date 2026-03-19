// Module._load patching — mock-require's getCallerFile() is broken on Node 24.
// We set up mocks once at load time and mutate handler stubs per test.
const Module = require('module');
const { strict: assert } = require('assert');
const { vscodeMock } = require('./helpers/vscodeMockShared');

// Shared mutable mock object — toolExecution holds a reference to this and
// accesses handlers via property lookup, so per-test mutations are visible.
const handlersMock: Record<string, any> = {};

function resetHandlers() {
  const defaults: Record<string, any> = {
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
  };
  for (const key of Object.keys(handlersMock)) delete handlersMock[key];
  Object.assign(handlersMock, defaults);
}
resetHandlers();

// Patch Module._load BEFORE any src/ module is required
const originalLoad = Module._load;
Module._load = function (request: string, parent: any, ...rest: any[]) {
  if (request === 'vscode') return vscodeMock;
  if (request === './toolHandlers' || request.endsWith('/toolHandlers')) return handlersMock;
  return originalLoad.call(this, request, parent, ...rest);
};

// Now load toolExecution — it will get our mocks via the Module._load hook
const { runToolCall, TOOL_REGISTRY } = require('../src/toolExecution');

function createPanel(messages: any[]) {
  return {
    visible: true,
    webview: {
      postMessage: async (message: any) => {
        messages.push(message);
        return true;
      }
    }
  };
}

function createDeps(overrides?: Record<string, any>) {
  return {
    log: () => undefined,
    postToAllWebviews: () => undefined,
    getMutationHandlerDeps: () => ({}),
    ...overrides
  };
}

describe('toolExecution', () => {
  afterEach(() => {
    vscodeMock.window.showInformationMessage = async () => 'Vytvorit';
    resetHandlers();
  });

  it('asks for permission on non-edit scopes and returns denied result when rejected', async () => {
    const prompts: string[] = [];
    vscodeMock.window.showInformationMessage = async (message: string) => {
      prompts.push(message);
      return 'Zamitnout';
    };

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
    const panelMessages: any[] = [];
    const broadcastMessages: any[] = [];
    const logs: string[] = [];
    const calls: any[] = [];
    handlersMock.handleWriteFileTool = async (name: string, args: any, confirmEdits: boolean, autoApprove: any, deps: any, session: any) => {
      calls.push({ name, args, confirmEdits, autoApprove, deps, session });
      return { ok: true, tool: name, message: 'written' };
    };
    const session = { hadMutations: false };

    const result = await runToolCall(
      createPanel(panelMessages),
      { name: 'write_file', arguments: { path: 'src/a.ts', text: 'x' } },
      true,
      session,
      undefined,
      createDeps({
        log: (message: string) => logs.push(message),
        postToAllWebviews: (message: any) => broadcastMessages.push(message)
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
    const calls: any[] = [];
    handlersMock.handleFetchWebpageTool = async (name: string, args: any, deps: any) => {
      calls.push({ name, args, deps });
      return { ok: true, tool: name, message: 'fetched' };
    };

    const result = await runToolCall(
      createPanel([]),
      { name: 'browser_fetch_page', arguments: { href: 'https://example.test' } },
      false,
      undefined,
      { read: true, edit: false, commands: false, browser: true, mcp: false },
      createDeps()
    );

    assert.equal(result.message, 'fetched');
    assert.equal(calls.length, 1);
    assert.equal(calls[0].name, 'browser_fetch_page');
    assert.deepEqual(calls[0].args, { href: 'https://example.test' });
  });

  it('returns unknown-tool and thrown-handler errors as tool results', async () => {
    // Unknown tools resolve to 'commands' scope — auto-approve to reach dispatch
    const unknown = await runToolCall(
      createPanel([]),
      { name: 'does_not_exist', arguments: {} },
      false,
      undefined,
      { read: true, edit: true, commands: true, browser: true, mcp: true },
      createDeps()
    );

    assert.equal(unknown.ok, false);
    assert.equal(unknown.message, 'neznamy nastroj');

    handlersMock.handleReadFileTool = async () => {
      throw new Error('boom');
    };
    const thrown = await runToolCall(
      createPanel([]),
      { name: 'read_file', arguments: { path: 'src/a.ts' } },
      false,
      undefined,
      { read: true, edit: false, commands: false, browser: false, mcp: false },
      createDeps()
    );

    assert.equal(thrown.ok, false);
    assert.match(thrown.message, /chyba: Error: boom/);
  });

  // --- Command approval scope tests ---

  it('blocks run_terminal_command when confirmEdits=false and autoApprove.commands=false', async () => {
    const prompts: string[] = [];
    vscodeMock.window.showInformationMessage = async (message: string) => {
      prompts.push(message);
      return 'Zamitnout';
    };

    const result = await runToolCall(
      createPanel([]),
      { name: 'run_terminal_command', arguments: { command: 'echo hi' } },
      false,   // confirmEdits OFF
      undefined,
      { read: true, edit: false, commands: false, browser: false, mcp: false },
      createDeps()
    );

    // Outer gate must fire even though confirmEdits is false
    assert.equal(result.approved, false);
    assert.equal(prompts.length, 1);
    assert.match(prompts[0], /scope: commands/);
  });

  it('auto-approves run_terminal_command when autoApprove.commands=true', async () => {
    const handlerCalls: any[] = [];
    handlersMock.handleRunTerminalCommandTool = async (name: string, args: any, deps: any) => {
      handlerCalls.push({ name, args });
      return { ok: true, tool: name, message: 'ok' };
    };

    const result = await runToolCall(
      createPanel([]),
      { name: 'run_terminal_command', arguments: { command: 'echo hi' } },
      true,    // confirmEdits ON
      undefined,
      { read: true, edit: false, commands: true, browser: false, mcp: false },
      createDeps()
    );

    // No dialog shown, handler called directly
    assert.equal(result.ok, true);
    assert.equal(handlerCalls.length, 1);
  });

  it('shows exactly one dialog for run_terminal_command when confirmEdits=true and autoApprove.commands=false', async () => {
    const prompts: string[] = [];
    vscodeMock.window.showInformationMessage = async (message: string) => {
      prompts.push(message);
      return 'Povolit';
    };
    const handlerCalls: any[] = [];
    handlersMock.handleRunTerminalCommandTool = async (name: string, args: any, deps: any) => {
      handlerCalls.push({ name, args });
      return { ok: true, tool: name, message: 'ok' };
    };

    const result = await runToolCall(
      createPanel([]),
      { name: 'run_terminal_command', arguments: { command: 'echo hi' } },
      true,    // confirmEdits ON
      undefined,
      { read: true, edit: false, commands: false, browser: false, mcp: false },
      createDeps()
    );

    // Exactly one approval dialog, then handler proceeds
    assert.equal(prompts.length, 1);
    assert.equal(handlerCalls.length, 1);
    assert.equal(result.ok, true);
  });

  it('edit tools still respect confirmEdits flag independently of command approval', async () => {
    const handlerCalls: any[] = [];
    handlersMock.handleWriteFileTool = async (name: string, args: any, confirmEdits: boolean, autoApprove: any, deps: any, session: any) => {
      handlerCalls.push({ name, confirmEdits, autoApprove });
      return { ok: true, tool: name, message: 'written' };
    };

    // Edit tool with confirmEdits=false should bypass outer gate (scope=edit)
    // and pass confirmEdits through to handler
    const result = await runToolCall(
      createPanel([]),
      { name: 'write_file', arguments: { path: 'a.ts', text: 'x' } },
      false,   // confirmEdits OFF
      undefined,
      { read: true, edit: false, commands: false, browser: false, mcp: false },
      createDeps()
    );

    assert.equal(result.ok, true);
    assert.equal(handlerCalls.length, 1);
    assert.equal(handlerCalls[0].confirmEdits, false);
    assert.equal(handlerCalls[0].autoApprove.edit, false);
  });

  // --- TOOL_REGISTRY tests ---

  it('TOOL_REGISTRY contains all expected tool names', () => {
    const expected = [
      'list_files', 'read_file', 'get_active_file', 'search_in_files',
      'get_symbols', 'get_workspace_symbols', 'get_definition', 'get_references',
      'get_type_info', 'get_diagnostics', 'route_file', 'pick_save_path',
      'run_terminal_command', 'fetch_webpage', 'browser_fetch_page', 'browser_open_page',
      'apply_patch', 'replace_lines', 'write_file', 'rename_file', 'delete_file'
    ];
    for (const name of expected) {
      assert.equal(typeof TOOL_REGISTRY[name], 'function', `missing registry entry for ${name}`);
    }
    // No unexpected entries
    assert.deepEqual(Object.keys(TOOL_REGISTRY).sort(), expected.sort());
  });

  it('TOOL_REGISTRY dispatches via lookup instead of switch', async () => {
    // Verify that runToolCall uses TOOL_REGISTRY by confirming a custom entry works
    const calls: any[] = [];
    handlersMock.handleListFilesTool = async (name: string, args: any) => {
      calls.push({ name, args });
      return { ok: true, tool: name, message: 'listed' };
    };

    const result = await runToolCall(
      createPanel([]),
      { name: 'list_files', arguments: { dir: '.' } },
      false,
      undefined,
      { read: true, edit: false, commands: false, browser: false, mcp: false },
      createDeps()
    );

    assert.equal(result.message, 'listed');
    assert.equal(calls.length, 1);
    assert.deepEqual(calls[0].args, { dir: '.' });
  });

  it('mutation tools receive confirmEdits and session via registry dispatch', async () => {
    const calls: any[] = [];
    handlersMock.handleReplaceLinesTool = async (name: string, args: any, confirmEdits: boolean, autoApprove: any, deps: any, session: any) => {
      calls.push({ name, confirmEdits, session });
      return { ok: true, tool: name, message: 'replaced' };
    };
    const session = { hadMutations: true, mutationTools: ['write_file'] };

    const result = await runToolCall(
      createPanel([]),
      { name: 'replace_lines', arguments: { path: 'a.ts', lines: '1-2', text: 'x' } },
      true,
      session,
      { read: true, edit: true, commands: false, browser: false, mcp: false },
      createDeps()
    );

    assert.equal(result.message, 'replaced');
    assert.equal(calls[0].confirmEdits, true);
    assert.equal(calls[0].session, session);
  });
});
