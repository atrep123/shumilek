import { strict as assert } from 'assert';

import { isRetriableOllamaRequestError } from '../scripts/botEval';

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
  });

  it('marks retriable HTTP statuses as retriable', () => {
    assert.equal(isRetriableOllamaRequestError('Ollama HTTP 503: service unavailable'), true);
    assert.equal(isRetriableOllamaRequestError('Ollama HTTP 429: too many requests'), true);
  });

  it('does not retry non-transient validation/protocol errors', () => {
    assert.equal(isRetriableOllamaRequestError('Ollama HTTP 400: unknown field "format"'), false);
    assert.equal(isRetriableOllamaRequestError('Model output is not valid JSON'), false);
  });
});
