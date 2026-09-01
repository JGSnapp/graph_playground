import { HttpError } from '../../core/errors.js';

const RETRYABLE_STATUS = new Set([408, 409, 425, 429, 500, 502, 503, 504]);

const RETRYABLE_MESSAGE =
  /mid-stream|client should retry|provider unavailable|temporar(?:y|ily)|timeout|timed out|ECONNRESET|ECONNREFUSED|ETIMEDOUT|fetch failed|socket hang up|network|overloaded|rate.?limit|503|502|504/i;

const NON_RETRYABLE_MESSAGE =
  /insufficient_balance|exceeds available balance|payment.?required|quota exceeded/i;

/** Transient provider failures that are safe to retry with a fresh request. */
export const isRetryableProviderError = (error: unknown): boolean => {
  const message = error instanceof Error ? error.message : String(error);
  if (NON_RETRYABLE_MESSAGE.test(message)) return false;
  if (error instanceof HttpError) {
    if (RETRYABLE_STATUS.has(error.status)) return true;
    return RETRYABLE_MESSAGE.test(error.message);
  }
  if (error instanceof Error) {
    if (error.name === 'AbortError') return false;
    return RETRYABLE_MESSAGE.test(error.message);
  }
  return RETRYABLE_MESSAGE.test(String(error));
};

export const retryDelayMs = (attempt: number): number => {
  // attempt is 1-based after the first failure: 400ms, 800ms, 1600ms…
  const base = Math.min(4_000, 400 * 2 ** (attempt - 1));
  const jitter = Math.floor(Math.random() * 200);
  return base + jitter;
};

export const sleep = (ms: number, signal?: AbortSignal): Promise<void> =>
  new Promise((resolve, reject) => {
    if (signal?.aborted) {
      reject(new Error('aborted'));
      return;
    }
    const timer = setTimeout(resolve, ms);
    const onAbort = () => {
      clearTimeout(timer);
      reject(new Error('aborted'));
    };
    signal?.addEventListener('abort', onAbort, { once: true });
  });
