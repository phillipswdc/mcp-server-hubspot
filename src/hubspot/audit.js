/**
 * Public audit-domain methods: rollback a previously-recorded change, list or
 * inspect audit rows, and prune old rows.
 *
 * Phase 3a: rollback supports UPDATE only. CREATE rollback (which would
 * archive the created record) lands in Phase 3b alongside create tools.
 */
import { sdk } from "./client.js";
import { withRetry } from "./retry.js";
import { auditedMutation } from "./_audit.js";
import {
  getAuditById,
  listRecentAudits,
  markRolledBack,
  pruneAudit,
} from "../db/queries/audit.js";
import { env } from "../config/env.js";

/**
 * Roll back a previously-recorded UPDATE by writing the captured old_values
 * back to the same object. Writes a NEW audit row recording the rollback,
 * then marks the original row as rolled_back.
 *
 * Refuses if the original row was a CREATE (Phase 3a limitation), if the
 * original was already rolled back, if it failed in the first place, or if
 * the original was recorded in a different environment than the current one.
 *
 * Drift protection: before writing the rollback, fetches the current value of
 * the affected fields from HubSpot and compares to the audit row's `new_values`.
 * If any field's current value differs from what we wrote (meaning it was
 * changed externally — HubSpot UI, another integration, another rollback),
 * the rollback refuses with a detailed drift report. Pass `force: true` to
 * override and overwrite the external changes anyway.
 *
 * @param {number|string} originalAuditId
 * @param {{ confirmProduction?: boolean, force?: boolean }} [options]
 * @returns {Promise<{ original_audit_id: number, rollback_audit_id: number, changed_fields: string[]|null, drift_overridden?: object[] }>}
 */
export async function rollbackChange(originalAuditId, options = {}) {
  const original = getAuditById(originalAuditId);
  if (!original) throw new Error(`Audit row ${originalAuditId} not found`);
  if (!original.success)
    throw new Error(`Audit row ${originalAuditId} recorded a failed mutation; nothing to roll back`);
  if (original.rolled_back)
    throw new Error(
      `Audit row ${originalAuditId} is already rolled back (rollback audit id: ${original.rollback_audit_id})`
    );
  if (original.environment !== env.name)
    throw new Error(
      `Audit row ${originalAuditId} was recorded in environment "${original.environment}", but current environment is "${env.name}". Switch HUBSPOT_ENV to roll it back.`
    );

  if (original.operation === "delete") {
    throw new Error(`Rollback of DELETE operations is not supported.`);
  }

  // CREATE rollback = archive the entity we created. Routed through the
  // dedicated helper because the audit shape is different (no properties to
  // diff; we record an "archive" event).
  if (original.operation === "create") {
    return await rollbackCreate(original, options);
  }
  // operation === "update"

  const basicApi = resolveBasicApi(original.object_type);
  const oldProps = original.old_values?.properties ?? {};
  if (!Object.keys(oldProps).length) {
    throw new Error(
      `Audit row ${originalAuditId} has no captured old_values.properties — cannot reconstruct prior state`
    );
  }

  // Surgical rollback: only revert the keys the original update explicitly set.
  // The audit row's args.properties represents user intent; old_values.properties
  // may include extra fields the SDK auto-includes (hs_object_id, createdate,
  // lastmodifieddate, etc.) which HubSpot rejects as read-only on write.
  const originalIntent = original.args?.properties ?? {};
  const keysToRollback = Object.keys(originalIntent);
  if (!keysToRollback.length) {
    throw new Error(
      `Audit row ${originalAuditId} has no recorded args.properties — cannot determine what to roll back`
    );
  }
  // HubSpot quirk: passing `null` for a property is treated as "leave unchanged"
  // (silently ignored). To CLEAR a value back to unset, we must send "" (empty
  // string). This applies across property types (enumerations, strings, numbers,
  // dates) — empty string is HubSpot's universal "clear" sentinel.
  const propsToWrite = {};
  for (const k of keysToRollback) {
    const oldVal = oldProps[k];
    propsToWrite[k] =
      oldVal === null || oldVal === undefined ? "" : oldVal;
  }

  // Drift detection: two-tier check.
  //
  // Tier 1 (fast path): compare HubSpot's current `updatedAt` for the entity
  //   to the `last_modified_at` we recorded when the audit row was written.
  //   If they match exactly, the entity has not been touched since our
  //   mutation — safe to roll back regardless of which fields were changed.
  //
  // Tier 2 (deep check): if the timestamp differs, something modified the
  //   entity since our update. Run a field-level comparison on just the keys
  //   we plan to revert. If our specific keys still match what we wrote,
  //   external changes were on OTHER fields — still safe to roll back ours.
  //   If our keys drifted, refuse unless force is true.
  const recordedLastModifiedAt = original.last_modified_at;
  const fetchProps = [...keysToRollback];
  // Always include lastmodifieddate so we can do the timestamp tier check.
  if (!fetchProps.includes("lastmodifieddate")) fetchProps.push("lastmodifieddate");
  if (!fetchProps.includes("hs_lastmodifieddate")) fetchProps.push("hs_lastmodifieddate");
  const currentSnapshot = await withRetry(() =>
    basicApi.getById(original.object_id, fetchProps)
  );
  const actualCurrent = currentSnapshot?.properties ?? {};
  const currentLastModifiedAt = parseHsDate(
    currentSnapshot?.updatedAt ??
      actualCurrent.lastmodifieddate ??
      actualCurrent.hs_lastmodifieddate
  );

  let drift = [];
  let driftCheckMode = null;
  if (
    recordedLastModifiedAt &&
    currentLastModifiedAt &&
    recordedLastModifiedAt === currentLastModifiedAt
  ) {
    // Tier 1 pass — no external changes anywhere on this entity.
    driftCheckMode = "timestamp_match";
  } else {
    // Tier 2 — entity was touched. Check our specific fields.
    driftCheckMode = "field_level_after_timestamp_mismatch";
    const expectedCurrent = original.new_values?.properties ?? {};
    drift = detectDrift(actualCurrent, expectedCurrent, keysToRollback);
  }

  if (drift.length && !options.force) {
    const lines = drift
      .map(
        (d) =>
          `  - ${d.field}: expected ${JSON.stringify(d.expected)} (what audit_id ${originalAuditId} wrote), current value is ${JSON.stringify(d.current)}`
      )
      .join("\n");
    throw new Error(
      `Drift detected on audit_id ${originalAuditId} — ${drift.length} field(s) changed externally since the original update:\n${lines}\n\n` +
        `Refusing rollback to avoid silently overwriting external changes. Pass force: true to override and revert anyway.`
    );
  }

  const { result, audit_id, changed_fields } = await auditedMutation({
    toolName: "rollback_change",
    objectType: original.object_type,
    operation: "update",
    args: {
      rolled_back_audit_id: Number(originalAuditId),
      properties: propsToWrite,
      drift_overridden: drift.length ? drift : undefined,
    },
    fetchExisting: () =>
      withRetry(() => basicApi.getById(original.object_id, keysToRollback)),
    perform: async () => {
      await withRetry(() =>
        basicApi.update(original.object_id, { properties: propsToWrite })
      );
      // Re-fetch with the same property list so new_values shape-matches old_values
      return await withRetry(() =>
        basicApi.getById(original.object_id, keysToRollback)
      );
    },
    filterCapturedKeys: keysToRollback,
    confirmProduction: options.confirmProduction,
    rollbackAuditId: Number(originalAuditId),
  });

  // Verify the write actually took effect. HubSpot can accept the request
  // (HTTP 200) yet leave fields unchanged for various reasons — silent
  // mismatches are the worst class of bug. If anything we tried to write
  // didn't land, refuse to mark the original rolled_back so the user knows.
  const actualNewProps = result?.properties ?? {};
  const writeMismatches = [];
  for (const [k, expectedVal] of Object.entries(propsToWrite)) {
    const actualVal = actualNewProps[k];
    if (!valuesEffectivelyEqual(expectedVal, actualVal)) {
      writeMismatches.push({ field: k, expected: expectedVal, actual: actualVal });
    }
  }
  if (writeMismatches.length) {
    throw new Error(
      `Rollback write was accepted by HubSpot but did not take effect for ${writeMismatches.length} field(s):\n` +
        writeMismatches
          .map(
            (m) =>
              `  - ${m.field}: tried to write ${JSON.stringify(m.expected)}, value remains ${JSON.stringify(m.actual)}`
          )
          .join("\n") +
        `\n\nAudit row ${audit_id} records the attempt; original audit_id ${originalAuditId} remains marked NOT rolled back. ` +
        `This usually means HubSpot rejected a value type silently or the property has a workflow blocking the change.`
    );
  }

  markRolledBack(Number(originalAuditId), audit_id);

  return {
    original_audit_id: Number(originalAuditId),
    rollback_audit_id: audit_id,
    changed_fields,
    result_id: result?.id,
    drift_check: driftCheckMode,
    ...(drift.length ? { drift_overridden: drift } : {}),
  };
}

/**
 * Roll back a CREATE by archiving the entity we created.
 *
 * HubSpot's v3 DELETE endpoint is a soft archive — the entity is hidden from
 * normal queries but restorable from the recycle bin / via unarchive. Truly
 * irreversible deletion is a separate API. This is by design for our
 * rollback semantics: undoing a create marks the entity inactive without
 * losing its data permanently.
 *
 * Drift consideration: we don't compare property-by-property here because
 * the rollback action is "make it not exist," not "restore values." We do
 * a lightweight existence + archived check to confirm the entity still
 * exists and isn't already archived.
 *
 * @param {object} original Audit row of the original create
 * @param {{ confirmProduction?: boolean, force?: boolean }} options
 */
async function rollbackCreate(original, options) {
  const basicApi = resolveBasicApi(original.object_type);
  const objectId = original.object_id;
  if (!objectId) {
    throw new Error(
      `Audit row ${original.id} has no object_id — cannot determine which entity to archive`
    );
  }

  // Existence + archive-state check. If the entity has already been archived
  // (manually, or via another rollback), there is nothing to undo here.
  let exists = false;
  let alreadyArchived = false;
  try {
    const current = await withRetry(() => basicApi.getById(objectId, []));
    exists = true;
    alreadyArchived = !!current?.archived;
  } catch (err) {
    const status = err?.code ?? err?.response?.status;
    if (status === 404) {
      exists = false;
    } else {
      throw err;
    }
  }

  if (!exists && !options.force) {
    throw new Error(
      `Cannot roll back create of ${original.object_type}/${objectId} — the entity no longer exists in HubSpot. ` +
        `Pass force: true to mark the audit row rolled_back anyway (no API call).`
    );
  }
  if (alreadyArchived && !options.force) {
    throw new Error(
      `Cannot roll back create of ${original.object_type}/${objectId} — the entity is already archived. ` +
        `Pass force: true to mark the audit row rolled_back anyway.`
    );
  }

  const { result, audit_id } = await auditedMutation({
    toolName: "rollback_change",
    objectType: original.object_type,
    operation: "delete",
    args: {
      rolled_back_audit_id: Number(original.id),
      action: "archive",
      object_id: objectId,
      already_gone: !exists || alreadyArchived,
    },
    fetchExisting: async () =>
      exists && !alreadyArchived
        ? await withRetry(() => basicApi.getById(objectId, []))
        : null,
    perform: async () => {
      if (exists && !alreadyArchived) {
        await withRetry(() => basicApi.archive(objectId));
      }
      // Return a synthetic shape — there's no entity to fetch after archive.
      return { id: objectId, archived: true };
    },
    confirmProduction: options.confirmProduction,
    rollbackAuditId: Number(original.id),
  });

  markRolledBack(Number(original.id), audit_id);

  return {
    original_audit_id: Number(original.id),
    rollback_audit_id: audit_id,
    operation: "create_rollback",
    archived_object_id: objectId,
    note:
      "HubSpot's v3 DELETE is a soft archive — the entity is hidden but restorable via the HubSpot recycle bin if needed.",
  };
}

/**
 * Parse a HubSpot date value (ISO string or unix-ms number) into unix-ms.
 * Returns null if unparseable.
 *
 * @param {unknown} value
 * @returns {number|null}
 */
function parseHsDate(value) {
  if (value == null) return null;
  if (typeof value === "number") return Number.isFinite(value) ? value : null;
  const t = Date.parse(String(value));
  return Number.isFinite(t) ? t : null;
}

/**
 * Compare two HubSpot property values for "effective equality."
 * Treats null, undefined, and empty string as the same (HubSpot's "cleared"
 * state). Otherwise compares as strings (HubSpot serializes everything to
 * strings on the wire).
 */
function valuesEffectivelyEqual(a, b) {
  const aEmpty = a === null || a === undefined || a === "";
  const bEmpty = b === null || b === undefined || b === "";
  if (aEmpty && bEmpty) return true;
  if (aEmpty !== bEmpty) return false;
  return String(a) === String(b);
}

/**
 * Compare the current state of an object's properties to what we expected
 * (the audit row's new_values) and return a list of fields that diverge.
 *
 * @param {Record<string,unknown>} actual Current values fetched from HubSpot
 * @param {Record<string,unknown>} expected new_values.properties from the audit row
 * @param {string[]} keys Keys to check
 * @returns {Array<{ field: string, expected: unknown, current: unknown }>}
 */
function detectDrift(actual, expected, keys) {
  const drift = [];
  for (const k of keys) {
    const a = actual[k] ?? null;
    const e = expected[k] ?? null;
    // String comparison — HubSpot returns all property values as strings.
    if (String(a) !== String(e)) {
      drift.push({ field: k, expected: e, current: a });
    }
  }
  return drift;
}

/**
 * List recent audit rows with optional filters. Lightweight payload — call
 * `getChangeDetail` for full old/new values.
 *
 * @param {{ object_type?: string, object_id?: string, only_unrolled?: boolean, only_successful?: boolean, limit?: number, offset?: number }} [filters]
 * @returns {object[]}
 */
export function listRecentChanges(filters = {}) {
  return listRecentAudits(filters);
}

/**
 * Get the full detail of a single audit row, including parsed old_values,
 * new_values, changed_fields, and original tool args.
 *
 * @param {number|string} auditId
 * @returns {object|null}
 */
export function getChangeDetail(auditId) {
  return getAuditById(auditId);
}

/**
 * Permanently delete audit rows. Composable filters: by age, by session,
 * or "everything except current session." At least one filter must be set.
 *
 * No automatic scheduling — runs only when invoked. Caller already passed
 * confirm: true at the tool layer.
 *
 * @param {object} options
 * @param {number} [options.olderThanDays] Cutoff in days; positive number
 * @param {string} [options.session_id] Delete only this session's rows
 * @param {string} [options.except_session_id] Delete all except this session's rows
 * @returns {{ before: number, deleted: number, cutoff_iso?: string, session_id?: string, except_session_id?: string }}
 */
export function pruneAuditLog({
  olderThanDays = null,
  session_id = null,
  except_session_id = null,
} = {}) {
  if (
    olderThanDays === null &&
    session_id === null &&
    except_session_id === null
  ) {
    throw new Error(
      "prune_audit_log requires at least one filter: older_than_days, session_id, or except_session_id"
    );
  }
  if (olderThanDays !== null && (!Number.isFinite(olderThanDays) || olderThanDays <= 0)) {
    throw new Error("older_than_days must be a positive number");
  }

  const cutoffMs =
    olderThanDays !== null
      ? Date.now() - olderThanDays * 24 * 60 * 60 * 1000
      : null;
  const counts = pruneAudit({ cutoffMs, session_id, except_session_id });
  return {
    ...counts,
    ...(cutoffMs !== null ? { cutoff_iso: new Date(cutoffMs).toISOString() } : {}),
    ...(session_id !== null ? { session_id } : {}),
    ...(except_session_id !== null ? { except_session_id } : {}),
  };
}

/**
 * Map an object_type string to its SDK basicApi handle.
 * @param {string} objectType
 */
function resolveBasicApi(objectType) {
  switch (objectType) {
    case "contacts":
      return sdk.crm.contacts.basicApi;
    case "companies":
      return sdk.crm.companies.basicApi;
    case "deals":
      return sdk.crm.deals.basicApi;
    case "tickets":
      return sdk.crm.tickets.basicApi;
    default:
      throw new Error(`Unknown object_type "${objectType}" in audit row`);
  }
}
