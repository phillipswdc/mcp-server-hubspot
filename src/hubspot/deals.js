/**
 * Deal-domain wrapper methods. Read-only as of Phase 2.
 */
import { sdk } from "./client.js";
import { withRetry } from "./retry.js";
import { compact } from "./compact.js";
import { buildSearchRequest, normalizeSearchResponse } from "./_search.js";
import { listAssociatedObjects } from "./_associations.js";
import { auditedUpdate, auditedCreate } from "./_audit.js";
import { autoCacheLargeValues, maybeCacheResponse } from "./_cache.js";
import { DEFAULT_DEAL_PROPERTIES } from "../config/constants.js";

/**
 * Look up a deal by HubSpot internal ID.
 *
 * @param {string} dealId
 * @param {string[]} [properties]
 * @returns {Promise<object>}
 */
export async function getDealById(dealId, properties) {
  const props = properties ?? [...DEFAULT_DEAL_PROPERTIES];
  const res = await withRetry(() => sdk.crm.deals.basicApi.getById(dealId, props));
  return shapeDeal(res);
}

/**
 * Search deals by query string and/or property filters.
 *
 * @param {import("./_search.js").SearchInput} input
 * @returns {Promise<{ total: number, count: number, next_cursor?: string, results: object[] }>}
 */
export async function searchDeals(input) {
  const req = buildSearchRequest(input, DEFAULT_DEAL_PROPERTIES);
  const res = await withRetry(() => sdk.crm.deals.searchApi.doSearch(req));
  const response = normalizeSearchResponse(res);
  return maybeCacheResponse(response, {
    useCache: input?.cache === true,
    tool_name: "search_deals",
    source_args: input,
    object_type: "deals",
  });
}

/**
 * List deals associated with a given company.
 *
 * @param {string} companyId
 * @param {import("./_associations.js").ListAssociatedOptions} [options]
 * @returns {Promise<{ count: number, next_cursor?: string, results: object[] }>}
 */
export async function listDealsForCompany(companyId, options) {
  return await listAssociatedObjects({
    sourceType: "companies",
    sourceId: companyId,
    targetType: "deals",
    batchApi: sdk.crm.deals.batchApi,
    defaultProperties: DEFAULT_DEAL_PROPERTIES,
    shape: shapeDeal,
    options,
  });
}

/**
 * List deals associated with a given contact.
 *
 * @param {string} contactId
 * @param {import("./_associations.js").ListAssociatedOptions} [options]
 * @returns {Promise<{ count: number, next_cursor?: string, results: object[] }>}
 */
export async function listDealsForContact(contactId, options) {
  return await listAssociatedObjects({
    sourceType: "contacts",
    sourceId: contactId,
    targetType: "deals",
    batchApi: sdk.crm.deals.batchApi,
    defaultProperties: DEFAULT_DEAL_PROPERTIES,
    shape: shapeDeal,
    options,
  });
}

/**
 * Create a new deal. Routes through the audit wrapper.
 *
 * @param {Record<string,unknown>} properties Initial properties (typically include `dealname`, `pipeline`, `dealstage`)
 * @param {{ confirmProduction?: boolean, returnProperties?: string[] }} [options]
 * @returns {Promise<{ result: object, audit_id: number }>}
 */
export async function createDeal(properties, options = {}) {
  return await auditedCreate({
    toolName: "create_deal",
    objectType: "deals",
    basicApi: sdk.crm.deals.basicApi,
    defaultProperties: DEFAULT_DEAL_PROPERTIES,
    properties,
    returnProperties: options.returnProperties,
    confirmProduction: options.confirmProduction,
  });
}

/**
 * Update a deal's properties. Routes through the audit wrapper.
 *
 * @param {string} dealId
 * @param {Record<string,unknown>} properties
 * @param {{ confirmProduction?: boolean }} [options]
 * @returns {Promise<{ result: object, audit_id: number, changed_fields: string[]|null }>}
 */
export async function updateDeal(dealId, properties, options = {}) {
  return await auditedUpdate({
    toolName: "update_deal",
    objectType: "deals",
    basicApi: sdk.crm.deals.basicApi,
    defaultProperties: DEFAULT_DEAL_PROPERTIES,
    id: dealId,
    properties,
    confirmProduction: options.confirmProduction,
  });
}

/**
 * Strip the SDK's model wrapper into a plain compacted object.
 * @param {object} res SDK SimplePublicObject
 */
function shapeDeal(res) {
  return (
    compact({
      id: res.id,
      properties: autoCacheLargeValues(res.properties, {
        object_type: "deals",
        object_id: res.id,
      }),
      createdAt: res.createdAt,
      updatedAt: res.updatedAt,
    }) ?? { id: res.id }
  );
}
