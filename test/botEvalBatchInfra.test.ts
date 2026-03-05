import { strict as assert } from 'assert';

import {
  classifyFailureCluster,
  detectOllamaInfraFailureFromText,
  parseBatchArgs,
  resolveOllamaRestartCommand,
  shouldAbortBatchOnInfraFailure,
  shouldAttemptOllamaAutoRestart,
  waitForOllamaRecovery
} from '../scripts/botEvalBatch';

describe('botEvalBatch infra outage handling', () => {
  it('defaults stopOnInfraFailure to true', () => {
    const opts: any = parseBatchArgs([]);
    assert.equal(opts.stopOnInfraFailure, true);
  });

  it('supports --continueOnInfraFailure switch', () => {
    const opts: any = parseBatchArgs(['--continueOnInfraFailure']);
    assert.equal(opts.stopOnInfraFailure, false);
  });

  it('supports explicit --stopOnInfraFailure false', () => {
    const opts: any = parseBatchArgs(['--stopOnInfraFailure', 'false']);
    assert.equal(opts.stopOnInfraFailure, false);
  });

  it('parses infra recovery options and ollama base url', () => {
    const opts: any = parseBatchArgs([
      '--ollamaBaseUrl', 'http://127.0.0.1:7777',
      '--infraRecoveryTimeoutSec', '33',
      '--infraRecoveryPollSec', '2'
    ]);
    assert.equal(opts.ollamaBaseUrl, 'http://127.0.0.1:7777');
    assert.equal(opts.infraRecoveryTimeoutSec, 33);
    assert.equal(opts.infraRecoveryPollSec, 2);
  });

  it('parses auto-restart options', () => {
    const opts: any = parseBatchArgs([
      '--autoRestartOnInfraFailure', 'true',
      '--maxInfraRestarts', '4',
      '--infraRestartTimeoutSec', '41',
      '--infraRestartCooldownSec', '7',
      '--infraRestartCommand', 'echo restart'
    ]);
    assert.equal(opts.autoRestartOnInfraFailure, true);
    assert.equal(opts.maxInfraRestarts, 4);
    assert.equal(opts.infraRestartTimeoutSec, 41);
    assert.equal(opts.infraRestartCooldownSec, 7);
    assert.equal(opts.infraRestartCommand, 'echo restart');
  });

  it('detects Ollama reachability outage from run log text', () => {
    const signal = detectOllamaInfraFailureFromText(
      'Cannot reach Ollama at http://localhost:11434 after 3 preflight attempt(s). Start Ollama server.',
      'run_log'
    );
    assert.ok(signal);
    assert.equal(signal?.kind, 'ollama_unreachable');
    assert.equal(signal?.source, 'run_log');
  });

  it('detects missing model and includes pull hint', () => {
    const signal = detectOllamaInfraFailureFromText(
      'Requested model "qwen2.5-coder:32b" is not available in Ollama tags. Pull it first: "ollama pull qwen2.5-coder:32b".'
    );
    assert.ok(signal);
    assert.equal(signal?.kind, 'ollama_model_missing');
    assert.match(String(signal?.message || ''), /qwen2\.5-coder:32b/);
  });

  it('detects network failure from Ollama generate request diagnostics', () => {
    const signal = detectOllamaInfraFailureFromText(
      'Ollama request failed: request to http://localhost:11434/api/generate failed, reason: '
    );
    assert.ok(signal);
    assert.equal(signal?.kind, 'ollama_unreachable');
  });

  it('returns null for non-infra failures', () => {
    const signal = detectOllamaInfraFailureFromText('Validation failed: expected status 201 but got 200.');
    assert.equal(signal, null);
  });

  it('classifies infra diagnostics into dedicated clusters', () => {
    assert.equal(
      classifyFailureCluster('[infra:ollama_unreachable] Cannot reach Ollama preflight endpoint (/api/tags).'),
      'ollama_infra'
    );
    assert.equal(
      classifyFailureCluster('Requested model "qwen2.5-coder:32b" is not available in Ollama tags.'),
      'ollama_model_missing'
    );
  });

  it('aborts batch only when policy is enabled and infra signal exists', () => {
    assert.equal(
      shouldAbortBatchOnInfraFailure(
        { stopOnInfraFailure: true } as any,
        { infraFailure: { kind: 'ollama_unreachable', message: 'x', source: 'run_log' } } as any
      ),
      true
    );
    assert.equal(
      shouldAbortBatchOnInfraFailure(
        { stopOnInfraFailure: false } as any,
        { infraFailure: { kind: 'ollama_unreachable', message: 'x', source: 'run_log' } } as any
      ),
      false
    );
    assert.equal(
      shouldAbortBatchOnInfraFailure(
        { stopOnInfraFailure: true } as any,
        { infraFailure: null } as any
      ),
      false
    );
  });

  it('decides auto-restart attempts only for continue mode and unreachable infra', () => {
    assert.equal(
      shouldAttemptOllamaAutoRestart({
        stopOnInfraFailure: false,
        autoRestartOnInfraFailure: true,
        maxInfraRestarts: 2,
        restartsUsed: 0,
        infraFailure: { kind: 'ollama_unreachable', message: 'x', source: 'run_log' },
        recoveryRecovered: false
      }),
      true
    );
    assert.equal(
      shouldAttemptOllamaAutoRestart({
        stopOnInfraFailure: true,
        autoRestartOnInfraFailure: true,
        maxInfraRestarts: 2,
        restartsUsed: 0,
        infraFailure: { kind: 'ollama_unreachable', message: 'x', source: 'run_log' },
        recoveryRecovered: false
      }),
      false
    );
    assert.equal(
      shouldAttemptOllamaAutoRestart({
        stopOnInfraFailure: false,
        autoRestartOnInfraFailure: true,
        maxInfraRestarts: 2,
        restartsUsed: 2,
        infraFailure: { kind: 'ollama_unreachable', message: 'x', source: 'run_log' },
        recoveryRecovered: false
      }),
      false
    );
    assert.equal(
      shouldAttemptOllamaAutoRestart({
        stopOnInfraFailure: false,
        autoRestartOnInfraFailure: true,
        maxInfraRestarts: 2,
        restartsUsed: 0,
        infraFailure: { kind: 'ollama_model_missing', message: 'x', source: 'run_log' },
        recoveryRecovered: false
      }),
      false
    );
  });

  it('resolves default restart commands by platform', () => {
    const winCmd = resolveOllamaRestartCommand('', 'win32');
    assert.match(winCmd, /taskkill \/IM ollama\.exe/i);
    const unixCmd = resolveOllamaRestartCommand('', 'linux');
    assert.match(unixCmd, /ollama serve/i);
  });

  it('waitForOllamaRecovery succeeds when probe eventually passes', async () => {
    let attempts = 0;
    const result = await waitForOllamaRecovery({
      baseUrl: 'http://localhost:11434',
      timeoutMs: 300,
      pollMs: 20,
      probe: async () => {
        attempts += 1;
        return attempts >= 3;
      }
    });
    assert.equal(result.recovered, true);
    assert.equal(result.attempts, 3);
  });

  it('waitForOllamaRecovery times out when probe never passes', async () => {
    const result = await waitForOllamaRecovery({
      baseUrl: 'http://localhost:11434',
      timeoutMs: 120,
      pollMs: 20,
      probe: async () => false
    });
    assert.equal(result.recovered, false);
    assert.ok(result.attempts >= 1);
  });
});
