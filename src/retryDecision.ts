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
