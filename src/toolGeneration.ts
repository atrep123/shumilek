import * as vscode from 'vscode';
import { executeModelCallWithMessages } from './modelCall';
import { parseToolCalls, ParseToolCallsResult } from './toolingProtocol';
import { runToolCall, RunToolCallDeps } from './toolExecution';
import { clampNumber, ToolRequirements } from './configResolver';
import { ToolCallOptions } from './toolUtils';
import { AutoApprovePolicy, ChatMessage, WebviewWrapper } from './types';
import { ToolSessionState } from './validationPipeline';

interface DiagnosticEntry {
  path: string;
  line: number;
  message: string;
  severity: string;
}

export interface GenerateWithToolsDeps extends RunToolCallDeps {
  executeModelCallWithMessagesFn?: typeof executeModelCallWithMessages;
  parseToolCallsFn?: (text: string) => ParseToolCallsResult;
  runToolCallFn?: typeof runToolCall;
  collectPostWriteDiagnosticsFn?: () => Promise<DiagnosticEntry[]>;
}

async function collectPostWriteDiagnostics(): Promise<DiagnosticEntry[]> {
  await new Promise(resolve => setTimeout(resolve, 800));

  const allDiagnostics = vscode.languages.getDiagnostics();
  const errors: DiagnosticEntry[] = [];
  const folders = vscode.workspace.workspaceFolders;

  for (const [uri, diagnostics] of allDiagnostics) {
    if (folders && !folders.some(folder => uri.fsPath.startsWith(folder.uri.fsPath))) continue;

    const rel = vscode.workspace.asRelativePath(uri, false);
    if (rel.includes('node_modules') || rel.startsWith('.git')) continue;

    for (const diag of diagnostics) {
      if (diag.severity === vscode.DiagnosticSeverity.Error) {
        errors.push({
          path: rel,
          line: diag.range.start.line + 1,
          message: diag.message,
          severity: 'error'
        });
      }
    }

    if (errors.length >= 30) break;
  }

  return errors;
}

export async function generateWithTools(
  panel: WebviewWrapper,
  baseUrl: string,
  model: string,
  systemPrompt: string,
  messages: ChatMessage[],
  timeout: number,
  maxIterations: number,
  confirmEdits: boolean,
  deps: GenerateWithToolsDeps,
  requirements?: ToolRequirements,
  toolOptions?: ToolCallOptions,
  abortSignal?: AbortSignal,
  session?: ToolSessionState,
  autoApprovePolicy?: AutoApprovePolicy
): Promise<string> {
  const maxSelfCorrections = 3;
  const iterations = clampNumber(maxIterations, 6, 1, 10);
  const workingMessages = messages.map(message => ({ ...message }));
  const requireToolCall = requirements?.requireToolCall ?? false;
  const requireMutation = requirements?.requireMutation ?? false;
  const startHadMutations = session?.hadMutations ?? false;
  const executeModelCall = deps.executeModelCallWithMessagesFn || executeModelCallWithMessages;
  const parseToolCallsImpl = deps.parseToolCallsFn || parseToolCalls;
  const runToolCallImpl = deps.runToolCallFn || runToolCall;
  const collectDiagnostics = deps.collectPostWriteDiagnosticsFn || collectPostWriteDiagnostics;
  let sawToolCall = false;
  let localMutation = false;
  let selfCorrectionCount = 0;
  const systemPromptOverride = toolOptions?.systemPromptOverride ?? systemPrompt;
  const fallbackModel = (toolOptions?.fallbackModel || '').trim();
  let currentModel = (toolOptions?.primaryModel || model).trim();
  let switchedToFallback = false;

  if (deps.log) {
    const fallbackLabel = fallbackModel ? `, fallback=${fallbackModel}` : '';
    deps.log(`[Tools] Model selection: primary=${currentModel}${fallbackLabel}`);
  }

  if (requireToolCall || requireMutation) {
    workingMessages.push({
      role: 'system',
      content: [
        'TOOL MODE:',
        'Odpovidej vyhradne tool_call bloky. Zadny text mimo tool_call.',
        requireMutation
          ? 'Musis provest zmenu souboru (write_file/replace_lines).'
          : 'Musis pouzit aspon jeden tool_call.',
        'Priklad:',
        '<tool_call>{"name":"write_file","arguments":{"path":"out/priklad.txt","text":"..."}} </tool_call>'
      ].join('\n')
    });
  }

  for (let index = 0; index < iterations; index++) {
    if (abortSignal?.aborted) {
      const abortErr = new Error('AbortError');
      abortErr.name = 'AbortError';
      throw abortErr;
    }

    let response: string;
    try {
      response = await executeModelCall(
        baseUrl,
        currentModel,
        systemPromptOverride,
        workingMessages,
        timeout,
        abortSignal,
        toolOptions?.forceJson ?? false,
        message => deps.log?.(message)
      );
    } catch (err) {
      if (fallbackModel && !switchedToFallback && currentModel !== fallbackModel) {
        deps.log?.(`[Tools] Tool model failed, switching to fallback: ${fallbackModel}`);
        currentModel = fallbackModel;
        switchedToFallback = true;
        continue;
      }
      throw err;
    }

    const { calls, remainingText, errors } = parseToolCallsImpl(response);
    if (calls.length === 0) {
      if (errors.length > 0) {
        if (requireToolCall) {
          workingMessages.push({
            role: 'system',
            content: [
              'Neplatny format tool callu.',
              'Posli pouze tool_call bloky s validnim JSON.',
              'Neposilej python/bash prikazy ani text mimo tool_call.'
            ].join('\n')
          });
          if (fallbackModel && !switchedToFallback && currentModel !== fallbackModel) {
            deps.log?.(`[Tools] Switching to fallback tool model: ${fallbackModel}`);
            currentModel = fallbackModel;
            switchedToFallback = true;
          }
          continue;
        }
        return `Chyba: neplatny format tool callu (${errors.join('; ')})`;
      }

      if (requireToolCall) {
        if (index >= iterations - 1) {
          return 'Chyba: model nepouzil nastroje. Pouzij tool_call a proved pozadovanou akci.';
        }
        workingMessages.push({
          role: 'system',
          content: [
            'MUSIS pouzit nastroje.',
            'Odpovidej pouze tool_call bloky, bez jineho textu.',
            requireMutation
              ? 'Povinne: write_file/replace_lines (zapis do souboru).'
              : 'Povinne: alespon jeden tool_call.',
            'Kdyz nevis cestu, pouzij pick_save_path a pak write_file.'
          ].join('\n')
        });
        if (fallbackModel && !switchedToFallback && currentModel !== fallbackModel) {
          deps.log?.(`[Tools] Switching to fallback tool model: ${fallbackModel}`);
          currentModel = fallbackModel;
          switchedToFallback = true;
        }
        continue;
      }

      return response.trim() ? response : 'Chyba: prazdna odpoved';
    }

    sawToolCall = true;
    if (remainingText) {
      deps.log?.('[Tools] Ignoring mixed text with tool calls');
      workingMessages.push({
        role: 'system',
        content: 'V odpovedi byly i jine znaky mimo tool_call. Ignoruji je, posilej pouze tool_call bloky.'
      });
    }

    for (const call of calls) {
      const result = await runToolCallImpl(panel, call, confirmEdits, session, autoApprovePolicy, deps);
      if (session) {
        if (!session.toolCallRecords) session.toolCallRecords = [];
        if (session.toolCallRecords.length < 200) {
          const argsSnapshot = call.arguments ? JSON.stringify(call.arguments) : '';
          session.toolCallRecords.push({
            tool: call.name,
            args: argsSnapshot.length > 2000 ? { _truncated: argsSnapshot.slice(0, 2000) } : (call.arguments ?? {}),
            ok: result.ok,
            message: result.message
          });
        }
      }

      if (!result.ok) {
        const message = result.message ?? 'unknown error';
        deps.log?.(`[Tools] ${call.name} failed: ${message}`);
        if (result.data !== undefined) {
          try {
            const serialized = JSON.stringify(result.data);
            if (serialized) {
              deps.log?.(`[Tools] ${call.name} data: ${serialized.slice(0, 1000)}`);
            }
          } catch {
            deps.log?.(`[Tools] ${call.name} data: [unserializable]`);
          }
        }
      }

      workingMessages.push({
        role: 'assistant',
        content: `<tool_call>${JSON.stringify(call)}</tool_call>`
      });
      workingMessages.push({
        role: 'system',
        content: `<tool_result>${JSON.stringify(result)}</tool_result>`
      });

      if (result.ok && ['write_file', 'replace_lines', 'apply_patch', 'rename_file', 'delete_file'].includes(call.name)) {
        localMutation = true;
      }
    }

    if (session?.toolCallRecords && session.toolCallRecords.length > 0) {
      const writes = session.toolCallRecords.filter(record => ['write_file', 'replace_lines', 'apply_patch'].includes(record.tool));
      const failedWrites = writes.filter(record => !record.ok);
      const successfulWrites = writes.filter(record => record.ok);
      deps.log?.(`[ToolTrack] Total calls: ${session.toolCallRecords.length}, writes: ${writes.length}, failed writes: ${failedWrites.length}`);
      if (failedWrites.length > 0) {
        for (const failedWrite of failedWrites) {
          deps.log?.(`[ToolTrack] Failed write: ${failedWrite.tool} -> ${failedWrite.message ?? 'unknown'}`);
        }
      }
      if (writes.length > 0 && successfulWrites.length === 0) {
        deps.log?.('[ToolTrack] WARNING: All write operations failed — possible fabricated edit');
        return 'Chyba: vsechny zapisy selhaly. Soubory nebyly zmeneny.';
      }
    }

    const mutated = Boolean(session?.hadMutations || localMutation);
    if (requireMutation && !mutated) {
      if (index >= iterations - 1) {
        return 'Chyba: nebyla provedena zadna zmena souboru. Pouzij write_file nebo replace_lines.';
      }
      workingMessages.push({
        role: 'system',
        content: 'Musis provest zmenu souboru (write_file/replace_lines). Pouhe cteni nebo listovani nestaci.'
      });
    } else if (mutated) {
      if (selfCorrectionCount < maxSelfCorrections && index < iterations - 1) {
        const diagErrors = await collectDiagnostics();
        if (diagErrors.length > 0) {
          selfCorrectionCount++;
          deps.log?.(`[SelfCorrect] Attempt ${selfCorrectionCount}/${maxSelfCorrections}: ${diagErrors.length} error(s) detected`);
          if (panel.visible) {
            panel.webview.postMessage({
              type: 'pipelineStatus',
              icon: '🔧',
              text: `Auto-oprava ${selfCorrectionCount}/${maxSelfCorrections}: ${diagErrors.length} chyb...`,
              statusType: 'step',
              loading: true
            });
          }
          workingMessages.push({
            role: 'system',
            content: [
              'SELF-CORRECTION: The code you just wrote has errors. Fix them NOW using write_file or replace_lines.',
              'ERRORS:',
              ...diagErrors.slice(0, 15).map(diag => `- ${diag.path}:${diag.line}: ${diag.message}`),
              diagErrors.length > 15 ? `... and ${diagErrors.length - 15} more errors` : '',
              '',
              'Fix ALL errors. Do not explain, just use tool_call to fix the code.'
            ].filter(Boolean).join('\n')
          });
          continue;
        }
      }

      const writePath = session?.lastWritePath;
      const correctionNote = selfCorrectionCount > 0
        ? ` (auto-corrected ${selfCorrectionCount}x)`
        : '';

      return writePath
        ? `Hotovo: zmena souboru provedena (${writePath}).${correctionNote}`
        : `Hotovo: zmena souboru provedena.${correctionNote}`;
    } else if (requireToolCall && sawToolCall) {
      return 'Hotovo: nastroje byly pouzity.';
    }
  }

  if (requireToolCall && !sawToolCall) {
    return 'Chyba: model nepouzil nastroje. Pouzij tool_call a proved pozadovanou akci.';
  }
  if (requireMutation && !(session?.hadMutations || localMutation) && !startHadMutations) {
    return 'Chyba: nebyla provedena zadna zmena souboru. Pouzij write_file nebo replace_lines.';
  }

  return 'Chyba: prekrocen limit tool iteraci';
}