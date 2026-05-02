/**
 * MCP tool registrations for HubSpot contact operations (read-only as of Phase 2b).
 * Handlers are thin: validate input via zod, call the wrapper, shape the
 * response. No SDK or DB calls happen here directly.
 */
import { z } from "zod";
import { hubspot } from "../hubspot/index.js";
import { jsonText, plainText, errorText, statusOf } from "./_shared.js";
import { searchInputShape } from "./_search.js";
import { registerUpdateTool, registerCreateTool } from "./_mutations.js";
import { DEFAULT_PAGE_LIMIT, MAX_PAGE_LIMIT } from "../config/constants.js";

/**
 * Register all contact-related MCP tools on a server instance.
 * @param {import("@modelcontextprotocol/sdk/server/mcp.js").McpServer} server
 */
export function registerContactTools(server) {
  server.tool(
    "get_contact_by_id",
    "Look up a single HubSpot contact by internal ID. Returns id, requested properties, and timestamps.",
    {
      contact_id: z.string().describe("HubSpot internal contact ID"),
      properties: z
        .array(z.string())
        .optional()
        .describe(
          "Specific HubSpot contact properties to return. Defaults to a small set of common fields."
        ),
    },
    async ({ contact_id, properties }) => {
      try {
        return jsonText(await hubspot.getContactById(contact_id, properties));
      } catch (err) {
        const status = statusOf(err);
        if (status === 404) return plainText(`No contact found with id: ${contact_id}`);
        return errorText(err, status);
      }
    }
  );

  server.tool(
    "get_contact_by_email",
    "Look up a single HubSpot contact by email address. Returns id, requested properties, and timestamps. Use this for direct contact lookups, not for searching.",
    {
      email: z.string().email().describe("Email address of the contact to retrieve"),
      properties: z
        .array(z.string())
        .optional()
        .describe(
          "Specific HubSpot contact properties to return. Defaults to a small set of common fields. Pass an explicit list to limit or expand."
        ),
    },
    async ({ email, properties }) => {
      try {
        return jsonText(await hubspot.getContactByEmail(email, properties));
      } catch (err) {
        const status = statusOf(err);
        if (status === 404) return plainText(`No contact found with email: ${email}`);
        return errorText(err, status);
      }
    }
  );

  server.tool(
    "search_contacts",
    "Search HubSpot contacts by query and/or property filters. Returns paginated results with a next_cursor when more exist. Use list_properties first to discover available property names and types.",
    searchInputShape(
      "Specific contact properties to return per result. Defaults to a small set of common fields."
    ),
    async (input) => {
      try {
        return jsonText(await hubspot.searchContacts(input));
      } catch (err) {
        return errorText(err, statusOf(err));
      }
    }
  );

  server.tool(
    "list_recent_contacts",
    "List contacts sorted by last-modified date descending. Use this to answer 'what contacts were updated recently' or 'show me the latest activity'.",
    {
      properties: z
        .array(z.string())
        .optional()
        .describe(
          "Specific contact properties to return per result. Defaults to a small set of common fields."
        ),
      limit: z
        .number()
        .int()
        .min(1)
        .max(MAX_PAGE_LIMIT)
        .optional()
        .default(DEFAULT_PAGE_LIMIT)
        .describe(`Max contacts per page (1-${MAX_PAGE_LIMIT}). Defaults to ${DEFAULT_PAGE_LIMIT}.`),
      after: z
        .string()
        .optional()
        .describe("Pagination cursor returned as next_cursor from a prior call."),
    },
    async ({ properties, limit, after }) => {
      try {
        return jsonText(
          await hubspot.listRecentContacts({ properties, limit, after })
        );
      } catch (err) {
        return errorText(err, statusOf(err));
      }
    }
  );

  registerUpdateTool(server, {
    toolName: "update_contact",
    description:
      "Update one or more properties on a HubSpot contact. Captures old + new state in the audit log; the response includes audit_id (use with rollback_change to revert) and changed_fields.",
    idField: "contact_id",
    idDescription: "HubSpot internal contact ID",
    update: hubspot.updateContact,
  });

  registerCreateTool(server, {
    toolName: "create_contact",
    description:
      "Create a new HubSpot contact. The `properties` object must include `email`. Captures the created entity in the audit log; rollback_change archives the contact.",
    create: hubspot.createContact,
  });
}
