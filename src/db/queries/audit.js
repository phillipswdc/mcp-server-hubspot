/**
 * Prepared statements and read/write helpers for the `audit_log` table.
 *
 * Mutations write a row whether or not the underlying HubSpot call succeeded
 * — failed mutations are still forensically valuable. Successful rows include
 * old_values, new_values, and changed_fields; failed rows include error text.
 */
import { db, nowMs } from "../index.js";

const INSERT = db.prepare(`
  INSERT INTO audit_log
    (timestamp, environment, session_id, tool_name, object_type, object_id, operation,
     old_values, new_values, changed_fields, args,
     success, error, last_modified_at, rolled_back, rollback_audit_id)
  VALUES
    (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0, ?)
`);

const SELECT_BY_ID = db.prepare(`SELECT * FROM audit_log WHERE id = ?`);

const SELECT_RECENT = db.prepare(`
  SELECT id, timestamp, environment, tool_name, object_type, object_id,
         operation, success, rolled_back, error
  FROM audit_log
  ORDER BY id DESC
  LIMIT ? OFFSET ?
`);

const SELECT_RECENT_FILTERED = db.prepare(`
  SELECT id, timestamp, environment, tool_name, object_type, object_id,
         operation, success, rolled_back, error
  FROM audit_log
  WHERE (@object_type IS NULL OR object_type = @object_type)
    AND (@object_id IS NULL OR object_id = @object_id)
    AND (@only_unrolled = 0 OR rolled_back = 0)
    AND (@only_successful = 0 OR success = 1)
  ORDER BY id DESC
  LIMIT @limit OFFSET @offset
`);

const MARK_ROLLED_BACK = db.prepare(`
  UPDATE audit_log
  SET rolled_back = 1, rolled_back_at = ?, rollback_audit_id = ?
  WHERE id = ? AND rolled_back = 0
`);

const DELETE_OLDER_THAN = db.prepare(`
  DELETE FROM audit_log
  WHERE timestamp < ?
`);

const COUNT_OLDER_THAN = db.prepare(`
  SELECT COUNT(*) as n FROM audit_log
  WHERE timestamp < ?
`);

/**
 * Row shape for an audit_log insert. Object/array fields are JSON-stringified
 * here so callers can pass plain JS values.
 *
 * @typedef {object} AuditRowInput
 * @property {string} environment "sandbox" or "production"
 * @property {string|null} session_id UUID for the server-process session
 * @property {string} tool_name e.g. "update_contact"
 * @property {string} object_type "contacts" | "companies" | "deals" | "tickets"
 * @property {string|null} object_id HubSpot ID; null for failed creates
 * @property {"create"|"update"|"delete"} operation
 * @property {object|null} old_values Snapshot before the change
 * @property {object|null} new_values Snapshot after the change
 * @property {string[]|null} changed_fields Property names that actually differed
 * @property {object} args Original tool arguments, for forensics
 * @property {boolean} success Did the underlying API call succeed?
 * @property {string|null} error Error message when !success
 * @property {number|null} last_modified_at Unix-ms of HubSpot's lastmodifieddate after our mutation; used as a fast-path drift signal on rollback
 * @property {number|null} rollback_audit_id If this row IS a rollback, the original audit id it reverses
 */

/**
 * Insert a new audit_log row.
 * @param {AuditRowInput} row
 * @returns {number} The new audit row id.
 */
export function insertAudit(row) {
  const info = INSERT.run(
    nowMs(),
    row.environment,
    row.session_id ?? null,
    row.tool_name,
    row.object_type,
    row.object_id ?? null,
    row.operation,
    row.old_values ? JSON.stringify(row.old_values) : null,
    row.new_values ? JSON.stringify(row.new_values) : null,
    row.changed_fields ? JSON.stringify(row.changed_fields) : null,
    JSON.stringify(row.args ?? {}),
    row.success ? 1 : 0,
    row.error ?? null,
    row.last_modified_at ?? null,
    row.rollback_audit_id ?? null
  );
  return Number(info.lastInsertRowid);
}

/**
 * Fetch a single audit row by id, with JSON columns parsed back to objects.
 * @param {number|string} id
 * @returns {object|null}
 */
export function getAuditById(id) {
  const row = SELECT_BY_ID.get(id);
  return row ? parseRow(row) : null;
}

/**
 * List recent audit rows (newest first), with optional filters.
 *
 * @param {{ object_type?: string, object_id?: string, only_unrolled?: boolean, only_successful?: boolean, limit?: number, offset?: number }} [filters]
 * @returns {object[]} Lightweight row summaries (full payloads accessible via getAuditById).
 */
export function listRecentAudits(filters = {}) {
  const {
    object_type = null,
    object_id = null,
    only_unrolled = false,
    only_successful = false,
    limit = 25,
    offset = 0,
  } = filters;
  if (
    object_type === null &&
    object_id === null &&
    !only_unrolled &&
    !only_successful
  ) {
    return SELECT_RECENT.all(limit, offset);
  }
  return SELECT_RECENT_FILTERED.all({
    object_type,
    object_id,
    only_unrolled: only_unrolled ? 1 : 0,
    only_successful: only_successful ? 1 : 0,
    limit,
    offset,
  });
}

/**
 * Mark an audit row as rolled back, linking forward to the new audit row that
 * recorded the rollback action. No-op if already rolled back.
 *
 * @param {number} originalId
 * @param {number} rollbackAuditId
 * @returns {boolean} True when a row was updated, false when already rolled back.
 */
export function markRolledBack(originalId, rollbackAuditId) {
  const info = MARK_ROLLED_BACK.run(nowMs(), rollbackAuditId, originalId);
  return info.changes > 0;
}

/**
 * Permanently delete audit rows older than `cutoffMs`. No automatic
 * scheduling — exposed only via a deliberate prune_audit_log tool call.
 *
 * @param {number} cutoffMs Unix-ms; rows with timestamp < cutoffMs are deleted
 * @returns {{ before: number, deleted: number }}
 */
export function pruneOlderThan(cutoffMs) {
  const before = Number(COUNT_OLDER_THAN.get(cutoffMs)?.n ?? 0);
  const info = DELETE_OLDER_THAN.run(cutoffMs);
  return { before, deleted: info.changes };
}

function parseRow(row) {
  return {
    ...row,
    old_values: row.old_values ? JSON.parse(row.old_values) : null,
    new_values: row.new_values ? JSON.parse(row.new_values) : null,
    changed_fields: row.changed_fields ? JSON.parse(row.changed_fields) : null,
    args: row.args ? JSON.parse(row.args) : null,
    success: !!row.success,
    rolled_back: !!row.rolled_back,
  };
}
