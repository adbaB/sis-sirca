import { Logger } from '@nestjs/common';

export interface RetryOptions {
  maxAttempts?: number;
  backoffMs?: number;
  exponential?: boolean;
  jitter?: boolean;
  shouldRetry?: (error: unknown) => boolean;
  taskName?: string;
}

const logger = new Logger('RetryUtil');

/**
 * Executes an async operation with automatic retry, exponential backoff, and optional jitter.
 */
export async function withRetry<T>(fn: () => Promise<T>, options: RetryOptions = {}): Promise<T> {
  const maxAttempts = options.maxAttempts ?? 3;
  const backoffMs = options.backoffMs ?? 1000;
  const exponential = options.exponential ?? true;
  const jitter = options.jitter ?? true;
  const taskName = options.taskName ?? 'Operation';

  let lastError: unknown;

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      return await fn();
    } catch (error) {
      lastError = error;

      if (options.shouldRetry && !options.shouldRetry(error)) {
        throw error;
      }

      if (attempt === maxAttempts) {
        logger.error(
          `[${taskName}] Exceeded max retry attempts (${maxAttempts}). Last error: ${
            error instanceof Error ? error.message : String(error)
          }`,
        );
        throw error;
      }

      let delay = exponential ? backoffMs * Math.pow(2, attempt - 1) : backoffMs;

      if (jitter) {
        const jitterFactor = 0.8 + Math.random() * 0.4; // 80% to 120%
        delay = Math.round(delay * jitterFactor);
      }

      logger.warn(
        `[${taskName}] Attempt ${attempt}/${maxAttempts} failed: ${
          error instanceof Error ? error.message : String(error)
        }. Retrying in ${delay}ms...`,
      );

      await new Promise((resolve) => setTimeout(resolve, delay));
    }
  }

  throw lastError;
}
