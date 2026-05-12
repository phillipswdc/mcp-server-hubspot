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
import { autoCacheLargeValues, maybeCacheResponse } from "./_cache.js";
import { buildSearchRequest } from "./_search.js";

/** Default CRM properties surfaced when search_marketing_events isn't given a list. */
const DEFAULT_PROPERTIES = Object.freeze([
  "hs_event_name",
  "hs_event_type",
  "hs_event_status",
  "hs_event_organizer",
  "hs_event_url",
  "hs_start_datetime",
  "hs_end_datetime",
  "hs_event_completed",
  "hs_event_cancelled",
  "hs_external_event_id",
  "hs_external_account_id",
  "createdate",
  "hs_lastmodifieddate",
]);

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

/** Coerce the search-API SimplePublicObject shape into our standard envelope. */
function shapeMarketingEventFromCrm(res) {
  return (
    compact({
      id: res.id,
      properties: autoCacheLargeValues(res.properties, {
        object_type: "marketing_events",
        object_id: res.id,
      }),
      createdAt: res.createdAt,
      updatedAt: res.updatedAt,
    }) ?? { id: res.id }
  );
}

/**
 * List marketing events (paginated, no filter).
 *
 * @param {{ after?: string, limit?: number }} [options]
 */
export async function listMarketingEvents(options = {}) {
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
 * Search marketing events via the generic CRM search endpoint. Supports the
 * standard filter / sort / cache input shape used elsewhere in the project.
 *
 * @param {import("./_search.js").SearchInput} input
 */
export async function searchMarketingEvents(input) {
  const req = buildSearchRequest(input, DEFAULT_PROPERTIES);
  const res = await withRetry(() =>
    sdk.crm.objects.searchApi.doSearch("marketing_events", req)
  );
  const shaped = (res?.results ?? []).map(shapeMarketingEventFromCrm);
  const response = {
    total: res?.total ?? shaped.length,
    count: shaped.length,
    next_cursor: res?.paging?.next?.after,
    results: shaped,
  };
  return maybeCacheResponse(response, {
    useCache: input?.cache === true,
    tool_name: "search_marketing_events",
    source_args: input,
    object_type: "marketing_events",
  });
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

/** Reshape a ParticipationBreakdown row into a flat, named envelope. */
function shapeParticipation(row) {
  if (!row) return null;
  const props = row.properties ?? {};
  const assoc = row.associations ?? {};
  return compact({
    id: row.id,
    contact_id: assoc.contactId,
    marketing_event_id: assoc.marketingEventId,
    attendance_state: props.attendanceState,
    attendance_duration_seconds: props.attendanceDurationSeconds,
    attendance_percentage: props.attendancePercentage,
    occurred_at:
      typeof props.occurredAt === "number"
        ? new Date(props.occurredAt).toISOString()
        : props.occurredAt,
    created_at: toIso(row.createdAt),
  });
}

/**
 * List participants (by attendance state) for a single marketing event.
 * Accepts marketing_event_id OR external_account_id + external_event_id.
 *
 * @param {object} args
 * @param {string|number} [args.marketing_event_id]
 * @param {string} [args.external_event_id]
 * @param {string} [args.external_account_id]
 * @param {string} [args.state] Filter to a specific state (REGISTERED / ATTENDED / CANCELLED / NO_SHOW)
 * @param {string} [args.contact_identifier] Filter to a single contact (email or vid)
 * @param {number} [args.limit]
 * @param {string} [args.after]
 */
export async function listMarketingEventParticipants(args) {
  const api = sdk.marketing.events.retrieveParticipantStateApi;
  let res;
  if (args.marketing_event_id !== undefined && args.marketing_event_id !== null) {
    res = await withRetry(() =>
      api.getParticipationsBreakdownByMarketingEventId(
        Number(args.marketing_event_id),
        args.contact_identifier,
        args.state,
        args.limit,
        args.after
      )
    );
  } else if (args.external_account_id && args.external_event_id) {
    res = await withRetry(() =>
      api.getParticipationsBreakdownByExternalEventId(
        args.external_account_id,
        args.external_event_id,
        args.contact_identifier,
        args.state,
        args.limit,
        args.after
      )
    );
  } else {
    throw new Error(
      "Provide either marketing_event_id, or both external_account_id and external_event_id."
    );
  }
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
 * @param {string} contactIdentifier Contact email or vid
 * @param {{ state?: string, limit?: number, after?: string }} [options]
 */
export async function listContactMarketingEventParticipations(
  contactIdentifier,
  options = {}
) {
  const res = await withRetry(() =>
    sdk.marketing.events.retrieveParticipantStateApi.getParticipationsBreakdownByContactId(
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
