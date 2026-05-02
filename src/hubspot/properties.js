/**
 * Property definition lookups with SQLite-backed cache.
 *
 * HubSpot property definitions change rarely; caching them avoids hammering
 * the API for what is effectively static metadata. Cache TTL is configurable
 * per call but defaults to PROPERTY_CACHE_TTL_MS.
 */
import { sdk } from "./client.js";
import { withRetry } from "./retry.js";
import {
  readFreshProperties,
  readFreshProperty,
  writeProperties,
} from "../db/queries/schemas.js";
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
