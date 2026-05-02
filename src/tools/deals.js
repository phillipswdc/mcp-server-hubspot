/**
 * MCP tool registrations for HubSpot deal operations (read-only as of Phase 2a).
 */
import { z } from "zod";
import { hubspot } from "../hubspot/index.js";
import { jsonText, plainText, errorText, statusOf } from "./_shared.js";
import { searchInputShape } from "./_search.js";
import { registerUpdateTool, registerCreateTool } from "./_mutations.js";
import { DEFAULT_PAGE_LIMIT, MAX_PAGE_LIMIT } from "../config/constants.js";

/**
 * Register all deal-related MCP tools on a server instance.
 * @param {import("@modelcontextprotocol/sdk/server/mcp.js").McpServer} server
 */
export function registerDealTools(server) {
  server.tool(
    "get_deal_by_id",
    "Look up a single HubSpot deal by its internal ID. Returns id, requested properties, and timestamps.",
    {
      deal_id: z.string().describe("HubSpot internal deal ID"),
      properties: z
        .array(z.string())
        .optional()
        .describe("Specific deal properties to return. Defaults to a small set of common fields."),
    },
    async ({ deal_id, properties }) => {
      try {
        return jsonText(await hubspot.getDealById(deal_id, properties));
      } catch (err) {
        const status = statusOf(err);
        if (status === 404) return plainText(`No deal found with id: ${deal_id}`);
        return errorText(err, status);
      }
    }
  );

  server.tool(
    "search_deals",
    "Search HubSpot deals by query and/or property filters. Returns paginated results with a next_cursor when more exist. Use list_properties first to discover available property names and types.",
    searchInputShape(
      "Specific deal properties to return per result. Defaults to a small set of common fields."
    ),
    async (input) => {
      try {
        return jsonText(await hubspot.searchDeals(input));
      } catch (err) {
        return errorText(err, statusOf(err));
      }
    }
  );

  server.tool(
    "list_deals_for_company",
    "List deals associated with a HubSpot company. Returns hydrated deal records (not just IDs). Pagination via after / next_cursor.",
    {
      company_id: z.string().describe("HubSpot internal company ID"),
      properties: z
        .array(z.string())
        .optional()
        .describe("Specific deal properties to return per result. Defaults to a small set."),
      limit: z
        .number()
        .int()
        .min(1)
        .max(MAX_PAGE_LIMIT)
        .optional()
        .default(DEFAULT_PAGE_LIMIT)
        .describe(`Max deals per page (1-${MAX_PAGE_LIMIT}). Defaults to ${DEFAULT_PAGE_LIMIT}.`),
      after: z
        .string()
        .optional()
        .describe("Pagination cursor returned as next_cursor from a prior call."),
    },
    async ({ company_id, properties, limit, after }) => {
      try {
        const result = await hubspot.listDealsForCompany(company_id, {
          properties,
          limit,
          after,
        });
        return jsonText(result);
      } catch (err) {
        return errorText(err, statusOf(err));
      }
    }
  );

  server.tool(
    "list_deals_for_contact",
    "List deals associated with a HubSpot contact. Returns hydrated deal records (not just IDs). Pagination via after / next_cursor.",
    {
      contact_id: z.string().describe("HubSpot internal contact ID"),
      properties: z
        .array(z.string())
        .optional()
        .describe("Specific deal properties to return per result. Defaults to a small set."),
      limit: z
        .number()
        .int()
        .min(1)
        .max(MAX_PAGE_LIMIT)
        .optional()
        .default(DEFAULT_PAGE_LIMIT)
        .describe(`Max deals per page (1-${MAX_PAGE_LIMIT}). Defaults to ${DEFAULT_PAGE_LIMIT}.`),
      after: z
        .string()
        .optional()
        .describe("Pagination cursor returned as next_cursor from a prior call."),
    },
    async ({ contact_id, properties, limit, after }) => {
      try {
        const result = await hubspot.listDealsForContact(contact_id, {
          properties,
          limit,
          after,
        });
        return jsonText(result);
      } catch (err) {
        return errorText(err, statusOf(err));
      }
    }
  );

  registerUpdateTool(server, {
    toolName: "update_deal",
    description:
      "Update one or more properties on a HubSpot deal (e.g. dealstage, amount, closedate). Captures old + new state in the audit log; the response includes audit_id (use with rollback_change to revert) and changed_fields.",
    idField: "deal_id",
    idDescription: "HubSpot internal deal ID",
    update: hubspot.updateDeal,
  });

  registerCreateTool(server, {
    toolName: "create_deal",
    description:
      "Create a new HubSpot deal. Typically include `dealname`, `pipeline`, `dealstage`, and optionally `amount`. Captures the created entity in the audit log; rollback_change archives the deal.",
    create: hubspot.createDeal,
  });
}
