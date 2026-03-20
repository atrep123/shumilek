import { expect } from 'chai';
import { computeRetryDecision, buildRetryFeedbackMessage, checkFailClosedBlock, RetryDecisionInput, RetryDecision, FailClosedBlockInput } from '../src/retryDecision';
import { HallucinationResult, GuardianResult, MiniModelResult, QualityCheckResult } from '../src/types';

function makeHallucination(overrides?: Partial<HallucinationResult>): HallucinationResult {
  return { isHallucination: false, confidence: 0, reasons: [], category: 'none', ...overrides };
}

function makeGuardian(overrides?: Partial<GuardianResult>): GuardianResult {
  return { isOk: true, cleanedResponse: '', issues: [], shouldRetry: false, loopDetected: false, repetitionScore: 0, ...overrides };
}

function makeQuality(overrides?: Partial<QualityCheckResult>): QualityCheckResult {
  return { name: 'test', ok: true, ...overrides };
}

function makeInput(overrides?: Partial<RetryDecisionInput>): RetryDecisionInput {
  return {
    hallucinationResult: makeHallucination(),
    guardianResult: makeGuardian(),
    miniResult: null,
    rewardResult: makeQuality({ name: 'reward' }),
    hhemResult: makeQuality({ name: 'hhem' }),
    ragasResult: makeQuality({ name: 'ragas' }),
    validationPolicy: 'fail-soft',
    guardianEnabled: true,
    rewardEnabled: false,
    rewardThreshold: 0.5,
    hhemEnabled: false,
    hhemThreshold: 0.5,
    ragasEnabled: false,
    ragasThreshold: 0.5,
    toolsHadMutations: false,
    toolsEnabled: false,
    retryCount: 0,
    maxRetries: 3,
    ...overrides
  };
}

describe('computeRetryDecision', () => {
  it('returns no retry when everything passes', () => {
    const d = computeRetryDecision(makeInput());
    expect(d.shouldRetry).to.be.false;
    expect(d.blocked).to.be.false;
  });

  it('retries on hallucination with high confidence', () => {
    const d = computeRetryDecision(makeInput({
      hallucinationResult: makeHallucination({ isHallucination: true, confidence: 0.85 })
    }));
    expect(d.shouldRetry).to.be.true;
    expect(d.retrySource).to.equal('Hallucination');
    expect(d.retryDetail).to.include('85');
  });

  it('does not retry on hallucination with low confidence', () => {
    const d = computeRetryDecision(makeInput({
      hallucinationResult: makeHallucination({ isHallucination: true, confidence: 0.5 })
    }));
    expect(d.shouldRetry).to.be.false;
  });

  it('retries on guardian shouldRetry', () => {
    const d = computeRetryDecision(makeInput({
      guardianResult: makeGuardian({ shouldRetry: true })
    }));
    expect(d.shouldRetry).to.be.true;
    expect(d.retrySource).to.equal('Guardian');
  });

  it('retries on mini-model failure (fail-soft, shouldRetry true)', () => {
    const d = computeRetryDecision(makeInput({
      miniResult: { isValid: false, score: 3, reason: 'špatně', shouldRetry: true }
    }));
    expect(d.shouldRetry).to.be.true;
    expect(d.retrySource).to.equal('Mini-model');
    expect(d.retryDetail).to.include('3');
  });

  it('retries on failed reward when enabled', () => {
    const d = computeRetryDecision(makeInput({
      rewardEnabled: true,
      rewardThreshold: 0.7,
      rewardResult: makeQuality({ name: 'reward', ok: false })
    }));
    expect(d.shouldRetry).to.be.true;
    expect(d.retrySource).to.equal('Reward');
    expect(d.retryDetail).to.include('0.7');
  });

  it('retries on failed HHEM when enabled', () => {
    const d = computeRetryDecision(makeInput({
      hhemEnabled: true,
      hhemThreshold: 0.6,
      hhemResult: makeQuality({ name: 'hhem', ok: false })
    }));
    expect(d.shouldRetry).to.be.true;
    expect(d.retrySource).to.equal('HHEM');
  });

  it('retries on failed RAGAS when enabled', () => {
    const d = computeRetryDecision(makeInput({
      ragasEnabled: true,
      ragasThreshold: 0.8,
      ragasResult: makeQuality({ name: 'ragas', ok: false })
    }));
    expect(d.shouldRetry).to.be.true;
    expect(d.retrySource).to.equal('RAGAS');
  });

  it('retries on fail-closed unavailable reward', () => {
    const d = computeRetryDecision(makeInput({
      validationPolicy: 'fail-closed',
      rewardEnabled: true,
      rewardResult: makeQuality({ name: 'reward', ok: false, unavailable: true })
    }));
    expect(d.shouldRetry).to.be.true;
  });

  it('sets retrySource to Reward (unavailable) on fail-closed unavailable reward only', () => {
    const d = computeRetryDecision(makeInput({
      validationPolicy: 'fail-closed',
      rewardEnabled: true,
      rewardResult: makeQuality({ name: 'reward', ok: false, unavailable: true })
    }));
    expect(d.retrySource).to.equal('Reward (unavailable)');
    expect(d.retryDetail).to.include('fail-closed');
  });

  it('sets retrySource to HHEM (unavailable) on fail-closed unavailable HHEM only', () => {
    const d = computeRetryDecision(makeInput({
      validationPolicy: 'fail-closed',
      hhemEnabled: true,
      hhemResult: makeQuality({ name: 'hhem', ok: false, unavailable: true })
    }));
    expect(d.retrySource).to.equal('HHEM (unavailable)');
    expect(d.retryDetail).to.include('fail-closed');
  });

  it('sets retrySource to RAGAS (unavailable) on fail-closed unavailable RAGAS only', () => {
    const d = computeRetryDecision(makeInput({
      validationPolicy: 'fail-closed',
      ragasEnabled: true,
      ragasResult: makeQuality({ name: 'ragas', ok: false, unavailable: true })
    }));
    expect(d.retrySource).to.equal('RAGAS (unavailable)');
    expect(d.retryDetail).to.include('fail-closed');
  });

  it('does not retry when retryCount >= maxRetries', () => {
    const d = computeRetryDecision(makeInput({
      guardianResult: makeGuardian({ shouldRetry: true }),
      retryCount: 3,
      maxRetries: 3
    }));
    expect(d.shouldRetry).to.be.false;
  });

  it('blocked by tool mutations', () => {
    const d = computeRetryDecision(makeInput({
      guardianResult: makeGuardian({ shouldRetry: true }),
      toolsEnabled: true,
      toolsHadMutations: true
    }));
    expect(d.shouldRetry).to.be.false;
    expect(d.blocked).to.be.true;
    expect(d.blockedReason).to.include('tool');
  });

  it('hallucination takes priority over mini-model', () => {
    const d = computeRetryDecision(makeInput({
      hallucinationResult: makeHallucination({ isHallucination: true, confidence: 0.9 }),
      miniResult: { isValid: false, score: 2, reason: 'bad', shouldRetry: true }
    }));
    expect(d.retrySource).to.equal('Hallucination');
  });
});

describe('buildRetryFeedbackMessage', () => {
  it('builds feedback with all components', () => {
    const decision: RetryDecision = {
      shouldRetry: true,
      blocked: false,
      retrySource: 'Guardian',
      retryDetail: 'Problém detekován'
    };
    const msg = buildRetryFeedbackMessage(
      decision,
      makeHallucination({ isHallucination: true, confidence: 0.8 }),
      makeGuardian({ issues: ['loop detected'] }),
      { isValid: false, score: 3, reason: 'bad', shouldRetry: true },
      true,
      '🚨 Halucinace 80%'
    );
    expect(msg).to.include('Guardian');
    expect(msg).to.include('loop detected');
    expect(msg).to.include('Svedomi: 3/10');
    expect(msg).to.include('Halucinace');
  });

  it('omits guardian when disabled', () => {
    const decision: RetryDecision = {
      shouldRetry: true, blocked: false,
      retrySource: 'Mini-model', retryDetail: 'Skóre 2/10'
    };
    const msg = buildRetryFeedbackMessage(
      decision,
      makeHallucination(),
      makeGuardian({ issues: ['issue'] }),
      null,
      false,
      ''
    );
    expect(msg).not.to.include('Guardian');
  });
});

function makeFailClosedInput(overrides?: Partial<FailClosedBlockInput>): FailClosedBlockInput {
  return {
    hallucinationResult: makeHallucination(),
    guardianResult: makeGuardian(),
    miniResult: null,
    validationPolicy: 'fail-closed',
    rewardEnabled: false,
    rewardResult: makeQuality({ name: 'reward' }),
    hhemEnabled: false,
    hhemResult: makeQuality({ name: 'hhem' }),
    ragasEnabled: false,
    ragasResult: makeQuality({ name: 'ragas' }),
    ...overrides
  };
}

describe('checkFailClosedBlock', () => {
  it('does not block in fail-soft mode', () => {
    const r = checkFailClosedBlock(makeFailClosedInput({ validationPolicy: 'fail-soft' }));
    expect(r.blocked).to.be.false;
  });

  it('does not block when all validators pass', () => {
    const r = checkFailClosedBlock(makeFailClosedInput());
    expect(r.blocked).to.be.false;
  });

  it('blocks on hallucination with high confidence', () => {
    const r = checkFailClosedBlock(makeFailClosedInput({
      hallucinationResult: makeHallucination({ isHallucination: true, confidence: 0.85 })
    }));
    expect(r.blocked).to.be.true;
    expect(r.reason).to.include('Halucinace');
    expect(r.reason).to.include('85');
  });

  it('does not block on hallucination with low confidence', () => {
    const r = checkFailClosedBlock(makeFailClosedInput({
      hallucinationResult: makeHallucination({ isHallucination: true, confidence: 0.5 })
    }));
    expect(r.blocked).to.be.false;
  });

  it('blocks on guardian shouldRetry', () => {
    const r = checkFailClosedBlock(makeFailClosedInput({
      guardianResult: makeGuardian({ shouldRetry: true, issues: ['loop detected'] })
    }));
    expect(r.blocked).to.be.true;
    expect(r.reason).to.include('Guardian');
    expect(r.reason).to.include('loop detected');
  });

  it('blocks on mini-model low score', () => {
    const r = checkFailClosedBlock(makeFailClosedInput({
      miniResult: { isValid: false, score: 3, reason: 'špatná odpověď', shouldRetry: true }
    }));
    expect(r.blocked).to.be.true;
    expect(r.reason).to.include('Svedomi');
  });

  it('blocks on mini-model unavailable', () => {
    const r = checkFailClosedBlock(makeFailClosedInput({
      miniResult: { isValid: false, score: 0, reason: 'unavailable', shouldRetry: false, unavailable: true }
    }));
    expect(r.blocked).to.be.true;
    expect(r.reason).to.include('Svedomi');
    expect(r.reason).to.include('fail-closed');
  });

  it('does not block on mini-model passing score', () => {
    const r = checkFailClosedBlock(makeFailClosedInput({
      miniResult: { isValid: true, score: 7, reason: 'ok', shouldRetry: false }
    }));
    expect(r.blocked).to.be.false;
  });

  it('blocks on unavailable reward when enabled', () => {
    const r = checkFailClosedBlock(makeFailClosedInput({
      rewardEnabled: true,
      rewardResult: makeQuality({ name: 'reward', ok: false, unavailable: true })
    }));
    expect(r.blocked).to.be.true;
    expect(r.reason).to.include('Reward');
  });

  it('blocks on unavailable HHEM when enabled', () => {
    const r = checkFailClosedBlock(makeFailClosedInput({
      hhemEnabled: true,
      hhemResult: makeQuality({ name: 'hhem', ok: false, unavailable: true })
    }));
    expect(r.blocked).to.be.true;
    expect(r.reason).to.include('HHEM');
  });

  it('blocks on unavailable RAGAS when enabled', () => {
    const r = checkFailClosedBlock(makeFailClosedInput({
      ragasEnabled: true,
      ragasResult: makeQuality({ name: 'ragas', ok: false, unavailable: true })
    }));
    expect(r.blocked).to.be.true;
    expect(r.reason).to.include('RAGAS');
  });

  it('blocks on failed reward when enabled', () => {
    const r = checkFailClosedBlock(makeFailClosedInput({
      rewardEnabled: true,
      rewardResult: makeQuality({ name: 'reward', ok: false })
    }));
    expect(r.blocked).to.be.true;
    expect(r.reason).to.include('Reward');
  });

  it('hallucination takes priority over other failures', () => {
    const r = checkFailClosedBlock(makeFailClosedInput({
      hallucinationResult: makeHallucination({ isHallucination: true, confidence: 0.9 }),
      guardianResult: makeGuardian({ shouldRetry: true }),
      miniResult: { isValid: false, score: 2, reason: 'bad', shouldRetry: true }
    }));
    expect(r.blocked).to.be.true;
    expect(r.reason).to.include('Halucinace');
  });

  it('combines multiple unavailable external validators in reason', () => {
    const r = checkFailClosedBlock(makeFailClosedInput({
      rewardEnabled: true,
      rewardResult: makeQuality({ name: 'reward', ok: false, unavailable: true }),
      hhemEnabled: true,
      hhemResult: makeQuality({ name: 'hhem', ok: false, unavailable: true })
    }));
    expect(r.blocked).to.be.true;
    expect(r.reason).to.include('Reward');
    expect(r.reason).to.include('HHEM');
  });
});
