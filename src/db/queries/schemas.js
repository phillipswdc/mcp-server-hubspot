/**
 * Prepared statements and read/write helpers for the `hubspot_schemas` table
 * (the local cache of HubSpot property definitions).
 *
 * Prepared statements are constructed once at module load — better-sqlite3
 * caches them on the connection for the process lifetime.
 */
import { db, nowMs } from "../index.js";

const SELECT_FRESH_BY_TYPE = db.prepare(`
  SELECT property_name, payload, fetched_at FROM hubspot_schemas
  WHERE object_type = ? AND fetched_at > ?
`);

const SELECT_ONE_FRESH = db.prepare(`
  SELECT payload, fetched_at FROM hubspot_schemas
  WHERE object_type = ? AND property_name = ? AND fetched_at > ?
`);

const UPSERT = db.prepare(`
  INSERT INTO hubspot_schemas
    (object_type, property_name, property_type, field_type, label, group_name, payload, fetched_at)
  VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  ON CONFLICT(object_type, property_name) DO UPDATE SET
    property_type = excluded.property_type,
    field_type    = excluded.field_type,
    label         = excluded.label,
    group_name    = excluded.group_name,
    payload       = excluded.payload,
    fetched_at    = excluded.fetched_at
`);

/**
 * Read all cached property definitions for an object type that are still fresh.
 * @param {string} objectType
 * @param {number} ttlMs
 * @returns {object[]} Property definition objects (parsed JSON), or empty array.
 */
export function readFreshProperties(objectType, ttlMs) {
  const cutoff = nowMs() - ttlMs;
  const rows = SELECT_FRESH_BY_TYPE.all(objectType, cutoff);
  return rows.map((r) => JSON.parse(r.payload));
}

/**
 * Read a single cached property definition if still fresh.
 * @param {string} objectType
 * @param {string} propertyName
 * @param {number} ttlMs
 * @returns {object|null}
 */
export function readFreshProperty(objectType, propertyName, ttlMs) {
  const cutoff = nowMs() - ttlMs;
  const row = SELECT_ONE_FRESH.get(objectType, propertyName, cutoff);
  return row ? JSON.parse(row.payload) : null;
}

/**
 * Upsert a batch of property definitions for an object type.
 * Wrapped in a transaction so a partial failure leaves the cache consistent.
 * @param {string} objectType
 * @param {object[]} props HubSpot property definition objects
 */
export const writeProperties = db.transaction((objectType, props) => {
  const ts = nowMs();
  for (const p of props) {
    UPSERT.run(
      objectType,
      p.name,
      p.type ?? null,
      p.fieldType ?? null,
      p.label ?? null,
      p.groupName ?? null,
      JSON.stringify(p),
      ts
    );
  }
});
