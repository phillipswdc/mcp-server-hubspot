/**
 * Shared helpers for building HubSpot CRM Search API requests.
 *
 * The Search API for every CRM object accepts the same request shape, so we
 * normalize it in one place rather than repeat per-domain.
 *
 * @typedef {{
 *   query?: string,
 *   filters?: Array<{propertyName: string, operator: string, value?: unknown, values?: unknown[]}>,
 *   filter_groups?: Array<{filters: Array<{propertyName: string, operator: string, value?: unknown, values?: unknown[]}>}>,
 *   sorts?: Array<{propertyName: string, direction?: 'ASCENDING'|'DESCENDING'}>,
 *   properties?: string[],
 *   limit?: number,
 *   after?: string|number
 * }} SearchInput
 */

/**
 * Translate the tool-friendly SearchInput into a HubSpot SDK
 * PublicObjectSearchRequest. Accepts either a flat `filters` array (treated as
 * a single AND group) or an explicit `filter_groups` array (each group is OR'd
 * across groups, AND'd within).
 *
 * @param {SearchInput} input
 * @param {string[]} defaultProperties Fallback when input.properties is omitted
 * @returns {object} HubSpot PublicObjectSearchRequest
 */
export function buildSearchRequest(input, defaultProperties) {
  const {
    query,
    filters,
    filter_groups,
    sorts,
    properties,
    limit = 10,
    after,
  } = input ?? {};

  const groups =
    filter_groups ??
    (filters && filters.length ? [{ filters }] : []);

  const sortObjs = (sorts ?? []).map((s) => ({
    propertyName: s.propertyName,
    direction: s.direction ?? "DESCENDING",
  }));

  return {
    filterGroups: groups,
    query,
    sorts: sortObjs,
    properties: properties ?? [...defaultProperties],
    limit,
    after,
  };
}

/**
 * Normalize a HubSpot search response to a compact, MCP-friendly shape.
 *
 * @param {object} res Raw SDK response: { total, results, paging }
 * @returns {{ total: number, count: number, next_cursor?: string, results: object[] }}
 */
export function normalizeSearchResponse(res) {
  const results = (res?.results ?? []).map((r) => ({
    id: r.id,
    properties: r.properties,
    createdAt: r.createdAt,
    updatedAt: r.updatedAt,
  }));
  return {
    total: res?.total ?? results.length,
    count: results.length,
    next_cursor: res?.paging?.next?.after,
    results,
  };
}
