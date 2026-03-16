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
  if (confirmEdits && permissionScope !== 'edit' && !autoApprove[permissionScope]) {
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

  const mutationHandlerDeps = deps.getMutationHandlerDeps();

  try {
    switch (name) {
      case 'list_files': return handleListFilesTool(name, args, mutationHandlerDeps);
      case 'read_file': return handleReadFileTool(name, args, mutationHandlerDeps);
      case 'get_active_file': return handleGetActiveFileTool(name, args, mutationHandlerDeps);
      case 'search_in_files': return handleSearchInFilesTool(name, args, mutationHandlerDeps);
      case 'apply_patch': return handleApplyPatchTool(name, args, confirmEdits, autoApprove, mutationHandlerDeps, session);
      case 'get_symbols': return handleGetSymbolsTool(name, args, mutationHandlerDeps);
      case 'get_workspace_symbols': return handleGetWorkspaceSymbolsTool(name, args, mutationHandlerDeps);
      case 'get_definition': return handleGetDefinitionTool(name, args, mutationHandlerDeps);
      case 'get_references': return handleGetReferencesTool(name, args, mutationHandlerDeps);
      case 'get_type_info': return handleGetTypeInfoTool(name, args, mutationHandlerDeps);
      case 'get_diagnostics': return handleGetDiagnosticsTool(name, args, mutationHandlerDeps);
      case 'route_file': return handleRouteFileTool(name, args, mutationHandlerDeps);
      case 'pick_save_path': return handlePickSavePathTool(name, args, mutationHandlerDeps);
      case 'replace_lines': return handleReplaceLinesTool(name, args, confirmEdits, autoApprove, mutationHandlerDeps, session);
      case 'write_file': return handleWriteFileTool(name, args, confirmEdits, autoApprove, mutationHandlerDeps, session);
      case 'rename_file': return handleRenameFileTool(name, args, confirmEdits, autoApprove, mutationHandlerDeps, session);
      case 'delete_file': return handleDeleteFileTool(name, args, confirmEdits, autoApprove, mutationHandlerDeps, session);
      case 'run_terminal_command': return handleRunTerminalCommandTool(name, args, confirmEdits, autoApprove, mutationHandlerDeps);
      case 'fetch_webpage': return handleFetchWebpageTool(name, args, mutationHandlerDeps);
      case 'browser_fetch_page': return handleFetchWebpageTool(name, args, mutationHandlerDeps);
      case 'browser_open_page': return handleBrowserOpenPageTool(name, args, mutationHandlerDeps);
      default:
        return { ok: false, tool: name, message: 'neznamy nastroj' };
    }
  } catch (err) {
    return { ok: false, tool: name, message: `chyba: ${String(err)}` };
  }
}