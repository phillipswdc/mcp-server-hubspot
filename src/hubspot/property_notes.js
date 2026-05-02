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
 * Fetch all properties for an object type and write rule-based categories
 * to property_notes. Existing user-set notes survive thanks to the
 * COALESCE-on-conflict logic, but `source` is updated to reflect the
 * latest write (auto in this case).
 *
 * @param {"contacts"|"companies"|"deals"|"tickets"} objectType
 * @returns {Promise<{ object_type: string, count: number, by_category: Record<string,number> }>}
 */
export async function categorizeProperties(objectType) {
  const props = await listProperties(objectType);
  const rows = props.map((p) => ({
    object_type: objectType,
    property_name: p.name,
    category: categorizePropertyByRule(p),
    notes: null,
    source: "auto",
  }));
  upsertPropertyNotesBatch(rows);

  const byCategory = {};
  for (const r of rows) {
    byCategory[r.category] = (byCategory[r.category] ?? 0) + 1;
  }
  return {
    object_type: objectType,
    count: rows.length,
    by_category: byCategory,
  };
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
