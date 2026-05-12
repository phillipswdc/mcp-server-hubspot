/**
 * MCP tool registrations for Marketing Events (read-only).
 *
 * Marketing Events are CRM records modeling webinars / conferences / trade
 * shows — distinct from the unified Behavioral Events stream in events.js.
 *
 * Mutations are intentionally not exposed here; see the note in
 * src/hubspot/marketing_events.js.
 */
import { z } from "zod";
import { hubspot } from "../hubspot/index.js";
import { jsonText, plainText, errorText, statusOf } from "./_shared.js";
import { searchInputShape } from "./_search.js";
import { DEFAULT_PAGE_LIMIT, MAX_PAGE_LIMIT } from "../config/constants.js";

const ATTENDANCE_STATES = ["REGISTERED", "ATTENDED", "CANCELLED", "NO_SHOW"];

const externalIdShape = {
  marketing_event_id: z
    .union([z.string(), z.number()])
    .optional()
    .describe(
      "HubSpot internal marketing event ID. Required if external_event_id/external_account_id aren't supplied."
    ),
  external_event_id: z
    .string()
    .optional()
    .describe(
      "External event ID assigned by the source app (e.g. Zoom webinar ID). Use with external_account_id."
    ),
  external_account_id: z
    .string()
    .optional()
    .describe("External account ID assigned by the source app. Use with external_event_id."),
};

/**
 * @param {import("@modelcontextprotocol/sdk/server/mcp.js").McpServer} server
 */
export function registerMarketingEventTools(server) {
  server.tool(
    "list_marketing_events",
    "List marketing events in the portal (webinars, conferences, etc.). " +
      "Returns the dedicated-API shape (eventName, organizer, dates, attendance " +
      "counters). Paginated via next_cursor. For filtering by name / date / " +
      "status, use search_marketing_events instead.",
    {
      limit: z
        .number()
        .int()
        .min(1)
        .max(MAX_PAGE_LIMIT)
        .optional()
        .default(DEFAULT_PAGE_LIMIT)
        .describe(`Max events per page (1-${MAX_PAGE_LIMIT}). Defaults to ${DEFAULT_PAGE_LIMIT}.`),
      after: z
        .string()
        .optional()
        .describe("Pagination cursor returned as next_cursor from a prior call."),
    },
    async (args) => {
      try {
        return jsonText(await hubspot.listMarketingEvents(args));
      } catch (err) {
        return errorText(err, statusOf(err));
      }
    }
  );

  server.tool(
    "get_marketing_event_by_id",
    "Look up a single marketing event by HubSpot internal objectId. " +
      "Returns the full dedicated-API detail including attendance counters " +
      "and custom properties.",
    {
      marketing_event_id: z
        .string()
        .describe("HubSpot internal marketing event ID (objectId)."),
    },
    async (args) => {
      try {
        const res = await hubspot.getMarketingEventById(args.marketing_event_id);
        if (!res) return plainText(`No marketing event found with id: ${args.marketing_event_id}`);
        return jsonText(res);
      } catch (err) {
        const status = statusOf(err);
        if (status === 404) {
          return plainText(`No marketing event found with id: ${args.marketing_event_id}`);
        }
        return errorText(err, status);
      }
    }
  );

  server.tool(
    "search_marketing_events",
    "Search marketing events by query and/or property filters via the CRM " +
      "search API. Use for filtering by name, date range, status, organizer, etc.",
    searchInputShape("Specific marketing event properties to return per result."),
    async (input) => {
      try {
        return jsonText(await hubspot.searchMarketingEvents(input));
      } catch (err) {
        return errorText(err, statusOf(err));
      }
    }
  );

  server.tool(
    "get_marketing_event_participation_counters",
    "Get attendance counters (registered / attended / cancelled / no-show) " +
      "for a single marketing event. Identify the event by " +
      "marketing_event_id OR by external_account_id + external_event_id.",
    externalIdShape,
    async (args) => {
      try {
        return jsonText(await hubspot.getMarketingEventParticipationCounters(args));
      } catch (err) {
        return errorText(err, statusOf(err));
      }
    }
  );

  server.tool(
    "list_marketing_event_participants",
    "Paginated list of contacts who participated in a marketing event, with " +
      "attendance state and duration. Identify the event by marketing_event_id " +
      "OR external_account_id + external_event_id. Optionally filter by " +
      "attendance state or to a specific contact.",
    {
      ...externalIdShape,
      state: z
        .enum(ATTENDANCE_STATES)
        .optional()
        .describe("Filter to a single attendance state."),
      contact_identifier: z
        .string()
        .optional()
        .describe("Filter to a single contact (email or vid)."),
      limit: z
        .number()
        .int()
        .min(1)
        .max(MAX_PAGE_LIMIT)
        .optional()
        .default(DEFAULT_PAGE_LIMIT)
        .describe(`Max participants per page (1-${MAX_PAGE_LIMIT}).`),
      after: z
        .string()
        .optional()
        .describe("Pagination cursor returned as next_cursor from a prior call."),
    },
    async (args) => {
      try {
        return jsonText(await hubspot.listMarketingEventParticipants(args));
      } catch (err) {
        return errorText(err, statusOf(err));
      }
    }
  );

  server.tool(
    "list_contact_marketing_event_participations",
    "List every marketing event participation for a single contact, with " +
      "attendance state and duration per event.",
    {
      contact_identifier: z
        .string()
        .describe("Contact email or vid (HubSpot internal contact ID)."),
      state: z
        .enum(ATTENDANCE_STATES)
        .optional()
        .describe("Filter to a single attendance state."),
      limit: z
        .number()
        .int()
        .min(1)
        .max(MAX_PAGE_LIMIT)
        .optional()
        .default(DEFAULT_PAGE_LIMIT)
        .describe(`Max participations per page (1-${MAX_PAGE_LIMIT}).`),
      after: z
        .string()
        .optional()
        .describe("Pagination cursor returned as next_cursor from a prior call."),
    },
    async (args) => {
      try {
        return jsonText(
          await hubspot.listContactMarketingEventParticipations(args.contact_identifier, {
            state: args.state,
            limit: args.limit,
            after: args.after,
          })
        );
      } catch (err) {
        return errorText(err, statusOf(err));
      }
    }
  );
}
