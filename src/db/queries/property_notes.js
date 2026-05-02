/**
 * Prepared statements and read/write helpers for the `property_notes` table —
 * the persistent annotation layer over HubSpot property schemas.
 *
 * Categories are auto-derived by rule when first seen, can be overridden
 * manually via set_property_note, and (in Phase 4b) refined by an LLM.
 */
import { db, nowMs } from "../index.js";

const UPSERT = db.prepare(`
  INSERT INTO property_notes
    (object_type, property_name, category, notes, source, updated_at)
  VALUES (?, ?, ?, ?, ?, ?)
  ON CONFLICT(object_type, property_name) DO UPDATE SET
    category   = COALESCE(excluded.category, property_notes.category),
    notes      = COALESCE(excluded.notes, property_notes.notes),
    source     = excluded.source,
    updated_at = excluded.updated_at
`);

const SELECT_BY_OBJECT = db.prepare(`
  SELECT object_type, property_name, category, notes, source, updated_at
  FROM property_notes
  WHERE object_type = ?
  ORDER BY property_name ASC
`);

const SELECT_ONE = db.prepare(`
  SELECT object_type, property_name, category, notes, source, updated_at
  FROM property_notes
  WHERE object_type = ? AND property_name = ?
`);

const SELECT_BY_CATEGORY = db.prepare(`
  SELECT object_type, property_name, category, notes, source, updated_at
  FROM property_notes
  WHERE object_type = ? AND category = ?
  ORDER BY property_name ASC
`);

/**
 * Upsert a note for a property. Source determines write priority — `user`
 * overrides `auto`/`llm-derived`. Category and notes default to existing
 * values via COALESCE so partial updates don't wipe other fields.
 *
 * @param {object} row
 * @param {string} row.object_type
 * @param {string} row.property_name
 * @param {string|null} [row.category] One of PROPERTY_CATEGORIES
 * @param {string|null} [row.notes] Free-text annotation
 * @param {"auto"|"user"|"llm-derived"} row.source
 */
export function upsertPropertyNote(row) {
  UPSERT.run(
    row.object_type,
    row.property_name,
    row.category ?? null,
    row.notes ?? null,
    row.source,
    nowMs()
  );
}

/**
 * Bulk-upsert a batch of notes in a single transaction. Used by
 * categorize_properties to avoid one-statement-per-property overhead.
 *
 * @param {Array<object>} rows
 */
export const upsertPropertyNotesBatch = db.transaction((rows) => {
  for (const r of rows) upsertPropertyNote(r);
});

/**
 * Fetch all notes for an object type.
 * @param {string} objectType
 */
export function getNotesForObjectType(objectType) {
  return SELECT_BY_OBJECT.all(objectType);
}

/**
 * Fetch a single note by composite key.
 * @param {string} objectType
 * @param {string} propertyName
 */
export function getNoteForProperty(objectType, propertyName) {
  return SELECT_ONE.get(objectType, propertyName) ?? null;
}

/**
 * Fetch all notes for an object type filtered by category.
 * @param {string} objectType
 * @param {string} category
 */
export function getNotesByCategory(objectType, category) {
  return SELECT_BY_CATEGORY.all(objectType, category);
}
