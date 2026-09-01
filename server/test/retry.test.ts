import { describe, expect, it } from 'vitest';
import { HttpError } from '../src/core/errors.js';
import { isRetryableProviderError } from '../src/modules/llm/retry.js';

describe('isRetryableProviderError', () => {
  it('retries mid-stream provider blips and gateway statuses', () => {
    expect(
      isRetryableProviderError(new HttpError(502, 'Provider unavailable mid-stream; client should retry')),
    ).toBe(true);
    expect(isRetryableProviderError(new HttpError(429, 'rate limit'))).toBe(true);
    expect(isRetryableProviderError(new HttpError(503, 'overloaded'))).toBe(true);
    expect(isRetryableProviderError(new Error('fetch failed'))).toBe(true);
  });

  it('does not retry auth, validation or abort', () => {
    expect(isRetryableProviderError(new HttpError(400, 'invalid temperature'))).toBe(false);
    expect(isRetryableProviderError(new HttpError(401, 'unauthorized'))).toBe(false);
    const abort = new Error('aborted');
    abort.name = 'AbortError';
    expect(isRetryableProviderError(abort)).toBe(false);
  });

  it('does not retry an empty wallet even when the status is 429', () => {
    expect(
      isRetryableProviderError(
        new HttpError(
          429,
          'LLM request failed (429): {"error":{"type":"insufficient_balance","message":"Estimated request cost 387 exceeds available balance 257"}}',
        ),
      ),
    ).toBe(false);
  });
});

describe('обрывы соединения', () => {
  it('считает повторяемыми ошибки undici при разрыве потока', () => {
    // These killed three bench runs on their first call before being listed.
    for (const message of [
      'terminated',
      'Premature close',
      'other side closed',
      'UND_ERR_SOCKET',
      'read ECONNRESET',
    ]) {
      expect(isRetryableProviderError(new Error(message))).toBe(true);
    }
  });

  it('по-прежнему не повторяет то, что повтором не лечится', () => {
    expect(isRetryableProviderError(new Error('insufficient_balance'))).toBe(false);
    const aborted = new Error('terminated');
    aborted.name = 'AbortError';
    expect(isRetryableProviderError(aborted)).toBe(false);
  });
});
