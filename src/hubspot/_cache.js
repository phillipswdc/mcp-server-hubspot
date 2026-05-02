/**
 * Result-cache helpers for two distinct flows:
 *
 * 1. Auto-cache for large field values: walks an entity's properties dict,
 *    detects values exceeding AUTO_CACHE_VALUE_BYTES, stores them in
 *    result_cache, and replaces them in-place with a __cached_ref handle.
 *    Used by shape functions (shapeContact, shapeDeal, etc.) so large notes
 *    fields never enter Claude's context unless explicitly dereferenced.
 *
 * 2. Result-set caching: stores a full search/list result under a cache_id
 *    and returns a small handle. Used by search/list tools when the caller
 *    passes `cache: true`.
 *
 * Audit storage NEVER goes through caching — audit_log captures full values
 * for forensics and rollback fidelity.
 */
import {
  insertCache,
  newCacheId,
  pruneExpired,
} from "../db/queries/result_cache.js";
import {
  AUTO_CACHE_VALUE_BYTES,
  RESULT_CACHE_TTL_MS,
  CACHE_PREVIEW_CHARS,
} from "../config/constants.js";
import { env } from "../config/env.js";

/**
 * Walk a HubSpot `properties` dict, replacing any string value that exceeds
 * AUTO_CACHE_VALUE_BYTES with a cached_ref handle.
 *
 * Returns a new dict — does not mutate input. Non-string values pass through
 * unchanged. Cached refs include a preview so the model can reason from the
 * leading content without dereferencing.
 *
 * @param {Record<string,unknown>|null|undefined} properties
 * @param {{ object_type?: string, object_id?: string, ttlMs?: number }} [context]
 * @returns {Record<string,unknown>|null|undefined}
 */
export function autoCacheLargeValues(properties, context = {}) {
  if (!properties || typeof properties !== "object") return properties;

  const { object_type, object_id, ttlMs = RESULT_CACHE_TTL_MS } = context;
  const out = {};
  let didCache = false;

  for (const [key, value] of Object.entries(properties)) {
    if (typeof value !== "string") {
      out[key] = value;
      continue;
    }
    const byteLen = Buffer.byteLength(value, "utf8");
    if (byteLen <= AUTO_CACHE_VALUE_BYTES) {
      out[key] = value;
      continue;
    }

    const cacheId = newCacheId(value);
    const preview =
      value.slice(0, CACHE_PREVIEW_CHARS) +
      (value.length > CACHE_PREVIEW_CHARS ? "…" : "");

    insertCache({
      cache_id: cacheId,
      cache_type: "property_value",
      tool_name: null,
      source_args: { object_type, object_id, property_name: key },
      object_type: object_type ?? null,
      payload: value,
      result_count: null,
      byte_length: byteLen,
      preview,
      expires_at: Date.now() + ttlMs,
      environment: env.name,
      session_id: env.sessionId,
    });

    out[key] = {
      __cached_ref: cacheId,
      preview,
      byte_length: byteLen,
      retrieve_with: `get_cached_value(cache_id="${cacheId}")`,
    };
    didCache = true;
  }

  // Opportunistic eviction of expired rows — no background job needed.
  if (didCache) pruneExpired();
  return out;
}

/**
 * Cache a complete search/list result-set and return a handle the model can
 * query later via query_cache. The full payload is stored as JSON; tools like
 * query_cache use SQLite JSON1 functions to filter/sort without rehydrating
 * everything into memory.
 *
 * @param {object} params
 * @param {string} params.tool_name
 * @param {object} params.source_args Original tool arguments — useful when
 *   debugging or repro-ing a query later
 * @param {string} params.object_type
 * @param {object[]} params.results Array of shaped entities (the `results` field
 *   from a search response)
 * @param {number} [params.ttlMs]
 * @returns {{ cache_id: string, expires_at: number, byte_length: number }}
 */
export function cacheResultSet({
  tool_name,
  source_args,
  object_type,
  results,
  ttlMs = RESULT_CACHE_TTL_MS,
}) {
  const payload = JSON.stringify(results);
  const byteLength = Buffer.byteLength(payload, "utf8");
  const cacheId = newCacheId(payload);
  const expiresAt = Date.now() + ttlMs;

  insertCache({
    cache_id: cacheId,
    cache_type: "result_set",
    tool_name,
    source_args,
    object_type,
    payload,
    result_count: results.length,
    byte_length: byteLength,
    preview: null,
    expires_at: expiresAt,
    environment: env.name,
    session_id: env.sessionId,
  });
  pruneExpired();

  return { cache_id: cacheId, expires_at: expiresAt, byte_length: byteLength };
}

/**
 * Wrap a search/list response with optional caching. When `useCache` is true,
 * the full results array is stored under a cache_id and the returned shape
 * gives the model a handle + a small sample instead of the full payload —
 * preventing context bloat on bulk queries.
 *
 * When `useCache` is false (the default), passes the response through.
 *
 * @param {{ total: number, count: number, next_cursor?: string, results: object[] }} response
 * @param {object} ctx
 * @param {boolean} ctx.useCache
 * @param {string} ctx.tool_name
 * @param {object} ctx.source_args
 * @param {string} ctx.object_type
 * @param {number} [ctx.sampleSize]
 * @returns {object}
 */
export function maybeCacheResponse(response, ctx) {
  if (!ctx.useCache) return response;
  const sampleSize = ctx.sampleSize ?? 3;
  const handle = cacheResultSet({
    tool_name: ctx.tool_name,
    source_args: ctx.source_args,
    object_type: ctx.object_type,
    results: response.results ?? [],
  });
  return {
    cache_id: handle.cache_id,
    cache_type: "result_set",
    object_type: ctx.object_type,
    total: response.total,
    count: response.count,
    next_cursor: response.next_cursor,
    expires_at_iso: new Date(handle.expires_at).toISOString(),
    byte_length: handle.byte_length,
    sample: (response.results ?? []).slice(0, sampleSize),
    available_properties: collectPropertyKeys(response.results ?? []),
    next_steps:
      "Use query_cache(cache_id) to filter/sort/paginate against the cached set without re-fetching from HubSpot.",
  };
}

/**
 * Collect the distinct set of property names across an array of cached
 * entities so the model knows what fields are queryable via query_cache.
 */
function collectPropertyKeys(entities) {
  const set = new Set();
  for (const e of entities) {
    if (e?.properties) {
      for (const k of Object.keys(e.properties)) set.add(k);
    }
  }
  return [...set].sort();
}
