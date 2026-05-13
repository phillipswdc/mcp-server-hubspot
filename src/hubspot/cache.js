/**
 * Public cache-domain methods: query a cached result_set, summarize, list,
 * expire, and dereference cached property values.
 *
 * Filters/sorts on cached result_sets use SQLite's JSON1 functions
 * (`json_extract`) — fast, indexed, and avoids re-parsing the payload into
 * memory for every tool call.
 */
import { db } from "../db/index.js";
import {
  getCache,
  listActiveCaches,
  deleteCache,
} from "../db/queries/result_cache.js";
import { cacheResultSet } from "./_cache.js";

/**
 * Dereference a cached property value (cache_type='property_value'). Returns
 * the full string value plus metadata. Used by the get_cached_value tool.
 *
 * @param {string} cacheId
 * @returns {{ value: string, byte_length: number, object_type: string|null, object_id: string|null, property_name: string|null, expires_at: number }|null}
 */
export function getCachedValue(cacheId) {
  const row = getCache(cacheId);
  if (!row) return null;
  if (row.cache_type !== "property_value") {
    throw new Error(
      `Cache ${cacheId} is type "${row.cache_type}", not "property_value". Use query_cache for result_set caches.`
    );
  }
  const args = row.source_args ?? {};
  return {
    value: row.payload,
    byte_length: row.byte_length,
    object_type: args.object_type ?? null,
    object_id: args.object_id ?? null,
    property_name: args.property_name ?? null,
    expires_at_iso: new Date(row.expires_at).toISOString(),
  };
}

/**
 * Summarize a cached result_set — counts, schema overview, distinct values
 * for enum-shaped properties. Useful before a full query_cache to know what's
 * inside.
 *
 * @param {string} cacheId
 */
export function cacheSummary(cacheId) {
  const row = getCache(cacheId);
  if (!row) throw new Error(`Cache ${cacheId} not found or expired`);
  if (row.cache_type !== "result_set") {
    throw new Error(`Cache ${cacheId} is type "${row.cache_type}", not "result_set"`);
  }

  const propertyKeyCounts = db
    .prepare(
      `
      SELECT key, COUNT(*) as count
      FROM result_cache, json_tree(result_cache.payload, '$')
      WHERE cache_id = ? AND parent IS NOT NULL AND type != 'object' AND type != 'array'
      GROUP BY key
      ORDER BY count DESC
      LIMIT 50
    `
    )
    .all(cacheId);

  return {
    cache_id: cacheId,
    cache_type: row.cache_type,
    object_type: row.object_type,
    result_count: row.result_count,
    byte_length: row.byte_length,
    created_at_iso: new Date(row.created_at).toISOString(),
    expires_at_iso: new Date(row.expires_at).toISOString(),
    source_args: row.source_args,
    field_frequency: propertyKeyCounts,
  };
}

/**
 * Query a cached result_set with optional filters, sort, and pagination.
 * Filters operate on `properties.<field>` paths via json_extract.
 *
 * @param {string} cacheId
 * @param {object} options
 * @param {Array<{propertyName: string, operator: string, value: unknown}>} [options.filters]
 * @param {Array<{propertyName: string, direction?: 'ASCENDING'|'DESCENDING'}>} [options.sorts]
 * @param {string[]} [options.properties] Fields to return per result; defaults to all
 * @param {number} [options.limit]
 * @param {number} [options.offset]
 */
export function queryCache(cacheId, options = {}) {
  const row = getCache(cacheId);
  if (!row) throw new Error(`Cache ${cacheId} not found or expired`);
  if (row.cache_type !== "result_set") {
    throw new Error(`Cache ${cacheId} is type "${row.cache_type}", not "result_set"`);
  }

  // We deserialize the array once and run filters/sorts in-memory. SQLite's
  // JSON1 path is faster for very large sets, but parsing once is simpler and
  // bounded by our cache size limits.
  /** @type {object[]} */
  const all = JSON.parse(row.payload);

  let filtered = all;
  if (options.filters && options.filters.length) {
    filtered = filtered.filter((entity) =>
      options.filters.every((f) => evaluateFilter(entity, f))
    );
  }

  if (options.sorts && options.sorts.length) {
    filtered = [...filtered].sort((a, b) =>
      compareEntities(a, b, options.sorts)
    );
  }

  const total = filtered.length;
  const offset = options.offset ?? 0;
  const limit = options.limit ?? 10;
  const page = filtered.slice(offset, offset + limit);

  const projected = options.properties?.length
    ? page.map((e) => projectFields(e, options.properties))
    : page;

  return {
    cache_id: cacheId,
    total,
    count: projected.length,
    offset,
    limit,
    next_offset: offset + projected.length < total ? offset + projected.length : null,
    results: projected,
  };
}

/**
 * List active (non-expired) caches. Defaults to current environment + session
 * for relevance.
 *
 * @param {{ environment?: string, session_id?: string, cache_type?: string, current_session_only?: boolean, limit?: number }} [filters]
 */
export function listCaches(filters = {}) {
  return listActiveCaches(filters);
}

/**
 * Manually delete a cache row.
 * @param {string} cacheId
 */
export function expireCache(cacheId) {
  return deleteCache(cacheId);
}

/**
 * Concatenate N result_set caches into a new combined cache. Designed for
 * fan-in workflows — e.g. enrichment that chunked a 1k-record set into 11
 * batches of 100 via search IN-filter, producing 11 cache_ids; merge_caches
 * collapses them into one queryable set.
 *
 * Validation: every input cache_id must exist, be non-expired, and be
 * cache_type='result_set'. Property-value caches and missing/expired IDs
 * fail the call with a clear error before any work is done.
 *
 * Deduplication: by default rows with the same `id` field are deduped
 * (first occurrence wins). Pass dedupe_by_id=false to keep duplicates,
 * which is the right call when intentional N-times-the-same-record
 * patterns are present.
 *
 * Object-type metadata: when all input caches share an object_type, the
 * merged cache inherits it. Mixed types get null (still queryable, just
 * loses that bit of provenance).
 *
 * @param {object} args
 * @param {string[]} args.cache_ids Two or more cache_ids to merge.
 * @param {boolean} [args.dedupe_by_id=true] Drop duplicates by entity.id.
 * @returns {{ cache_id: string, count: number, sources: object[], deduped: number, expires_at_iso: string, byte_length: number }}
 */
export function mergeCaches({ cache_ids, dedupe_by_id = true }) {
  if (!Array.isArray(cache_ids) || cache_ids.length < 2) {
    throw new Error("merge_caches requires at least 2 cache_ids.");
  }

  const loaded = [];
  for (const id of cache_ids) {
    const row = getCache(id);
    if (!row) {
      throw new Error(`Cache ${id} not found or expired.`);
    }
    if (row.cache_type !== "result_set") {
      throw new Error(
        `Cache ${id} is type "${row.cache_type}", not "result_set". Only result_set caches can be merged.`
      );
    }
    loaded.push(row);
  }

  const combined = [];
  const seenIds = new Set();
  let deduped = 0;
  for (const row of loaded) {
    const parsed = JSON.parse(row.payload);
    if (!Array.isArray(parsed)) continue;
    for (const entity of parsed) {
      if (dedupe_by_id && entity?.id != null) {
        const key = String(entity.id);
        if (seenIds.has(key)) {
          deduped += 1;
          continue;
        }
        seenIds.add(key);
      }
      combined.push(entity);
    }
  }

  const objectTypes = new Set(loaded.map((r) => r.object_type).filter(Boolean));
  const objectType = objectTypes.size === 1 ? [...objectTypes][0] : null;

  const handle = cacheResultSet({
    tool_name: "merge_caches",
    source_args: { source_cache_ids: cache_ids, dedupe_by_id },
    object_type: objectType,
    results: combined,
  });

  return {
    cache_id: handle.cache_id,
    cache_type: "result_set",
    object_type: objectType,
    count: combined.length,
    deduped,
    expires_at_iso: new Date(handle.expires_at).toISOString(),
    byte_length: handle.byte_length,
    sources: loaded.map((r) => ({
      cache_id: r.cache_id,
      object_type: r.object_type,
      result_count: r.result_count,
      tool_name: r.tool_name,
    })),
    next_steps:
      "Use query_cache(cache_id) against the merged set to filter/sort across the full union.",
  };
}

// --- Internal helpers ---

/**
 * Evaluate a single filter against an entity.
 * @param {object} entity
 * @param {{ propertyName: string, operator: string, value?: unknown, values?: unknown[], highValue?: unknown }} filter
 */
function evaluateFilter(entity, filter) {
  const propVal = entity?.properties?.[filter.propertyName];
  const op = filter.operator;
  const v = filter.value;
  switch (op) {
    case "EQ":
      return String(propVal ?? "") === String(v ?? "");
    case "NEQ":
      return String(propVal ?? "") !== String(v ?? "");
    case "LT":
      return numeric(propVal) < numeric(v);
    case "LTE":
      return numeric(propVal) <= numeric(v);
    case "GT":
      return numeric(propVal) > numeric(v);
    case "GTE":
      return numeric(propVal) >= numeric(v);
    case "BETWEEN":
      return (
        numeric(propVal) >= numeric(v) &&
        numeric(propVal) <= numeric(filter.highValue)
      );
    case "IN":
      return (filter.values ?? []).map(String).includes(String(propVal ?? ""));
    case "NOT_IN":
      return !(filter.values ?? []).map(String).includes(String(propVal ?? ""));
    case "HAS_PROPERTY":
      return propVal !== null && propVal !== undefined && propVal !== "";
    case "NOT_HAS_PROPERTY":
      return propVal === null || propVal === undefined || propVal === "";
    case "CONTAINS_TOKEN":
      return String(propVal ?? "").toLowerCase().includes(String(v ?? "").toLowerCase());
    case "NOT_CONTAINS_TOKEN":
      return !String(propVal ?? "").toLowerCase().includes(String(v ?? "").toLowerCase());
    default:
      throw new Error(`Unsupported filter operator in query_cache: ${op}`);
  }
}

function numeric(v) {
  const n = Number(v);
  return Number.isFinite(n) ? n : NaN;
}

/**
 * Compare two entities by an ordered list of sort specs.
 */
function compareEntities(a, b, sorts) {
  for (const s of sorts) {
    const av = a?.properties?.[s.propertyName] ?? null;
    const bv = b?.properties?.[s.propertyName] ?? null;
    let cmp;
    if (av == null && bv == null) cmp = 0;
    else if (av == null) cmp = 1;
    else if (bv == null) cmp = -1;
    else cmp = String(av).localeCompare(String(bv));
    if (s.direction === "DESCENDING") cmp = -cmp;
    if (cmp !== 0) return cmp;
  }
  return 0;
}

/** Limit each entity to the requested property names. */
function projectFields(entity, properties) {
  const props = entity?.properties ?? {};
  const out = {};
  for (const k of properties) {
    if (k in props) out[k] = props[k];
  }
  return { id: entity.id, properties: out };
}
