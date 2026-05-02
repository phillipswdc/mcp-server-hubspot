/**
 * Line item-domain wrapper methods. Commerce Hub object — children of
 * orders, deals, and quotes.
 *
 * Uses the dedicated `sdk.crm.lineItems` SDK path (which exists for line
 * items, unlike the generic objects path used by orders).
 */
import { sdk } from "./client.js";
import { withRetry } from "./retry.js";
import { compact } from "./compact.js";
import { buildSearchRequest, normalizeSearchResponse } from "./_search.js";
import { listAssociatedObjects } from "./_associations.js";
import { auditedUpdate, auditedCreate } from "./_audit.js";
import { autoCacheLargeValues, maybeCacheResponse } from "./_cache.js";
import { DEFAULT_LINE_ITEM_PROPERTIES } from "../config/constants.js";

const OBJ = "line_items";

/**
 * Look up a line item by HubSpot internal ID.
 * @param {string} lineItemId
 * @param {string[]} [properties]
 */
export async function getLineItemById(lineItemId, properties) {
  const props = properties ?? [...DEFAULT_LINE_ITEM_PROPERTIES];
  const res = await withRetry(() =>
    sdk.crm.lineItems.basicApi.getById(lineItemId, props)
  );
  return shapeLineItem(res);
}

/**
 * Search line items by query and/or property filters.
 * @param {import("./_search.js").SearchInput} input
 */
export async function searchLineItems(input) {
  const req = buildSearchRequest(input, DEFAULT_LINE_ITEM_PROPERTIES);
  const res = await withRetry(() => sdk.crm.lineItems.searchApi.doSearch(req));
  const response = normalizeSearchResponse(res);
  return maybeCacheResponse(response, {
    useCache: input?.cache === true,
    tool_name: "search_line_items",
    source_args: input,
    object_type: OBJ,
  });
}

/**
 * Create a new line item. Typically attached to a deal/order/quote via
 * associations passed in the create payload (handled via additional
 * associations API calls).
 *
 * @param {Record<string,unknown>} properties
 * @param {{ confirmProduction?: boolean, returnProperties?: string[] }} [options]
 */
export async function createLineItem(properties, options = {}) {
  return await auditedCreate({
    toolName: "create_line_item",
    objectType: OBJ,
    basicApi: sdk.crm.lineItems.basicApi,
    defaultProperties: DEFAULT_LINE_ITEM_PROPERTIES,
    properties,
    returnProperties: options.returnProperties,
    confirmProduction: options.confirmProduction,
  });
}

/**
 * Update a line item's properties.
 *
 * @param {string} lineItemId
 * @param {Record<string,unknown>} properties
 * @param {{ confirmProduction?: boolean }} [options]
 */
export async function updateLineItem(lineItemId, properties, options = {}) {
  return await auditedUpdate({
    toolName: "update_line_item",
    objectType: OBJ,
    basicApi: sdk.crm.lineItems.basicApi,
    defaultProperties: DEFAULT_LINE_ITEM_PROPERTIES,
    id: lineItemId,
    properties,
    confirmProduction: options.confirmProduction,
  });
}

/**
 * List line items associated with a deal.
 * @param {string} dealId
 * @param {import("./_associations.js").ListAssociatedOptions} [options]
 */
export async function listLineItemsForDeal(dealId, options) {
  return await listAssociatedObjects({
    sourceType: "deals",
    sourceId: dealId,
    targetType: OBJ,
    batchApi: sdk.crm.lineItems.batchApi,
    defaultProperties: DEFAULT_LINE_ITEM_PROPERTIES,
    shape: shapeLineItem,
    options,
  });
}

/**
 * List line items associated with an order.
 * Note: order-side associations may need to be queried via the generic
 * associations.v4 API since orders is a generic-objects type.
 *
 * @param {string} orderId
 * @param {import("./_associations.js").ListAssociatedOptions} [options]
 */
export async function listLineItemsForOrder(orderId, options) {
  return await listAssociatedObjects({
    sourceType: "orders",
    sourceId: orderId,
    targetType: OBJ,
    batchApi: sdk.crm.lineItems.batchApi,
    defaultProperties: DEFAULT_LINE_ITEM_PROPERTIES,
    shape: shapeLineItem,
    options,
  });
}

function shapeLineItem(res) {
  return (
    compact({
      id: res.id,
      properties: autoCacheLargeValues(res.properties, {
        object_type: OBJ,
        object_id: res.id,
      }),
      createdAt: res.createdAt,
      updatedAt: res.updatedAt,
    }) ?? { id: res.id }
  );
}
