/**
 * MCP tool registrations for HubSpot ticket operations (read-only as of Phase 2c).
 *
 * Tickets are HubSpot's support/service object. Default property list omits
 * `content` (ticket body) to bound token cost — request it explicitly when needed.
 */
import { z } from "zod";
import { hubspot } from "../hubspot/index.js";
import { jsonText, plainText, errorText, statusOf } from "./_shared.js";
import { searchInputShape } from "./_search.js";
import { registerUpdateTool, registerCreateTool } from "./_mutations.js";
import { DEFAULT_PAGE_LIMIT, MAX_PAGE_LIMIT } from "../config/constants.js";

/**
 * Register all ticket-related MCP tools on a server instance.
 * @param {import("@modelcontextprotocol/sdk/server/mcp.js").McpServer} server
 */
export function registerTicketTools(server) {
  server.tool(
    "get_ticket_by_id",
    "Look up a single HubSpot ticket by its internal ID. Returns id, requested properties, and timestamps. Pass 'content' explicitly in properties to retrieve the ticket body.",
    {
      ticket_id: z.string().describe("HubSpot internal ticket ID"),
      properties: z
        .array(z.string())
        .optional()
        .describe(
          "Specific ticket properties to return. Defaults exclude 'content' (potentially large) — request it explicitly when needed."
        ),
    },
    async ({ ticket_id, properties }) => {
      try {
        return jsonText(await hubspot.getTicketById(ticket_id, properties));
      } catch (err) {
        const status = statusOf(err);
        if (status === 404) return plainText(`No ticket found with id: ${ticket_id}`);
        return errorText(err, status);
      }
    }
  );

  server.tool(
    "search_tickets",
    "Search HubSpot tickets by query and/or property filters. Returns paginated results with a next_cursor when more exist. Use list_properties first to discover available property names and types.",
    searchInputShape(
      "Specific ticket properties to return per result. Defaults exclude 'content' to keep token cost bounded."
    ),
    async (input) => {
      try {
        return jsonText(await hubspot.searchTickets(input));
      } catch (err) {
        return errorText(err, statusOf(err));
      }
    }
  );

  server.tool(
    "list_tickets_for_contact",
    "List tickets associated with a HubSpot contact. Returns hydrated ticket records (not just IDs). Pagination via after / next_cursor.",
    {
      contact_id: z.string().describe("HubSpot internal contact ID"),
      properties: z
        .array(z.string())
        .optional()
        .describe("Specific ticket properties to return per result. Defaults to a small set."),
      limit: z
        .number()
        .int()
        .min(1)
        .max(MAX_PAGE_LIMIT)
        .optional()
        .default(DEFAULT_PAGE_LIMIT)
        .describe(`Max tickets per page (1-${MAX_PAGE_LIMIT}). Defaults to ${DEFAULT_PAGE_LIMIT}.`),
      after: z
        .string()
        .optional()
        .describe("Pagination cursor returned as next_cursor from a prior call."),
    },
    async ({ contact_id, properties, limit, after }) => {
      try {
        return jsonText(
          await hubspot.listTicketsForContact(contact_id, { properties, limit, after })
        );
      } catch (err) {
        return errorText(err, statusOf(err));
      }
    }
  );

  server.tool(
    "list_tickets_for_company",
    "List tickets associated with a HubSpot company. Returns hydrated ticket records (not just IDs). Pagination via after / next_cursor.",
    {
      company_id: z.string().describe("HubSpot internal company ID"),
      properties: z
        .array(z.string())
        .optional()
        .describe("Specific ticket properties to return per result. Defaults to a small set."),
      limit: z
        .number()
        .int()
        .min(1)
        .max(MAX_PAGE_LIMIT)
        .optional()
        .default(DEFAULT_PAGE_LIMIT)
        .describe(`Max tickets per page (1-${MAX_PAGE_LIMIT}). Defaults to ${DEFAULT_PAGE_LIMIT}.`),
      after: z
        .string()
        .optional()
        .describe("Pagination cursor returned as next_cursor from a prior call."),
    },
    async ({ company_id, properties, limit, after }) => {
      try {
        return jsonText(
          await hubspot.listTicketsForCompany(company_id, { properties, limit, after })
        );
      } catch (err) {
        return errorText(err, statusOf(err));
      }
    }
  );

  registerUpdateTool(server, {
    toolName: "update_ticket",
    description:
      "Update one or more properties on a HubSpot ticket (e.g. hs_pipeline_stage, hs_ticket_priority). Captures old + new state in the audit log; the response includes audit_id (use with rollback_change to revert) and changed_fields.",
    idField: "ticket_id",
    idDescription: "HubSpot internal ticket ID",
    update: hubspot.updateTicket,
  });

  registerCreateTool(server, {
    toolName: "create_ticket",
    description:
      "Create a new HubSpot ticket. Must include `subject`. Often includes `hs_pipeline`, `hs_pipeline_stage`, `hs_ticket_priority`. Captures the created entity in the audit log; rollback_change archives the ticket.",
    create: hubspot.createTicket,
  });
}
