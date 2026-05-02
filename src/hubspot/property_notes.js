/**
 * Property categorization + persistent notes domain logic.
 *
 * Combines HubSpot's property metadata (read via the property cache) with our
 * local `property_notes` annotations. Auto-categorization runs against rule
 * heuristics and is the floor — user/LLM annotations can override.
 */
import { listProperties } from "./properties.js";
import {
  upsertPropertyNotesBatch,
  upsertPropertyNote,
  getNotesForObjectType,
  getNoteForProperty,
  getNotesByCategory,
} from "../db/queries/property_notes.js";
import {
  PROPERTY_CATEGORIES,
  LARGE_PROPERTY_NAME_PATTERN,
} from "../config/constants.js";
import { runLLMTask } from "../llm/index.js";

/**
 * Apply rule-based categorization to a HubSpot property definition.
 * Order matters: deprecated > computed > potentially_large > system > compact.
 *
 * @param {object} prop HubSpot property definition (from listProperties)
 * @returns {string} One of PROPERTY_CATEGORIES
 */
export function categorizePropertyByRule(prop) {
  if (!prop) return "compact";
  if (prop.deprecated === true) return "deprecated";
  if (prop.modificationMetadata?.readOnlyValue === true) return "computed";
  if (prop.calculated === true) return "computed";
  if (prop.fieldType === "textarea") return "potentially_large";
  if (typeof prop.name === "string" && LARGE_PROPERTY_NAME_PATTERN.test(prop.name)) {
    return "potentially_large";
  }
  if (typeof prop.name === "string" && prop.name.startsWith("hs_")) {
    return "system";
  }
  return "compact";
}

/**
 * Fetch all properties for an object type and write categories to
 * property_notes. Tries an LLM first (Ollama or sampling) for richer
 * categories + a one-line note per property; falls back to rule-based
 * categorization if the LLM layer is unreachable or output fails validation.
 *
 * Rule-based result is the floor — if the LLM disagrees with a strong rule
 * (e.g. textarea fieldType → potentially_large), we trust the rule.
 *
 * Existing user-set notes survive thanks to the COALESCE-on-conflict logic.
 *
 * Concurrency: when LLM is enabled, calls are dispatched through a small
 * worker pool (default 2) to avoid saturating Ollama. Naive Promise.all
 * here would issue N concurrent inference requests — a typical Ollama
 * install serves only 1–2 in parallel, so the remainder queue or hit the
 * 5s per-call timeout, falling back to rules silently. Worker-pool with
 * matched concurrency keeps every call inside the timeout window.
 *
 * @param {"contacts"|"companies"|"deals"|"tickets"} objectType
 * @param {{ useLLM?: boolean, llmConcurrency?: number, limit_props?: number, categories_to_enrich?: string[] }} [options]
 * @returns {Promise<object>}
 */
export async function categorizeProperties(
  objectType,
  {
    useLLM = true,
    llmConcurrency = 2,
    limit_props = null,
    categories_to_enrich = null,
  } = {}
) {
  const allProps = await listProperties(objectType);
  const props =
    Number.isFinite(limit_props) && limit_props > 0
      ? allProps.slice(0, limit_props)
      : allProps;

  // Pass 1: rule-based categorization for ALL properties. Instant.
  const ruleRows = props.map((p) => ({
    prop: p,
    rule: categorizePropertyByRule(p),
  }));

  // Decide which properties get LLM enrichment. When categories_to_enrich is
  // set, properties whose rule-based category isn't in the list skip the LLM
  // entirely — saves time + Ollama load. Computed/system fields are usually
  // self-explanatory by name and don't benefit from LLM-generated notes.
  const enrichmentFilter =
    Array.isArray(categories_to_enrich) && categories_to_enrich.length
      ? new Set(categories_to_enrich)
      : null;

  const needsEnrichment = useLLM
    ? ruleRows.filter(({ rule }) =>
        enrichmentFilter ? enrichmentFilter.has(rule) : true
      )
    : [];

  // Pass 2: LLM enrichment, throttled through the worker pool.
  /** @type {Map<string, { category: string, notes: string, source: string }>} */
  const enriched = new Map();
  if (needsEnrichment.length) {
    const enrichedResults = await runWithConcurrency(
      needsEnrichment,
      llmConcurrency,
      async ({ prop, rule }) => {
        const llm = await classifyWithLLM(prop, rule);
        return { name: prop.name, llm };
      }
    );
    for (const { name, llm } of enrichedResults) {
      if (llm) enriched.set(name, llm);
    }
  }

  // Compose the final rows: LLM result if available + cross-checked, otherwise
  // rule-based with no notes.
  const rows = ruleRows.map(({ prop, rule }) => {
    let category = rule;
    let notes = null;
    let source = "auto";

    const llm = enriched.get(prop.name);
    if (llm) {
      // Trust strong rules (potentially_large/computed/deprecated) over the
      // LLM. Only let the LLM upgrade compact/system → richer categories.
      if (rule === "compact" || rule === "system" || llm.category === rule) {
        category = PROPERTY_CATEGORIES.includes(llm.category) ? llm.category : rule;
      }
      notes = typeof llm.notes === "string" ? llm.notes.slice(0, 200) : null;
      // Source column has a CHECK constraint limited to 'auto'|'user'|'llm-derived'.
      // Full provenance like "llm-derived:ollama:gemma4:e4b" is preserved in tool
      // responses and llm_status; here we store the bucket only.
      source = llm.source.startsWith("llm-derived") ? "llm-derived" : "auto";
    }

    return {
      object_type: objectType,
      property_name: prop.name,
      category,
      notes,
      source,
    };
  });

  upsertPropertyNotesBatch(rows);

  const byCategory = {};
  const bySource = {};
  for (const r of rows) {
    byCategory[r.category] = (byCategory[r.category] ?? 0) + 1;
    bySource[r.source] = (bySource[r.source] ?? 0) + 1;
  }
  return {
    object_type: objectType,
    count: rows.length,
    total_available: allProps.length,
    by_category: byCategory,
    by_source: bySource,
    llm_used: useLLM,
    llm_concurrency: useLLM ? llmConcurrency : 0,
    llm_attempted: needsEnrichment.length,
    llm_succeeded: enriched.size,
    enrichment_filter: enrichmentFilter ? [...enrichmentFilter] : null,
  };
}

/**
 * Worker-pool runner. Processes `items` through `fn` with at most
 * `concurrency` in flight at any time. Preserves input order in the
 * returned results array.
 *
 * @template T,R
 * @param {T[]} items
 * @param {number} concurrency
 * @param {(item: T, index: number) => Promise<R>} fn
 * @returns {Promise<R[]>}
 */
async function runWithConcurrency(items, concurrency, fn) {
  const results = new Array(items.length);
  let nextIndex = 0;
  const workers = Array.from({ length: Math.max(1, concurrency) }, async () => {
    while (true) {
      const i = nextIndex++;
      if (i >= items.length) return;
      results[i] = await fn(items[i], i);
    }
  });
  await Promise.all(workers);
  return results;
}

/**
 * Try to classify a single HubSpot property via the LLM provider chain.
 * Returns null when all providers fail (caller falls back to rules).
 */
async function classifyWithLLM(prop, ruleHint) {
  const result = await runLLMTask({
    taskName: "categorize_property",
    systemPrompt: `You categorize HubSpot CRM property definitions. Given a property's metadata, respond with EXACTLY this JSON shape:
{
  "category": "compact" | "potentially_large" | "computed" | "deprecated" | "system",
  "notes": "<one-line note describing what this property is used for, max 150 chars, no quotes, no newlines>"
}

Categories:
- compact: small, safe-by-default field (string ≤ 256 chars, enum, datetime, number, boolean)
- potentially_large: long-text fields (notes, descriptions, content, body, html)
- computed: HubSpot-managed; read-only on writes
- deprecated: marked deprecated by HubSpot
- system: hs_* infrastructure fields

Output ONLY the JSON object. No prose.`,
    userPrompt: `Property metadata:
name: ${prop.name}
label: ${prop.label ?? ""}
type: ${prop.type ?? ""}
fieldType: ${prop.fieldType ?? ""}
description: ${(prop.description ?? "").slice(0, 200)}
groupName: ${prop.groupName ?? ""}
hint_from_rules: ${ruleHint}`,
    expectJson: true,
    validate: (raw) => {
      let parsed;
      try {
        parsed = JSON.parse(raw);
      } catch {
        return { ok: false, error: "Output was not valid JSON. Respond with the JSON object only." };
      }
      if (!parsed || typeof parsed !== "object") {
        return { ok: false, error: "Output must be a JSON object." };
      }
      if (!PROPERTY_CATEGORIES.includes(parsed.category)) {
        return {
          ok: false,
          error: `category must be one of: ${PROPERTY_CATEGORIES.join(", ")}; got "${parsed.category}".`,
        };
      }
      if (typeof parsed.notes !== "string") {
        return { ok: false, error: "notes must be a string." };
      }
      if (parsed.notes.length > 200) {
        return { ok: false, error: "notes exceeds 200 chars; shorten it." };
      }
      return {
        ok: true,
        value: { category: parsed.category, notes: parsed.notes },
      };
    },
    fallback: () => null, // signal "no LLM result" so caller uses rules
  });

  if (result.source === "rules-derived") return null;
  return { ...result.value, source: result.source };
}

/**
 * Manually set or update a note on a single property. User-supplied — `source`
 * is recorded as 'user' so we can distinguish from auto-derived entries.
 *
 * @param {string} objectType
 * @param {string} propertyName
 * @param {{ category?: string, notes?: string }} fields
 */
export function setPropertyNote(objectType, propertyName, { category, notes } = {}) {
  if (category && !PROPERTY_CATEGORIES.includes(category)) {
    throw new Error(
      `Invalid category "${category}". Must be one of: ${PROPERTY_CATEGORIES.join(", ")}`
    );
  }
  upsertPropertyNote({
    object_type: objectType,
    property_name: propertyName,
    category: category ?? null,
    notes: notes ?? null,
    source: "user",
  });
  return getNoteForProperty(objectType, propertyName);
}

/**
 * Read property notes for an object type. Optionally filter by category or
 * fetch a single property's note.
 *
 * @param {string} objectType
 * @param {{ property_name?: string, category?: string }} [options]
 */
export function getPropertyNotes(objectType, { property_name, category } = {}) {
  if (property_name) {
    const row = getNoteForProperty(objectType, property_name);
    return row ? [row] : [];
  }
  if (category) {
    return getNotesByCategory(objectType, category);
  }
  return getNotesForObjectType(objectType);
}
