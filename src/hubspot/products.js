/**
 * Product-domain wrapper methods. Read-only — products are typically managed
 * in HubSpot's UI or via a separate catalog system, not via API mutation.
 *
 * Uses the dedicated `sdk.crm.products` SDK path.
 */
import { sdk } from "./client.js";
import { withRetry } from "./retry.js";
import { compact } from "./compact.js";
import { buildSearchRequest, normalizeSearchResponse } from "./_search.js";
import { autoCacheLargeValues, maybeCacheResponse } from "./_cache.js";
import { DEFAULT_PRODUCT_PROPERTIES } from "../config/constants.js";

const OBJ = "products";

/**
 * Look up a product by HubSpot internal ID.
 * @param {string} productId
 * @param {string[]} [properties]
 */
export async function getProductById(productId, properties) {
  const props = properties ?? [...DEFAULT_PRODUCT_PROPERTIES];
  const res = await withRetry(() =>
    sdk.crm.products.basicApi.getById(productId, props)
  );
  return shapeProduct(res);
}

/**
 * Search products by query and/or property filters.
 * @param {import("./_search.js").SearchInput} input
 */
export async function searchProducts(input) {
  const req = buildSearchRequest(input, DEFAULT_PRODUCT_PROPERTIES);
  const res = await withRetry(() => sdk.crm.products.searchApi.doSearch(req));
  const response = normalizeSearchResponse(res);
  return maybeCacheResponse(response, {
    useCache: input?.cache === true,
    tool_name: "search_products",
    source_args: input,
    object_type: OBJ,
  });
}

/**
 * List the most-recently-modified products.
 * @param {{ properties?: string[], limit?: number, after?: string, cache?: boolean }} [options]
 */
export async function listRecentProducts({ properties, limit, after, cache } = {}) {
  return await searchProducts({
    sorts: [{ propertyName: "hs_lastmodifieddate", direction: "DESCENDING" }],
    properties,
    limit,
    after,
    cache,
  });
}

function shapeProduct(res) {
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
