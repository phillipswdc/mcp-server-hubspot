/**
 * Ollama provider for the LLM layer.
 *
 * Talks to a local Ollama instance over HTTP. Designed to fail gracefully —
 * if Ollama isn't running or the model isn't pulled, the provider reports
 * unhealthy and the upstream chain falls through to the next provider (or
 * rules-only).
 */
const DEFAULT_URL = "http://localhost:11434";
const DEFAULT_MODEL = "gemma4:e4b";

const OLLAMA_URL = process.env.OLLAMA_BASE_URL ?? DEFAULT_URL;
const OLLAMA_MODEL = process.env.OLLAMA_MODEL ?? DEFAULT_MODEL;

/**
 * Generate text from a prompt via Ollama's /api/generate endpoint.
 * Uses JSON mode (format: "json") when `expectJson` is true so the model
 * is constrained to produce parseable JSON output.
 *
 * @param {string} prompt
 * @param {{ expectJson?: boolean, timeoutMs?: number, temperature?: number }} [options]
 * @returns {Promise<string>} Raw text response from the model
 * @throws Error with .code = "OLLAMA_UNREACHABLE" | "OLLAMA_HTTP" | "OLLAMA_TIMEOUT" | "OLLAMA_BAD_RESPONSE"
 */
export async function generate(prompt, options = {}) {
  const { expectJson = false, timeoutMs = 5000, temperature = 0.2 } = options;

  let res;
  try {
    res = await fetch(`${OLLAMA_URL}/api/generate`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        model: OLLAMA_MODEL,
        prompt,
        stream: false,
        options: { temperature },
        ...(expectJson ? { format: "json" } : {}),
      }),
      signal: AbortSignal.timeout(timeoutMs),
    });
  } catch (err) {
    if (err?.name === "TimeoutError" || err?.name === "AbortError") {
      throw withCode(err, "OLLAMA_TIMEOUT");
    }
    throw withCode(err, "OLLAMA_UNREACHABLE");
  }

  if (!res.ok) {
    const body = await res.text().catch(() => "");
    const e = new Error(`Ollama HTTP ${res.status}: ${body.slice(0, 200)}`);
    e.code = "OLLAMA_HTTP";
    e.status = res.status;
    throw e;
  }

  /** @type {{ response?: string }} */
  const data = await res.json().catch(() => ({}));
  if (typeof data.response !== "string") {
    const e = new Error("Ollama returned no `response` field");
    e.code = "OLLAMA_BAD_RESPONSE";
    throw e;
  }
  return data.response;
}

/**
 * Health check — does Ollama respond at all, and is the configured model
 * pulled? Used by the startup banner and the llm_status tool.
 *
 * @returns {Promise<{ reachable: boolean, url: string, configured_model: string, model_pulled?: boolean, available_models?: string[], reason?: string }>}
 */
export async function health() {
  try {
    const res = await fetch(`${OLLAMA_URL}/api/tags`, {
      signal: AbortSignal.timeout(2000),
    });
    if (!res.ok) {
      return {
        reachable: false,
        url: OLLAMA_URL,
        configured_model: OLLAMA_MODEL,
        reason: `HTTP ${res.status}`,
      };
    }
    /** @type {{ models?: Array<{name: string}> }} */
    const data = await res.json();
    const names = (data.models ?? []).map((m) => m.name);
    return {
      reachable: true,
      url: OLLAMA_URL,
      configured_model: OLLAMA_MODEL,
      model_pulled: names.includes(OLLAMA_MODEL),
      available_models: names,
    };
  } catch (err) {
    return {
      reachable: false,
      url: OLLAMA_URL,
      configured_model: OLLAMA_MODEL,
      reason: err?.code ?? err?.message ?? "unknown",
    };
  }
}

/** Provider name + active model — used in source-provenance tags. */
export function describe() {
  return { provider: "ollama", model: OLLAMA_MODEL };
}

function withCode(err, code) {
  const wrapped = new Error(err?.message ?? String(err));
  wrapped.code = code;
  wrapped.cause = err;
  return wrapped;
}
