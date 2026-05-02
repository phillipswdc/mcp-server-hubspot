/**
 * Shared response helpers for MCP tool handlers. Tools should produce a
 * uniform output shape so callers don't need per-tool error parsing.
 */
import { z } from "zod";
import {
  MAX_PROPERTIES_PER_REQUEST,
  MAX_RESPONSE_BYTES,
} from "../config/constants.js";

/**
 * Reusable zod schema for an optional `properties` argument on read tools.
 * Caps the array length to MAX_PROPERTIES_PER_REQUEST (Layer 1 protection).
 *
 * @param {string} description Free-form prefix for the property arg description
 */
export function optionalPropertiesArray(description) {
  return z
    .array(z.string())
    .max(MAX_PROPERTIES_PER_REQUEST)
    .optional()
    .describe(
      `${description} Hard cap of ${MAX_PROPERTIES_PER_REQUEST} entries per request — use list_properties to scope down if needed.`
    );
}

/**
 * Wrap a JSON-serializable object as an MCP text-content response.
 *
 * Layer 2 size guard: if the serialized response exceeds MAX_RESPONSE_BYTES,
 * refuse with a helpful error rather than silently truncating. Truncation
 * makes Claude think it has full data when it doesn't, which is worse than
 * an explicit "too large, scope it down" error.
 *
 * @param {unknown} obj
 * @returns {{ content: Array<{type: 'text', text: string}>, isError?: boolean }}
 */
export function jsonText(obj) {
  const text = JSON.stringify(obj, null, 2);
  const byteLength = Buffer.byteLength(text, "utf8");
  if (byteLength > MAX_RESPONSE_BYTES) {
    return errorText(
      new Error(
        `Response too large: ${byteLength} bytes (max ${MAX_RESPONSE_BYTES}). ` +
          `Reduce 'properties' (request fewer fields), lower 'limit' (request fewer results), ` +
          `or apply a tighter filter and try again. To inspect a specific large field, use get_full_value.`
      ),
      "response-too-large"
    );
  }
  return { content: [{ type: "text", text }] };
}

/**
 * Wrap a plain string as an MCP text-content response (non-error).
 * @param {string} text
 */
export function plainText(text) {
  return { content: [{ type: "text", text }] };
}

/**
 * Wrap an error as an MCP error response. Includes HTTP status when available
 * so the model can react differently to e.g. 404 vs 500.
 *
 * Special-cases tier-gated commerce features: when an error includes a
 * `featureName` hint and HubSpot returned 403/404, produce a clear "feature
 * not enabled on your tier" message with guidance, instead of the raw
 * HubSpot error.
 *
 * @param {unknown} err
 * @param {number|string} [status]
 * @param {string} [featureName] e.g. "orders", "subscriptions" — triggers
 *   tier-aware rephrasing on 403/404
 */
export function errorText(err, status, featureName) {
  const httpStatus = Number(status);
  if (
    featureName &&
    (httpStatus === 403 || httpStatus === 404)
  ) {
    return {
      content: [
        {
          type: "text",
          text:
            `${featureName} are not available on this HubSpot account ` +
            `(HubSpot returned ${httpStatus}). This feature typically requires ` +
            `Commerce Hub or an equivalent tier. Verify enablement in HubSpot ` +
            `(left nav → Commerce), or run check_feature_availability to see ` +
            `which commerce objects are accessible with your current token.`,
        },
      ],
      isError: true,
    };
  }
  return {
    content: [
      {
        type: "text",
        text: `HubSpot error (${status ?? "unknown"}): ${err?.message ?? String(err)}`,
      },
    ],
    isError: true,
  };
}

/** Extract a status-like field from a HubSpot SDK error, if present. */
export function statusOf(err) {
  return err?.code ?? err?.response?.status;
}
