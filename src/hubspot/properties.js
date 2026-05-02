/**
 * Property definition lookups with SQLite-backed cache.
 *
 * HubSpot property definitions change rarely; caching them avoids hammering
 * the API for what is effectively static metadata. Cache TTL is configurable
 * per call but defaults to PROPERTY_CACHE_TTL_MS.
 */
import { sdk } from "./client.js";
import { withRetry } from "./retry.js";
import { env } from "../config/env.js";
import {
  readFreshProperties,
  readFreshProperty,
  writeProperties,
} from "../db/queries/schemas.js";
import { insertAudit } from "../db/queries/audit.js";
import {
  PROPERTY_CACHE_TTL_MS,
  SUPPORTED_OBJECT_TYPES,
} from "../config/constants.js";

/**
 * Throw if `objectType` isn't one this server supports.
 * @param {string} objectType
 */
function assertObjectType(objectType) {
  if (!SUPPORTED_OBJECT_TYPES.includes(objectType)) {
    throw new Error(
      `Unsupported object_type "${objectType}". Supported: ${SUPPORTED_OBJECT_TYPES.join(", ")}`
    );
  }
}

/**
 * Fetch all properties for an object type from HubSpot and persist to cache.
 * @param {string} objectType
 * @returns {Promise<object[]>}
 */
async function fetchAndCacheProperties(objectType) {
  const res = await withRetry(() =>
    sdk.crm.properties.coreApi.getAll(objectType, false)
  );
  const props = res.results ?? [];
  writeProperties(objectType, props);
  return props;
}

/**
 * List all property definitions for an object type. Returns cached values when
 * fresh; otherwise refreshes from HubSpot.
 *
 * @param {"contacts"|"companies"|"deals"|"tickets"} objectType
 * @param {{ ttlMs?: number }} [options]
 * @returns {Promise<object[]>}
 */
export async function listProperties(objectType, { ttlMs = PROPERTY_CACHE_TTL_MS } = {}) {
  assertObjectType(objectType);
  const cached = readFreshProperties(objectType, ttlMs);
  if (cached.length) return cached;
  return await fetchAndCacheProperties(objectType);
}

/**
 * Get a single property definition by name. If absent or stale, refreshes the
 * full set rather than fetching one — single-property lookups would otherwise
 * N+1 the HubSpot API.
 *
 * @param {"contacts"|"companies"|"deals"|"tickets"} objectType
 * @param {string} propertyName
 * @param {{ ttlMs?: number }} [options]
 * @returns {Promise<object|null>}
 */
export async function getProperty(
  objectType,
  propertyName,
  { ttlMs = PROPERTY_CACHE_TTL_MS } = {}
) {
  assertObjectType(objectType);
  const cached = readFreshProperty(objectType, propertyName, ttlMs);
  if (cached) return cached;
  const all = await fetchAndCacheProperties(objectType);
  return all.find((p) => p.name === propertyName) ?? null;
}

/**
 * Create a new custom property on a HubSpot object type.
 *
 * Records the creation as an audit_log row tagged with the object_type and
 * the new property's name as object_id. Phase 3a-style rollback (via
 * rollback_change) is NOT yet supported for property mutations — that
 * would require teaching rollbackChange how to archive properties; see the
 * tool description for how to undo a created property manually.
 *
 * After creating, invalidates the local property cache so subsequent
 * `list_properties`/`get_property` calls see the new schema.
 *
 * @param {"contacts"|"companies"|"deals"|"tickets"|"orders"|"line_items"|"products"|"quotes"|"invoices"|"subscriptions"|"payments"|"carts"} objectType
 * @param {object} definition HubSpot property definition. Required:
 *   name, label, type, fieldType, groupName. For type=enumeration: options.
 * @param {{ confirmProduction?: boolean }} [options]
 * @returns {Promise<{ result: object, audit_id: number }>}
 */
export async function createProperty(objectType, definition, options = {}) {
  assertObjectType(objectType);

  // Production guard: same defense-in-depth as other mutation tools.
  if (env.isProduction && options.confirmProduction !== true) {
    const err = new Error(
      `Production environment guard: create_property requires \`confirm_production: true\`. Defense-in-depth on top of Claude Desktop's per-call approval.`
    );
    err.code = "PRODUCTION_CONFIRM_REQUIRED";
    throw err;
  }

  let result = null;
  let error = null;
  let success = false;
  try {
    result = await withRetry(() =>
      sdk.crm.properties.coreApi.create(objectType, definition)
    );
    success = true;
  } catch (err) {
    error = err;
  }

  // Audit row written whether or not the underlying API call succeeded.
  // Property name as object_id; new_values is the created property
  // definition; old_values is null (didn't exist before).
  const audit_id = insertAudit({
    environment: env.name,
    session_id: env.sessionId,
    tool_name: "create_property",
    object_type: objectType,
    object_id: definition?.name ?? null,
    operation: "create",
    old_values: null,
    new_values: success ? { property: result } : null,
    changed_fields: null,
    args: { object_type: objectType, definition },
    success,
    error: error ? String(error?.message ?? error) : null,
    last_modified_at: null,
    rollback_audit_id: null,
  });

  if (!success) {
    throw Object.assign(error ?? new Error("HubSpot property create failed"), {
      audit_id,
    });
  }

  // Invalidate the property cache so subsequent reads see the new property.
  // Cheapest correct invalidation: refresh the full set for this object type.
  await fetchAndCacheProperties(objectType);

  return { result, audit_id };
}
