/**
 * MCP tool registrations for HubSpot company operations (read-only as of Phase 2a).
 */
import { z } from "zod";
import { hubspot } from "../hubspot/index.js";
import { jsonText, plainText, errorText, statusOf } from "./_shared.js";
import { searchInputShape } from "./_search.js";
import { registerUpdateTool, registerCreateTool } from "./_mutations.js";

/**
 * Register all company-related MCP tools on a server instance.
 * @param {import("@modelcontextprotocol/sdk/server/mcp.js").McpServer} server
 */
export function registerCompanyTools(server) {
  server.tool(
    "get_company_by_id",
    "Look up a single HubSpot company by its internal ID. Returns id, requested properties, and timestamps.",
    {
      company_id: z.string().describe("HubSpot internal company ID"),
      properties: z
        .array(z.string())
        .optional()
        .describe(
          "Specific company properties to return. Defaults to a small set of common fields."
        ),
    },
    async ({ company_id, properties }) => {
      try {
        return jsonText(await hubspot.getCompanyById(company_id, properties));
      } catch (err) {
        const status = statusOf(err);
        if (status === 404) return plainText(`No company found with id: ${company_id}`);
        return errorText(err, status);
      }
    }
  );

  server.tool(
    "get_company_by_domain",
    "Look up a single HubSpot company by domain (e.g., 'okta.com'). Returns null when no match exists.",
    {
      domain: z.string().describe("Company domain to look up (case-insensitive exact match)"),
      properties: z
        .array(z.string())
        .optional()
        .describe(
          "Specific company properties to return. Defaults to a small set of common fields."
        ),
    },
    async ({ domain, properties }) => {
      try {
        const company = await hubspot.getCompanyByDomain(domain, properties);
        if (!company) return plainText(`No company found with domain: ${domain}`);
        return jsonText(company);
      } catch (err) {
        return errorText(err, statusOf(err));
      }
    }
  );

  server.tool(
    "search_companies",
    "Search HubSpot companies by query and/or property filters. Returns paginated results with a next_cursor when more exist. Use list_properties first to discover available property names and types.",
    searchInputShape(
      "Specific company properties to return per result. Defaults to a small set of common fields."
    ),
    async (input) => {
      try {
        return jsonText(await hubspot.searchCompanies(input));
      } catch (err) {
        return errorText(err, statusOf(err));
      }
    }
  );

  registerUpdateTool(server, {
    toolName: "update_company",
    description:
      "Update one or more properties on a HubSpot company. Captures old + new state in the audit log; the response includes audit_id (use with rollback_change to revert) and changed_fields.",
    idField: "company_id",
    idDescription: "HubSpot internal company ID",
    update: hubspot.updateCompany,
  });

  registerCreateTool(server, {
    toolName: "create_company",
    description:
      "Create a new HubSpot company. Typically include `name` and/or `domain`. Captures the created entity in the audit log; rollback_change archives the company.",
    create: hubspot.createCompany,
  });
}
