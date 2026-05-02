/**
 * MCP tool registrations for the read-only commerce object types:
 * Invoices, Subscriptions, Payments, Carts.
 *
 * All four follow an identical shape (get_by_id, search, list_for_X) so
 * this file builds them via a small factory rather than five near-identical
 * tool files.
 */
import { z } from "zod";
import { hubspot } from "../hubspot/index.js";
import { jsonText, plainText, errorText, statusOf } from "./_shared.js";
import { searchInputShape } from "./_search.js";
import { DEFAULT_PAGE_LIMIT, MAX_PAGE_LIMIT } from "../config/constants.js";

/**
 * Register a get/search/list_for_* set for one read-only commerce type.
 *
 * @param {object} params
 * @param {import("@modelcontextprotocol/sdk/server/mcp.js").McpServer} params.server
 * @param {string} params.singular e.g. "invoice"
 * @param {string} params.featureLabel Used in error messages e.g. "Invoices"
 * @param {string} params.getMethod Method name on hubspot namespace
 * @param {string} params.searchMethod
 * @param {Array<{ parent: string, methodName: string }>} params.parents Which parent types support listing
 */
function registerReadOnlyCommerce({
  server,
  singular,
  featureLabel,
  getMethod,
  searchMethod,
  parents,
}) {
  const idArg = `${singular}_id`;
  const idDesc = `HubSpot internal ${singular} ID`;

  server.tool(
    `get_${singular}_by_id`,
    `Look up a single HubSpot ${singular} by internal ID. Read-only — ${singular}s are typically created by external systems and observed via this API.`,
    {
      [idArg]: z.string().describe(idDesc),
      properties: z
        .array(z.string())
        .optional()
        .describe(`Specific ${singular} properties to return.`),
    },
    async (args) => {
      try {
        const id = args[idArg];
        return jsonText(await hubspot[getMethod](id, args.properties));
      } catch (err) {
        const status = statusOf(err);
        if (status === 404) return plainText(`No ${singular} found with id: ${args[idArg]}`);
        return errorText(err, status, featureLabel);
      }
    }
  );

  server.tool(
    `search_${singular}s`,
    `Search HubSpot ${singular}s by query and/or property filters. Returns paginated results with a next_cursor when more exist.`,
    searchInputShape(`Specific ${singular} properties to return per result.`),
    async (input) => {
      try {
        return jsonText(await hubspot[searchMethod](input));
      } catch (err) {
        return errorText(err, statusOf(err), featureLabel);
      }
    }
  );

  for (const { parent, methodName } of parents) {
    server.tool(
      `list_${singular}s_for_${parent}`,
      `List ${singular}s associated with a HubSpot ${parent}. Returns hydrated records (not just IDs). Pagination via after / next_cursor.`,
      {
        [`${parent}_id`]: z.string().describe(`HubSpot internal ${parent} ID`),
        properties: z
          .array(z.string())
          .optional()
          .describe(`Specific ${singular} properties to return per result.`),
        limit: z
          .number()
          .int()
          .min(1)
          .max(MAX_PAGE_LIMIT)
          .optional()
          .default(DEFAULT_PAGE_LIMIT)
          .describe(`Max ${singular}s per page (1-${MAX_PAGE_LIMIT}). Defaults to ${DEFAULT_PAGE_LIMIT}.`),
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
          return errorText(err, statusOf(err), featureLabel);
        }
      }
    );
  }
}

/**
 * Register Invoice/Subscription/Payment/Cart MCP tools.
 * @param {import("@modelcontextprotocol/sdk/server/mcp.js").McpServer} server
 */
export function registerCommerceReadTools(server) {
  registerReadOnlyCommerce({
    server,
    singular: "invoice",
    featureLabel: "Invoices",
    getMethod: "getInvoiceById",
    searchMethod: "searchInvoices",
    parents: [
      { parent: "contact", methodName: "listInvoicesForContact" },
      { parent: "company", methodName: "listInvoicesForCompany" },
    ],
  });

  registerReadOnlyCommerce({
    server,
    singular: "subscription",
    featureLabel: "Subscriptions",
    getMethod: "getSubscriptionById",
    searchMethod: "searchSubscriptions",
    parents: [
      { parent: "contact", methodName: "listSubscriptionsForContact" },
      { parent: "company", methodName: "listSubscriptionsForCompany" },
    ],
  });

  registerReadOnlyCommerce({
    server,
    singular: "payment",
    featureLabel: "Payments",
    getMethod: "getPaymentById",
    searchMethod: "searchPayments",
    parents: [
      { parent: "contact", methodName: "listPaymentsForContact" },
      { parent: "company", methodName: "listPaymentsForCompany" },
    ],
  });

  registerReadOnlyCommerce({
    server,
    singular: "cart",
    featureLabel: "Carts",
    getMethod: "getCartById",
    searchMethod: "searchCarts",
    parents: [{ parent: "contact", methodName: "listCartsForContact" }],
  });
}
