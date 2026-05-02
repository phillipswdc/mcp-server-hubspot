/**
 * Project-wide constants. Centralized so behavior changes (TTLs, defaults,
 * supported object types) happen in one place rather than scattered across modules.
 */

/** HubSpot CRM object types this server currently supports. */
export const SUPPORTED_OBJECT_TYPES = Object.freeze([
  "contacts",
  "companies",
  "deals",
  "tickets",
]);

/** Default contact properties returned when the caller doesn't specify a list. */
export const DEFAULT_CONTACT_PROPERTIES = Object.freeze([
  "firstname",
  "lastname",
  "email",
  "phone",
  "company",
  "lifecyclestage",
]);

/** Default company properties returned when the caller doesn't specify a list. */
export const DEFAULT_COMPANY_PROPERTIES = Object.freeze([
  "name",
  "domain",
  "website",
  "industry",
  "city",
  "state",
  "country",
  "lifecyclestage",
]);

/** Default deal properties returned when the caller doesn't specify a list. */
export const DEFAULT_DEAL_PROPERTIES = Object.freeze([
  "dealname",
  "amount",
  "dealstage",
  "pipeline",
  "closedate",
  "hubspot_owner_id",
  "dealtype",
]);

/**
 * Default ticket properties. Excludes `content` because ticket bodies can be
 * arbitrarily large; callers must request it explicitly when they need it.
 */
export const DEFAULT_TICKET_PROPERTIES = Object.freeze([
  "subject",
  "hs_pipeline",
  "hs_pipeline_stage",
  "hs_ticket_priority",
  "hs_ticket_category",
  "hubspot_owner_id",
  "source_type",
]);

/** Maximum results per page across search/list tools. Keeps token cost bounded. */
export const DEFAULT_PAGE_LIMIT = 10;
export const MAX_PAGE_LIMIT = 100;

/** Max length of the `properties` array in any single tool call (Layer 1). */
export const MAX_PROPERTIES_PER_REQUEST = 30;

/**
 * Hard byte cap on a single MCP tool response (Layer 2). ~7.5K tokens at
 * 4 bytes/token. Responses over this are refused with a "scope it down" error.
 */
export const MAX_RESPONSE_BYTES = 30_000;

/** TTL (ms) for cached HubSpot property definitions. */
export const PROPERTY_CACHE_TTL_MS = 5 * 60 * 1000;

/** Default retry attempts for HubSpot 429 responses (rate-limit). */
export const DEFAULT_RETRY_ATTEMPTS = 3;
