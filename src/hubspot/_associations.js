/**
 * Generic "list associated objects" pattern.
 *
 * Every "list deals/tickets/contacts for company/contact/etc." call follows
 * the same two-step shape:
 *   1. v4 associations → array of toObjectIds
 *   2. batch read on the target object type → hydrated records
 *
 * This module centralizes that pattern so domain modules just supply the
 * source/target types and the batch API to call.
 */
import { sdk } from "./client.js";
import { withRetry } from "./retry.js";

/**
 * @typedef {object} ListAssociatedOptions
 * @property {string[]} [properties] Properties to hydrate on returned objects
 * @property {number} [limit] Max associations per page (HubSpot caps around 500)
 * @property {string} [after] Pagination cursor from a prior call
 */

/**
 * @typedef {object} ListAssociatedParams
 * @property {string} sourceType e.g. "companies", "contacts", "deals"
 * @property {string} sourceId HubSpot ID of the source object
 * @property {string} targetType e.g. "deals", "tickets" — same as the SDK module name
 * @property {object} batchApi The SDK batch API for the target type (e.g. sdk.crm.deals.batchApi)
 * @property {readonly string[]} defaultProperties Fallback when options.properties is omitted
 * @property {(res: object) => object} shape Function that produces the public object shape
 * @property {ListAssociatedOptions} [options]
 */

/**
 * Fetch associated objects of `targetType` for a single source object.
 *
 * Returns an empty `results` array (not an error) when no associations exist.
 *
 * @param {ListAssociatedParams} params
 * @returns {Promise<{ count: number, next_cursor?: string, results: object[] }>}
 */
export async function listAssociatedObjects({
  sourceType,
  sourceId,
  targetType,
  batchApi,
  defaultProperties,
  shape,
  options = {},
}) {
  const { properties, limit = 50, after } = options;

  const assoc = await withRetry(() =>
    sdk.crm.associations.v4.basicApi.getPage(
      sourceType,
      sourceId,
      targetType,
      after,
      limit
    )
  );

  const ids = (assoc?.results ?? []).map((r) => String(r.toObjectId));
  if (!ids.length) {
    return {
      count: 0,
      next_cursor: assoc?.paging?.next?.after,
      results: [],
    };
  }

  const props = properties ?? [...defaultProperties];
  const batch = await withRetry(() =>
    batchApi.read({
      properties: props,
      propertiesWithHistory: [],
      inputs: ids.map((id) => ({ id })),
    })
  );

  return {
    count: batch?.results?.length ?? 0,
    next_cursor: assoc?.paging?.next?.after,
    results: (batch?.results ?? []).map(shape),
  };
}
