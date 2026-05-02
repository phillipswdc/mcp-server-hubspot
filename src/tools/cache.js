/**
 * MCP tools for working with the local result_cache:
 *   - get_cached_value: dereference a cached property value
 *   - query_cache: filter/sort/paginate a cached result_set
 *   - cache_summary: schema overview of a cached result_set
 *   - list_active_caches: what's currently stored
 *   - expire_cache: manually delete a cache row
 */
import { z } from "zod";
import { hubspot } from "../hubspot/index.js";
import { jsonText, plainText, errorText, statusOf } from "./_shared.js";
import { filterSchema, sortSchema } from "./_search.js";

/**
 * Register cache MCP tools on a server instance.
 * @param {import("@modelcontextprotocol/sdk/server/mcp.js").McpServer} server
 */
export function registerCacheTools(server) {
  server.tool(
    "get_cached_value",
    "Retrieve the FULL untruncated value of a property that was auto-cached because it exceeded the inline-response threshold. The original response showed a `__cached_ref` handle and a preview; this tool fetches the complete value when you need it. Stays in the local SQLite — no HubSpot API call.",
    {
      cache_id: z
        .string()
        .describe("The cache_id from a __cached_ref handle (starts with 'rc_')"),
    },
    async ({ cache_id }) => {
      try {
        const out = hubspot.getCachedValue(cache_id);
        if (!out)
          return plainText(
            `Cache ${cache_id} not found or expired. Cached values have a 1-hour TTL by default — re-fetch the original entity to regenerate.`
          );
        return jsonText(out);
      } catch (err) {
        return errorText(err, statusOf(err));
      }
    }
  );

  server.tool(
    "query_cache",
    "Query a cached result_set with filters, sorts, and pagination. Operates entirely on local SQLite-stored data — no HubSpot API call, no token cost for the underlying records. Use this to drill down into a previously-cached search/list result. Filters use the same operators as search_* tools.",
    {
      cache_id: z
        .string()
        .describe("The cache_id of a previously-stored result_set"),
      filters: z
        .array(filterSchema)
        .optional()
        .describe("Filter conditions; all must match (AND logic)"),
      sorts: z
        .array(sortSchema)
        .optional()
        .describe("Sort order applied in array order"),
      properties: z
        .array(z.string())
        .max(75)
        .optional()
        .describe(
          "Restrict each result to these property names. Lower = smaller response."
        ),
      limit: z
        .number()
        .int()
        .min(1)
        .max(100)
        .optional()
        .default(10)
        .describe("Max rows to return (1-100). Defaults to 10."),
      offset: z
        .number()
        .int()
        .min(0)
        .optional()
        .default(0)
        .describe("Number of rows to skip — used for pagination."),
    },
    async ({ cache_id, filters, sorts, properties, limit, offset }) => {
      try {
        return jsonText(
          hubspot.queryCache(cache_id, {
            filters,
            sorts,
            properties,
            limit,
            offset,
          })
        );
      } catch (err) {
        return errorText(err, statusOf(err));
      }
    }
  );

  server.tool(
    "cache_summary",
    "Inspect a cached result_set without rehydrating its contents — counts, source tool args, byte size, expiration, and most-frequent property keys. Use before query_cache to know what fields exist and how many records are in the set.",
    {
      cache_id: z
        .string()
        .describe("The cache_id of a previously-stored result_set"),
    },
    async ({ cache_id }) => {
      try {
        return jsonText(hubspot.cacheSummary(cache_id));
      } catch (err) {
        return errorText(err, statusOf(err));
      }
    }
  );

  server.tool(
    "list_active_caches",
    "List all non-expired entries in result_cache. Defaults to current environment. Use current_session_only to scope to this server-process session.",
    {
      cache_type: z
        .enum(["result_set", "property_value"])
        .optional()
        .describe(
          "Optional: filter to one cache type. result_set = cached search/list output. property_value = cached oversized field value."
        ),
      current_session_only: z
        .boolean()
        .optional()
        .describe(
          "If true, restrict to caches written by this server-process session."
        ),
      limit: z
        .number()
        .int()
        .min(1)
        .max(200)
        .optional()
        .default(50)
        .describe("Max rows. Defaults to 50."),
    },
    async ({ cache_type, current_session_only, limit }) => {
      try {
        const env = hubspot.environment();
        const rows = hubspot.listCaches({
          environment: env.name,
          session_id: current_session_only ? env.session_id : null,
          cache_type: cache_type ?? null,
          limit,
        });
        return jsonText({ count: rows.length, rows });
      } catch (err) {
        return errorText(err, statusOf(err));
      }
    }
  );

  server.tool(
    "expire_cache",
    "Manually delete a cache_id from result_cache. Useful when you know a cached result_set is stale and want it gone immediately. Does not affect other caches or HubSpot data.",
    {
      cache_id: z.string().describe("The cache_id to delete"),
    },
    async ({ cache_id }) => {
      try {
        const deleted = hubspot.expireCache(cache_id);
        return jsonText({ cache_id, deleted });
      } catch (err) {
        return errorText(err, statusOf(err));
      }
    }
  );
}
