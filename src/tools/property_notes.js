/**
 * MCP tool registrations for property categorization + the property_notes
 * annotation layer.
 */
import { z } from "zod";
import { hubspot } from "../hubspot/index.js";
import { jsonText, plainText, errorText, statusOf } from "./_shared.js";
import {
  SUPPORTED_OBJECT_TYPES,
  PROPERTY_CATEGORIES,
} from "../config/constants.js";

/**
 * Register property-notes MCP tools on a server instance.
 * @param {import("@modelcontextprotocol/sdk/server/mcp.js").McpServer} server
 */
export function registerPropertyNotesTools(server) {
  server.tool(
    "categorize_properties",
    "Walk every property of a HubSpot object type and write a category (compact / potentially_large / computed / deprecated / system) plus an optional one-line note to the local property_notes table. Uses the LLM (Ollama) when reachable for richer categories + auto-generated notes; falls back to rule-based categorization otherwise. Returns counts by category AND by source (so you can see what came from the LLM vs rules vs prior user notes). Useful before searches or updates so you know which fields are safe to fetch and which are likely to be large. Existing user-set notes survive re-runs.",
    {
      object_type: z
        .enum(SUPPORTED_OBJECT_TYPES)
        .describe("Which CRM object type to categorize"),
      use_llm: z
        .boolean()
        .optional()
        .default(true)
        .describe(
          "Use the LLM provider chain (Ollama → rules-only) for richer categorization with one-line notes. When false, skips the LLM entirely and uses only the rule-based categorizer. Defaults to true; ignored when no LLM provider is reachable (graceful fallback to rules)."
        ),
      llm_concurrency: z
        .number()
        .int()
        .min(1)
        .max(8)
        .optional()
        .default(2)
        .describe(
          "Number of LLM calls to dispatch in parallel. Local Ollama typically serves 1–2 inferences at a time; raising this past your hardware's capacity causes timeouts and silent fallback to rules. Default 2."
        ),
      limit_props: z
        .number()
        .int()
        .min(1)
        .optional()
        .describe(
          "Optional cap on how many properties to categorize. Useful for testing the LLM path on a small subset before committing to a full categorization run (which can be slow at hundreds of properties)."
        ),
      categories_to_enrich: z
        .array(z.enum(PROPERTY_CATEGORIES))
        .optional()
        .describe(
          "Restrict LLM enrichment to properties whose RULE-BASED category is in this list. Other properties still get a rule-based category but skip the LLM call entirely (no note generated). Common pattern: pass [\"compact\",\"potentially_large\"] to skip computed/system fields, which are usually self-explanatory by name. Cuts LLM calls roughly in half on a typical HubSpot account."
        ),
    },
    async ({ object_type, use_llm, llm_concurrency, limit_props, categories_to_enrich }) => {
      try {
        return jsonText(
          await hubspot.categorizeProperties(object_type, {
            useLLM: use_llm,
            llmConcurrency: llm_concurrency,
            limit_props,
            categories_to_enrich,
          })
        );
      } catch (err) {
        return errorText(err, statusOf(err));
      }
    }
  );

  server.tool(
    "set_property_note",
    "Manually annotate a property — assign a category and/or free-form notes. User-supplied notes outrank auto-derived ones via COALESCE-on-conflict, so manual annotations persist across `categorize_properties` re-runs. Useful for marking project-specific quirks like 'industry_v2 is what we actually use, not industry'.",
    {
      object_type: z
        .enum(SUPPORTED_OBJECT_TYPES)
        .describe("Which CRM object type the property belongs to"),
      property_name: z.string().describe("Internal property name"),
      category: z
        .enum(PROPERTY_CATEGORIES)
        .optional()
        .describe(
          "Optional category override. One of: compact, potentially_large, computed, deprecated, system"
        ),
      notes: z
        .string()
        .optional()
        .describe("Optional free-form annotation"),
    },
    async ({ object_type, property_name, category, notes }) => {
      try {
        const row = hubspot.setPropertyNote(object_type, property_name, {
          category,
          notes,
        });
        return jsonText(row);
      } catch (err) {
        return errorText(err, statusOf(err));
      }
    }
  );

  server.tool(
    "get_property_notes",
    "Read property annotations for an object type. Without filters, returns all notes for the type. With property_name, returns just that property's note. With category, filters to one category. Pair with list_properties for the canonical schema; this tool returns the editorial layer on top of it.",
    {
      object_type: z
        .enum(SUPPORTED_OBJECT_TYPES)
        .describe("Which CRM object type to query"),
      property_name: z
        .string()
        .optional()
        .describe("Optional: fetch the note for a single property"),
      category: z
        .enum(PROPERTY_CATEGORIES)
        .optional()
        .describe(
          "Optional: filter results to one category"
        ),
    },
    async ({ object_type, property_name, category }) => {
      try {
        const rows = hubspot.getPropertyNotes(object_type, {
          property_name,
          category,
        });
        if (!rows.length) {
          return plainText(
            `No property notes recorded for ${object_type}${
              property_name ? `/${property_name}` : ""
            }${category ? ` (category=${category})` : ""}. Run categorize_properties to populate.`
          );
        }
        return jsonText({ count: rows.length, rows });
      } catch (err) {
        return errorText(err, statusOf(err));
      }
    }
  );
}
