/**
 * Retry helper for HubSpot 429 (rate-limit) responses.
 *
 * HubSpot's API enforces ~100 requests / 10 seconds for most tiers. The SDK
 * doesn't retry by default, so every wrapped call routes through here.
 */
import { DEFAULT_RETRY_ATTEMPTS } from "../config/constants.js";

/**
 * Execute `fn`, retrying on HTTP 429 up to `retries` times. The wait between
 * attempts honors the server's `Retry-After` header (seconds), defaulting to 1s.
 *
 * @template T
 * @param {() => Promise<T>} fn
 * @param {number} [retries]
 * @returns {Promise<T>}
 */
export async function withRetry(fn, retries = DEFAULT_RETRY_ATTEMPTS) {
  try {
    return await fn();
  } catch (err) {
    const status = err?.code ?? err?.response?.status;
    if (status === 429 && retries > 0) {
      const retryAfterSec = Number(err?.response?.headers?.["retry-after"] ?? 1);
      await sleep(retryAfterSec * 1000);
      return withRetry(fn, retries - 1);
    }
    throw err;
  }
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
