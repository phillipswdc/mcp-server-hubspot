/**
 * MCP tools for the LLM layer:
 *   - llm_status: which providers are configured/reachable, what models are pulled
 *   - summarize_audit_history: feed recent audit rows to the LLM, return a tight summary
 */
import { z } from "zod";
import { jsonText, plainText, errorText, statusOf } from "./_shared.js";
import { healthSnapshot, runLLMTask } from "../llm/index.js";
import { hubspot } from "../hubspot/index.js";
import { SUPPORTED_OBJECT_TYPES } from "../config/constants.js";

/**
 * Register LLM-domain MCP tools on a server instance.
 * @param {import("@modelcontextprotocol/sdk/server/mcp.js").McpServer} server
 */
export function registerLLMTools(server) {
  server.tool(
    "llm_status",
    "Report the LLM provider chain — which providers are configured, which are reachable right now, and which model is pulled. Use this to diagnose why LLM-enhanced tools are degraded or to verify Ollama is set up correctly.",
    {},
    async () => {
      try {
        return jsonText(await healthSnapshot());
      } catch (err) {
        return errorText(err, statusOf(err));
      }
    }
  );

  server.tool(
    "summarize_audit_history",
    "Feed a window of recent audit_log rows to the LLM and return a tight, human-readable summary. Saves Claude tokens vs reading raw rows. Falls back to a deterministic count-by-tool summary if no LLM is reachable.",
    {
      object_type: z
        .enum(SUPPORTED_OBJECT_TYPES)
        .optional()
        .describe("Optional: scope to one CRM object type"),
      session_id: z
        .string()
        .optional()
        .describe("Optional: scope to a single server-process session"),
      current_session_only: z
        .boolean()
        .optional()
        .describe("Shorthand: scope to the current session"),
      limit: z
        .number()
        .int()
        .min(1)
        .max(200)
        .optional()
        .default(50)
        .describe("How many recent rows to consider (default 50)"),
    },
    async (input) => {
      try {
        const filters = { ...input };
        if (filters.current_session_only) {
          filters.session_id = hubspot.environment().session_id;
        }
        delete filters.current_session_only;
        const rows = hubspot.listRecentChanges(filters);
        if (!rows.length) return plainText("No audit rows match those filters.");

        // Compact representation that's cheap to feed to the LLM.
        const condensed = rows.map((r) => ({
          id: r.id,
          tool: r.tool_name,
          op: r.operation,
          obj: `${r.object_type}/${r.object_id}`,
          ok: r.success === 1 || r.success === true,
          rolled_back: r.rolled_back === 1 || r.rolled_back === true,
        }));

        const result = await runLLMTask({
          taskName: "summarize_audit_history",
          systemPrompt: `You summarize HubSpot mutation history. Given a JSON list of audit rows (each with id, tool, op, obj, ok, rolled_back), produce a concise human-readable summary of what was done, what succeeded, what failed, what was rolled back. Mention notable patterns (lots of updates to the same record, repeated failures, etc.).

Respond with EXACTLY this JSON:
{
  "summary": "<2-6 sentences, ≤500 chars>",
  "counts": { "total": <int>, "successful": <int>, "rolled_back": <int>, "failed": <int> }
}

No prose outside the JSON. No newlines inside string values.`,
          userPrompt: `Audit rows:\n${JSON.stringify(condensed)}`,
          expectJson: true,
          validate: (raw) => {
            let parsed;
            try {
              parsed = JSON.parse(raw);
            } catch {
              return { ok: false, error: "Output was not valid JSON." };
            }
            if (!parsed || typeof parsed.summary !== "string") {
              return { ok: false, error: "Missing or invalid 'summary' field." };
            }
            if (parsed.summary.length > 800) {
              return { ok: false, error: "summary too long; keep under 500 chars." };
            }
            return { ok: true, value: parsed };
          },
          fallback: () => deterministicSummary(condensed),
        });

        return jsonText({
          source: result.source,
          attempts: result.attempts,
          window: { count: rows.length, filters },
          ...result.value,
        });
      } catch (err) {
        return errorText(err, statusOf(err));
      }
    }
  );
}

/**
 * Rule-based fallback summary for when no LLM is reachable. Counts only —
 * no narrative — but always succeeds.
 */
function deterministicSummary(rows) {
  const total = rows.length;
  let successful = 0;
  let rolled_back = 0;
  let failed = 0;
  const byTool = {};
  for (const r of rows) {
    if (r.ok) successful++;
    else failed++;
    if (r.rolled_back) rolled_back++;
    byTool[r.tool] = (byTool[r.tool] ?? 0) + 1;
  }
  const topTools = Object.entries(byTool)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 3)
    .map(([t, c]) => `${t}×${c}`)
    .join(", ");
  return {
    summary: `${total} audit rows: ${successful} ok, ${failed} failed, ${rolled_back} rolled back. Top tools: ${topTools}.`,
    counts: { total, successful, rolled_back, failed },
  };
}
