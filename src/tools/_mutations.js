/**
 * Reusable MCP tool-registration helpers for mutation operations.
 *
 * All update tools share the same input shape (entity ID, property updates,
 * production confirm flag) and the same response shape (audit_id, changed_fields,
 * updated entity). Centralizing here keeps tool files thin.
 */
import { z } from "zod";
import { jsonText, errorText, statusOf } from "./_shared.js";
import { MAX_PROPERTIES_PER_REQUEST } from "../config/constants.js";

/** Reusable zod schema for the `properties` argument on update/create tools. */
const propertiesSchema = z
  .record(
    z.string(),
    z.union([z.string(), z.number(), z.boolean(), z.null()])
  )
  .refine(
    (props) => Object.keys(props).length <= MAX_PROPERTIES_PER_REQUEST,
    {
      message: `Too many properties — limit is ${MAX_PROPERTIES_PER_REQUEST} per request.`,
    }
  )
  .describe(
    `Property updates to apply. Keys are HubSpot internal property names (use list_properties to discover them). Values may be strings, numbers, booleans, or null. Cap of ${MAX_PROPERTIES_PER_REQUEST} entries per request.`
  );

/** Reusable zod schema for the production confirm flag. */
const confirmProductionSchema = z
  .boolean()
  .optional()
  .describe(
    "Required when HUBSPOT_ENV=production. Defense-in-depth check on top of Claude Desktop's per-call approval. Sandbox runs ignore this."
  );

/**
 * Register a generic "create_{object}" MCP tool.
 *
 * @param {import("@modelcontextprotocol/sdk/server/mcp.js").McpServer} server
 * @param {object} params
 * @param {string} params.toolName e.g. "create_contact"
 * @param {string} params.description Tool-level description shown to the model
 * @param {(properties: object, options: { confirmProduction?: boolean }) => Promise<{ result: object, audit_id: number }>} params.create
 *   Wrapper method that performs the audited create.
 */
export function registerCreateTool(server, {
  toolName,
  description,
  create,
}) {
  server.tool(
    toolName,
    description,
    {
      properties: propertiesSchema,
      confirm_production: confirmProductionSchema,
    },
    async (args) => {
      try {
        const out = await create(args.properties, {
          confirmProduction: args.confirm_production === true,
        });
        return jsonText({
          audit_id: out.audit_id,
          created: {
            id: out.result?.id,
            properties: out.result?.properties,
            createdAt: out.result?.createdAt,
            updatedAt: out.result?.updatedAt,
          },
          rollback_hint: `Use rollback_change(audit_id=${out.audit_id}) to archive this entity.`,
        });
      } catch (err) {
        return errorText(err, statusOf(err));
      }
    }
  );
}

/**
 * Register a generic "update_{object}" MCP tool.
 *
 * @param {import("@modelcontextprotocol/sdk/server/mcp.js").McpServer} server
 * @param {object} params
 * @param {string} params.toolName e.g. "update_contact"
 * @param {string} params.description Tool-level description shown to the model
 * @param {string} params.idField Argument name for the entity ID, e.g. "contact_id"
 * @param {string} params.idDescription Description for the ID arg
 * @param {(id: string, properties: object, options: { confirmProduction?: boolean }) => Promise<{ result: object, audit_id: number, changed_fields: string[]|null }>} params.update
 *   Wrapper method that performs the audited update.
 */
export function registerUpdateTool(server, {
  toolName,
  description,
  idField,
  idDescription,
  update,
}) {
  server.tool(
    toolName,
    description,
    {
      [idField]: z.string().describe(idDescription),
      properties: propertiesSchema,
      confirm_production: confirmProductionSchema,
    },
    async (args) => {
      try {
        const id = args[idField];
        const out = await update(id, args.properties, {
          confirmProduction: args.confirm_production === true,
        });
        return jsonText({
          audit_id: out.audit_id,
          changed_fields: out.changed_fields,
          updated: {
            id: out.result?.id,
            properties: out.result?.properties,
            updatedAt: out.result?.updatedAt,
          },
        });
      } catch (err) {
        return errorText(err, statusOf(err));
      }
    }
  );
}
