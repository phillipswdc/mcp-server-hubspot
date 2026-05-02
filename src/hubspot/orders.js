/**
 * Order-domain wrapper methods. Commerce Hub object — uses the generic
 * objects API (sdk.crm.objects.*) since orders don't have a dedicated SDK
 * module like contacts does.
 *
 * Tier note: HubSpot accounts without Commerce Hub will get 403/404 from
 * these calls. The errorText helper at the tool layer rephrases those into
 * clean tier-aware messages — see check_feature_availability for diagnosis.
 */
import { auditedCreate, auditedUpdate } from "./_audit.js";
import {
  makeShapeFn,
  getGenericObjectById,
  searchGenericObject,
  listAssociatedGenericObjects,
  genericBasicApi,
} from "./_generic_object.js";
import { DEFAULT_ORDER_PROPERTIES } from "../config/constants.js";

const OBJ = "orders";
const SHAPE = makeShapeFn(OBJ);
const API = genericBasicApi(OBJ);

/**
 * Look up an order by HubSpot internal ID.
 * @param {string} orderId
 * @param {string[]} [properties]
 * @returns {Promise<object>}
 */
export async function getOrderById(orderId, properties) {
  const props = properties ?? [...DEFAULT_ORDER_PROPERTIES];
  return await getGenericObjectById(OBJ, orderId, props, SHAPE);
}

/**
 * Search orders by query and/or property filters.
 * @param {import("./_search.js").SearchInput} input
 */
export async function searchOrders(input) {
  return await searchGenericObject(OBJ, input, DEFAULT_ORDER_PROPERTIES, SHAPE, "search_orders");
}

/**
 * Create a new order. Requires Commerce Hub on the HubSpot account.
 * @param {Record<string,unknown>} properties
 * @param {{ confirmProduction?: boolean, returnProperties?: string[] }} [options]
 */
export async function createOrder(properties, options = {}) {
  return await auditedCreate({
    toolName: "create_order",
    objectType: OBJ,
    basicApi: API,
    defaultProperties: DEFAULT_ORDER_PROPERTIES,
    properties,
    returnProperties: options.returnProperties,
    confirmProduction: options.confirmProduction,
  });
}

/**
 * Update an order's properties.
 * @param {string} orderId
 * @param {Record<string,unknown>} properties
 * @param {{ confirmProduction?: boolean }} [options]
 */
export async function updateOrder(orderId, properties, options = {}) {
  return await auditedUpdate({
    toolName: "update_order",
    objectType: OBJ,
    basicApi: API,
    defaultProperties: DEFAULT_ORDER_PROPERTIES,
    id: orderId,
    properties,
    confirmProduction: options.confirmProduction,
  });
}

/**
 * List orders associated with a contact.
 * @param {string} contactId
 * @param {import("./_associations.js").ListAssociatedOptions} [options]
 */
export async function listOrdersForContact(contactId, options) {
  return await listAssociatedGenericObjects({
    sourceType: "contacts",
    sourceId: contactId,
    targetType: OBJ,
    defaultProperties: DEFAULT_ORDER_PROPERTIES,
    shape: SHAPE,
    options,
  });
}

/**
 * List orders associated with a company.
 * @param {string} companyId
 * @param {import("./_associations.js").ListAssociatedOptions} [options]
 */
export async function listOrdersForCompany(companyId, options) {
  return await listAssociatedGenericObjects({
    sourceType: "companies",
    sourceId: companyId,
    targetType: OBJ,
    defaultProperties: DEFAULT_ORDER_PROPERTIES,
    shape: SHAPE,
    options,
  });
}

/**
 * List orders associated with a deal.
 * @param {string} dealId
 * @param {import("./_associations.js").ListAssociatedOptions} [options]
 */
export async function listOrdersForDeal(dealId, options) {
  return await listAssociatedGenericObjects({
    sourceType: "deals",
    sourceId: dealId,
    targetType: OBJ,
    defaultProperties: DEFAULT_ORDER_PROPERTIES,
    shape: SHAPE,
    options,
  });
}
