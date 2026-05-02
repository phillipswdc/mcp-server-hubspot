/**
 * MCP tool that probes each tier-gated commerce object once to report what's
 * actually accessible with the current HubSpot token. Pattern A from the
 * tier-handling design: tools always register, this tool tells you which
 * ones will work.
 *
 * Each probe is a cheap getPage(limit:1) call. Results aren't cached server-
 * side because tier changes are rare but the probe cost is trivial — running
 * this on demand is fine.
 */
import { jsonText, errorText, statusOf } from "./_shared.js";
import { sdk } from "../hubspot/client.js";
import { COMMERCE_OBJECT_TYPES } from "../config/constants.js";

const PROBES = {
  orders: () => sdk.crm.objects.basicApi.getPage("orders", 1),
  line_items: () => sdk.crm.lineItems.basicApi.getPage(1),
  products: () => sdk.crm.products.basicApi.getPage(1),
  quotes: () => sdk.crm.quotes.basicApi.getPage(1),
  invoices: () => sdk.crm.objects.basicApi.getPage("invoices", 1),
  subscriptions: () => sdk.crm.objects.basicApi.getPage("subscriptions", 1),
  payments: () => sdk.crm.objects.basicApi.getPage("payments", 1),
  carts: () => sdk.crm.objects.basicApi.getPage("carts", 1),
};

/**
 * Register the check_feature_availability MCP tool.
 * @param {import("@modelcontextprotocol/sdk/server/mcp.js").McpServer} server
 */
export function registerFeatureAvailabilityTools(server) {
  server.tool(
    "check_feature_availability",
    "Probe each tier-gated CRM object (orders, line_items, products, plus future commerce types) and report which are accessible with the current HubSpot token. Useful when set up on a new account, or when a tool returns a tier-related error and you want to confirm what the account actually supports. Each probe is a cheap one-record fetch.",
    {},
    async () => {
      const results = {};
      for (const objectType of COMMERCE_OBJECT_TYPES) {
        const probe = PROBES[objectType];
        if (!probe) {
          results[objectType] = { available: null, reason: "no probe configured" };
          continue;
        }
        try {
          await probe();
          results[objectType] = { available: true };
        } catch (err) {
          const status = statusOf(err);
          if (status === 403 || status === 404) {
            results[objectType] = {
              available: false,
              status,
              reason:
                status === 403
                  ? "Forbidden — feature likely not enabled on this account tier (Commerce Hub or equivalent required)."
                  : "Not Found — endpoint missing for this account, usually means the feature isn't provisioned.",
            };
          } else {
            results[objectType] = {
              available: null,
              status,
              reason: `Probe failed with unexpected error: ${err?.message?.slice(0, 200)}`,
            };
          }
        }
      }
      const summary = Object.entries(results).reduce(
        (acc, [k, v]) => {
          if (v.available === true) acc.available.push(k);
          else if (v.available === false) acc.unavailable.push(k);
          else acc.unknown.push(k);
          return acc;
        },
        { available: [], unavailable: [], unknown: [] }
      );
      return jsonText({ summary, details: results });
    }
  );
}
