#!/usr/bin/env node
/**
 * Standalone health-check CLI for the HubSpot MCP server.
 *
 * Run with: `npm run health-check` or `node bin/health-check.js`.
 * Verifies prerequisites without launching the full MCP stdio server, so
 * users can troubleshoot setup issues outside Claude Desktop.
 *
 * Exits 0 on full success, 1 on warnings (degraded but functional), 2 on
 * fatal errors (server can't start).
 */
import { config } from "dotenv";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { existsSync } from "node:fs";

const __dirname = dirname(fileURLToPath(import.meta.url));
const projectRoot = join(__dirname, "..");

// Output helpers — colors via ANSI; harmless on terminals that don't support them.
const C = {
  ok: (s) => `\x1b[32m✓\x1b[0m ${s}`,
  warn: (s) => `\x1b[33m⚠\x1b[0m ${s}`,
  fail: (s) => `\x1b[31m✗\x1b[0m ${s}`,
  hint: (s) => `  \x1b[2m→ ${s}\x1b[0m`,
  hdr: (s) => `\n\x1b[1m${s}\x1b[0m`,
};

let warnings = 0;
let fatals = 0;
const warn = (msg, hint) => {
  warnings++;
  console.log(C.warn(msg));
  if (hint) console.log(C.hint(hint));
};
const fail = (msg, hint) => {
  fatals++;
  console.log(C.fail(msg));
  if (hint) console.log(C.hint(hint));
};
const ok = (msg) => console.log(C.ok(msg));

console.log(C.hdr("HubSpot MCP Server — Health Check"));

// --- 1. Node version ---
console.log(C.hdr("1. Node runtime"));
{
  const major = Number(process.versions.node.split(".")[0]);
  if (major >= 20) ok(`Node ${process.versions.node}`);
  else fail(`Node ${process.versions.node}`, "Node 20 or newer is required.");
}

// --- 2. .env file ---
console.log(C.hdr("2. Configuration (.env)"));
const envPath = join(projectRoot, ".env");
if (!existsSync(envPath)) {
  fail(".env file not found", "Run `npm run setup` or copy .env.example to .env and edit.");
} else {
  ok(`.env exists at ${envPath}`);
  config({ path: envPath, quiet: true });

  const envName = process.env.HUBSPOT_ENV;
  if (!envName) {
    fail("HUBSPOT_ENV is not set", "Add `HUBSPOT_ENV=sandbox` (or production) to .env");
  } else if (!["sandbox", "production"].includes(envName)) {
    fail(`HUBSPOT_ENV="${envName}" is invalid`, "Must be 'sandbox' or 'production'");
  } else {
    ok(`HUBSPOT_ENV=${envName}`);
  }

  const tokenVar = `HUBSPOT_TOKEN_${envName?.toUpperCase()}`;
  const token = process.env[tokenVar] ?? process.env.HUBSPOT_ACCESS_TOKEN;
  if (!token) {
    fail(
      `No token configured for ${envName}`,
      `Set ${tokenVar} in .env (or the legacy HUBSPOT_ACCESS_TOKEN).`
    );
  } else {
    ok(`Token configured (length ${token.length}, starts with ${token.slice(0, 4)}…)`);
  }
}

// --- 3. Live HubSpot API check ---
if (process.env.HUBSPOT_ENV && fatals === 0) {
  console.log(C.hdr("3. HubSpot API connectivity"));
  try {
    const { Client } = await import("@hubspot/api-client");
    const tokenVar = `HUBSPOT_TOKEN_${process.env.HUBSPOT_ENV.toUpperCase()}`;
    const token = process.env[tokenVar] ?? process.env.HUBSPOT_ACCESS_TOKEN;
    const sdk = new Client({ accessToken: token });
    const res = await sdk.crm.properties.coreApi.getAll("contacts", false);
    ok(
      `Authenticated. ${res.results?.length ?? 0} contact properties available.`
    );
  } catch (err) {
    const status = err?.code ?? err?.response?.status;
    if (status === 401) {
      fail("HubSpot rejected the token (401)", "Token is invalid or revoked. Generate a new one.");
    } else if (status === 403) {
      fail(
        "HubSpot returned 403",
        "Token lacks crm.schemas.contacts.read scope. Grant CRM read permissions."
      );
    } else {
      fail(`HubSpot call failed (${status ?? "unknown"})`, err?.message?.slice(0, 200));
    }
  }
}

// --- 4. SQLite database ---
console.log(C.hdr("4. Local SQLite database"));
if (process.env.HUBSPOT_ENV) {
  const dbFile = join(projectRoot, "data", `hubspot-${process.env.HUBSPOT_ENV}.db`);
  if (existsSync(dbFile)) {
    ok(`Database file exists at ${dbFile}`);
  } else {
    ok(`Database file does not exist yet — will be created on first server start.`);
  }
} else {
  warn("Cannot determine DB path until HUBSPOT_ENV is set.");
}

// --- 5. Ollama (optional) ---
console.log(C.hdr("5. Ollama (optional, enables LLM-enhanced features)"));
{
  const ollamaUrl = process.env.OLLAMA_BASE_URL ?? "http://localhost:11434";
  const ollamaModel = process.env.OLLAMA_MODEL ?? "gemma4:e4b";
  try {
    const res = await fetch(`${ollamaUrl}/api/tags`, {
      signal: AbortSignal.timeout(2000),
    });
    if (!res.ok) {
      warn(
        `Ollama responded with HTTP ${res.status}`,
        "LLM-enhanced tools will fall back to rule-based output."
      );
    } else {
      const { models = [] } = await res.json();
      const names = models.map((m) => m.name);
      if (names.includes(ollamaModel)) {
        ok(`Ollama reachable at ${ollamaUrl}; model ${ollamaModel} pulled.`);
      } else {
        warn(
          `Ollama reachable but ${ollamaModel} not pulled.`,
          `Run: ollama pull ${ollamaModel}`
        );
      }
    }
  } catch {
    warn(
      `Ollama not reachable at ${ollamaUrl}`,
      "LLM features will fall back to rule-based output. Install Ollama from https://ollama.com to enable."
    );
  }
}

// --- Summary ---
console.log(C.hdr("Summary"));
if (fatals > 0) {
  console.log(C.fail(`${fatals} fatal issue(s) — server cannot start.`));
  process.exit(2);
}
if (warnings > 0) {
  console.log(C.warn(`${warnings} warning(s) — server will run with degraded features.`));
  process.exit(1);
}
console.log(C.ok("All checks passed. Server is ready to launch."));
process.exit(0);
