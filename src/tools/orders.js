/**
 * MCP tool registrations for HubSpot Orders (Commerce Hub).
 *
 * Tools register regardless of tier — the tier-aware errorText helper
 * produces a clean message when the underlying HubSpot account doesn't
 * have Commerce Hub enabled. Run check_feature_availability to confirm
 * what's accessible.
 */
import { z } from "zod";
import { hubspot } from "../hubspot/index.js";
import { jsonText, plainText, errorText, statusOf } from "./_shared.js";
import { searchInputShape } from "./_search.js";
import { registerUpdateTool, registerCreateTool } from "./_mutations.js";
import { DEFAULT_PAGE_LIMIT, MAX_PAGE_LIMIT } from "../config/constants.js";

/**
 * Register all order-related MCP tools on a server instance.
 * @param {import("@modelcontextprotocol/sdk/server/mcp.js").McpServer} server
 */
export function registerOrderTools(server) {
  server.tool(
    "get_order_by_id",
    "Look up a single HubSpot order by internal ID. Requires Commerce Hub on the account. Returns id, requested properties, and timestamps.",
    {
      order_id: z.string().describe("HubSpot internal order ID"),
      properties: z
        .array(z.string())
        .optional()
        .describe("Specific order properties to return. Defaults to a small set."),
    },
    async ({ order_id, properties }) => {
      try {
        return jsonText(await hubspot.getOrderById(order_id, properties));
      } catch (err) {
        const status = statusOf(err);
        if (status === 404) return plainText(`No order found with id: ${order_id}`);
        return errorText(err, status, "Orders");
      }
    }
  );

  server.tool(
    "search_orders",
    "Search HubSpot orders by query and/or property filters. Requires Commerce Hub. Returns paginated results with a next_cursor when more exist.",
    searchInputShape(
      "Specific order properties to return per result. Defaults to a small set."
    ),
    async (input) => {
      try {
        return jsonText(await hubspot.searchOrders(input));
      } catch (err) {
        return errorText(err, statusOf(err), "Orders");
      }
    }
  );

  registerCreateTool(server, {
    toolName: "create_order",
    description:
      "Create a new HubSpot order. Requires Commerce Hub. Captures the created entity in the audit log; rollback_change archives the order.",
    create: hubspot.createOrder,
  });

  registerUpdateTool(server, {
    toolName: "update_order",
    description:
      "Update one or more properties on a HubSpot order (e.g. hs_order_status). Requires Commerce Hub. Captures old + new state in the audit log.",
    idField: "order_id",
    idDescription: "HubSpot internal order ID",
    update: hubspot.updateOrder,
  });

  for (const [parent, methodName, toolName] of [
    ["contact", "listOrdersForContact", "list_orders_for_contact"],
    ["company", "listOrdersForCompany", "list_orders_for_company"],
    ["deal", "listOrdersForDeal", "list_orders_for_deal"],
  ]) {
    server.tool(
      toolName,
      `List orders associated with a HubSpot ${parent}. Requires Commerce Hub. Returns hydrated order records (not just IDs). Pagination via after / next_cursor.`,
      {
        [`${parent}_id`]: z.string().describe(`HubSpot internal ${parent} ID`),
        properties: z
          .array(z.string())
          .optional()
          .describe("Specific order properties to return per result."),
        limit: z
          .number()
          .int()
          .min(1)
          .max(MAX_PAGE_LIMIT)
          .optional()
          .default(DEFAULT_PAGE_LIMIT)
          .describe(`Max orders per page (1-${MAX_PAGE_LIMIT}). Defaults to ${DEFAULT_PAGE_LIMIT}.`),
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
          return errorText(err, statusOf(err), "Orders");
        }
      }
    );
  }
}
