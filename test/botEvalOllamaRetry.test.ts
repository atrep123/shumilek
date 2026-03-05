import { strict as assert } from 'assert';

import {
  computeOllamaPerAttemptTimeoutMs,
  extractOllamaModelNames,
  isOllamaModelAvailable,
  isRetriableOllamaRequestError,
  shouldRetryOllamaRequest
} from '../scripts/botEval';

describe('botEval Ollama retry classification', () => {
  it('marks transient network errors as retriable', () => {
    assert.equal(
      isRetriableOllamaRequestError('request to http://127.0.0.1:11434/api/generate failed, reason: connect EADDRINUSE 127.0.0.1:11434'),
      true
    );
    assert.equal(
      isRetriableOllamaRequestError('request to http://127.0.0.1:11434/api/chat failed, reason: read ECONNRESET'),
      true
    );
    assert.equal(
      isRetriableOllamaRequestError('request to http://localhost:11434/api/generate failed, reason: '),
      true
    );
    assert.equal(
      isRetriableOllamaRequestError('AbortError: The operation was aborted'),
      true
    );
    assert.equal(
      isRetriableOllamaRequestError('socket hang up'),
      true
    );
    assert.equal(
      isRetriableOllamaRequestError('Structured chat failed: The user aborted a request.'),
      true
    );
  });

  it('marks retriable HTTP statuses as retriable', () => {
    assert.equal(isRetriableOllamaRequestError('Ollama HTTP 503: service unavailable'), true);
    assert.equal(isRetriableOllamaRequestError('Ollama HTTP 429: too many requests'), true);
  });

  it('does not retry non-transient validation/protocol errors', () => {
    assert.equal(isRetriableOllamaRequestError('Ollama HTTP 400: unknown field "format"'), false);
    assert.equal(isRetriableOllamaRequestError('Model output is not valid JSON'), false);
  });

  it('splits timeout budget across retry attempts to keep total wall-time bounded', () => {
    const perAttemptLarge = computeOllamaPerAttemptTimeoutMs(600_000);
    assert.ok(perAttemptLarge > 0);
    assert.ok(perAttemptLarge < 600_000);

    const perAttemptSmall = computeOllamaPerAttemptTimeoutMs(2_000);
    assert.equal(perAttemptSmall, 5_000);
  });

  it('disables retries for long-generation calls to avoid retry amplification', () => {
    assert.equal(shouldRetryOllamaRequest(60_000), true);
    assert.equal(shouldRetryOllamaRequest(90_000), false);
    assert.equal(shouldRetryOllamaRequest(120_000), false);
    assert.equal(shouldRetryOllamaRequest(180_000), false);
    assert.equal(shouldRetryOllamaRequest(600_000), false);
  });
});

describe('botEval Ollama preflight helpers', () => {
  it('extracts model names from /api/tags payload', () => {
    const names = extractOllamaModelNames({
      models: [
        { name: 'deepseek-coder-v2:16b', model: 'deepseek-coder-v2:16b-q4_K_M' },
        { name: 'qwen2.5-coder:32b', model: 'qwen2.5-coder:32b' },
      ]
    });
    assert.deepEqual(names, [
      'deepseek-coder-v2:16b',
      'deepseek-coder-v2:16b-q4_K_M',
      'qwen2.5-coder:32b'
    ]);
  });

  it('matches models by exact name or base name', () => {
    const available = ['qwen2.5-coder:32b', 'deepseek-coder-v2:16b-q4_K_M'];
    assert.equal(isOllamaModelAvailable('qwen2.5-coder:32b', available), true);
    assert.equal(isOllamaModelAvailable('qwen2.5-coder', available), true);
    assert.equal(isOllamaModelAvailable('deepseek-coder-v2:16b', available), true);
    assert.equal(isOllamaModelAvailable('llama3.1:8b', available), false);
  });
});
