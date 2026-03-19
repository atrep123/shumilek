/**
 * Validation pipeline — orchestrates post-edit verification, hallucination detection,
 * guardian analysis, response history, svedomi validation, external validators,
 * summarizer, and structured output assembly.
 *
 * Extracted from extension.ts for testability and separation of concerns.
 * All module-level dependencies are injected via the `deps` parameter.
 */
import type {
  ChatMessage,
  GuardianResult,
  HallucinationResult,
  MiniModelResult,
  QualityCheckResult,
  ValidationPolicy,
  AutoApprovePolicy
} from './types';
import { PIPELINE_STATUS_ICONS, PIPELINE_STATUS_TEXT } from './statusMessages';

// ── Interfaces moved from extension.ts ─────────────────────────

export interface ToolCallRecord {
  tool: string;
  args: Record<string, unknown>;
  ok: boolean;
  message?: string;
}

export interface ToolSessionState {
  hadMutations: boolean;
  mutationTools: string[];
  lastWritePath?: string;
  lastWriteAction?: 'created' | 'updated';
  toolCallRecords?: ToolCallRecord[];
}

export interface VerificationCommandResult {
  command: string;
  ok: boolean;
  exitCode: number | null;
  stdout: string;
  stderr: string;
}

export interface VerificationSummary {
  ok: boolean;
  ran: VerificationCommandResult[];
  failed: VerificationCommandResult[];
}

export interface ValidationPipelineConfig {
  trimmedPrompt: string;
  chatMessages: ChatMessage[];
  stepMode: boolean;
  panel: any; // WebviewWrapper — kept as `any` to avoid vscode dependency
  // Self-correction
  toolCallsEnabled: boolean;
  baseUrl: string;
  writerModel: string;
  toolPromptForMain: string;
  toolPrimaryModel: string;
  toolsFallbackModel: string;
  toolsConfirmEdits: boolean;
  stepTimeout: number;
  autoApprovePolicy: AutoApprovePolicy;
  abortSignal?: AbortSignal;
  // Validators
  guardianEnabled: boolean;
  miniModelEnabled: boolean;
  validationPolicy: ValidationPolicy;
  validatorLogsEnabled: boolean;
  summarizerEnabled: boolean;
  summarizerModel: string;
  timeout: number;
  // External validators
  rewardEnabled: boolean;
  rewardEndpoint: string;
  rewardThreshold: number;
  hhemEnabled: boolean;
  hhemEndpoint: string;
  hhemThreshold: number;
  ragasEnabled: boolean;
  ragasEndpoint: string;
  ragasThreshold: number;
}

export interface ValidationPipelineResult {
  fullResponse: string;
  postEditVerification: VerificationSummary | null;
  hallucinationResult: HallucinationResult;
  guardianResult: GuardianResult;
  miniResult: MiniModelResult | null;
  qualityChecks: QualityCheckResult[];
  external: {
    rewardResult: QualityCheckResult;
    hhemResult: QualityCheckResult;
    ragasResult: QualityCheckResult;
    results: QualityCheckResult[];
  };
  summary: string | null;
  structuredOutput: string;
}

// ── Dependency injection interface ─────────────────────────────

export interface ValidationPipelineDeps {
  postToAllWebviews: (msg: any) => void;
  log: (msg: string) => void;
  guardianStats: { hallucinationsDetected: number };
  hallucinationDetector: {
    analyze(response: string, prompt: string, messages: ChatMessage[]): HallucinationResult;
    getSummary(result: HallucinationResult): string;
  };
  guardian: {
    analyze(response: string, prompt: string): GuardianResult;
  };
  responseHistoryManager: {
    checkSimilarity(response: string, prompt: string): { isSimilar: boolean; similarity: number };
  };
  svedomi: {
    validate(prompt: string, response: string, cb: (status: string) => void): Promise<MiniModelResult>;
  };
  generateWithTools: (
    panel: any, baseUrl: string, model: string, systemPrompt: string,
    messages: ChatMessage[], timeout: number, maxIterations: number,
    confirmEdits: boolean, requirements: { requireToolCall: boolean; requireMutation: boolean },
    options: { systemPromptOverride: string; primaryModel: string; fallbackModel: string },
    abortSignal: AbortSignal | undefined, session: ToolSessionState, autoApprovePolicy: AutoApprovePolicy
  ) => Promise<string>;
  runPostEditVerification: (timeoutMs: number) => Promise<VerificationSummary>;
  runExternalValidators: (
    panel: any, prompt: string, response: string,
    config: {
      rewardEnabled: boolean; rewardEndpoint: string; rewardThreshold: number;
      hhemEnabled: boolean; hhemEndpoint: string; hhemThreshold: number;
      ragasEnabled: boolean; ragasEndpoint: string; ragasThreshold: number;
      timeoutMs: number;
    },
    logsEnabled: boolean
  ) => Promise<{
    rewardResult: QualityCheckResult;
    hhemResult: QualityCheckResult;
    ragasResult: QualityCheckResult;
    results: QualityCheckResult[];
  }>;
  summarizeResponse: (
    baseUrl: string, model: string, prompt: string, response: string, timeout: number
  ) => Promise<string | null>;
  buildStructuredOutput: (
    response: string, summary: string | null, checks: QualityCheckResult[], includeChecks: boolean
  ) => string;
  getMiniUnavailableMessage: (policy: ValidationPolicy, withVerb: boolean) => string;
  isMiniAccepted: (result: MiniModelResult, policy: ValidationPolicy) => boolean;
}

// ── Main pipeline function ─────────────────────────────────────

export async function runValidationPipeline(
  fullResponse: string,
  toolSession: ToolSessionState,
  cfg: ValidationPipelineConfig,
  deps: ValidationPipelineDeps
): Promise<ValidationPipelineResult | null> {

  // === POST-EDIT VERIFICATION ===
  let postEditVerification: VerificationSummary | null = null;
  if (fullResponse && toolSession.hadMutations) {
    deps.postToAllWebviews({ type: 'pipelineStatus', icon: '✅', text: 'Overuji lint/test/build po editaci...', statusType: 'validation', loading: true });
    postEditVerification = await deps.runPostEditVerification(cfg.stepTimeout);
    if (postEditVerification.ran.length > 0) {
      for (const cmd of postEditVerification.ran) {
        deps.log(`[Verify] ${cmd.command} => ${cmd.ok ? 'OK' : `FAIL(${cmd.exitCode})`}`);
      }
    }
    if (!postEditVerification.ok) {
      const firstFail = postEditVerification.failed[0];
      const detail = firstFail ? `${firstFail.command} failed` : 'verification failed';

      const errorOutput = firstFail
        ? (firstFail.stderr || firstFail.stdout || '').slice(0, 3000)
        : '';
      if (errorOutput && cfg.toolCallsEnabled) {
        deps.log(`[SelfCorrect] Post-edit verification failed, attempting auto-fix for: ${detail}`);
        deps.postToAllWebviews({ type: 'pipelineStatus', icon: '🔧', text: `Auto-oprava: ${detail}`, statusType: 'step', loading: true });
        try {
          const fixPrompt = [
            'SELF-CORRECTION: The code changes you made caused build/test/lint errors.',
            `FAILED COMMAND: ${firstFail?.command ?? 'unknown'}`,
            'ERROR OUTPUT:',
            errorOutput,
            '',
            'Fix ALL errors using write_file or replace_lines. Do not explain, just fix.'
          ].join('\n');
          const fixMessages: ChatMessage[] = [
            ...cfg.chatMessages.slice(-3),
            { role: 'system', content: fixPrompt }
          ];
          const fixResult = await deps.generateWithTools(
            cfg.panel, cfg.baseUrl, cfg.writerModel, cfg.toolPromptForMain, fixMessages, cfg.stepTimeout,
            3, cfg.toolsConfirmEdits, { requireToolCall: true, requireMutation: true },
            { systemPromptOverride: cfg.toolPromptForMain, primaryModel: cfg.toolPrimaryModel, fallbackModel: cfg.toolsFallbackModel },
            cfg.abortSignal, toolSession, cfg.autoApprovePolicy
          );
          deps.log(`[SelfCorrect] Fix result: ${fixResult.slice(0, 200)}`);

          const reVerify = await deps.runPostEditVerification(cfg.stepTimeout);
          if (reVerify.ok) {
            deps.log('[SelfCorrect] Post-edit re-verification PASSED');
            deps.postToAllWebviews({ type: 'pipelineStatus', icon: '✅', text: 'Auto-oprava uspesna!', statusType: 'step', loading: false });
            fullResponse += `\n\n[Auto-corrected: ${detail}]`;
            postEditVerification = reVerify;
          } else {
            deps.log('[SelfCorrect] Post-edit re-verification still FAILED');
            if (cfg.validationPolicy === 'fail-closed') {
              deps.postToAllWebviews({ type: 'responseError', text: `Publish blocked by verification: ${detail}` });
              return null;
            }
            deps.postToAllWebviews({ type: 'guardianAlert', message: `Verify warning (auto-fix failed): ${detail}` });
            fullResponse += `\n\n[Verify warning] ${detail} (auto-fix attempted but failed)`;
          }
        } catch (autoFixErr: unknown) {
          deps.log(`[SelfCorrect] Auto-fix crashed: ${(autoFixErr as Error).message || String(autoFixErr)}`);
          deps.postToAllWebviews({ type: 'guardianAlert', message: `Auto-fix error: ${(autoFixErr as Error).message || String(autoFixErr)}` });
          fullResponse += `\n\n[Verify warning] ${detail} (auto-fix error)`;
        }
      } else {
        if (cfg.validationPolicy === 'fail-closed') {
          deps.postToAllWebviews({ type: 'responseError', text: `Publish blocked by verification: ${detail}` });
          return null;
        }
        deps.postToAllWebviews({ type: 'guardianAlert', message: `Verify warning: ${detail}` });
        fullResponse += `\n\n[Verify warning] ${detail}`;
      }
    }
  }

  // === HALLUCINATION DETECTION ===
  deps.postToAllWebviews({ type: 'pipelineStatus', icon: '🔮', text: 'Kontrola halucinací...', statusType: 'validation', loading: true });

  const hallucinationResult = deps.hallucinationDetector.analyze(fullResponse, cfg.trimmedPrompt, cfg.chatMessages);
  if (hallucinationResult.isHallucination) {
    deps.guardianStats.hallucinationsDetected++;
    deps.log(`[HallucinationDetector] HALUCINACE detekovana (${(hallucinationResult.confidence * 100).toFixed(1)}%)`);
    deps.log(`[HallucinationDetector] Kategorie: ${hallucinationResult.category}`);
    deps.postToAllWebviews({
      type: 'guardianAlert',
      message: `🔮 Halucinace: ${deps.hallucinationDetector.getSummary(hallucinationResult)}`
    });
  } else {
    deps.log(`[HallucinationDetector] OK: ${deps.hallucinationDetector.getSummary(hallucinationResult)}`);
  }

  // === GUARDIAN ANALYSIS ===
  let guardianResult: GuardianResult = {
    isOk: true,
    cleanedResponse: fullResponse,
    issues: [],
    shouldRetry: false,
    loopDetected: false,
    repetitionScore: 0
  };

  if (cfg.guardianEnabled) {
    deps.postToAllWebviews({ type: 'pipelineStatus', icon: '🛡️', text: 'Guardian kontroluje vzory...', statusType: 'validation', loading: true });

    guardianResult = deps.guardian.analyze(fullResponse, cfg.trimmedPrompt);

    deps.log(`[ResponseGuardian] isOk: ${guardianResult.isOk}, loopDetected: ${guardianResult.loopDetected}, repetitionScore: ${(guardianResult.repetitionScore * 100).toFixed(1)}%`);
    if (guardianResult.issues.length > 0) {
      guardianResult.issues.forEach(issue => {
        deps.log(`[ResponseGuardian]   - ${issue}`);
      });
    }

    deps.postToAllWebviews({
      type: 'guardianStatus',
      result: {
        isOk: guardianResult.isOk,
        issues: guardianResult.issues,
        repetitionScore: guardianResult.repetitionScore,
        loopDetected: guardianResult.loopDetected
      }
    });

    if (!guardianResult.isOk) {
      fullResponse = guardianResult.cleanedResponse;
      if (guardianResult.issues.length > 0) {
        deps.postToAllWebviews({
          type: 'guardianAlert',
          message: `Guardian: ${guardianResult.issues.join(', ')}`
        });
      }
    }
  }

  // === RESPONSE HISTORY CHECK ===
  deps.postToAllWebviews({
    type: 'pipelineStatus',
    icon: PIPELINE_STATUS_ICONS.history,
    text: PIPELINE_STATUS_TEXT.checkingHistory,
    statusType: 'validation',
    loading: true
  });

  const similarityCheck = deps.responseHistoryManager.checkSimilarity(fullResponse, cfg.trimmedPrompt);
  if (similarityCheck.isSimilar) {
    deps.log(`[ResponseHistory] Podobna odpoved nalezena (${(similarityCheck.similarity * 100).toFixed(1)}%)`);
    deps.postToAllWebviews({
      type: 'guardianAlert',
      message: `📋 Podobná odpověď v historii (${(similarityCheck.similarity * 100).toFixed(0)}%)`
    });
  } else {
    deps.log('[ResponseHistory] Odpověď je unikátní');
  }

  // === SVEDOMI (MINI-MODEL VALIDATION) ===
  let miniResult: MiniModelResult | null = null;
  if (cfg.miniModelEnabled) {
    deps.postToAllWebviews({
      type: 'pipelineStatus',
      icon: PIPELINE_STATUS_ICONS.svedomi,
      text: PIPELINE_STATUS_TEXT.svedomiValidation,
      statusType: 'validation',
      loading: true
    });
    deps.postToAllWebviews({ type: 'svedomiValidating' });
    miniResult = await deps.svedomi.validate(
      cfg.trimmedPrompt,
      fullResponse,
      (status: string) => {
        deps.postToAllWebviews({ type: 'pipelineStatus', icon: '🧠', text: status, statusType: 'validation', loading: true });
      }
    );
    deps.postToAllWebviews({ type: 'svedomiValidationDone' });
    deps.postToAllWebviews({ type: 'miniModelResult', result: miniResult });
  } else {
    deps.log('[Svedomi] Mini-model je vypnut');
  }
  if (miniResult?.unavailable) {
    deps.postToAllWebviews({
      type: 'guardianAlert',
      message: deps.getMiniUnavailableMessage(cfg.validationPolicy, true)
    });
  }

  // === QUALITY CHECKS ARRAY ===
  const qualityChecks: QualityCheckResult[] = [];
  qualityChecks.push({
    name: 'Guardian',
    ok: cfg.guardianEnabled ? guardianResult.isOk : true,
    unavailable: !cfg.guardianEnabled,
    details: cfg.guardianEnabled
      ? (guardianResult.issues.length > 0 ? guardianResult.issues.join(', ') : undefined)
      : 'Vypnuto'
  });
  qualityChecks.push({
    name: 'HallucinationDetector',
    ok: !hallucinationResult.isHallucination,
    score: hallucinationResult.confidence,
    threshold: 0.7,
    details: deps.hallucinationDetector.getSummary(hallucinationResult)
  });
  if (miniResult) {
    const svedomiOk = deps.isMiniAccepted(miniResult, cfg.validationPolicy);
    qualityChecks.push({
      name: 'svedomi',
      ok: svedomiOk,
      score: miniResult.score,
      threshold: 5,
      details: miniResult.reason,
      unavailable: miniResult.unavailable
    });
  }
  if (postEditVerification) {
    qualityChecks.push({
      name: 'post-edit verify',
      ok: postEditVerification.ok,
      unavailable: postEditVerification.ran.length === 0,
      details: postEditVerification.ok
        ? (postEditVerification.ran.length > 0 ? 'lint/test/build OK' : 'No verification scripts')
        : (postEditVerification.failed[0]?.command || 'Verification failed')
    });
  }

  // === EXTERNAL VALIDATORS ===
  let external: { rewardResult: QualityCheckResult; hhemResult: QualityCheckResult; ragasResult: QualityCheckResult; results: QualityCheckResult[] };
  try {
    external = await deps.runExternalValidators(cfg.panel, cfg.trimmedPrompt, fullResponse, {
      rewardEnabled: cfg.rewardEnabled,
      rewardEndpoint: cfg.rewardEndpoint,
      rewardThreshold: cfg.rewardThreshold,
      hhemEnabled: cfg.hhemEnabled,
      hhemEndpoint: cfg.hhemEndpoint,
      hhemThreshold: cfg.hhemThreshold,
      ragasEnabled: cfg.ragasEnabled,
      ragasEndpoint: cfg.ragasEndpoint,
      ragasThreshold: cfg.ragasThreshold,
      timeoutMs: cfg.timeout
    }, cfg.validatorLogsEnabled);
  } catch (extErr: unknown) {
    deps.log(`[ExternalValidators] Crashed: ${(extErr as Error).message || String(extErr)}`);
    const unavailable: QualityCheckResult = { name: 'external', ok: true, unavailable: true, details: 'Validator error' };
    external = { rewardResult: unavailable, hhemResult: unavailable, ragasResult: unavailable, results: [] };
  }
  qualityChecks.push(...external.results);

  // === SUMMARIZER + STRUCTURED OUTPUT ===
  const summary = cfg.summarizerEnabled
    ? await deps.summarizeResponse(cfg.baseUrl, cfg.summarizerModel, cfg.trimmedPrompt, fullResponse, cfg.timeout)
    : null;
  const structuredOutput = deps.buildStructuredOutput(fullResponse, summary, qualityChecks, !cfg.stepMode);

  return {
    fullResponse,
    postEditVerification,
    hallucinationResult,
    guardianResult,
    miniResult,
    qualityChecks,
    external: {
      rewardResult: external.rewardResult,
      hhemResult: external.hhemResult,
      ragasResult: external.ragasResult,
      results: external.results
    },
    summary,
    structuredOutput
  };
}
