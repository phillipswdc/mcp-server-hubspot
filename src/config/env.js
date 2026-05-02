/**
 * Environment resolution. Reads HUBSPOT_ENV plus the matching token, validates
 * both, and exposes them via a single `env` export consumed by db/index.js
 * and hubspot/client.js.
 *
 * No defaults. The server hard-fails on startup if HUBSPOT_ENV is missing or
 * the matching token isn't set. This forces an explicit choice between
 * sandbox and production every time the server is configured.
 *
 * Also generates a session_id (UUID) at startup — one per process — used to
 * tag audit_log rows so users can scope queries and pruning to "what this
 * server instance did" rather than the entire history.
 */
import { randomUUID } from "node:crypto";

/** Allowed values for HUBSPOT_ENV. */
export const VALID_ENVS = Object.freeze(["sandbox", "production"]);

/**
 * Read and validate the active HubSpot environment.
 * @returns {"sandbox"|"production"}
 */
function resolveActiveEnv() {
  const raw = process.env.HUBSPOT_ENV;
  if (!raw) {
    throw new Error(
      `HUBSPOT_ENV is required. Set it to one of: ${VALID_ENVS.join(", ")} in .env`
    );
  }
  const normalized = raw.toLowerCase();
  if (!VALID_ENVS.includes(normalized)) {
    throw new Error(
      `Invalid HUBSPOT_ENV "${raw}". Must be one of: ${VALID_ENVS.join(", ")}`
    );
  }
  return normalized;
}

/**
 * Read the access token for a given environment from process.env.
 * Falls back to the legacy HUBSPOT_ACCESS_TOKEN var when env-specific
 * tokens aren't set, to keep older configurations working.
 *
 * @param {"sandbox"|"production"} envName
 * @returns {string}
 */
function resolveTokenFor(envName) {
  const specific = process.env[`HUBSPOT_TOKEN_${envName.toUpperCase()}`];
  const legacy = process.env.HUBSPOT_ACCESS_TOKEN;
  const token = specific ?? legacy;
  if (!token) {
    throw new Error(
      `Missing token for HUBSPOT_ENV="${envName}". Set HUBSPOT_TOKEN_${envName.toUpperCase()} (preferred) or HUBSPOT_ACCESS_TOKEN in .env`
    );
  }
  return token;
}

const active = resolveActiveEnv();

/** Active HubSpot environment for this process. Frozen at startup. */
export const env = Object.freeze({
  /** @type {"sandbox"|"production"} */
  name: active,
  token: resolveTokenFor(active),
  /** True when active env is production — gates extra confirmation on mutations. */
  isProduction: active === "production",
  /** True when active env is sandbox. */
  isSandbox: active === "sandbox",
  /**
   * UUID generated once per server process. Stamped onto every audit_log row
   * so downstream queries (and pruning) can scope to "this session's work."
   * Persists across MCP tool calls within the same Claude Desktop launch.
   */
  sessionId: randomUUID(),
  /** Unix-ms when this process booted; useful for session-relative timing. */
  startedAt: Date.now(),
});
