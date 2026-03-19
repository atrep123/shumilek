import * as vscode from 'vscode';
import { PIPELINE_STATUS_ICONS } from './statusMessages';
import { resolveToolPermissionScope } from './toolingProtocol';
import {
  handleApplyPatchTool,
  handleBrowserOpenPageTool,
  handleDeleteFileTool,
  handleGetActiveFileTool,
  handleGetDefinitionTool,
  handleGetDiagnosticsTool,
  handlePickSavePathTool,
  handleGetReferencesTool,
  handleGetSymbolsTool,
  handleGetTypeInfoTool,
  handleGetWorkspaceSymbolsTool,
  handleFetchWebpageTool,
  handleListFilesTool,
  handleReadFileTool,
  handleRenameFileTool,
  handleReplaceLinesTool,
  handleRouteFileTool,
  handleRunTerminalCommandTool,
  handleSearchInFilesTool,
  handleWriteFileTool,
  MutationHandlerDeps
} from './toolHandlers';
import { ToolSessionState } from './validationPipeline';
import { ToolCall, ToolResult } from './toolUtils';
import { AutoApprovePolicy, WebviewWrapper } from './types';

/** Context passed to each tool dispatch function. */
export interface ToolDispatchContext {
  name: string;
  args: Record<string, unknown>;
  confirmEdits: boolean;
  autoApprove: AutoApprovePolicy;
  deps: MutationHandlerDeps;
  session: ToolSessionState | undefined;
}

export type ToolDispatchFn = (ctx: ToolDispatchContext) => Promise<ToolResult>;

/**
 * Registry mapping tool names to their dispatch functions.
 * Adding a new tool = adding one entry here.
 */
export const TOOL_REGISTRY: Record<string, ToolDispatchFn> = {
  // --- read-only tools ---
  list_files:            (ctx) => handleListFilesTool(ctx.name, ctx.args, ctx.deps),
  read_file:             (ctx) => handleReadFileTool(ctx.name, ctx.args, ctx.deps),
  get_active_file:       (ctx) => handleGetActiveFileTool(ctx.name, ctx.args, ctx.deps),
  search_in_files:       (ctx) => handleSearchInFilesTool(ctx.name, ctx.args, ctx.deps),
  get_symbols:           (ctx) => handleGetSymbolsTool(ctx.name, ctx.args, ctx.deps),
  get_workspace_symbols: (ctx) => handleGetWorkspaceSymbolsTool(ctx.name, ctx.args, ctx.deps),
  get_definition:        (ctx) => handleGetDefinitionTool(ctx.name, ctx.args, ctx.deps),
  get_references:        (ctx) => handleGetReferencesTool(ctx.name, ctx.args, ctx.deps),
  get_type_info:         (ctx) => handleGetTypeInfoTool(ctx.name, ctx.args, ctx.deps),
  get_diagnostics:       (ctx) => handleGetDiagnosticsTool(ctx.name, ctx.args, ctx.deps),
  route_file:            (ctx) => handleRouteFileTool(ctx.name, ctx.args, ctx.deps),
  pick_save_path:        (ctx) => handlePickSavePathTool(ctx.name, ctx.args, ctx.deps),
  // --- command / browser tools ---
  run_terminal_command:  (ctx) => handleRunTerminalCommandTool(ctx.name, ctx.args, ctx.deps),
  fetch_webpage:         (ctx) => handleFetchWebpageTool(ctx.name, ctx.args, ctx.deps),
  browser_fetch_page:    (ctx) => handleFetchWebpageTool(ctx.name, ctx.args, ctx.deps),
  browser_open_page:     (ctx) => handleBrowserOpenPageTool(ctx.name, ctx.args, ctx.deps),
  // --- mutation tools (pass confirmEdits, autoApprove, session) ---
  apply_patch:           (ctx) => handleApplyPatchTool(ctx.name, ctx.args, ctx.confirmEdits, ctx.autoApprove, ctx.deps, ctx.session),
  replace_lines:         (ctx) => handleReplaceLinesTool(ctx.name, ctx.args, ctx.confirmEdits, ctx.autoApprove, ctx.deps, ctx.session),
  write_file:            (ctx) => handleWriteFileTool(ctx.name, ctx.args, ctx.confirmEdits, ctx.autoApprove, ctx.deps, ctx.session),
  rename_file:           (ctx) => handleRenameFileTool(ctx.name, ctx.args, ctx.confirmEdits, ctx.autoApprove, ctx.deps, ctx.session),
  delete_file:           (ctx) => handleDeleteFileTool(ctx.name, ctx.args, ctx.confirmEdits, ctx.autoApprove, ctx.deps, ctx.session),
};

export interface RunToolCallDeps {
  log?: (message: string) => void;
  postToAllWebviews: (message: unknown) => void;
  getMutationHandlerDeps: () => MutationHandlerDeps;
}

export async function runToolCall(
  panel: WebviewWrapper,
  call: ToolCall,
  confirmEdits: boolean,
  session: ToolSessionState | undefined,
  autoApprovePolicy: AutoApprovePolicy | undefined,
  deps: RunToolCallDeps
): Promise<ToolResult> {
  const name = call.name;
  const args = call.arguments || {};
  const autoApprove = autoApprovePolicy ?? {
    read: true,
    edit: false,
    commands: false,
    browser: false,
    mcp: false
  };

  deps.log?.(`[Tools] ${name}`);
  deps.postToAllWebviews({ type: 'toolEvent', name });
  const permissionScope = resolveToolPermissionScope(name);
  // Edit tools handle their own approval internally (via confirmEdits + autoApprove.edit).
  // Non-edit scopes use their scope-specific autoApprove flag directly,
  // independent of confirmEdits, so that autoApprove.commands / .browser / .mcp
  // cannot be bypassed when confirmEdits is disabled.
  if (permissionScope !== 'edit' && !autoApprove[permissionScope]) {
    const choice = await vscode.window.showInformationMessage(
      `Povolit akci "${name}" (scope: ${permissionScope})?`,
      { modal: true },
      'Povolit',
      'Zamitnout'
    );
    if (choice !== 'Povolit') {
      return { ok: true, tool: name, approved: false, message: `akce zamitnuta (scope: ${permissionScope})` };
    }
  }
  if (panel.visible) {
    panel.webview.postMessage({
      type: 'pipelineStatus',
      icon: PIPELINE_STATUS_ICONS.tools,
      text: `Tool: ${name}`,
      statusType: 'step',
      loading: true
    });
  }

  const dispatch = TOOL_REGISTRY[name];
  if (!dispatch) {
    return { ok: false, tool: name, message: 'neznamy nastroj' };
  }

  const mutationHandlerDeps = deps.getMutationHandlerDeps();
  try {
    return await dispatch({ name, args, confirmEdits, autoApprove, deps: mutationHandlerDeps, session });
  } catch (err) {
    return { ok: false, tool: name, message: `chyba: ${String(err)}` };
  }
}