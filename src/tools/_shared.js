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
 * @param {unknown} err
 * @param {number|string} [status]
 */
export function errorText(err, status) {
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
