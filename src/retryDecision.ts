import {
  HallucinationResult,
  GuardianResult,
  MiniModelResult,
  QualityCheckResult,
  ValidationPolicy
} from './types';
import { shouldRetryMiniValidation } from './validationPolicy';

export interface RetryDecisionInput {
  hallucinationResult: HallucinationResult;
  guardianResult: GuardianResult;
  miniResult: MiniModelResult | null;
  rewardResult: QualityCheckResult;
  hhemResult: QualityCheckResult;
  ragasResult: QualityCheckResult;
  validationPolicy: ValidationPolicy;
  guardianEnabled: boolean;
  rewardEnabled: boolean;
  rewardThreshold: number;
  hhemEnabled: boolean;
  hhemThreshold: number;
  ragasEnabled: boolean;
  ragasThreshold: number;
  toolsHadMutations: boolean;
  toolsEnabled: boolean;
  retryCount: number;
  maxRetries: number;
}

export interface RetryDecision {
  shouldRetry: boolean;
  blocked: boolean;
  blockedReason?: string;
  retrySource?: string;
  retryDetail?: string;
  feedbackMessage?: string;
}

export function computeRetryDecision(input: RetryDecisionInput): RetryDecision {
  const {
    hallucinationResult, guardianResult, miniResult,
    rewardResult, hhemResult, ragasResult,
    validationPolicy,
    rewardEnabled, rewardThreshold,
    hhemEnabled, hhemThreshold,
    ragasEnabled, ragasThreshold,
    toolsHadMutations, toolsEnabled,
    retryCount, maxRetries
  } = input;

  const shouldRetryMini = shouldRetryMiniValidation(miniResult, validationPolicy);
  const shouldRetryGuardian = guardianResult.shouldRetry;
  const shouldRetryHallucination = hallucinationResult.isHallucination && hallucinationResult.confidence > 0.7;
  const shouldRetryReward = rewardEnabled && !rewardResult.ok && !rewardResult.unavailable;
  const shouldRetryHhem = hhemEnabled && !hhemResult.ok && !hhemResult.unavailable;
  const shouldRetryRagas = ragasEnabled && !ragasResult.ok && !ragasResult.unavailable;
  const failClosedUnavailableReward = rewardEnabled && rewardResult.unavailable && validationPolicy === 'fail-closed';
  const failClosedUnavailableHhem = hhemEnabled && hhemResult.unavailable && validationPolicy === 'fail-closed';
  const failClosedUnavailableRagas = ragasEnabled && ragasResult.unavailable && validationPolicy === 'fail-closed';
  const shouldRetryAny = shouldRetryMini || shouldRetryGuardian || shouldRetryHallucination
    || shouldRetryReward || shouldRetryHhem || shouldRetryRagas
    || failClosedUnavailableReward || failClosedUnavailableHhem || failClosedUnavailableRagas;
  const retryBlockedByTools = toolsEnabled && toolsHadMutations;

  if (!shouldRetryAny) {
    return { shouldRetry: false, blocked: false };
  }

  if (retryCount >= maxRetries) {
    return { shouldRetry: false, blocked: false };
  }

  if (retryBlockedByTools) {
    return {
      shouldRetry: false,
      blocked: true,
      blockedReason: 'tool edits were applied'
    };
  }

  const retrySource = shouldRetryHallucination
    ? 'Hallucination'
    : (shouldRetryMini
      ? 'Mini-model'
      : (shouldRetryReward
        ? 'Reward'
        : (shouldRetryHhem ? 'HHEM' : (shouldRetryRagas ? 'RAGAS' : 'Guardian'))));

  const retryDetail = shouldRetryHallucination
    ? `Halucinace ${(hallucinationResult.confidence * 100).toFixed(0)}%`
    : (shouldRetryMini
      ? `Skóre ${miniResult!.score}/10 - ${miniResult!.reason}`
      : (shouldRetryReward
        ? `Reward pod prahem ${rewardThreshold}`
        : (shouldRetryHhem
          ? `HHEM pod prahem ${hhemThreshold}`
          : (shouldRetryRagas ? `RAGAS pod prahem ${ragasThreshold}` : `Problém detekován`))));

  return {
    shouldRetry: true,
    blocked: false,
    retrySource,
    retryDetail
  };
}

export interface FailClosedBlockInput {
  hallucinationResult: HallucinationResult;
  guardianResult: GuardianResult;
  miniResult: MiniModelResult | null;
  validationPolicy: ValidationPolicy;
  rewardEnabled: boolean;
  rewardResult: QualityCheckResult;
  hhemEnabled: boolean;
  hhemResult: QualityCheckResult;
  ragasEnabled: boolean;
  ragasResult: QualityCheckResult;
}

export interface FailClosedBlockResult {
  blocked: boolean;
  reason?: string;
}

/**
 * Check whether fail-closed policy should block publishing.
 * Used by both single-call and step-by-step modes.
 */
export function checkFailClosedBlock(input: FailClosedBlockInput): FailClosedBlockResult {
  if (input.validationPolicy !== 'fail-closed') {
    return { blocked: false };
  }

  // Hallucination with high confidence
  if (input.hallucinationResult.isHallucination && input.hallucinationResult.confidence > 0.7) {
    return { blocked: true, reason: `Halucinace detekována (${(input.hallucinationResult.confidence * 100).toFixed(0)}%)` };
  }

  // Guardian critical issues
  if (input.guardianResult.shouldRetry) {
    return { blocked: true, reason: `Guardian: ${input.guardianResult.issues.join(', ') || 'problém detekován'}` };
  }

  // Mini-model (svedomi)
  if (input.miniResult && !input.miniResult.unavailable && input.miniResult.score < 5) {
    return { blocked: true, reason: `Svedomi: ${input.miniResult.reason ?? 'Validation failed'}` };
  }
  if (input.miniResult?.unavailable) {
    return { blocked: true, reason: 'Svedomi nedostupné (fail-closed)' };
  }

  // External validators unavailable
  const unavailable: string[] = [];
  if (input.rewardEnabled && input.rewardResult.unavailable) unavailable.push('Reward');
  if (input.hhemEnabled && input.hhemResult.unavailable) unavailable.push('HHEM');
  if (input.ragasEnabled && input.ragasResult.unavailable) unavailable.push('RAGAS');
  if (unavailable.length > 0) {
    return { blocked: true, reason: `Validátor ${unavailable.join(', ')} nedostupný (fail-closed)` };
  }

  // External validators failed
  if (input.rewardEnabled && !input.rewardResult.ok && !input.rewardResult.unavailable) {
    return { blocked: true, reason: 'Reward validace selhala' };
  }
  if (input.hhemEnabled && !input.hhemResult.ok && !input.hhemResult.unavailable) {
    return { blocked: true, reason: 'HHEM validace selhala' };
  }
  if (input.ragasEnabled && !input.ragasResult.ok && !input.ragasResult.unavailable) {
    return { blocked: true, reason: 'RAGAS validace selhala' };
  }

  return { blocked: false };
}

export function buildRetryFeedbackMessage(
  decision: RetryDecision,
  hallucinationResult: HallucinationResult,
  guardianResult: GuardianResult,
  miniResult: MiniModelResult | null,
  guardianEnabled: boolean,
  hallucinationSummary: string
): string {
  return [
    `Duvod: ${decision.retrySource} - ${decision.retryDetail}`,
    guardianEnabled && guardianResult.issues.length > 0 ? `Guardian: ${guardianResult.issues.join(', ')}` : '',
    miniResult ? `Svedomi: ${miniResult.score}/10 - ${miniResult.reason}` : '',
    hallucinationResult.isHallucination ? `Halucinace: ${hallucinationSummary}` : ''
  ].filter(Boolean).join('\n');
}
