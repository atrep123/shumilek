import { expect } from 'chai';
import {
  runValidationPipeline,
  ValidationPipelineConfig,
  ValidationPipelineDeps,
  ToolSessionState,
  VerificationSummary
} from '../src/validationPipeline';
import type { HallucinationResult, GuardianResult } from '../src/types';

function noopDeps(overrides: Partial<ValidationPipelineDeps> = {}): ValidationPipelineDeps {
  const logs: string[] = [];
  const webviewMessages: any[] = [];
  return {
    postToAllWebviews: (msg: any) => webviewMessages.push(msg),
    log: (msg: string) => logs.push(msg),
    guardianStats: { hallucinationsDetected: 0 },
    hallucinationDetector: {
      analyze: (): HallucinationResult => ({
        isHallucination: false,
        confidence: 0.1,
        reasons: [],
        category: 'none'
      }),
      getSummary: () => 'No hallucination'
    },
    guardian: {
      analyze: (_r: string, _p: string): GuardianResult => ({
        isOk: true,
        cleanedResponse: _r,
        issues: [],
        shouldRetry: false,
        loopDetected: false,
        repetitionScore: 0
      })
    },
    responseHistoryManager: {
      checkSimilarity: () => ({ isSimilar: false, similarity: 0 })
    },
    svedomi: {
      validate: async () => ({ isValid: true, score: 8, reason: 'Good', shouldRetry: false, unavailable: false })
    },
    generateWithTools: async () => 'fixed',
    runPostEditVerification: async (): Promise<VerificationSummary> => ({ ok: true, ran: [], failed: [] }),
    runExternalValidators: async () => ({
      rewardResult: { name: 'reward', ok: true },
      hhemResult: { name: 'hhem', ok: true },
      ragasResult: { name: 'ragas', ok: true },
      results: []
    }),
    summarizeResponse: async () => null,
    buildStructuredOutput: (response: string) => response,
    getMiniUnavailableMessage: () => 'Mini unavailable',
    isMiniAccepted: () => true,
    ...overrides
  };
}

function baseCfg(overrides: Partial<ValidationPipelineConfig> = {}): ValidationPipelineConfig {
  return {
    trimmedPrompt: 'test prompt',
    chatMessages: [{ role: 'user', content: 'test' }],
    stepMode: false,
    panel: {} as any,
    toolCallsEnabled: false,
    baseUrl: 'http://localhost:11434',
    writerModel: 'test-model',
    toolPromptForMain: '',
    toolPrimaryModel: '',
    toolsFallbackModel: '',
    toolsConfirmEdits: false,
    stepTimeout: 5000,
    autoApprovePolicy: { read: true, edit: false, commands: false, browser: false, mcp: false },
    guardianEnabled: true,
    miniModelEnabled: false,
    validationPolicy: 'fail-soft',
    validatorLogsEnabled: false,
    summarizerEnabled: false,
    summarizerModel: '',
    timeout: 5000,
    rewardEnabled: false,
    rewardEndpoint: '',
    rewardThreshold: 0.5,
    hhemEnabled: false,
    hhemEndpoint: '',
    hhemThreshold: 0.5,
    ragasEnabled: false,
    ragasEndpoint: '',
    ragasThreshold: 0.5,
    ...overrides
  };
}

function baseSession(overrides: Partial<ToolSessionState> = {}): ToolSessionState {
  return {
    hadMutations: false,
    mutationTools: [],
    ...overrides
  };
}

describe('validationPipeline', () => {

  describe('runValidationPipeline', () => {
    it('returns result with all quality checks for simple case', async () => {
      const result = await runValidationPipeline('Hello world', baseSession(), baseCfg(), noopDeps());
      expect(result).to.not.be.null;
      expect(result!.fullResponse).to.equal('Hello world');
      expect(result!.qualityChecks).to.be.an('array');
      expect(result!.hallucinationResult.isHallucination).to.be.false;
      expect(result!.guardianResult.isOk).to.be.true;
    });

    it('includes Guardian check in qualityChecks', async () => {
      const result = await runValidationPipeline('resp', baseSession(), baseCfg(), noopDeps());
      const guardianCheck = result!.qualityChecks.find(c => c.name === 'Guardian');
      expect(guardianCheck).to.exist;
      expect(guardianCheck!.ok).to.be.true;
    });

    it('includes HallucinationDetector check', async () => {
      const result = await runValidationPipeline('resp', baseSession(), baseCfg(), noopDeps());
      const halCheck = result!.qualityChecks.find(c => c.name === 'HallucinationDetector');
      expect(halCheck).to.exist;
      expect(halCheck!.ok).to.be.true;
    });

    it('marks Guardian unavailable when disabled', async () => {
      const result = await runValidationPipeline('resp', baseSession(), baseCfg({ guardianEnabled: false }), noopDeps());
      const guardianCheck = result!.qualityChecks.find(c => c.name === 'Guardian');
      expect(guardianCheck!.unavailable).to.be.true;
      expect(guardianCheck!.ok).to.be.true;
    });

    it('runs svedomi when miniModelEnabled', async () => {
      let validated = false;
      const deps = noopDeps({
        svedomi: {
          validate: async () => {
            validated = true;
            return { isValid: true, score: 7, reason: 'OK', shouldRetry: false, unavailable: false };
          }
        }
      });
      const result = await runValidationPipeline('resp', baseSession(), baseCfg({ miniModelEnabled: true }), deps);
      expect(validated).to.be.true;
      expect(result!.miniResult).to.not.be.null;
      const svedomiCheck = result!.qualityChecks.find(c => c.name === 'svedomi');
      expect(svedomiCheck).to.exist;
    });

    it('skips svedomi when miniModelEnabled is false', async () => {
      const result = await runValidationPipeline('resp', baseSession(), baseCfg({ miniModelEnabled: false }), noopDeps());
      expect(result!.miniResult).to.be.null;
    });

    it('runs post-edit verification when mutations occurred', async () => {
      let verifyRan = false;
      const deps = noopDeps({
        runPostEditVerification: async (): Promise<VerificationSummary> => {
          verifyRan = true;
          return { ok: true, ran: [{ command: 'npm test', ok: true, exitCode: 0, stdout: '', stderr: '' }], failed: [] };
        }
      });
      const session = baseSession({ hadMutations: true });
      const result = await runValidationPipeline('resp', session, baseCfg(), deps);
      expect(verifyRan).to.be.true;
      expect(result!.postEditVerification).to.not.be.null;
      expect(result!.postEditVerification!.ok).to.be.true;
    });

    it('skips post-edit verification when no mutations', async () => {
      const session = baseSession({ hadMutations: false });
      const result = await runValidationPipeline('resp', session, baseCfg(), noopDeps());
      expect(result!.postEditVerification).to.be.null;
    });

    it('returns null on fail-closed verification failure (no tool auto-fix)', async () => {
      const deps = noopDeps({
        runPostEditVerification: async (): Promise<VerificationSummary> => ({
          ok: false,
          ran: [{ command: 'npm test', ok: false, exitCode: 1, stdout: '', stderr: 'error' }],
          failed: [{ command: 'npm test', ok: false, exitCode: 1, stdout: '', stderr: 'error' }]
        })
      });
      const session = baseSession({ hadMutations: true });
      const result = await runValidationPipeline('resp', session, baseCfg({
        validationPolicy: 'fail-closed',
        toolCallsEnabled: false
      }), deps);
      expect(result).to.be.null;
    });

    it('appends verify warning on fail-soft verification failure', async () => {
      const deps = noopDeps({
        runPostEditVerification: async (): Promise<VerificationSummary> => ({
          ok: false,
          ran: [{ command: 'npm test', ok: false, exitCode: 1, stdout: '', stderr: 'error' }],
          failed: [{ command: 'npm test', ok: false, exitCode: 1, stdout: '', stderr: 'error' }]
        })
      });
      const session = baseSession({ hadMutations: true });
      const result = await runValidationPipeline('resp', session, baseCfg({
        validationPolicy: 'fail-soft',
        toolCallsEnabled: false
      }), deps);
      expect(result).to.not.be.null;
      expect(result!.fullResponse).to.include('[Verify warning]');
    });

    it('detects hallucination and increments stats', async () => {
      const stats = { hallucinationsDetected: 0 };
      const deps = noopDeps({
        guardianStats: stats,
        hallucinationDetector: {
          analyze: (): HallucinationResult => ({
            isHallucination: true,
            confidence: 0.9,
            category: 'factual',
            reasons: ['made up']
          }),
          getSummary: () => 'Fabricated content'
        }
      });
      const result = await runValidationPipeline('resp', baseSession(), baseCfg(), deps);
      expect(stats.hallucinationsDetected).to.equal(1);
      const halCheck = result!.qualityChecks.find(c => c.name === 'HallucinationDetector');
      expect(halCheck!.ok).to.be.false;
    });

    it('detects guardian issues and cleans response', async () => {
      const deps = noopDeps({
        guardian: {
          analyze: (_response: string): GuardianResult => ({
            isOk: false,
            cleanedResponse: 'cleaned',
            issues: ['loop detected'],
            shouldRetry: false,
            loopDetected: true,
            repetitionScore: 0.8
          })
        }
      });
      const result = await runValidationPipeline('bad response', baseSession(), baseCfg(), deps);
      expect(result!.fullResponse).to.equal('cleaned');
      expect(result!.guardianResult.isOk).to.be.false;
    });

    it('calls summarizer when enabled', async () => {
      let called = false;
      const deps = noopDeps({
        summarizeResponse: async () => { called = true; return 'tldr'; }
      });
      const result = await runValidationPipeline('resp', baseSession(), baseCfg({ summarizerEnabled: true, summarizerModel: 'sm' }), deps);
      expect(called).to.be.true;
      expect(result!.summary).to.equal('tldr');
    });

    it('skips summarizer when disabled', async () => {
      const result = await runValidationPipeline('resp', baseSession(), baseCfg({ summarizerEnabled: false }), noopDeps());
      expect(result!.summary).to.be.null;
    });

    it('includes external validator results', async () => {
      const deps = noopDeps({
        runExternalValidators: async () => ({
          rewardResult: { name: 'reward', ok: true, score: 0.9 },
          hhemResult: { name: 'hhem', ok: true, score: 0.8 },
          ragasResult: { name: 'ragas', ok: true, score: 0.7 },
          results: [{ name: 'reward', ok: true, score: 0.9 }]
        })
      });
      const result = await runValidationPipeline('resp', baseSession(), baseCfg(), deps);
      expect(result!.external.rewardResult.score).to.equal(0.9);
      expect(result!.qualityChecks.some(c => c.name === 'reward')).to.be.true;
    });

    it('attempts self-correction when verification fails with tools enabled', async () => {
      let fixAttempted = false;
      let verifyCallCount = 0;
      const deps = noopDeps({
        runPostEditVerification: async (): Promise<VerificationSummary> => {
          verifyCallCount++;
          if (verifyCallCount === 1) {
            return {
              ok: false,
              ran: [{ command: 'npm test', ok: false, exitCode: 1, stdout: '', stderr: 'SyntaxError: Unexpected token' }],
              failed: [{ command: 'npm test', ok: false, exitCode: 1, stdout: '', stderr: 'SyntaxError: Unexpected token' }]
            };
          }
          return { ok: true, ran: [{ command: 'npm test', ok: true, exitCode: 0, stdout: '', stderr: '' }], failed: [] };
        },
        generateWithTools: async () => {
          fixAttempted = true;
          return 'applied fix';
        }
      });
      const session = baseSession({ hadMutations: true });
      const result = await runValidationPipeline('resp', session, baseCfg({ toolCallsEnabled: true }), deps);
      expect(fixAttempted).to.be.true;
      expect(result!.fullResponse).to.include('[Auto-corrected:');
    });

    it('gracefully handles auto-fix crash without losing pipeline result', async () => {
      const logs: string[] = [];
      const deps = noopDeps({
        log: (msg: string) => logs.push(msg),
        runPostEditVerification: async (): Promise<VerificationSummary> => ({
          ok: false,
          ran: [{ command: 'npm test', ok: false, exitCode: 1, stdout: '', stderr: 'Error' }],
          failed: [{ command: 'npm test', ok: false, exitCode: 1, stdout: '', stderr: 'Error' }]
        }),
        generateWithTools: async () => { throw new Error('LLM connection lost'); }
      });
      const session = baseSession({ hadMutations: true });
      const result = await runValidationPipeline('resp', session, baseCfg({ toolCallsEnabled: true }), deps);
      expect(result).to.not.be.null;
      expect(result!.fullResponse).to.include('[Verify warning]');
      expect(result!.fullResponse).to.include('auto-fix error');
      expect(logs.some(l => l.includes('Auto-fix crashed'))).to.be.true;
    });

    it('gracefully handles external validator crash with fail-open defaults', async () => {
      const logs: string[] = [];
      const deps = noopDeps({
        log: (msg: string) => logs.push(msg),
        runExternalValidators: async () => { throw new Error('Network timeout'); }
      });
      const result = await runValidationPipeline('resp', baseSession(), baseCfg(), deps);
      expect(result).to.not.be.null;
      expect(result!.external.rewardResult.unavailable).to.be.true;
      expect(result!.external.hhemResult.unavailable).to.be.true;
      expect(result!.external.ragasResult.unavailable).to.be.true;
      expect(logs.some(l => l.includes('Crashed'))).to.be.true;
    });

    it('gracefully handles svedomi crash and marks result unavailable', async () => {
      const logs: string[] = [];
      const deps = noopDeps({
        log: (msg: string) => logs.push(msg),
        svedomi: {
          validate: async () => { throw new Error('ECONNREFUSED'); }
        }
      });
      const cfg = baseCfg({ miniModelEnabled: true });
      const result = await runValidationPipeline('resp', baseSession(), cfg, deps);
      expect(result).to.not.be.null;
      expect(result!.miniResult).to.not.be.null;
      expect(result!.miniResult!.unavailable).to.be.true;
      expect(logs.some(l => l.includes('Svedomi') && l.includes('ECONNREFUSED'))).to.be.true;
    });

    it('gracefully handles summarizer crash and returns null summary', async () => {
      const logs: string[] = [];
      const deps = noopDeps({
        log: (msg: string) => logs.push(msg),
        summarizeResponse: async () => { throw new Error('Model not loaded'); }
      });
      const cfg = baseCfg({ summarizerEnabled: true });
      const result = await runValidationPipeline('resp', baseSession(), cfg, deps);
      expect(result).to.not.be.null;
      expect(result!.summary).to.be.null;
      expect(logs.some(l => l.includes('Summarizer') && l.includes('Model not loaded'))).to.be.true;
    });
  });
});
