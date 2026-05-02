/**
 * Company-domain wrapper methods. Read-only as of Phase 2a — write/delete
 * operations land in Phase 3 alongside the audit log.
 */
import { sdk } from "./client.js";
import { withRetry } from "./retry.js";
import { compact } from "./compact.js";
import { buildSearchRequest, normalizeSearchResponse } from "./_search.js";
import { auditedUpdate, auditedCreate } from "./_audit.js";
import { autoCacheLargeValues, maybeCacheResponse } from "./_cache.js";
import { DEFAULT_COMPANY_PROPERTIES } from "../config/constants.js";

/**
 * Look up a company by HubSpot internal ID.
 *
 * @param {string} companyId
 * @param {string[]} [properties]
 * @returns {Promise<object>}
 */
export async function getCompanyById(companyId, properties) {
  const props = properties ?? [...DEFAULT_COMPANY_PROPERTIES];
  const res = await withRetry(() =>
    sdk.crm.companies.basicApi.getById(companyId, props)
  );
  return shapeCompany(res);
}

/**
 * Look up a company by domain (e.g., "okta.com"). HubSpot's search is
 * case-insensitive but exact-match on domain by default.
 *
 * Returns `null` when no company exists with that domain.
 *
 * @param {string} domain
 * @param {string[]} [properties]
 * @returns {Promise<object|null>}
 */
export async function getCompanyByDomain(domain, properties) {
  const req = buildSearchRequest(
    {
      filters: [{ propertyName: "domain", operator: "EQ", value: domain }],
      limit: 1,
      properties,
    },
    DEFAULT_COMPANY_PROPERTIES
  );
  const res = await withRetry(() => sdk.crm.companies.searchApi.doSearch(req));
  const first = res?.results?.[0];
  return first ? shapeCompany(first) : null;
}

/**
 * Search companies by query string and/or property filters.
 *
 * @param {import("./_search.js").SearchInput} input
 * @returns {Promise<{ total: number, count: number, next_cursor?: string, results: object[] }>}
 */
export async function searchCompanies(input) {
  const req = buildSearchRequest(input, DEFAULT_COMPANY_PROPERTIES);
  const res = await withRetry(() => sdk.crm.companies.searchApi.doSearch(req));
  const response = normalizeSearchResponse(res);
  return maybeCacheResponse(response, {
    useCache: input?.cache === true,
    tool_name: "search_companies",
    source_args: input,
    object_type: "companies",
  });
}

/**
 * Create a new company. Routes through the audit wrapper.
 *
 * @param {Record<string,unknown>} properties Initial properties (typically include `name` and/or `domain`)
 * @param {{ confirmProduction?: boolean, returnProperties?: string[] }} [options]
 * @returns {Promise<{ result: object, audit_id: number }>}
 */
export async function createCompany(properties, options = {}) {
  return await auditedCreate({
    toolName: "create_company",
    objectType: "companies",
    basicApi: sdk.crm.companies.basicApi,
    defaultProperties: DEFAULT_COMPANY_PROPERTIES,
    properties,
    returnProperties: options.returnProperties,
    confirmProduction: options.confirmProduction,
  });
}

/**
 * Update a company's properties. Routes through the audit wrapper.
 *
 * @param {string} companyId
 * @param {Record<string,unknown>} properties
 * @param {{ confirmProduction?: boolean }} [options]
 * @returns {Promise<{ result: object, audit_id: number, changed_fields: string[]|null }>}
 */
export async function updateCompany(companyId, properties, options = {}) {
  return await auditedUpdate({
    toolName: "update_company",
    objectType: "companies",
    basicApi: sdk.crm.companies.basicApi,
    defaultProperties: DEFAULT_COMPANY_PROPERTIES,
    id: companyId,
    properties,
    confirmProduction: options.confirmProduction,
  });
}

/**
 * Strip the SDK's model wrapper into a plain compacted object.
 * @param {object} res SDK SimplePublicObject
 */
function shapeCompany(res) {
  return (
    compact({
      id: res.id,
      properties: autoCacheLargeValues(res.properties, {
        object_type: "companies",
        object_id: res.id,
      }),
      createdAt: res.createdAt,
      updatedAt: res.updatedAt,
    }) ?? { id: res.id }
  );
}
