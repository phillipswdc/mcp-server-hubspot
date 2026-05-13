/**
 * Events-domain wrapper methods. Read-only — wraps HubSpot's unified events
 * API at /events/v3/events, which surfaces cross-object timeline events
 * (web analytics events, custom behavioral events, CRM activity events).
 *
 * Two operations are exposed:
 *   - searchEvents — paginated query against the unified event stream, with
 *     filters for object_type / object_id / event_type / occurred_at range.
 *   - listEventTypes — returns the set of event type names visible to the
 *     portal (useful when the caller wants to pick a value for event_type).
 *
 * Auto-cache and result_cache flow through the same helpers used by the
 * CRM modules — large event payloads do not enter Claude's context unless
 * explicitly dereferenced.
 */
import { sdk } from "./client.js";
import { withRetry } from "./retry.js";
import { compact } from "./compact.js";
import { autoCacheLargeValues, maybeCacheResponse, paginateAndCache } from "./_cache.js";
import { AUTO_PAGINATE_PAGE_SIZE } from "../config/constants.js";

/**
 * Reshape a raw ExternalUnifiedEvent into the project's standard
 * {id, properties} envelope so query_cache can filter/sort uniformly via
 * properties.<field> against cached event sets.
 *
 * Metadata (event_type, object_type, object_id, occurred_at) is hoisted
 * INTO properties so it's queryable; the raw event properties dict is
 * spread in alongside it. Oversized values get auto-cached as elsewhere
 * to keep responses bounded.
 *
 * @param {object} res Raw event from the SDK.
 */
function shapeEvent(res) {
  const eventProps = autoCacheLargeValues(res.properties, {
    object_type: "events",
    object_id: res.id,
  });
  return (
    compact({
      id: res.id,
      properties: compact({
        event_type: res.eventType,
        object_type: res.objectType,
        object_id: res.objectId,
        occurred_at:
          res.occurredAt instanceof Date
            ? res.occurredAt.toISOString()
            : res.occurredAt,
        ...(eventProps ?? {}),
      }) ?? {},
    }) ?? { id: res.id }
  );
}

/**
 * Coerce an ISO-8601 string (or Date) into a Date instance for the SDK.
 * Returns undefined when the input is falsy so the SDK omits the query param.
 *
 * @param {string|Date|undefined|null} v
 */
function toDate(v) {
  if (!v) return undefined;
  if (v instanceof Date) return v;
  const d = new Date(v);
  if (Number.isNaN(d.getTime())) {
    throw new Error(`Invalid date value: ${v}. Expected ISO-8601 string.`);
  }
  return d;
}

/**
 * @typedef {object} SearchEventsInput
 * @property {string} [object_type] Filter to events for this CRM object type
 *   (e.g. "contacts", "companies", "deals") or app-specific type. Combines
 *   with object_id to scope to a single record's timeline.
 * @property {string|number} [object_id] CRM internal object ID. Sent as the
 *   numeric `objectId` query param.
 * @property {string} [event_type] Filter to a single event type name
 *   (e.g. "e_visited_page" or "pe1234567_my_custom_event"). Use
 *   listEventTypes() to enumerate.
 * @property {string[]} [event_ids] Specific event IDs to fetch.
 * @property {string|Date} [occurred_after] ISO-8601 lower bound (inclusive)
 *   on occurredAt.
 * @property {string|Date} [occurred_before] ISO-8601 upper bound (exclusive)
 *   on occurredAt.
 * @property {string} [after] Pagination cursor from a prior response.
 * @property {string} [before] Reverse pagination cursor (rarely used).
 * @property {number} [limit] Max results per page.
 * @property {string[]} [sort] Sort fields (e.g. ["-occurredAt"]).
 * @property {boolean} [cache] When true, full result set is stashed under a
 *   cache_id and the response returns a handle + sample instead of the bulk
 *   payload. See src/hubspot/_cache.js.
 */

/**
 * Query the unified events stream.
 *
 * When `cache: true`, walks every page until exhaustion (or AUTO_PAGINATE
 * caps trip) and stashes the union under a cache_id. Without that flag,
 * the single-page response is returned inline.
 *
 * Event volume can be enormous on busy portals (millions of records), so
 * the auto-paginate caps in constants.js are the load-bearing safety net.
 * Always combine cache:true with a tight scope (event_type, object_id,
 * occurred_after/before) on this endpoint.
 *
 * @param {SearchEventsInput} [input]
 */
export async function searchEvents(input = {}) {
  const occurredAfter = toDate(input.occurred_after);
  const occurredBefore = toDate(input.occurred_before);

  if (input.cache) {
    return paginateAndCache({
      tool_name: "search_events",
      source_args: input,
      object_type: "events",
      fetchPage: async (cursor) => {
        const res = await withRetry(() =>
          sdk.events.eventsApi.getPage(
            input.object_type,
            input.event_type,
            cursor,
            input.before,
            AUTO_PAGINATE_PAGE_SIZE,
            input.sort,
            occurredAfter,
            occurredBefore,
            input.object_id !== undefined && input.object_id !== null
              ? Number(input.object_id)
              : undefined,
            undefined,
            undefined,
            input.event_ids
          )
        );
        return {
          results: (res?.results ?? []).map(shapeEvent),
          next_cursor: res?.paging?.next?.after,
        };
      },
    });
  }

  const res = await withRetry(() =>
    sdk.events.eventsApi.getPage(
      input.object_type,
      input.event_type,
      input.after,
      input.before,
      input.limit,
      input.sort,
      occurredAfter,
      occurredBefore,
      input.object_id !== undefined && input.object_id !== null
        ? Number(input.object_id)
        : undefined,
      undefined,
      undefined,
      input.event_ids
    )
  );

  const shaped = (res?.results ?? []).map(shapeEvent);
  const response = {
    count: shaped.length,
    next_cursor: res?.paging?.next?.after,
    results: shaped,
  };

  return maybeCacheResponse(response, {
    useCache: false,
    tool_name: "search_events",
    source_args: input,
    object_type: "events",
  });
}

/**
 * Enumerate event type names visible to the current portal. Response is
 * typically small (a flat string array), so no cache integration here.
 *
 * @returns {Promise<{ count: number, event_types: string[] }>}
 */
export async function listEventTypes() {
  const res = await withRetry(() => sdk.events.eventsApi.getTypes());
  const types = res?.eventTypes ?? [];
  return { count: types.length, event_types: types };
}
