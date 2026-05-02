/**
 * Generic CRM object helpers — wrap `sdk.crm.objects.*` for object types that
 * don't have dedicated SDK modules (orders, invoices, subscriptions, payments,
 * carts, custom objects).
 *
 * The dedicated-SDK objects (contacts, companies, deals, tickets, products,
 * lineItems, quotes) keep using their own typed APIs. Anything else routes
 * through here using the generic objects/searchObjects endpoints with the
 * objectType passed explicitly.
 */
import { sdk } from "./client.js";
import { withRetry } from "./retry.js";
import { compact } from "./compact.js";
import { autoCacheLargeValues, maybeCacheResponse } from "./_cache.js";
import { buildSearchRequest, normalizeSearchResponse } from "./_search.js";
import { listAssociatedObjects } from "./_associations.js";

/**
 * Build a "shape function" for a given object_type. Used by callers to
 * construct domain-specific shapeX helpers without duplicating the auto-cache
 * boilerplate.
 *
 * @param {string} objectType
 */
export function makeShapeFn(objectType) {
  return function shape(res) {
    return (
      compact({
        id: res.id,
        properties: autoCacheLargeValues(res.properties, {
          object_type: objectType,
          object_id: res.id,
        }),
        createdAt: res.createdAt,
        updatedAt: res.updatedAt,
      }) ?? { id: res.id }
    );
  };
}

/**
 * Look up a single object by HubSpot internal ID via the generic objects API.
 *
 * @param {string} objectType
 * @param {string} objectId
 * @param {string[]} properties
 * @param {(res: object) => object} shape
 */
export async function getGenericObjectById(objectType, objectId, properties, shape) {
  const res = await withRetry(() =>
    sdk.crm.objects.basicApi.getById(objectType, objectId, properties)
  );
  return shape(res);
}

/**
 * Search a generic object type with the standard filter/sort/paginate input.
 * Honors the cache: true flag the same way as the dedicated-SDK searches.
 *
 * @param {string} objectType
 * @param {import("./_search.js").SearchInput} input
 * @param {readonly string[]} defaultProperties
 * @param {(res: object) => object} shape
 * @param {string} toolName For cache provenance
 */
export async function searchGenericObject(objectType, input, defaultProperties, shape, toolName) {
  const req = buildSearchRequest(input, defaultProperties);
  const res = await withRetry(() =>
    sdk.crm.objects.searchApi.doSearch(objectType, req)
  );
  // searchApi returns SimplePublicObject[]; rewrap them through our shape so
  // auto-cache fires per result.
  const shaped = (res?.results ?? []).map(shape);
  const response = {
    total: res?.total ?? shaped.length,
    count: shaped.length,
    next_cursor: res?.paging?.next?.after,
    results: shaped,
  };
  return maybeCacheResponse(response, {
    useCache: input?.cache === true,
    tool_name: toolName,
    source_args: input,
    object_type: objectType,
  });
}

/**
 * List most-recent objects (no filter, sort by hs_lastmodifieddate DESC).
 * Implemented via search since the basic list endpoint doesn't sort.
 *
 * @param {string} objectType
 * @param {{ properties?: string[], limit?: number, after?: string, cache?: boolean }} options
 * @param {readonly string[]} defaultProperties
 * @param {(res: object) => object} shape
 * @param {string} toolName
 */
export async function listRecentGenericObjects(
  objectType,
  options,
  defaultProperties,
  shape,
  toolName
) {
  return await searchGenericObject(
    objectType,
    {
      sorts: [{ propertyName: "hs_lastmodifieddate", direction: "DESCENDING" }],
      ...options,
    },
    defaultProperties,
    shape,
    toolName
  );
}

/**
 * List objects of `targetType` associated to a source object (any type).
 * Same two-step pattern as our existing listAssociatedObjects helper, but
 * uses the generic objects.batchApi for hydration so it works for objects
 * without dedicated SDK paths.
 *
 * @param {object} params
 * @param {string} params.sourceType
 * @param {string} params.sourceId
 * @param {string} params.targetType
 * @param {readonly string[]} params.defaultProperties
 * @param {(res: object) => object} params.shape
 * @param {{ properties?: string[], limit?: number, after?: string }} [params.options]
 */
export async function listAssociatedGenericObjects({
  sourceType,
  sourceId,
  targetType,
  defaultProperties,
  shape,
  options,
}) {
  return await listAssociatedObjects({
    sourceType,
    sourceId,
    targetType,
    // batchApi for the generic objects endpoint: pass objectType as first arg.
    batchApi: {
      read: ({ properties, propertiesWithHistory, inputs }) =>
        sdk.crm.objects.batchApi.read(targetType, {
          properties,
          propertiesWithHistory,
          inputs,
        }),
    },
    defaultProperties,
    shape,
    options,
  });
}

/**
 * SDK basic-API shim that routes the standard {getById, update, create, archive}
 * surface through the generic objects endpoint with objectType pre-bound. Used by
 * auditedUpdate / auditedCreate so they don't need to know whether they're
 * talking to a dedicated SDK or the generic one.
 *
 * @param {string} objectType
 */
export function genericBasicApi(objectType) {
  return {
    getById: (objectId, properties, ...rest) =>
      sdk.crm.objects.basicApi.getById(objectType, objectId, properties, ...rest),
    update: (objectId, body) =>
      sdk.crm.objects.basicApi.update(objectType, objectId, body),
    create: (body) => sdk.crm.objects.basicApi.create(objectType, body),
    archive: (objectId) => sdk.crm.objects.basicApi.archive(objectType, objectId),
  };
}
