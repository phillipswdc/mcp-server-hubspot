/**
 * Reusable zod schemas for HubSpot Search API tool inputs.
 *
 * The HubSpot Search API takes the same filter / sort / pagination shape for
 * every CRM object, so any tool that searches contacts, companies, deals,
 * tickets reuses these schemas.
 */
import { z } from "zod";
import {
  DEFAULT_PAGE_LIMIT,
  MAX_PAGE_LIMIT,
  MAX_PROPERTIES_PER_REQUEST,
} from "../config/constants.js";

/** HubSpot Search API filter operators. */
export const FILTER_OPERATORS = [
  "EQ",
  "NEQ",
  "LT",
  "LTE",
  "GT",
  "GTE",
  "BETWEEN",
  "IN",
  "NOT_IN",
  "HAS_PROPERTY",
  "NOT_HAS_PROPERTY",
  "CONTAINS_TOKEN",
  "NOT_CONTAINS_TOKEN",
];

/** Single filter condition. */
export const filterSchema = z.object({
  propertyName: z
    .string()
    .describe("Internal HubSpot property name (e.g. 'name', 'amount', 'createdate')"),
  operator: z
    .enum(FILTER_OPERATORS)
    .describe(
      "Comparison operator. EQ/NEQ/LT/LTE/GT/GTE for scalars; IN/NOT_IN with `values`; BETWEEN with `value`+`highValue`; HAS_PROPERTY/NOT_HAS_PROPERTY take no value; CONTAINS_TOKEN for substring (use sparingly)."
    ),
  value: z
    .union([z.string(), z.number(), z.boolean()])
    .optional()
    .describe("Scalar value for the comparison. Omit for HAS_PROPERTY / NOT_HAS_PROPERTY."),
  highValue: z
    .union([z.string(), z.number()])
    .optional()
    .describe("Upper bound for BETWEEN."),
  values: z
    .array(z.union([z.string(), z.number()]))
    .optional()
    .describe("Value list for IN / NOT_IN."),
});

/** Filter group — filters within a group are AND'd; groups are OR'd together. */
export const filterGroupSchema = z.object({
  filters: z.array(filterSchema).min(1),
});

/** Sort spec. */
export const sortSchema = z.object({
  propertyName: z.string(),
  direction: z.enum(["ASCENDING", "DESCENDING"]).optional(),
});

/**
 * Build the standard zod object for any "search_*" tool input. Caller passes
 * a domain-specific description for `properties`.
 *
 * @param {string} propertiesDescription
 * @returns {z.ZodRawShape}
 */
export function searchInputShape(propertiesDescription) {
  return {
    query: z
      .string()
      .optional()
      .describe(
        "Optional natural-language search across default fields. Combines with filters when both supplied."
      ),
    filters: z
      .array(filterSchema)
      .optional()
      .describe(
        "Flat filter list — treated as a single AND group. Use filter_groups for OR logic."
      ),
    filter_groups: z
      .array(filterGroupSchema)
      .optional()
      .describe(
        "Explicit filter groups. Filters within a group are AND'd; groups are OR'd."
      ),
    sorts: z.array(sortSchema).optional().describe("Sort order, applied in array order."),
    properties: z
      .array(z.string())
      .max(MAX_PROPERTIES_PER_REQUEST)
      .optional()
      .describe(
        `${propertiesDescription} Hard cap of ${MAX_PROPERTIES_PER_REQUEST} entries per request — use list_properties to scope down before requesting more.`
      ),
    limit: z
      .number()
      .int()
      .min(1)
      .max(MAX_PAGE_LIMIT)
      .optional()
      .default(DEFAULT_PAGE_LIMIT)
      .describe(`Max results per page (1-${MAX_PAGE_LIMIT}). Defaults to ${DEFAULT_PAGE_LIMIT}.`),
    after: z
      .string()
      .optional()
      .describe("Pagination cursor returned as `next_cursor` from a prior call."),
  };
}
