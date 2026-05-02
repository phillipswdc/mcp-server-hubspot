/**
 * Contact-domain wrapper methods. Thin layer over the HubSpot SDK that returns
 * MCP-friendly plain objects (compacted, JSON-serializable) instead of the
 * SDK's model instances.
 */
import { sdk } from "./client.js";
import { withRetry } from "./retry.js";
import { compact } from "./compact.js";
import { buildSearchRequest, normalizeSearchResponse } from "./_search.js";
import { auditedUpdate, auditedCreate } from "./_audit.js";
import { DEFAULT_CONTACT_PROPERTIES } from "../config/constants.js";

/**
 * Look up a single contact by HubSpot internal ID.
 *
 * @param {string} contactId
 * @param {string[]} [properties]
 * @returns {Promise<object>}
 */
export async function getContactById(contactId, properties) {
  const props = properties ?? [...DEFAULT_CONTACT_PROPERTIES];
  const res = await withRetry(() =>
    sdk.crm.contacts.basicApi.getById(contactId, props)
  );
  return shapeContact(res);
}

/**
 * Look up a single contact by email address.
 *
 * @param {string} email
 * @param {string[]} [properties] Specific properties to return; defaults to a
 *   small common set to keep token cost low.
 * @returns {Promise<{ id: string, properties?: object, createdAt?: string, updatedAt?: string }>}
 */
export async function getContactByEmail(email, properties) {
  const props = properties ?? [...DEFAULT_CONTACT_PROPERTIES];
  const res = await withRetry(() =>
    sdk.crm.contacts.basicApi.getById(
      email,
      props,
      undefined,
      undefined,
      false,
      "email"
    )
  );
  return shapeContact(res);
}

/**
 * Search contacts by query string and/or property filters.
 *
 * @param {import("./_search.js").SearchInput} input
 * @returns {Promise<{ total: number, count: number, next_cursor?: string, results: object[] }>}
 */
export async function searchContacts(input) {
  const req = buildSearchRequest(input, DEFAULT_CONTACT_PROPERTIES);
  const res = await withRetry(() => sdk.crm.contacts.searchApi.doSearch(req));
  return normalizeSearchResponse(res);
}

/**
 * List contacts sorted by `lastmodifieddate` descending. Implemented via the
 * Search API (no filters) because the basic list endpoint can't sort.
 *
 * @param {{ properties?: string[], limit?: number, after?: string }} [options]
 * @returns {Promise<{ total: number, count: number, next_cursor?: string, results: object[] }>}
 */
export async function listRecentContacts({ properties, limit, after } = {}) {
  return await searchContacts({
    sorts: [{ propertyName: "lastmodifieddate", direction: "DESCENDING" }],
    properties,
    limit,
    after,
  });
}

/**
 * Create a new contact. Routes through the audit wrapper.
 *
 * @param {Record<string,unknown>} properties Initial properties for the new contact (must include `email` per HubSpot)
 * @param {{ confirmProduction?: boolean, returnProperties?: string[] }} [options]
 * @returns {Promise<{ result: object, audit_id: number }>}
 */
export async function createContact(properties, options = {}) {
  return await auditedCreate({
    toolName: "create_contact",
    objectType: "contacts",
    basicApi: sdk.crm.contacts.basicApi,
    defaultProperties: DEFAULT_CONTACT_PROPERTIES,
    properties,
    returnProperties: options.returnProperties,
    confirmProduction: options.confirmProduction,
  });
}

/**
 * Update a contact's properties. Routes through the audit wrapper:
 * captures old + new state, computes changed fields, writes an audit_log row,
 * and enforces the production confirm flag.
 *
 * @param {string} contactId
 * @param {Record<string,unknown>} properties Property updates to apply
 * @param {{ confirmProduction?: boolean }} [options]
 * @returns {Promise<{ result: object, audit_id: number, changed_fields: string[]|null }>}
 */
export async function updateContact(contactId, properties, options = {}) {
  return await auditedUpdate({
    toolName: "update_contact",
    objectType: "contacts",
    basicApi: sdk.crm.contacts.basicApi,
    defaultProperties: DEFAULT_CONTACT_PROPERTIES,
    id: contactId,
    properties,
    confirmProduction: options.confirmProduction,
  });
}

/**
 * Strip the SDK's model wrapper into a plain compacted object.
 * @param {object} res SDK SimplePublicObject
 */
function shapeContact(res) {
  return (
    compact({
      id: res.id,
      properties: res.properties,
      createdAt: res.createdAt,
      updatedAt: res.updatedAt,
    }) ?? { id: res.id }
  );
}
