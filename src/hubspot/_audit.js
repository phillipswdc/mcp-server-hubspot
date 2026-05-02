/**
 * Audit wrapper for HubSpot mutations.
 *
 * Every create/update/delete-style mutation flows through `auditedMutation`
 * so that:
 *   1. Existing state is captured before the change (old_values).
 *   2. The mutation runs, even if it fails.
 *   3. The new state is captured after success (new_values).
 *   4. Changed fields are diffed.
 *   5. An audit_log row is inserted with success/error context.
 *   6. Production runs require an explicit confirm flag.
 *
 * Tools never call this directly — domain modules (contacts.js, deals.js, …)
 * wrap their mutations with it.
 */
import { env } from "../config/env.js";
import { insertAudit } from "../db/queries/audit.js";
import { withRetry } from "./retry.js";

/**
 * @typedef {object} AuditedMutationParams
 * @property {string} toolName e.g. "update_contact"
 * @property {string} objectType "contacts" | "companies" | "deals" | "tickets"
 * @property {"create"|"update"|"delete"} operation
 * @property {object} args Original tool args (forensic record)
 * @property {() => Promise<object|null>} fetchExisting Returns the entity's
 *   current state (or null for a fresh create). Called once before `perform`.
 * @property {() => Promise<object>} perform Executes the mutation; resolves to
 *   the new state of the entity (the SDK's SimplePublicObject shape).
 * @property {boolean} [requireProductionConfirm=true] When false, skip the
 *   confirm gate — used internally by rollback (the gate runs at tool level instead).
 * @property {boolean} [confirmProduction=false] Caller-supplied confirm flag;
 *   ignored unless env is production.
 * @property {number|null} [rollbackAuditId=null] If this mutation IS itself
 *   a rollback, the audit_id of the original change being reversed.
 */

/**
 * Execute a HubSpot mutation with full audit capture.
 *
 * @param {AuditedMutationParams} params
 * @returns {Promise<{ result: object, audit_id: number, changed_fields: string[]|null }>}
 */
export async function auditedMutation({
  toolName,
  objectType,
  operation,
  args,
  fetchExisting,
  perform,
  requireProductionConfirm = true,
  confirmProduction = false,
  rollbackAuditId = null,
}) {
  if (env.isProduction && requireProductionConfirm && !confirmProduction) {
    throw productionConfirmRequired(toolName);
  }

  const old_values = await safeFetch(fetchExisting);

  let result = null;
  let error = null;
  let success = false;

  try {
    result = await perform();
    success = true;
  } catch (err) {
    error = err;
  }

  const new_values = success ? extractValues(result) : null;
  const changed_fields =
    operation === "update" && old_values && new_values
      ? diffProperties(old_values.properties ?? {}, new_values.properties ?? {})
      : null;

  const audit_id = insertAudit({
    environment: env.name,
    tool_name: toolName,
    object_type: objectType,
    object_id: result?.id ?? old_values?.id ?? null,
    operation,
    old_values,
    new_values,
    changed_fields,
    args,
    success,
    error: error ? String(error?.message ?? error) : null,
    rollback_audit_id: rollbackAuditId,
  });

  if (!success) {
    throw Object.assign(error ?? new Error("HubSpot mutation failed"), {
      audit_id,
    });
  }

  return { result, audit_id, changed_fields };
}

/**
 * Convenience wrapper for UPDATE operations across all CRM object types.
 * Domain modules call this to avoid repeating the fetch-existing + update
 * scaffolding around `auditedMutation`.
 *
 * @param {object} params
 * @param {string} params.toolName e.g. "update_contact"
 * @param {string} params.objectType "contacts" | "companies" | "deals" | "tickets"
 * @param {object} params.basicApi SDK basicApi for the object type (e.g. sdk.crm.contacts.basicApi)
 * @param {readonly string[]} params.defaultProperties Identifying properties to capture in addition to the changed ones
 * @param {string} params.id HubSpot ID of the object being updated
 * @param {Record<string,unknown>} params.properties Property updates to apply
 * @param {boolean} [params.confirmProduction=false] Production guard flag from the tool args
 * @returns {Promise<{ result: object, audit_id: number, changed_fields: string[]|null }>}
 */
export async function auditedUpdate({
  toolName,
  objectType,
  basicApi,
  defaultProperties,
  id,
  properties,
  confirmProduction = false,
}) {
  const propsToCapture = [
    ...new Set([...Object.keys(properties), ...defaultProperties]),
  ];

  return await auditedMutation({
    toolName,
    objectType,
    operation: "update",
    args: { id, properties },
    fetchExisting: () => withRetry(() => basicApi.getById(id, propsToCapture)),
    perform: () => withRetry(() => basicApi.update(id, { properties })),
    confirmProduction,
  });
}

/**
 * Construct the standard error thrown when a production mutation is missing
 * the explicit `confirm_production: true` flag.
 *
 * @param {string} toolName
 */
function productionConfirmRequired(toolName) {
  const err = new Error(
    `Production environment guard: ${toolName} requires \`confirm_production: true\` in arguments. ` +
      `This is a defense-in-depth check on top of Claude Desktop's per-call approval.`
  );
  err.code = "PRODUCTION_CONFIRM_REQUIRED";
  return err;
}

/**
 * Strip the SDK model wrapper to a plain JSON object suitable for audit storage.
 * @param {object|null} res
 */
function extractValues(res) {
  if (!res) return null;
  return {
    id: res.id,
    properties: res.properties,
    createdAt: res.createdAt,
    updatedAt: res.updatedAt,
  };
}

/**
 * Compute the list of property names whose value differs between two
 * properties dictionaries. HubSpot returns property values as strings, so
 * a plain `!==` comparison is sufficient.
 *
 * @param {Record<string,unknown>} oldProps
 * @param {Record<string,unknown>} newProps
 * @returns {string[]}
 */
function diffProperties(oldProps, newProps) {
  const keys = new Set([...Object.keys(oldProps), ...Object.keys(newProps)]);
  const changed = [];
  for (const k of keys) {
    if (oldProps[k] !== newProps[k]) changed.push(k);
  }
  return changed;
}

/**
 * Run `fn`, returning null if it throws (typically a 404 — entity didn't
 * exist, which is the create-case). Surfaces other errors so the caller can
 * decide how to react.
 *
 * @param {() => Promise<object|null>} fn
 */
async function safeFetch(fn) {
  if (!fn) return null;
  try {
    return await fn();
  } catch (err) {
    const status = err?.code ?? err?.response?.status;
    if (status === 404) return null;
    throw err;
  }
}
