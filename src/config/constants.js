/**
 * Project-wide constants. Centralized so behavior changes (TTLs, defaults,
 * supported object types) happen in one place rather than scattered across modules.
 */

/**
 * HubSpot CRM object types this server currently supports.
 *
 * Some entries here may be tier-gated by HubSpot (e.g. `orders` typically
 * requires Commerce Hub). Tools register regardless of tier; calls that hit
 * a feature the user's account doesn't have produce a clean tier-aware error
 * via the errorText helper. Run `check_feature_availability` to see what's
 * actually accessible with your current token.
 */
export const SUPPORTED_OBJECT_TYPES = Object.freeze([
  "contacts",
  "companies",
  "deals",
  "tickets",
  "orders",
  "line_items",
  "products",
  "quotes",
  "invoices",
  "subscriptions",
  "payments",
  "carts",
]);

/** Object types that require Commerce Hub or equivalent tier. */
export const COMMERCE_OBJECT_TYPES = Object.freeze([
  "orders",
  "line_items",
  "products",
  "quotes",
  "invoices",
  "subscriptions",
  "payments",
  "carts",
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

/** Default order properties. Commerce Hub object. */
export const DEFAULT_ORDER_PROPERTIES = Object.freeze([
  "hs_order_name",
  "hs_order_status",
  "hs_currency_code",
  "hs_total_price",
  "hs_subtotal_price",
  "hs_tax_amount",
  "hs_shipping_amount",
  "hs_external_order_id",
  "hubspot_owner_id",
  "createdate",
  "hs_lastmodifieddate",
]);

/** Default line item properties. Commerce Hub object — children of orders/deals/quotes. */
export const DEFAULT_LINE_ITEM_PROPERTIES = Object.freeze([
  "name",
  "quantity",
  "price",
  "amount",
  "hs_sku",
  "hs_product_id",
  "hs_recurring_billing_period",
  "hs_billing_period",
  "createdate",
  "hs_lastmodifieddate",
]);

/** Default product properties. Catalog records. */
export const DEFAULT_PRODUCT_PROPERTIES = Object.freeze([
  "name",
  "description",
  "price",
  "hs_sku",
  "hs_cost_of_goods_sold",
  "hs_recurring_billing_period",
  "createdate",
  "hs_lastmodifieddate",
]);

/** Default quote properties. Pre-sale documents attached to deals. */
export const DEFAULT_QUOTE_PROPERTIES = Object.freeze([
  "hs_title",
  "hs_status",
  "hs_quote_amount",
  "hs_currency",
  "hs_expiration_date",
  "hs_url",
  "hubspot_owner_id",
  "createdate",
  "hs_lastmodifieddate",
]);

/** Default invoice properties. Billed amounts (Commerce Hub). */
export const DEFAULT_INVOICE_PROPERTIES = Object.freeze([
  "hs_invoice_status",
  "hs_amount_billed",
  "hs_currency_code",
  "hs_due_date",
  "hs_external_invoice_id",
  "hubspot_owner_id",
  "createdate",
  "hs_lastmodifieddate",
]);

/** Default subscription properties. Recurring revenue records (Commerce Hub). */
export const DEFAULT_SUBSCRIPTION_PROPERTIES = Object.freeze([
  "hs_subscription_name",
  "hs_status",
  "hs_billing_frequency",
  "hs_total_value",
  "hs_currency_code",
  "hs_start_date",
  "hubspot_owner_id",
  "createdate",
  "hs_lastmodifieddate",
]);

/** Default payment properties. Payment records (Commerce Hub). */
export const DEFAULT_PAYMENT_PROPERTIES = Object.freeze([
  "hs_amount",
  "hs_currency_code",
  "hs_payment_status",
  "hs_payment_method",
  "hs_payment_date",
  "hubspot_owner_id",
  "createdate",
  "hs_lastmodifieddate",
]);

/** Default cart properties. Shopping cart state (Commerce Hub). */
export const DEFAULT_CART_PROPERTIES = Object.freeze([
  "hs_external_cart_id",
  "hs_cart_status",
  "hs_total_value",
  "hs_currency_code",
  "createdate",
  "hs_lastmodifieddate",
]);

/** Maximum results per page across search/list tools. Keeps token cost bounded. */
export const DEFAULT_PAGE_LIMIT = 10;
export const MAX_PAGE_LIMIT = 100;

/** Max length of the `properties` array in any single tool call (Layer 1). */
export const MAX_PROPERTIES_PER_REQUEST = 75;

/**
 * Hard byte cap on a single MCP tool response (Layer 2). ~7.5K tokens at
 * 4 bytes/token. Responses over this are refused with a "scope it down" error.
 */
export const MAX_RESPONSE_BYTES = 30_000;

/** TTL (ms) for cached HubSpot property definitions. */
export const PROPERTY_CACHE_TTL_MS = 5 * 60 * 1000;

/** Default retry attempts for HubSpot 429 responses (rate-limit). */
export const DEFAULT_RETRY_ATTEMPTS = 3;

/** Allowed values for property_notes.category. */
export const PROPERTY_CATEGORIES = Object.freeze([
  "compact",            // small, safe-by-default
  "potentially_large",  // long text fields, content/notes
  "computed",           // HubSpot-managed; read-only on writes
  "deprecated",         // flagged in HubSpot metadata
  "system",             // hs_* infrastructure fields
]);

/**
 * Property name patterns that indicate a likely-large value. Anything matching
 * is auto-categorized as "potentially_large" unless overridden.
 */
export const LARGE_PROPERTY_NAME_PATTERN = /(notes|description|content|body|comments|html)/i;

/**
 * Auto-cache threshold: any single property value over this many bytes is
 * stored in result_cache and replaced with a cached_ref handle in the MCP
 * response, so the bulk data never enters Claude's context unless explicitly
 * dereferenced via get_cached_value.
 */
export const AUTO_CACHE_VALUE_BYTES = 2_000;

/** Default TTL for result_cache rows. 1 hour. */
export const RESULT_CACHE_TTL_MS = 60 * 60 * 1000;

/** Preview length (chars) for cached values shown alongside the handle. */
export const CACHE_PREVIEW_CHARS = 200;

/**
 * Auto-pagination caps for paginateAndCache. When a list/search tool gets
 * cache: true, the server walks every page until the cursor is exhausted OR
 * one of these limits trips. Conservative defaults — large enough to cover
 * realistic marketing-event registrant lists (1-2k rows), small enough to
 * prevent a runaway query from monopolizing the rate budget.
 */
export const AUTO_PAGINATE_MAX_ROWS = 10_000;
export const AUTO_PAGINATE_MAX_PAGES = 200;
export const AUTO_PAGINATE_MAX_MS = 60_000;
/** Default per-page request size when auto-paginating; HubSpot caps at 100 for most endpoints. */
export const AUTO_PAGINATE_PAGE_SIZE = 100;
