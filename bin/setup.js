#!/usr/bin/env node
/**
 * Interactive setup wizard for the HubSpot MCP server.
 *
 * Run with: `npm run setup` or `node bin/setup.js`.
 * Walks a fresh user through environment selection, token entry, optional
 * Ollama detection, writes a `.env` file, and prints a Claude Desktop config
 * snippet they can paste in.
 *
 * Designed to be safe to re-run: existing .env is backed up before overwrite.
 */
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import {
  existsSync,
  copyFileSync,
  writeFileSync,
  readFileSync,
} from "node:fs";
import { createInterface } from "node:readline/promises";
import { stdin as input, stdout as output } from "node:process";

const __dirname = dirname(fileURLToPath(import.meta.url));
const projectRoot = join(__dirname, "..");
const envPath = join(projectRoot, ".env");

const C = {
  bold: (s) => `\x1b[1m${s}\x1b[0m`,
  dim: (s) => `\x1b[2m${s}\x1b[0m`,
  ok: (s) => `\x1b[32m✓\x1b[0m ${s}`,
  warn: (s) => `\x1b[33m⚠\x1b[0m ${s}`,
};

const rl = createInterface({ input, output });
const ask = (q, fallback = "") => rl.question(`${q}${fallback ? ` [${fallback}]` : ""} `);

console.log(C.bold("\nHubSpot MCP Server — Setup"));
console.log(C.dim("This wizard writes a .env file and prints a Claude Desktop config snippet."));
console.log(C.dim("You can re-run this any time; existing .env is backed up.\n"));

// 1. Environment choice
let envName = "";
while (!["sandbox", "production"].includes(envName)) {
  const answer = await ask("Which HubSpot environment will you use? (sandbox/production)", "sandbox");
  envName = (answer || "sandbox").trim().toLowerCase();
  if (!["sandbox", "production"].includes(envName)) {
    console.log("  Must be 'sandbox' or 'production'. Try again.");
  }
}

if (envName === "production") {
  console.log(
    C.warn(
      "Heads up: production env requires `confirm_production: true` on every mutation tool call. This is intentional defense-in-depth."
    )
  );
}

// 2. Token entry — keystrokes are visible (no good cross-platform stdin masking
// without extra deps). User is told upfront that the value will be on screen
// while they paste it; the .env file itself is gitignored.
console.log(C.dim("\nNext: paste your HubSpot Service Key (or Private App access token)."));
console.log(C.dim("It will appear on screen as you paste — clear your scrollback after if concerned."));
console.log(C.dim("The .env file is gitignored, so the value never enters version control.\n"));

const token = (await ask(`Token for HUBSPOT_TOKEN_${envName.toUpperCase()}:`)).trim();
if (!token) {
  console.log(C.warn("No token entered. Exiting without writing .env."));
  rl.close();
  process.exit(1);
}

// 3. Optional: detect Ollama
let ollamaInstalled = false;
let ollamaHasGemma = false;
console.log(C.dim("\nChecking for Ollama (optional — enables richer LLM-derived categorization)..."));
try {
  const res = await fetch("http://localhost:11434/api/tags", {
    signal: AbortSignal.timeout(2000),
  });
  if (res.ok) {
    ollamaInstalled = true;
    const { models = [] } = await res.json();
    const names = models.map((m) => m.name);
    ollamaHasGemma = names.includes("gemma4:e4b") || names.includes("gemma4:e2b");
    console.log(C.ok(`Ollama is running. Models present: ${names.join(", ") || "(none)"}`));
    if (!ollamaHasGemma) {
      console.log(C.dim("  No gemma4 model pulled. Run `ollama pull gemma4:e4b` to enable LLM features."));
    }
  }
} catch {
  console.log(C.dim("  Ollama not running — that's fine. LLM features will fall back to rule-based output."));
  console.log(C.dim("  To enable later: install from https://ollama.com, then pull a model:"));
  console.log(C.dim("    ollama serve  &"));
  console.log(C.dim("    ollama pull gemma4:e4b"));
}

// 4. Write .env (backup any existing file first)
if (existsSync(envPath)) {
  const backupPath = `${envPath}.bak.${Date.now()}`;
  copyFileSync(envPath, backupPath);
  console.log(C.dim(`\nBacking up existing .env → ${backupPath}`));
}

const tokenVar = `HUBSPOT_TOKEN_${envName.toUpperCase()}`;
const lines = [
  `# Written by bin/setup.js on ${new Date().toISOString()}`,
  `HUBSPOT_ENV=${envName}`,
  `${tokenVar}=${token}`,
];
if (ollamaInstalled) {
  lines.push("");
  lines.push(`# Ollama detected and configured`);
  lines.push(`OLLAMA_BASE_URL=http://localhost:11434`);
  lines.push(`OLLAMA_MODEL=gemma4:e4b`);
}
writeFileSync(envPath, lines.join("\n") + "\n", { mode: 0o600 });
console.log(C.ok(`\nWrote ${envPath}`));

// 5. Print Claude Desktop config snippet
const snippet = JSON.stringify(
  {
    mcpServers: {
      hubspot: {
        command: "node",
        args: [join(projectRoot, "src", "index.js")],
      },
    },
  },
  null,
  2
);

console.log(C.bold("\n--- Claude Desktop Config ---"));
console.log(C.dim("Open: ~/Library/Application Support/Claude/claude_desktop_config.json"));
console.log(C.dim("Merge this into the file (or paste it whole if the file is empty):\n"));
console.log(snippet);

console.log(C.bold("\n--- Next Steps ---"));
console.log("1. Save the Claude Desktop config above.");
console.log("2. Cmd-Q Claude Desktop fully (not just close window) and reopen.");
console.log("3. Verify: `npm run health-check`");
console.log("4. In Claude Desktop, ask: \"What HubSpot environment am I connected to?\"");

console.log(C.dim("\nSetup complete.\n"));
rl.close();
