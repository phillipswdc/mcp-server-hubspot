/**
 * Marketing Events domain wrapper. Read-only surface.
 *
 * Marketing Events are CRM records modeling things like webinars, conferences,
 * and trade shows — distinct from the unified Behavioral Events stream in
 * events.js. HubSpot exposes them via two surfaces:
 *
 *   - Dedicated API (sdk.marketing.events.*) — richer shape with eventName,
 *     attendance counters, and participant state APIs.
 *   - Generic CRM objects (sdk.crm.objects with object_type="marketing_events")
 *     — filterable search semantics.
 *
 * We use the dedicated API for direct lookups and attendance reads, and the
 * generic search API for filtering by name/date/etc. Mutations (create /
 * update / archive) are intentionally NOT exported here — they require an
 * audit_log shim that adapts the dedicated SDK's non-standard get/update
 * signatures to auditedMutation. Add only when the use case is concrete.
 */
import { sdk } from "./client.js";
import { withRetry } from "./retry.js";
import { compact } from "./compact.js";
import { autoCacheLargeValues, paginateAndCache } from "./_cache.js";
import { AUTO_PAGINATE_PAGE_SIZE } from "../config/constants.js";

/**
 * Reshape a dedicated-API MarketingEventPublicReadResponseV2 into a stable
 * envelope. Date instances are flattened to ISO strings, customProperties
 * (which the SDK returns as an array of {name, value} wrappers) gets
 * flattened into a properties dict for parity with the rest of the CRM
 * surface.
 *
 * @param {object} res
 */
function shapeMarketingEvent(res) {
  if (!res) return null;
  const flatCustomProps = {};
  for (const p of res.customProperties ?? []) {
    if (p?.name) flatCustomProps[p.name] = p.value;
  }
  return compact({
    id: res.objectId,
    external_event_id: res.externalEventId,
    event_name: res.eventName,
    event_type: res.eventType,
    event_status: res.eventStatus,
    event_organizer: res.eventOrganizer,
    event_url: res.eventUrl,
    event_description: res.eventDescription,
    event_completed: res.eventCompleted,
    event_cancelled: res.eventCancelled,
    start_datetime: toIso(res.startDateTime),
    end_datetime: toIso(res.endDateTime),
    registrants: res.registrants,
    attendees: res.attendees,
    no_shows: res.noShows,
    cancellations: res.cancellations,
    app_info: res.appInfo,
    custom_properties: autoCacheLargeValues(flatCustomProps, {
      object_type: "marketing_events",
      object_id: res.objectId,
    }),
    created_at: toIso(res.createdAt),
    updated_at: toIso(res.updatedAt),
  });
}

/** Convert a Date (or already-ISO string) to ISO; undefined passes through. */
function toIso(v) {
  if (!v) return undefined;
  return v instanceof Date ? v.toISOString() : v;
}

/** Reshape an identifiersApi.doSearch result into a flat envelope. */
function shapeMarketingEventIdentifier(res) {
  return compact({
    id: res.objectId,
    external_account_id: res.externalAccountId,
    external_event_id: res.externalEventId,
    app_id: res.appId,
  });
}

/**
 * List marketing events (paginated, no filter).
 *
 * When `cache: true`, walks every page until exhaustion (or AUTO_PAGINATE
 * caps trip) and stashes the union under a cache_id — useful for portals
 * with hundreds of events where the model wants to slice the set locally
 * without burning rate-limit budget on repeat fetches.
 *
 * @param {{ after?: string, limit?: number, cache?: boolean }} [options]
 */
export async function listMarketingEvents(options = {}) {
  if (options.cache) {
    return paginateAndCache({
      tool_name: "list_marketing_events",
      source_args: options,
      object_type: "marketing_events",
      fetchPage: async (cursor) => {
        const res = await withRetry(() =>
          sdk.marketing.events.basicApi.getAll(cursor, AUTO_PAGINATE_PAGE_SIZE)
        );
        return {
          results: (res?.results ?? []).map(shapeMarketingEvent).filter(Boolean),
          next_cursor: res?.paging?.next?.after,
        };
      },
    });
  }
  const res = await withRetry(() =>
    sdk.marketing.events.basicApi.getAll(options.after, options.limit)
  );
  const results = (res?.results ?? []).map(shapeMarketingEvent).filter(Boolean);
  return {
    count: results.length,
    next_cursor: res?.paging?.next?.after,
    results,
  };
}

/**
 * Get one marketing event by HubSpot internal objectId.
 *
 * @param {string} objectId
 */
export async function getMarketingEventById(objectId) {
  const res = await withRetry(() =>
    sdk.marketing.events.basicApi.getByObjectId(objectId)
  );
  return shapeMarketingEvent(res);
}

/**
 * Search marketing events by external_event_id (the ID assigned by the
 * source app like Zoom, GoToWebinar, etc.). Hits
 * /marketing/v3/marketing-events/events/search?q=...
 *
 * IMPORTANT: this does NOT search by event name. To find an event by name,
 * page through listMarketingEvents and filter client-side. HubSpot doesn't
 * expose a name-based search for the marketing_events object type — the
 * generic CRM search endpoint rejects it.
 *
 * Returns lean identifier records (objectId, externalAccountId,
 * externalEventId, appId); chain into getMarketingEventById for full detail.
 *
 * @param {{ query: string }} input
 */
export async function searchMarketingEvents(input) {
  if (!input?.query) {
    throw new Error("search_marketing_events requires a 'query' string.");
  }
  const res = await withRetry(() =>
    sdk.marketing.events.identifiersApi.doSearch(input.query)
  );
  const results = (res?.results ?? []).map(shapeMarketingEventIdentifier);
  return {
    count: results.length,
    results,
    next_step:
      "These are identifier-only records. Use get_marketing_event_by_id with the returned id to fetch full event detail.",
  };
}

/**
 * Attendance counters (registered / attended / cancelled / no-show) for a
 * single marketing event. Accepts either the internal marketing_event_id OR
 * the external_account_id + external_event_id pair.
 *
 * @param {object} args
 * @param {string|number} [args.marketing_event_id]
 * @param {string} [args.external_event_id]
 * @param {string} [args.external_account_id]
 */
export async function getMarketingEventParticipationCounters(args) {
  const api = sdk.marketing.events.retrieveParticipantStateApi;
  let res;
  if (args.marketing_event_id !== undefined && args.marketing_event_id !== null) {
    res = await withRetry(() =>
      api.getParticipationsCountersByMarketingEventId(Number(args.marketing_event_id))
    );
  } else if (args.external_account_id && args.external_event_id) {
    res = await withRetry(() =>
      api.getParticipationsCountersByEventExternalId(
        args.external_account_id,
        args.external_event_id
      )
    );
  } else {
    throw new Error(
      "Provide either marketing_event_id, or both external_account_id and external_event_id."
    );
  }
  return {
    registered: res?.registered ?? 0,
    attended: res?.attended ?? 0,
    cancelled: res?.cancelled ?? 0,
    no_shows: res?.noShows ?? 0,
  };
}

/**
 * Reshape a ParticipationBreakdown row into the project's standard
 * {id, properties, createdAt} envelope so query_cache can filter/sort
 * against cached participation sets via json_extract on properties.<field>.
 *
 * Associations are nested under {contact, marketingEvent} on the SDK type —
 * we flatten the useful identifiers into properties so they're queryable
 * alongside attendance_state, occurred_at, etc.
 */
function shapeParticipation(row) {
  if (!row) return null;
  const p = row.properties ?? {};
  const assoc = row.associations ?? {};
  const contact = assoc.contact ?? {};
  const event = assoc.marketingEvent ?? {};
  return compact({
    id: row.id,
    properties: compact({
      contact_id: contact.contactId,
      contact_email: contact.email,
      contact_firstname: contact.firstname,
      contact_lastname: contact.lastname,
      marketing_event_id: event.marketingEventId,
      marketing_event_name: event.name,
      external_event_id: event.externalEventId,
      external_account_id: event.externalAccountId,
      attendance_state: p.attendanceState,
      attendance_duration_seconds: p.attendanceDurationSeconds,
      attendance_percentage: p.attendancePercentage,
      occurred_at:
        typeof p.occurredAt === "number"
          ? new Date(p.occurredAt).toISOString()
          : p.occurredAt,
    }) ?? {},
    createdAt: toIso(row.createdAt),
  });
}

/**
 * List participants (by attendance state) for a single marketing event.
 * Accepts marketing_event_id OR external_account_id + external_account_id.
 *
 * When `cache: true`, auto-paginates every state-breakdown page and caches
 * the union — the primary use case for this flag, since HubSpot's
 * participant pagination forces small page sizes and large events
 * (hundreds-to-thousands of registrants) get expensive fast.
 *
 * @param {object} args
 * @param {string|number} [args.marketing_event_id]
 * @param {string} [args.external_event_id]
 * @param {string} [args.external_account_id]
 * @param {string} [args.state] Filter to a specific state (REGISTERED / ATTENDED / CANCELLED / NO_SHOW)
 * @param {string} [args.contact_identifier] Filter to a single contact (email or vid)
 * @param {number} [args.limit] Single-page mode only — ignored when cache:true uses AUTO_PAGINATE_PAGE_SIZE.
 * @param {string} [args.after] Single-page mode only.
 * @param {boolean} [args.cache] When true, auto-paginate the full breakdown and cache the union.
 */
export async function listMarketingEventParticipants(args) {
  const api = sdk.marketing.events.retrieveParticipantStateApi;

  const fetchOnePage = (limit, after) => {
    if (args.marketing_event_id !== undefined && args.marketing_event_id !== null) {
      return api.getParticipationsBreakdownByMarketingEventId(
        Number(args.marketing_event_id),
        args.contact_identifier,
        args.state,
        limit,
        after
      );
    }
    if (args.external_account_id && args.external_event_id) {
      return api.getParticipationsBreakdownByExternalEventId(
        args.external_account_id,
        args.external_event_id,
        args.contact_identifier,
        args.state,
        limit,
        after
      );
    }
    throw new Error(
      "Provide either marketing_event_id, or both external_account_id and external_event_id."
    );
  };

  if (args.cache) {
    return paginateAndCache({
      tool_name: "list_marketing_event_participants",
      source_args: args,
      object_type: "marketing_event_participations",
      fetchPage: async (cursor) => {
        const res = await withRetry(() =>
          fetchOnePage(AUTO_PAGINATE_PAGE_SIZE, cursor)
        );
        return {
          results: (res?.results ?? []).map(shapeParticipation).filter(Boolean),
          next_cursor: res?.paging?.next?.after,
          total: res?.total,
        };
      },
    });
  }

  const res = await withRetry(() => fetchOnePage(args.limit, args.after));
  const results = (res?.results ?? []).map(shapeParticipation).filter(Boolean);
  return {
    total: res?.total ?? results.length,
    count: results.length,
    next_cursor: res?.paging?.next?.after,
    results,
  };
}

/**
 * List every marketing event participation for a single contact.
 *
 * When `cache: true`, auto-paginates the full set and caches the union.
 *
 * @param {string} contactIdentifier Contact email or vid
 * @param {{ state?: string, limit?: number, after?: string, cache?: boolean }} [options]
 */
export async function listContactMarketingEventParticipations(
  contactIdentifier,
  options = {}
) {
  const api = sdk.marketing.events.retrieveParticipantStateApi;

  if (options.cache) {
    return paginateAndCache({
      tool_name: "list_contact_marketing_event_participations",
      source_args: { contact_identifier: contactIdentifier, ...options },
      object_type: "marketing_event_participations",
      fetchPage: async (cursor) => {
        const res = await withRetry(() =>
          api.getParticipationsBreakdownByContactId(
            contactIdentifier,
            options.state,
            AUTO_PAGINATE_PAGE_SIZE,
            cursor
          )
        );
        return {
          results: (res?.results ?? []).map(shapeParticipation).filter(Boolean),
          next_cursor: res?.paging?.next?.after,
          total: res?.total,
        };
      },
    });
  }

  const res = await withRetry(() =>
    api.getParticipationsBreakdownByContactId(
      contactIdentifier,
      options.state,
      options.limit,
      options.after
    )
  );
  const results = (res?.results ?? []).map(shapeParticipation).filter(Boolean);
  return {
    total: res?.total ?? results.length,
    count: results.length,
    next_cursor: res?.paging?.next?.after,
    results,
  };
}
