/**
 * Prepared statements and helpers for the `result_cache` table.
 *
 * Holds two cache shapes:
 *   - `result_set`: full search/list results stored under a cache_id, with
 *     a sample + handle returned to the model so the bulk data never enters
 *     Claude's context unless explicitly queried via query_cache.
 *   - `property_value`: a single oversized HubSpot property value stored
 *     under a cache_id, with a preview returned in the response. Replaces
 *     truncation — full value is always retrievable via get_cached_value.
 */
import { db, nowMs } from "../index.js";
import { randomUUID, createHash } from "node:crypto";

// INSERT OR REPLACE because cache_ids are content-addressed (SHA-256 prefix
// of the payload). When the same content is cached again — most commonly when
// a stale expired row hasn't been swept yet — we want to seamlessly refresh
// the TTL on the existing row, not crash on PRIMARY KEY collision. Replace
// is the correct semantics: identical content → one row, refreshed timestamp.
const INSERT = db.prepare(`
  INSERT OR REPLACE INTO result_cache
    (cache_id, cache_type, tool_name, source_args, object_type, payload,
     result_count, byte_length, preview, created_at, expires_at, environment, session_id)
  VALUES
    (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
`);

const SELECT_BY_ID = db.prepare(`
  SELECT * FROM result_cache WHERE cache_id = ?
`);

const SELECT_ACTIVE = db.prepare(`
  SELECT cache_id, cache_type, tool_name, object_type, result_count,
         byte_length, created_at, expires_at, environment, session_id
  FROM result_cache
  WHERE expires_at > @now
    AND (@environment IS NULL OR environment = @environment)
    AND (@session_id IS NULL OR session_id = @session_id)
    AND (@cache_type IS NULL OR cache_type = @cache_type)
  ORDER BY created_at DESC
  LIMIT @limit
`);

const DELETE_BY_ID = db.prepare(`DELETE FROM result_cache WHERE cache_id = ?`);

const DELETE_EXPIRED = db.prepare(`
  DELETE FROM result_cache WHERE expires_at <= ?
`);

/**
 * Generate a content-addressed cache_id. Same content → same id, so identical
 * cached payloads naturally deduplicate. Falls back to UUID if hashing fails.
 *
 * @param {string} payload Already-stringified JSON
 * @returns {string} 16-char hex prefix or UUID
 */
export function newCacheId(payload) {
  try {
    const hash = createHash("sha256").update(payload).digest("hex");
    return `rc_${hash.slice(0, 16)}`;
  } catch {
    return `rc_${randomUUID()}`;
  }
}

/**
 * Insert a cache row.
 *
 * @param {object} row
 * @param {string} row.cache_id
 * @param {"result_set"|"property_value"} row.cache_type
 * @param {string|null} row.tool_name
 * @param {object|null} row.source_args
 * @param {string|null} row.object_type
 * @param {unknown} row.payload Already-serialized JSON string OR a value to stringify
 * @param {number|null} row.result_count
 * @param {number|null} row.byte_length
 * @param {string|null} row.preview
 * @param {number} row.expires_at Unix-ms
 * @param {string} row.environment
 * @param {string|null} row.session_id
 */
export function insertCache(row) {
  const payloadStr =
    typeof row.payload === "string" ? row.payload : JSON.stringify(row.payload);
  INSERT.run(
    row.cache_id,
    row.cache_type,
    row.tool_name ?? null,
    row.source_args ? JSON.stringify(row.source_args) : null,
    row.object_type ?? null,
    payloadStr,
    row.result_count ?? null,
    row.byte_length ?? Buffer.byteLength(payloadStr, "utf8"),
    row.preview ?? null,
    nowMs(),
    row.expires_at,
    row.environment,
    row.session_id ?? null
  );
}

/**
 * Read a cache row by id. Returns null if missing OR expired.
 *
 * @param {string} cacheId
 * @returns {object|null}
 */
export function getCache(cacheId) {
  const row = SELECT_BY_ID.get(cacheId);
  if (!row) return null;
  if (row.expires_at <= nowMs()) return null;
  return {
    ...row,
    source_args: row.source_args ? JSON.parse(row.source_args) : null,
  };
}

/**
 * List active (non-expired) cache rows with optional filters.
 *
 * @param {{ environment?: string|null, session_id?: string|null, cache_type?: string|null, limit?: number }} [filters]
 */
export function listActiveCaches(filters = {}) {
  const {
    environment = null,
    session_id = null,
    cache_type = null,
    limit = 100,
  } = filters;
  return SELECT_ACTIVE.all({
    now: nowMs(),
    environment,
    session_id,
    cache_type,
    limit,
  });
}

/**
 * Manually delete a cache row by id.
 * @param {string} cacheId
 * @returns {boolean} True if a row was deleted.
 */
export function deleteCache(cacheId) {
  const info = DELETE_BY_ID.run(cacheId);
  return info.changes > 0;
}

/**
 * Sweep expired rows. Called opportunistically on cache writes so the table
 * doesn't grow unbounded; no separate background job needed.
 *
 * @returns {number} rows deleted
 */
export function pruneExpired() {
  const info = DELETE_EXPIRED.run(nowMs());
  return info.changes;
}
