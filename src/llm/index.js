/**
 * LLM layer — provider chain dispatcher with validation gates and bounded
 * retries.
 *
 * Public API: `runLLMTask(taskConfig)` runs a defined LLM task through the
 * configured provider chain. Each provider gets up to N attempts; on
 * validation failure, the next attempt receives feedback about what went
 * wrong. Hard errors (provider unreachable, model missing) skip retries
 * for that provider and fall through to the next one. The rules-only
 * fallback (caller-supplied) always succeeds.
 *
 * Design constraint: an LLM failure NEVER breaks the calling tool — worst
 * case the response is degraded (rules-derived instead of LLM-derived).
 */
import * as ollama from "./ollama.js";

const MAX_ATTEMPTS_PER_PROVIDER = 2;

/**
 * @typedef {object} LLMTaskConfig
 * @property {string} taskName Short identifier for logging (e.g. "categorize_property")
 * @property {string} systemPrompt Stable instruction; same across attempts and providers
 * @property {string} userPrompt The variable input
 * @property {(raw: string) => { ok: true, value: unknown } | { ok: false, error: string }} validate
 *   Parses + validates the raw model output. Returns ok:true with a clean object,
 *   or ok:false with a feedback string injected into the next attempt's prompt.
 * @property {() => unknown} fallback Deterministic answer when all providers fail.
 * @property {boolean} [expectJson=true] Use JSON mode where the provider supports it.
 */

/**
 * Run an LLM task through the provider chain.
 *
 * @param {LLMTaskConfig} config
 * @returns {Promise<{ value: unknown, source: string, attempts: object[] }>}
 *   `source` identifies which provider+model produced the value, or "rules"
 *   if all providers failed.
 */
export async function runLLMTask(config) {
  const attempts = [];
  const providers = [
    {
      name: "ollama",
      describe: ollama.describe,
      generate: (prompt, opts) =>
        ollama.generate(prompt, { ...opts, expectJson: config.expectJson !== false }),
      shouldRetry: (err) => !isHardOllamaError(err),
    },
    // MCP sampling provider lives here once 4b.3 ships.
  ];

  for (const provider of providers) {
    let feedback = null;
    for (let attempt = 1; attempt <= MAX_ATTEMPTS_PER_PROVIDER; attempt++) {
      const fullPrompt = buildPrompt(config, feedback);
      let raw;
      try {
        raw = await provider.generate(fullPrompt, {});
      } catch (err) {
        attempts.push({
          provider: provider.name,
          attempt,
          outcome: "error",
          code: err?.code,
          message: short(err?.message),
        });
        if (!provider.shouldRetry(err)) break;
        feedback = `Previous attempt failed before producing output (${err?.code ?? "unknown"}). Try again.`;
        continue;
      }

      const v = config.validate(raw);
      if (v.ok) {
        attempts.push({ provider: provider.name, attempt, outcome: "ok" });
        const desc = provider.describe();
        return {
          value: v.value,
          source: `llm-derived:${desc.provider}:${desc.model}`,
          attempts,
        };
      }
      attempts.push({
        provider: provider.name,
        attempt,
        outcome: "validation_failed",
        feedback: v.error,
      });
      feedback = v.error;
    }
  }

  return {
    value: config.fallback(),
    source: "rules-derived",
    attempts,
  };
}

/**
 * Build the final prompt sent to the model. Includes a system framing,
 * the user input, and (on retries) the previous failure as feedback.
 */
function buildPrompt(config, feedback) {
  const parts = [config.systemPrompt.trim(), "", config.userPrompt.trim()];
  if (feedback) {
    parts.push("");
    parts.push("Previous attempt failed validation:");
    parts.push(feedback);
    parts.push("");
    parts.push("Try again, addressing the validation issue above.");
  }
  return parts.join("\n");
}

/** Hard Ollama errors that won't change on retry. */
function isHardOllamaError(err) {
  const code = err?.code;
  return (
    code === "OLLAMA_UNREACHABLE" ||
    (code === "OLLAMA_HTTP" && err.status === 404)
  );
}

function short(s, n = 200) {
  return typeof s === "string" ? s.slice(0, n) : s;
}

/** Health snapshot for all configured providers — used by llm_status tool. */
export async function healthSnapshot() {
  return {
    chain_order: ["ollama", "mcp-sampling-pending", "rules-only"],
    providers: {
      ollama: await ollama.health(),
    },
  };
}
