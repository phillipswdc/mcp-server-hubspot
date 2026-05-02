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
 * @property {string[]} [filterCapturedKeys] When provided, the stored
 *   old_values.properties and new_values.properties are filtered to only
 *   these keys. Keeps audit rows lean — captures the user's explicit intent
 *   without noisy auto-included or default fields.
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
  filterCapturedKeys = null,
  requireProductionConfirm = true,
  confirmProduction = false,
  rollbackAuditId = null,
}) {
  if (env.isProduction && requireProductionConfirm && !confirmProduction) {
    throw productionConfirmRequired(toolName);
  }

  const fullOld = await safeFetch(fetchExisting);

  let result = null;
  let error = null;
  let success = false;

  try {
    result = await perform();
    success = true;
  } catch (err) {
    error = err;
  }

  const fullNew = success ? extractValues(result) : null;

  // Filter captured properties to the user's explicit intent when requested,
  // so audit rows stay focused on what was actually being changed (not
  // auto-included read-only fields or default-property captures).
  const old_values = applyKeyFilter(fullOld, filterCapturedKeys);
  const new_values = applyKeyFilter(fullNew, filterCapturedKeys);

  const changed_fields =
    operation === "update" && old_values && new_values
      ? diffProperties(old_values.properties ?? {}, new_values.properties ?? {})
      : null;

  const audit_id = insertAudit({
    environment: env.name,
    session_id: env.sessionId,
    tool_name: toolName,
    object_type: objectType,
    object_id: result?.id ?? fullOld?.id ?? null,
    operation,
    old_values,
    new_values,
    changed_fields,
    args,
    success,
    error: error ? String(error?.message ?? error) : null,
    last_modified_at: extractLastModifiedAt(result),
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
 * Extract HubSpot's lastmodifieddate from a SimplePublicObject result and
 * convert to unix-ms. Returns null if the result is missing or doesn't have
 * a recognizable timestamp.
 *
 * Used to record "when did HubSpot say this entity was last touched, as of
 * our mutation" — the fast-path drift signal for rollback (Phase 4a.2).
 *
 * @param {object|null|undefined} result SimplePublicObject from getById/update
 * @returns {number|null} Unix milliseconds, or null
 */
function extractLastModifiedAt(result) {
  if (!result) return null;
  // HubSpot returns lastmodifieddate (and hs_lastmodifieddate for some objects)
  // on the properties dict, plus an SDK-level updatedAt at the top level.
  // updatedAt is the most reliable cross-object-type signal.
  const sources = [
    result.updatedAt,
    result.properties?.lastmodifieddate,
    result.properties?.hs_lastmodifieddate,
  ];
  for (const s of sources) {
    if (!s) continue;
    const t = typeof s === "string" ? Date.parse(s) : Number(s);
    if (Number.isFinite(t)) return t;
  }
  return null;
}

/**
 * Return a new shape with `properties` filtered to only the listed keys.
 * Pass-through for null/undefined or when no filter is set.
 *
 * @param {object|null|undefined} shape
 * @param {string[]|null} keys
 */
function applyKeyFilter(shape, keys) {
  if (!shape || !keys || !Array.isArray(keys)) return shape;
  const props = shape.properties ?? {};
  const filtered = {};
  for (const k of keys) {
    if (k in props) filtered[k] = props[k];
  }
  return { ...shape, properties: filtered };
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
    // Two API calls: do the write, then re-read with the same property list.
    // This makes new_values shape-compatible with old_values so the changed_fields
    // diff reflects real changes only — the SDK's update() response includes
    // unrelated `hs_*` fields that would otherwise create noise.
    perform: async () => {
      await withRetry(() => basicApi.update(id, { properties }));
      return await withRetry(() => basicApi.getById(id, propsToCapture));
    },
    // Lean audit storage: only keep the keys the user explicitly updated.
    // Defaults like firstname/email and SDK auto-includes (hs_object_id,
    // createdate, lastmodifieddate) get dropped from old/new captures.
    filterCapturedKeys: Object.keys(properties),
    confirmProduction,
  });
}

/**
 * Convenience wrapper for CREATE operations across all CRM object types.
 *
 * Captures null as old_values (the entity didn't exist), runs the create,
 * then re-fetches the created entity with the user's property list so the
 * audit row's new_values is shape-comparable to update audits.
 *
 * @param {object} params
 * @param {string} params.toolName e.g. "create_contact"
 * @param {string} params.objectType "contacts" | "companies" | "deals" | "tickets"
 * @param {object} params.basicApi SDK basicApi for the object type
 * @param {readonly string[]} params.defaultProperties Used only when caller doesn't specify `returnProperties`
 * @param {Record<string,unknown>} params.properties Property values to set on the new entity
 * @param {string[]} [params.returnProperties] Properties to capture in new_values; defaults to keys of `properties`
 * @param {boolean} [params.confirmProduction=false] Production guard flag from the tool args
 * @returns {Promise<{ result: object, audit_id: number }>}
 */
export async function auditedCreate({
  toolName,
  objectType,
  basicApi,
  defaultProperties,
  properties,
  returnProperties,
  confirmProduction = false,
}) {
  const propsToCapture =
    returnProperties && returnProperties.length
      ? [...new Set(returnProperties)]
      : [...new Set([...Object.keys(properties), ...defaultProperties])];

  return await auditedMutation({
    toolName,
    objectType,
    operation: "create",
    args: { properties },
    // No prior state — entity doesn't exist yet.
    fetchExisting: async () => null,
    perform: async () => {
      const created = await withRetry(() =>
        basicApi.create({ properties })
      );
      // Re-fetch with the canonical property list so new_values has the
      // same shape we'd capture on a subsequent update.
      return await withRetry(() =>
        basicApi.getById(created.id, propsToCapture)
      );
    },
    filterCapturedKeys: propsToCapture,
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
