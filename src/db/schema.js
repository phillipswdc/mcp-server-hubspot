/**
 * Schema DDL. Applied idempotently on every startup via CREATE TABLE IF NOT EXISTS.
 *
 * When a real schema migration is needed (column rename, type change, etc.),
 * introduce a versioned migrations module rather than mutating these statements.
 */

const DDL = `
  CREATE TABLE IF NOT EXISTS audit_log (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    timestamp INTEGER NOT NULL,
    environment TEXT NOT NULL CHECK (environment IN ('sandbox','production')),
    tool_name TEXT NOT NULL,
    object_type TEXT NOT NULL,
    object_id TEXT,
    operation TEXT NOT NULL CHECK (operation IN ('create','update','delete')),
    old_values TEXT,
    new_values TEXT,
    changed_fields TEXT,
    args TEXT,
    success INTEGER NOT NULL CHECK (success IN (0,1)),
    error TEXT,
    rolled_back INTEGER NOT NULL DEFAULT 0 CHECK (rolled_back IN (0,1)),
    rolled_back_at INTEGER,
    rollback_audit_id INTEGER
  );
  CREATE INDEX IF NOT EXISTS idx_audit_object ON audit_log(object_type, object_id);
  CREATE INDEX IF NOT EXISTS idx_audit_timestamp ON audit_log(timestamp);
  CREATE INDEX IF NOT EXISTS idx_audit_rolled_back ON audit_log(rolled_back);
  CREATE INDEX IF NOT EXISTS idx_audit_env ON audit_log(environment);

  CREATE TABLE IF NOT EXISTS hubspot_schemas (
    object_type TEXT NOT NULL,
    property_name TEXT NOT NULL,
    property_type TEXT,
    field_type TEXT,
    label TEXT,
    group_name TEXT,
    payload TEXT NOT NULL,
    fetched_at INTEGER NOT NULL,
    PRIMARY KEY (object_type, property_name)
  );
  CREATE INDEX IF NOT EXISTS idx_schemas_obj ON hubspot_schemas(object_type);
  CREATE INDEX IF NOT EXISTS idx_schemas_type ON hubspot_schemas(property_type);

  CREATE TABLE IF NOT EXISTS hubspot_pipelines (
    pipeline_id TEXT PRIMARY KEY,
    object_type TEXT NOT NULL,
    label TEXT,
    payload TEXT NOT NULL,
    fetched_at INTEGER NOT NULL
  );

  CREATE TABLE IF NOT EXISTS hubspot_owners (
    owner_id TEXT PRIMARY KEY,
    email TEXT,
    first_name TEXT,
    last_name TEXT,
    payload TEXT NOT NULL,
    fetched_at INTEGER NOT NULL
  );

  CREATE TABLE IF NOT EXISTS api_cache (
    cache_key TEXT PRIMARY KEY,
    payload TEXT NOT NULL,
    fetched_at INTEGER NOT NULL,
    ttl_seconds INTEGER NOT NULL
  );
`;

/**
 * Apply schema DDL to a database handle.
 * @param {import("better-sqlite3").Database} database
 */
export function applySchema(database) {
  database.exec(DDL);
}
