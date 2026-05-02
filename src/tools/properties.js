/**
 * MCP tool registrations for HubSpot property-schema introspection.
 *
 * These tools let Claude discover what fields exist on each object type before
 * filtering, searching, or updating — eliminating the need to hardcode
 * property lists in tool prompts or downstream tools.
 */
import { z } from "zod";
import { hubspot } from "../hubspot/index.js";
import { jsonText, plainText, errorText, statusOf } from "./_shared.js";
import { SUPPORTED_OBJECT_TYPES } from "../config/constants.js";

const objectTypeSchema = z
  .enum(SUPPORTED_OBJECT_TYPES)
  .describe("Which HubSpot CRM object type to operate on");

/**
 * Reduce a full HubSpot property definition to the fields most useful for
 * listing. The full payload is available via `get_property` when needed.
 *
 * @param {object} p HubSpot property definition
 */
function summarizeProperty(p) {
  return {
    name: p.name,
    type: p.type,
    fieldType: p.fieldType,
    label: p.label,
    groupName: p.groupName,
  };
}

/**
 * Register all property-introspection MCP tools on a server instance.
 * @param {import("@modelcontextprotocol/sdk/server/mcp.js").McpServer} server
 */
export function registerPropertyTools(server) {
  server.tool(
    "list_object_types",
    "List the HubSpot CRM object types this server supports. Use this when you need to know which object_type values are valid for other tools.",
    {},
    async () => jsonText({ object_types: hubspot.supportedObjectTypes() })
  );

  server.tool(
    "list_properties",
    "List property definitions for a HubSpot object type. Returns a compact list (name, type, label, group). Cached for 5 minutes. Use get_property for full detail of a single property.",
    {
      object_type: objectTypeSchema,
      name_contains: z
        .string()
        .optional()
        .describe("Optional substring filter on property name (case-insensitive)"),
      property_type: z
        .string()
        .optional()
        .describe(
          "Optional filter on property type, e.g. 'enumeration', 'string', 'datetime'"
        ),
    },
    async ({ object_type, name_contains, property_type }) => {
      try {
        const all = await hubspot.listProperties(object_type);
        const filtered = filterProperties(all, { name_contains, property_type });
        return jsonText({
          object_type,
          count: filtered.length,
          total_unfiltered: all.length,
          properties: filtered.map(summarizeProperty),
        });
      } catch (err) {
        return errorText(err, statusOf(err));
      }
    }
  );

  server.tool(
    "get_property",
    "Get the full definition of a single HubSpot property, including enumeration options and metadata.",
    {
      object_type: objectTypeSchema,
      property_name: z
        .string()
        .describe("Internal property name (e.g. 'lifecyclestage', 'firstname')"),
    },
    async ({ object_type, property_name }) => {
      try {
        const prop = await hubspot.getProperty(object_type, property_name);
        if (!prop) {
          return plainText(
            `Property '${property_name}' not found on object_type '${object_type}'`
          );
        }
        return jsonText(prop);
      } catch (err) {
        return errorText(err, statusOf(err));
      }
    }
  );

  server.tool(
    "create_property",
    "Define a new custom property on a HubSpot object type. Records the creation as an audit_log row. Note: rollback_change does NOT yet support property mutations — to undo a created property, archive it manually in HubSpot UI (Settings → Properties), or you can delete it via direct HubSpot API. The audit log captures the full definition for forensic recovery.",
    {
      object_type: objectTypeSchema,
      definition: z
        .object({
          name: z
            .string()
            .min(1)
            .describe(
              "Internal name (lowercase, underscores, no spaces, e.g. 'my_custom_field')"
            ),
          label: z.string().min(1).describe("Display label shown in HubSpot UI"),
          type: z
            .enum([
              "string",
              "number",
              "date",
              "datetime",
              "enumeration",
              "bool",
            ])
            .describe("Data type"),
          fieldType: z
            .enum([
              "text",
              "textarea",
              "number",
              "date",
              "select",
              "radio",
              "checkbox",
              "booleancheckbox",
              "calculation_equation",
              "phonenumber",
              "html",
              "file",
            ])
            .describe(
              "UI input style. For type=enumeration use 'select', 'radio', or 'checkbox'."
            ),
          groupName: z
            .string()
            .describe(
              "Property group name (e.g. 'contactinformation'). Discover existing groups by inspecting other properties."
            ),
          description: z.string().optional().describe("Help text for HubSpot UI"),
          options: z
            .array(
              z.object({
                label: z.string(),
                value: z.string(),
                description: z.string().optional(),
                displayOrder: z.number().int().optional(),
                hidden: z.boolean().optional(),
              })
            )
            .optional()
            .describe(
              "Required when type=enumeration. Each option needs label + value."
            ),
          formField: z
            .boolean()
            .optional()
            .describe("Whether this property can appear on HubSpot forms"),
          hasUniqueValue: z
            .boolean()
            .optional()
            .describe("Enforce uniqueness across records of this object type"),
          hidden: z
            .boolean()
            .optional()
            .describe("Hide from UI but keep usable via API"),
        })
        .describe("HubSpot property definition"),
      confirm_production: z
        .boolean()
        .optional()
        .describe(
          "Required when HUBSPOT_ENV=production. Property creation is a schema change — defense-in-depth check on top of Claude Desktop's per-call approval."
        ),
    },
    async ({ object_type, definition, confirm_production }) => {
      try {
        const out = await hubspot.createProperty(object_type, definition, {
          confirmProduction: confirm_production === true,
        });
        return jsonText({
          audit_id: out.audit_id,
          created: out.result,
          rollback_hint:
            "rollback_change does not yet support property mutations. To undo, archive the property manually in HubSpot UI (Settings → Properties).",
        });
      } catch (err) {
        return errorText(err, statusOf(err));
      }
    }
  );
}

/**
 * Apply optional filters (name substring, property type) to a property list.
 * @param {object[]} props
 * @param {{ name_contains?: string, property_type?: string }} filters
 */
function filterProperties(props, { name_contains, property_type }) {
  let out = props;
  if (name_contains) {
    const needle = name_contains.toLowerCase();
    out = out.filter((p) => p.name?.toLowerCase().includes(needle));
  }
  if (property_type) {
    out = out.filter((p) => p.type === property_type);
  }
  return out;
}
