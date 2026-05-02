/**
 * Ticket-domain wrapper methods. Read-only as of Phase 2c.
 */
import { sdk } from "./client.js";
import { withRetry } from "./retry.js";
import { compact } from "./compact.js";
import { buildSearchRequest, normalizeSearchResponse } from "./_search.js";
import { listAssociatedObjects } from "./_associations.js";
import { auditedUpdate, auditedCreate } from "./_audit.js";
import { autoCacheLargeValues, maybeCacheResponse } from "./_cache.js";
import { DEFAULT_TICKET_PROPERTIES } from "../config/constants.js";

/**
 * Look up a ticket by HubSpot internal ID.
 *
 * @param {string} ticketId
 * @param {string[]} [properties]
 * @returns {Promise<object>}
 */
export async function getTicketById(ticketId, properties) {
  const props = properties ?? [...DEFAULT_TICKET_PROPERTIES];
  const res = await withRetry(() =>
    sdk.crm.tickets.basicApi.getById(ticketId, props)
  );
  return shapeTicket(res);
}

/**
 * Search tickets by query string and/or property filters.
 *
 * @param {import("./_search.js").SearchInput} input
 * @returns {Promise<{ total: number, count: number, next_cursor?: string, results: object[] }>}
 */
export async function searchTickets(input) {
  const req = buildSearchRequest(input, DEFAULT_TICKET_PROPERTIES);
  const res = await withRetry(() => sdk.crm.tickets.searchApi.doSearch(req));
  const response = normalizeSearchResponse(res);
  return maybeCacheResponse(response, {
    useCache: input?.cache === true,
    tool_name: "search_tickets",
    source_args: input,
    object_type: "tickets",
  });
}

/**
 * List tickets associated with a given contact.
 *
 * @param {string} contactId
 * @param {import("./_associations.js").ListAssociatedOptions} [options]
 * @returns {Promise<{ count: number, next_cursor?: string, results: object[] }>}
 */
export async function listTicketsForContact(contactId, options) {
  return await listAssociatedObjects({
    sourceType: "contacts",
    sourceId: contactId,
    targetType: "tickets",
    batchApi: sdk.crm.tickets.batchApi,
    defaultProperties: DEFAULT_TICKET_PROPERTIES,
    shape: shapeTicket,
    options,
  });
}

/**
 * List tickets associated with a given company.
 *
 * @param {string} companyId
 * @param {import("./_associations.js").ListAssociatedOptions} [options]
 * @returns {Promise<{ count: number, next_cursor?: string, results: object[] }>}
 */
export async function listTicketsForCompany(companyId, options) {
  return await listAssociatedObjects({
    sourceType: "companies",
    sourceId: companyId,
    targetType: "tickets",
    batchApi: sdk.crm.tickets.batchApi,
    defaultProperties: DEFAULT_TICKET_PROPERTIES,
    shape: shapeTicket,
    options,
  });
}

/**
 * Create a new ticket. Routes through the audit wrapper.
 *
 * @param {Record<string,unknown>} properties Initial properties (must include `subject` per HubSpot)
 * @param {{ confirmProduction?: boolean, returnProperties?: string[] }} [options]
 * @returns {Promise<{ result: object, audit_id: number }>}
 */
export async function createTicket(properties, options = {}) {
  return await auditedCreate({
    toolName: "create_ticket",
    objectType: "tickets",
    basicApi: sdk.crm.tickets.basicApi,
    defaultProperties: DEFAULT_TICKET_PROPERTIES,
    properties,
    returnProperties: options.returnProperties,
    confirmProduction: options.confirmProduction,
  });
}

/**
 * Update a ticket's properties. Routes through the audit wrapper.
 *
 * @param {string} ticketId
 * @param {Record<string,unknown>} properties
 * @param {{ confirmProduction?: boolean }} [options]
 * @returns {Promise<{ result: object, audit_id: number, changed_fields: string[]|null }>}
 */
export async function updateTicket(ticketId, properties, options = {}) {
  return await auditedUpdate({
    toolName: "update_ticket",
    objectType: "tickets",
    basicApi: sdk.crm.tickets.basicApi,
    defaultProperties: DEFAULT_TICKET_PROPERTIES,
    id: ticketId,
    properties,
    confirmProduction: options.confirmProduction,
  });
}

/**
 * Strip the SDK's model wrapper into a plain compacted object.
 * @param {object} res SDK SimplePublicObject
 */
function shapeTicket(res) {
  return (
    compact({
      id: res.id,
      properties: autoCacheLargeValues(res.properties, {
        object_type: "tickets",
        object_id: res.id,
      }),
      createdAt: res.createdAt,
      updatedAt: res.updatedAt,
    }) ?? { id: res.id }
  );
}
