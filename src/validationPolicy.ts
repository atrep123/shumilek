import type { MiniModelResult, ValidationPolicy } from './types';

export function isMiniAccepted(miniResult: MiniModelResult | null, policy: ValidationPolicy): boolean {
  if (!miniResult) return true;
  if (miniResult.unavailable) return policy === 'fail-soft';
  return miniResult.score >= 5;
}

export function shouldRetryMiniValidation(miniResult: MiniModelResult | null, policy: ValidationPolicy): boolean {
  if (!miniResult) return false;
  if (miniResult.unavailable) return policy === 'fail-closed';
  return Boolean(miniResult.shouldRetry);
}

export function getMiniUnavailableMessage(policy: ValidationPolicy, withVerb: boolean = false): string {
  if (withVerb) {
    return policy === 'fail-closed'
      ? 'Svedomi je nedostupne (fail-closed)'
      : 'Svedomi je nedostupne (fail-soft)';
  }
  return policy === 'fail-closed'
    ? 'Svedomi nedostupne (fail-closed)'
    : 'Svedomi nedostupne (fail-soft)';
}
