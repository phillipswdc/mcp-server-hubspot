/**
 * MCP tool registrations for HubSpot Quotes (read-only).
 */
import { z } from "zod";
import { hubspot } from "../hubspot/index.js";
import { jsonText, plainText, errorText, statusOf } from "./_shared.js";
import { searchInputShape } from "./_search.js";
import { DEFAULT_PAGE_LIMIT, MAX_PAGE_LIMIT } from "../config/constants.js";

/**
 * @param {import("@modelcontextprotocol/sdk/server/mcp.js").McpServer} server
 */
export function registerQuoteTools(server) {
  server.tool(
    "get_quote_by_id",
    "Look up a single HubSpot quote by internal ID. Read-only — quotes are typically generated via HubSpot's quote builder, not via API.",
    {
      quote_id: z.string().describe("HubSpot internal quote ID"),
      properties: z
        .array(z.string())
        .optional()
        .describe("Specific quote properties to return."),
    },
    async ({ quote_id, properties }) => {
      try {
        return jsonText(await hubspot.getQuoteById(quote_id, properties));
      } catch (err) {
        const status = statusOf(err);
        if (status === 404) return plainText(`No quote found with id: ${quote_id}`);
        return errorText(err, status, "Quotes");
      }
    }
  );

  server.tool(
    "search_quotes",
    "Search HubSpot quotes by query and/or property filters. Returns paginated results with a next_cursor when more exist.",
    searchInputShape("Specific quote properties to return per result. Defaults to a small set."),
    async (input) => {
      try {
        return jsonText(await hubspot.searchQuotes(input));
      } catch (err) {
        return errorText(err, statusOf(err), "Quotes");
      }
    }
  );

  for (const [parent, methodName, toolName] of [
    ["contact", "listQuotesForContact", "list_quotes_for_contact"],
    ["company", "listQuotesForCompany", "list_quotes_for_company"],
    ["deal", "listQuotesForDeal", "list_quotes_for_deal"],
  ]) {
    server.tool(
      toolName,
      `List quotes associated with a HubSpot ${parent}. Returns hydrated quote records (not just IDs). Pagination via after / next_cursor.`,
      {
        [`${parent}_id`]: z.string().describe(`HubSpot internal ${parent} ID`),
        properties: z.array(z.string()).optional().describe("Specific quote properties to return per result."),
        limit: z.number().int().min(1).max(MAX_PAGE_LIMIT).optional().default(DEFAULT_PAGE_LIMIT)
          .describe(`Max quotes per page (1-${MAX_PAGE_LIMIT}). Defaults to ${DEFAULT_PAGE_LIMIT}.`),
        after: z.string().optional().describe("Pagination cursor returned as next_cursor from a prior call."),
      },
      async (args) => {
        try {
          const id = args[`${parent}_id`];
          return jsonText(
            await hubspot[methodName](id, {
              properties: args.properties,
              limit: args.limit,
              after: args.after,
            })
          );
        } catch (err) {
          return errorText(err, statusOf(err), "Quotes");
        }
      }
    );
  }
}
