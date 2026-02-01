import logger from './logger';

interface RetryOptions {
  maxAttempts: number;
  delayMs: number;
  backoffMultiplier?: number;
  maxDelayMs?: number;
}

export async function withRetry<T>(
  fn: () => Promise<T>,
  options: RetryOptions
): Promise<T> {
  const {
    maxAttempts,
    delayMs,
    backoffMultiplier = 2,
    maxDelayMs = 30000
  } = options;

  let lastError: Error | undefined;
  let currentDelay = delayMs;

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      return await fn();
    } catch (error) {
      lastError = error instanceof Error ? error : new Error(String(error));

      if (attempt === maxAttempts) {
        logger.error(`All ${maxAttempts} retry attempts failed`, {
          error: lastError.message
        });
        throw lastError;
      }

      const jitter = Math.random() * (currentDelay * 0.1);
      const waitTime = Math.min(currentDelay + jitter, maxDelayMs);

      logger.warn(`Attempt ${attempt}/${maxAttempts} failed, retrying in ${Math.round(waitTime)}ms`, {
        error: lastError.message
      });

      await sleep(waitTime);
      currentDelay *= backoffMultiplier;
    }
  }

  throw lastError;
}

function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}
