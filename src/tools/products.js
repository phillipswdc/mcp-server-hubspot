/**
 * MCP tool registrations for HubSpot Products (Commerce Hub catalog).
 * Read-only — product mutations belong in the HubSpot UI or a separate
 * catalog management system.
 */
import { z } from "zod";
import { hubspot } from "../hubspot/index.js";
import { jsonText, plainText, errorText, statusOf } from "./_shared.js";
import { searchInputShape } from "./_search.js";
import { DEFAULT_PAGE_LIMIT, MAX_PAGE_LIMIT } from "../config/constants.js";

/**
 * Register all product-related MCP tools on a server instance.
 * @param {import("@modelcontextprotocol/sdk/server/mcp.js").McpServer} server
 */
export function registerProductTools(server) {
  server.tool(
    "get_product_by_id",
    "Look up a single HubSpot product (catalog item) by internal ID. Read-only — products are managed elsewhere.",
    {
      product_id: z.string().describe("HubSpot internal product ID"),
      properties: z
        .array(z.string())
        .optional()
        .describe("Specific product properties to return."),
    },
    async ({ product_id, properties }) => {
      try {
        return jsonText(await hubspot.getProductById(product_id, properties));
      } catch (err) {
        const status = statusOf(err);
        if (status === 404) return plainText(`No product found with id: ${product_id}`);
        return errorText(err, status, "Products");
      }
    }
  );

  server.tool(
    "search_products",
    "Search HubSpot products (catalog) by query and/or property filters. Returns paginated results with a next_cursor when more exist.",
    searchInputShape(
      "Specific product properties to return per result. Defaults to a small set."
    ),
    async (input) => {
      try {
        return jsonText(await hubspot.searchProducts(input));
      } catch (err) {
        return errorText(err, statusOf(err), "Products");
      }
    }
  );

  server.tool(
    "list_recent_products",
    "List products sorted by last-modified date descending. Use this to answer 'what products were updated recently' or 'what's the latest catalog state'.",
    {
      properties: z
        .array(z.string())
        .optional()
        .describe("Specific product properties to return per result."),
      limit: z
        .number()
        .int()
        .min(1)
        .max(MAX_PAGE_LIMIT)
        .optional()
        .default(DEFAULT_PAGE_LIMIT)
        .describe(`Max products per page (1-${MAX_PAGE_LIMIT}). Defaults to ${DEFAULT_PAGE_LIMIT}.`),
      after: z
        .string()
        .optional()
        .describe("Pagination cursor returned as next_cursor from a prior call."),
    },
    async ({ properties, limit, after }) => {
      try {
        return jsonText(
          await hubspot.listRecentProducts({ properties, limit, after })
        );
      } catch (err) {
        return errorText(err, statusOf(err), "Products");
      }
    }
  );
}
