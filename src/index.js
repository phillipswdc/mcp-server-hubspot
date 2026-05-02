#!/usr/bin/env node
/**
 * HubSpot MCP server entrypoint.
 *
 * Boot order is intentional:
 *   1. Load .env via absolute path (Claude Desktop spawns this from an
 *      arbitrary cwd, so we cannot rely on dotenv's default lookup).
 *   2. Dynamically import tool modules — they pull in the HubSpot client,
 *      which throws at import time if HUBSPOT_ACCESS_TOKEN is missing.
 *      Static imports would run before step 1.
 *   3. Construct the MCP server, register tools, connect stdio transport.
 *
 * Stdout is reserved for MCP JSON-RPC traffic. All status messages, logs,
 * and library output must be routed to stderr or suppressed (see the
 * dotenv `quiet: true` flag).
 */
import { config } from "dotenv";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
config({ path: join(__dirname, "..", ".env"), quiet: true });

const { registerContactTools } = await import("./tools/contacts.js");
const { registerPropertyTools } = await import("./tools/properties.js");
const { registerCompanyTools } = await import("./tools/companies.js");
const { registerDealTools } = await import("./tools/deals.js");
const { registerTicketTools } = await import("./tools/tickets.js");
const { registerAuditTools } = await import("./tools/audit.js");
const { registerPropertyNotesTools } = await import("./tools/property_notes.js");
const { registerCacheTools } = await import("./tools/cache.js");
const { registerLLMTools } = await import("./tools/llm.js");

const server = new McpServer({
  name: "hubspot",
  version: "0.1.0",
});

registerContactTools(server);
registerPropertyTools(server);
registerCompanyTools(server);
registerDealTools(server);
registerTicketTools(server);
registerAuditTools(server);
registerPropertyNotesTools(server);
registerCacheTools(server);
registerLLMTools(server);

await server.connect(new StdioServerTransport());

console.error("hubspot-mcp server running on stdio");
