/**
 * Quote-domain wrapper methods. Read-only — quotes are typically generated
 * via HubSpot's quote builder, not programmatically.
 *
 * Uses the dedicated `sdk.crm.quotes` SDK path.
 */
import { sdk } from "./client.js";
import { withRetry } from "./retry.js";
import { compact } from "./compact.js";
import { buildSearchRequest, normalizeSearchResponse } from "./_search.js";
import { listAssociatedObjects } from "./_associations.js";
import { autoCacheLargeValues, maybeCacheResponse } from "./_cache.js";
import { DEFAULT_QUOTE_PROPERTIES } from "../config/constants.js";

const OBJ = "quotes";

/**
 * Look up a quote by HubSpot internal ID.
 * @param {string} quoteId
 * @param {string[]} [properties]
 */
export async function getQuoteById(quoteId, properties) {
  const props = properties ?? [...DEFAULT_QUOTE_PROPERTIES];
  const res = await withRetry(() => sdk.crm.quotes.basicApi.getById(quoteId, props));
  return shapeQuote(res);
}

/**
 * Search quotes by query and/or property filters.
 * @param {import("./_search.js").SearchInput} input
 */
export async function searchQuotes(input) {
  const req = buildSearchRequest(input, DEFAULT_QUOTE_PROPERTIES);
  const res = await withRetry(() => sdk.crm.quotes.searchApi.doSearch(req));
  const response = normalizeSearchResponse(res);
  return maybeCacheResponse(response, {
    useCache: input?.cache === true,
    tool_name: "search_quotes",
    source_args: input,
    object_type: OBJ,
  });
}

const PARENT_TO_QUOTE_LIST = (parentType) => async (parentId, options) =>
  listAssociatedObjects({
    sourceType: parentType,
    sourceId: parentId,
    targetType: OBJ,
    batchApi: sdk.crm.quotes.batchApi,
    defaultProperties: DEFAULT_QUOTE_PROPERTIES,
    shape: shapeQuote,
    options,
  });

export const listQuotesForContact = PARENT_TO_QUOTE_LIST("contacts");
export const listQuotesForCompany = PARENT_TO_QUOTE_LIST("companies");
export const listQuotesForDeal = PARENT_TO_QUOTE_LIST("deals");

function shapeQuote(res) {
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
