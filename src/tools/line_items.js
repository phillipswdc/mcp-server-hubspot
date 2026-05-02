/**
 * MCP tool registrations for HubSpot Line Items (Commerce Hub).
 */
import { z } from "zod";
import { hubspot } from "../hubspot/index.js";
import { jsonText, plainText, errorText, statusOf } from "./_shared.js";
import { searchInputShape } from "./_search.js";
import { registerUpdateTool, registerCreateTool } from "./_mutations.js";
import { DEFAULT_PAGE_LIMIT, MAX_PAGE_LIMIT } from "../config/constants.js";

/**
 * Register all line-item-related MCP tools on a server instance.
 * @param {import("@modelcontextprotocol/sdk/server/mcp.js").McpServer} server
 */
export function registerLineItemTools(server) {
  server.tool(
    "get_line_item_by_id",
    "Look up a single HubSpot line item by internal ID. Line items are children of orders, deals, and quotes — they represent the products/services on a transaction.",
    {
      line_item_id: z.string().describe("HubSpot internal line item ID"),
      properties: z
        .array(z.string())
        .optional()
        .describe("Specific line item properties to return."),
    },
    async ({ line_item_id, properties }) => {
      try {
        return jsonText(await hubspot.getLineItemById(line_item_id, properties));
      } catch (err) {
        const status = statusOf(err);
        if (status === 404) return plainText(`No line item found with id: ${line_item_id}`);
        return errorText(err, status, "Line items");
      }
    }
  );

  server.tool(
    "search_line_items",
    "Search HubSpot line items by query and/or property filters. Returns paginated results with a next_cursor when more exist.",
    searchInputShape(
      "Specific line item properties to return per result. Defaults to a small set."
    ),
    async (input) => {
      try {
        return jsonText(await hubspot.searchLineItems(input));
      } catch (err) {
        return errorText(err, statusOf(err), "Line items");
      }
    }
  );

  registerCreateTool(server, {
    toolName: "create_line_item",
    description:
      "Create a new HubSpot line item. Typically attached to a deal, order, or quote via associations. Captures the created entity in the audit log; rollback_change archives it.",
    create: hubspot.createLineItem,
  });

  registerUpdateTool(server, {
    toolName: "update_line_item",
    description:
      "Update one or more properties on a HubSpot line item (e.g. quantity, price). Captures old + new state in the audit log.",
    idField: "line_item_id",
    idDescription: "HubSpot internal line item ID",
    update: hubspot.updateLineItem,
  });

  for (const [parent, methodName, toolName] of [
    ["deal", "listLineItemsForDeal", "list_line_items_for_deal"],
    ["order", "listLineItemsForOrder", "list_line_items_for_order"],
  ]) {
    server.tool(
      toolName,
      `List line items associated with a HubSpot ${parent}. Returns hydrated line item records (not just IDs). Pagination via after / next_cursor.`,
      {
        [`${parent}_id`]: z.string().describe(`HubSpot internal ${parent} ID`),
        properties: z
          .array(z.string())
          .optional()
          .describe("Specific line item properties to return per result."),
        limit: z
          .number()
          .int()
          .min(1)
          .max(MAX_PAGE_LIMIT)
          .optional()
          .default(DEFAULT_PAGE_LIMIT)
          .describe(`Max line items per page (1-${MAX_PAGE_LIMIT}). Defaults to ${DEFAULT_PAGE_LIMIT}.`),
        after: z
          .string()
          .optional()
          .describe("Pagination cursor returned as next_cursor from a prior call."),
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
          return errorText(err, statusOf(err), "Line items");
        }
      }
    );
  }
}
