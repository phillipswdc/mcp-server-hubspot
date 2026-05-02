/**
 * MCP tool registrations for environment introspection, audit-log queries,
 * rollback, and audit-log pruning.
 *
 * These tools never call HubSpot directly — they read/write only the local
 * SQLite audit log, except `rollback_change` which routes a reversal mutation
 * back through the same audit pipeline as a normal update.
 */
import { z } from "zod";
import { hubspot } from "../hubspot/index.js";
import { jsonText, plainText, errorText, statusOf } from "./_shared.js";
import { SUPPORTED_OBJECT_TYPES } from "../config/constants.js";

/**
 * Register environment + audit MCP tools on a server instance.
 * @param {import("@modelcontextprotocol/sdk/server/mcp.js").McpServer} server
 */
export function registerAuditTools(server) {
  server.tool(
    "get_environment",
    "Report the active HubSpot environment (sandbox or production) and the local audit-database path. Use this whenever you're about to mutate data, to confirm which account you'd be writing to.",
    {},
    async () => {
      try {
        return jsonText(hubspot.environment());
      } catch (err) {
        return errorText(err, statusOf(err));
      }
    }
  );

  server.tool(
    "list_recent_changes",
    "List recent rows from the audit log (most recent first). Lightweight summary — call get_change_detail for full old/new values. Filters can scope to a single object_type, a specific object_id, or hide rolled-back / failed rows.",
    {
      object_type: z
        .enum(SUPPORTED_OBJECT_TYPES)
        .optional()
        .describe("Filter to a single CRM object type."),
      object_id: z
        .string()
        .optional()
        .describe("Filter to a single object's audit history (HubSpot internal ID)."),
      only_unrolled: z
        .boolean()
        .optional()
        .describe("If true, exclude rows that have already been rolled back."),
      only_successful: z
        .boolean()
        .optional()
        .describe("If true, exclude rows where the underlying API call failed."),
      session_id: z
        .string()
        .optional()
        .describe(
          "Filter to a single server-process session. Use the session_id returned by get_environment to scope to the current session."
        ),
      current_session_only: z
        .boolean()
        .optional()
        .describe(
          "Shorthand: if true, equivalent to passing the current session's session_id. Useful for 'show me what I just did.'"
        ),
      limit: z
        .number()
        .int()
        .min(1)
        .max(200)
        .optional()
        .default(25)
        .describe("Max rows to return (1-200). Defaults to 25."),
      offset: z
        .number()
        .int()
        .min(0)
        .optional()
        .default(0)
        .describe("Number of rows to skip — used for pagination."),
    },
    async (filters) => {
      try {
        const effectiveFilters = { ...filters };
        if (filters.current_session_only) {
          effectiveFilters.session_id = hubspot.environment().session_id;
        }
        delete effectiveFilters.current_session_only;
        const rows = hubspot.listRecentChanges(effectiveFilters);
        return jsonText({ count: rows.length, rows });
      } catch (err) {
        return errorText(err, statusOf(err));
      }
    }
  );

  server.tool(
    "get_change_detail",
    "Fetch the full detail of a single audit_log row, including parsed old_values, new_values, changed_fields, and the original tool args. Use this to inspect exactly what a prior change did before deciding to roll it back.",
    {
      audit_id: z
        .number()
        .int()
        .min(1)
        .describe("Audit row id (returned as `audit_id` from any mutation tool)."),
    },
    async ({ audit_id }) => {
      try {
        const row = hubspot.getChangeDetail(audit_id);
        if (!row) return plainText(`No audit row found with id: ${audit_id}`);
        return jsonText(row);
      } catch (err) {
        return errorText(err, statusOf(err));
      }
    }
  );

  server.tool(
    "rollback_change",
    "Reverse a previously-recorded UPDATE by writing the captured old_values back to the same object. Records a NEW audit_log row for the rollback action, then marks the original row as rolled_back. Refuses to roll back creates (Phase 3a limitation), already-rolled-back rows, failed mutations, or rows from a different environment than the current one. By default also refuses if any of the affected fields was changed externally since the original update — use force: true to override that drift check.",
    {
      audit_id: z
        .number()
        .int()
        .min(1)
        .describe("ID of the audit_log row to reverse."),
      force: z
        .boolean()
        .optional()
        .describe(
          "Override drift detection. Set true ONLY when you have inspected the drift report and explicitly want to overwrite external changes. Without this, rollback refuses if any affected field was modified outside this server since the original update."
        ),
      confirm_production: z
        .boolean()
        .optional()
        .describe(
          "Required when HUBSPOT_ENV=production. The rollback writes to the same account the original change touched."
        ),
    },
    async ({ audit_id, force, confirm_production }) => {
      try {
        const out = await hubspot.rollbackChange(audit_id, {
          confirmProduction: confirm_production === true,
          force: force === true,
        });
        return jsonText(out);
      } catch (err) {
        return errorText(err, statusOf(err));
      }
    }
  );

  server.tool(
    "prune_audit_log",
    "Permanently delete audit_log rows. Composable filters — by age, by specific session, or 'all sessions except current' — and at least one filter is required. No automatic scheduling; runs only when invoked.",
    {
      older_than_days: z
        .number()
        .min(1)
        .optional()
        .describe(
          "Delete audit rows whose timestamp is older than this many days. Combines with session filters."
        ),
      session_id: z
        .string()
        .optional()
        .describe(
          "Delete only rows from this specific session. Mutually exclusive with except_session_id."
        ),
      except_current_session: z
        .boolean()
        .optional()
        .describe(
          "Shorthand: if true, delete all rows EXCEPT the current session's. Use this to clean up old test sessions while keeping current work intact."
        ),
      confirm: z
        .literal(true)
        .describe(
          "Must be `true` to actually delete. Final safety check on top of Claude Desktop's tool approval."
        ),
    },
    async ({ older_than_days, session_id, except_current_session, confirm }) => {
      try {
        if (confirm !== true) {
          return errorText(
            new Error("prune_audit_log requires `confirm: true` to actually delete rows"),
            "confirm-required"
          );
        }
        const except_session_id = except_current_session
          ? hubspot.environment().session_id
          : undefined;
        return jsonText(
          hubspot.pruneAuditLog({
            olderThanDays: older_than_days,
            session_id,
            except_session_id,
          })
        );
      } catch (err) {
        return errorText(err, statusOf(err));
      }
    }
  );
}
