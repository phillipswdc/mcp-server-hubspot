/**
 * MCP tool registrations for the HubSpot Events API (read-only).
 *
 * Exposes two tools:
 *   - search_events       — paginated query against /events/v3/events
 *   - list_event_types    — enumerate visible event type names
 *
 * Sending custom behavioral events (POST /events/v3/send) is a separate
 * mutation surface and is intentionally NOT registered here — that path
 * needs audit_log integration before it can be added.
 */
import { z } from "zod";
import { hubspot } from "../hubspot/index.js";
import { jsonText, errorText, statusOf } from "./_shared.js";
import { DEFAULT_PAGE_LIMIT, MAX_PAGE_LIMIT } from "../config/constants.js";

const isoDateString = z
  .string()
  .refine((s) => !Number.isNaN(Date.parse(s)), {
    message: "Must be an ISO-8601 date string (e.g. 2026-05-01T00:00:00Z).",
  });

/**
 * @param {import("@modelcontextprotocol/sdk/server/mcp.js").McpServer} server
 */
export function registerEventTools(server) {
  server.tool(
    "search_events",
    "Query the HubSpot unified events stream (/events/v3/events). Returns " +
      "cross-object timeline events — web analytics events, custom behavioral " +
      "events, CRM activity events — filterable by object, event type, and " +
      "occurred-at range. Pagination via next_cursor. Pass cache:true to " +
      "stash large result sets and get back a handle instead of the bulk payload.",
    {
      object_type: z
        .string()
        .optional()
        .describe(
          "CRM object type to filter on, e.g. 'contacts', 'companies', " +
            "'deals'. Combine with object_id to scope to a single record's timeline."
        ),
      object_id: z
        .union([z.string(), z.number()])
        .optional()
        .describe("Internal HubSpot object ID. Requires object_type to be useful."),
      event_type: z
        .string()
        .optional()
        .describe(
          "Specific event type name (e.g. 'e_visited_page' or " +
            "'pe1234567_my_custom_event'). Use list_event_types to enumerate."
        ),
      event_ids: z
        .array(z.string())
        .optional()
        .describe("Fetch specific events by ID."),
      occurred_after: isoDateString
        .optional()
        .describe("ISO-8601 lower bound (inclusive) on occurredAt."),
      occurred_before: isoDateString
        .optional()
        .describe("ISO-8601 upper bound (exclusive) on occurredAt."),
      after: z
        .string()
        .optional()
        .describe("Pagination cursor returned as next_cursor from a prior call."),
      before: z
        .string()
        .optional()
        .describe("Reverse pagination cursor (rarely used)."),
      limit: z
        .number()
        .int()
        .min(1)
        .max(MAX_PAGE_LIMIT)
        .optional()
        .default(DEFAULT_PAGE_LIMIT)
        .describe(`Max events per page (1-${MAX_PAGE_LIMIT}). Defaults to ${DEFAULT_PAGE_LIMIT}.`),
      sort: z
        .array(z.string())
        .optional()
        .describe(
          "Sort fields. Prefix with '-' for descending (e.g. ['-occurredAt'])."
        ),
      cache: z
        .boolean()
        .optional()
        .describe(
          "When true, stash the full result set under a cache_id and return " +
            "a handle + sample. Recommended for high-volume time ranges."
        ),
    },
    async (input) => {
      try {
        return jsonText(await hubspot.searchEvents(input));
      } catch (err) {
        return errorText(err, statusOf(err));
      }
    }
  );

  server.tool(
    "list_event_types",
    "Enumerate event type names visible to the current HubSpot portal " +
      "(/events/v3/events/event-types). Useful for picking a value for the " +
      "event_type filter on search_events.",
    {},
    async () => {
      try {
        return jsonText(await hubspot.listEventTypes());
      } catch (err) {
        return errorText(err, statusOf(err));
      }
    }
  );
}
