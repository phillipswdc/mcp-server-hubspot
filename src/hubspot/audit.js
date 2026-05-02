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
  pruneOlderThan,
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
 * @param {number|string} originalAuditId
 * @param {{ confirmProduction?: boolean }} [options]
 * @returns {Promise<{ original_audit_id: number, rollback_audit_id: number, changed_fields: string[]|null }>}
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

  if (original.operation === "create") {
    throw new Error(
      `Rollback of CREATE operations is not supported in Phase 3a. Will be added in Phase 3b.`
    );
  }
  if (original.operation === "delete") {
    throw new Error(`Rollback of DELETE operations is not supported.`);
  }
  // operation === "update"

  const basicApi = resolveBasicApi(original.object_type);
  const oldProps = original.old_values?.properties ?? {};
  if (!Object.keys(oldProps).length) {
    throw new Error(
      `Audit row ${originalAuditId} has no captured old_values.properties — cannot reconstruct prior state`
    );
  }

  const { result, audit_id, changed_fields } = await auditedMutation({
    toolName: "rollback_change",
    objectType: original.object_type,
    operation: "update",
    args: { rolled_back_audit_id: Number(originalAuditId) },
    fetchExisting: () =>
      withRetry(() => basicApi.getById(original.object_id, Object.keys(oldProps))),
    perform: () =>
      withRetry(() =>
        basicApi.update(original.object_id, { properties: oldProps })
      ),
    confirmProduction: options.confirmProduction,
    rollbackAuditId: Number(originalAuditId),
  });

  markRolledBack(Number(originalAuditId), audit_id);

  return {
    original_audit_id: Number(originalAuditId),
    rollback_audit_id: audit_id,
    changed_fields,
    result_id: result?.id,
  };
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
 * Permanently delete audit rows older than `olderThanDays`. Returns counts
 * for confirmation. No automatic scheduling — this only runs when invoked.
 *
 * @param {number} olderThanDays Must be > 0.
 * @returns {{ before: number, deleted: number, cutoff_iso: string }}
 */
export function pruneAuditLog(olderThanDays) {
  if (!Number.isFinite(olderThanDays) || olderThanDays <= 0) {
    throw new Error("older_than_days must be a positive number");
  }
  const cutoffMs = Date.now() - olderThanDays * 24 * 60 * 60 * 1000;
  const counts = pruneOlderThan(cutoffMs);
  return {
    ...counts,
    cutoff_iso: new Date(cutoffMs).toISOString(),
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
