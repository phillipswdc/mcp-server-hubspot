/**
 * SQLite connection owner. Opens (or creates) a per-environment database file
 * — `data/hubspot-sandbox.db` or `data/hubspot-production.db` — so audit
 * logs and property caches stay cleanly separated across environments.
 *
 * All other modules import `db` from here — there is exactly one Database
 * instance per process.
 */
import Database from "better-sqlite3";
import { mkdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { applySchema } from "./schema.js";
import { env } from "../config/env.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const dataDir = join(__dirname, "..", "..", "data");
mkdirSync(dataDir, { recursive: true });

/** Absolute path to the active environment's SQLite file. */
export const dbPath = join(dataDir, `hubspot-${env.name}.db`);

/** Singleton SQLite handle for the active environment. */
export const db = new Database(dbPath);

// WAL improves concurrent read safety; foreign_keys is off by default in SQLite.
db.pragma("journal_mode = WAL");
db.pragma("foreign_keys = ON");

applySchema(db);

/** @returns {number} Current unix epoch in milliseconds. */
export function nowMs() {
  return Date.now();
}
