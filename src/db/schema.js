/**
 * Schema DDL. Applied idempotently on every startup via CREATE TABLE IF NOT EXISTS.
 *
 * For columns added in later phases to existing tables, use addColumnIfNotExists
 * below — SQLite has no ADD COLUMN IF NOT EXISTS so we check PRAGMA table_info
 * first. Avoids breaking existing databases when the schema evolves.
 */

const DDL = `
  CREATE TABLE IF NOT EXISTS audit_log (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    timestamp INTEGER NOT NULL,
    environment TEXT NOT NULL CHECK (environment IN ('sandbox','production')),
    session_id TEXT,
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
    last_modified_at INTEGER,
    rolled_back INTEGER NOT NULL DEFAULT 0 CHECK (rolled_back IN (0,1)),
    rolled_back_at INTEGER,
    rollback_audit_id INTEGER
  );
  CREATE INDEX IF NOT EXISTS idx_audit_object ON audit_log(object_type, object_id);
  CREATE INDEX IF NOT EXISTS idx_audit_timestamp ON audit_log(timestamp);
  CREATE INDEX IF NOT EXISTS idx_audit_rolled_back ON audit_log(rolled_back);
  CREATE INDEX IF NOT EXISTS idx_audit_env ON audit_log(environment);
  -- Note: idx_audit_session on session_id is created in applySchema() after
  -- the column-add migration runs, so existing DBs don't fail on first boot.

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

  CREATE TABLE IF NOT EXISTS property_notes (
    object_type TEXT NOT NULL,
    property_name TEXT NOT NULL,
    category TEXT,
    notes TEXT,
    source TEXT NOT NULL CHECK (source IN ('auto','user','llm-derived')),
    updated_at INTEGER NOT NULL,
    PRIMARY KEY (object_type, property_name)
  );
  CREATE INDEX IF NOT EXISTS idx_pn_category ON property_notes(category);
  CREATE INDEX IF NOT EXISTS idx_pn_source ON property_notes(source);

  CREATE TABLE IF NOT EXISTS result_cache (
    cache_id TEXT PRIMARY KEY,
    cache_type TEXT NOT NULL CHECK (cache_type IN ('result_set','property_value')),
    tool_name TEXT,
    source_args TEXT,
    object_type TEXT,
    payload TEXT NOT NULL,
    result_count INTEGER,
    byte_length INTEGER,
    preview TEXT,
    created_at INTEGER NOT NULL,
    expires_at INTEGER NOT NULL,
    environment TEXT NOT NULL,
    session_id TEXT
  );
  CREATE INDEX IF NOT EXISTS idx_rc_expires ON result_cache(expires_at);
  CREATE INDEX IF NOT EXISTS idx_rc_session ON result_cache(session_id);
  CREATE INDEX IF NOT EXISTS idx_rc_type ON result_cache(cache_type);
`;

/**
 * Apply schema DDL to a database handle. Also runs idempotent column
 * additions for columns introduced after the initial schema, so existing
 * databases get upgraded without manual migration steps.
 *
 * @param {import("better-sqlite3").Database} database
 */
export function applySchema(database) {
  database.exec(DDL);

  // Idempotent column additions for databases created before these columns existed.
  // Each call is a no-op if the column is already present.
  addColumnIfNotExists(database, "audit_log", "session_id", "TEXT");
  addColumnIfNotExists(database, "audit_log", "last_modified_at", "INTEGER");
  // Index needs to be (re-)created in case session_id was just added.
  database.exec(
    `CREATE INDEX IF NOT EXISTS idx_audit_session ON audit_log(session_id)`
  );
}

/**
 * Add a column to a table if it doesn't already exist. Reads PRAGMA table_info
 * to determine current columns. Useful for in-place schema upgrades on
 * databases created before the column was introduced.
 *
 * @param {import("better-sqlite3").Database} db
 * @param {string} table
 * @param {string} column
 * @param {string} typeAndConstraints e.g. "TEXT", "INTEGER NOT NULL DEFAULT 0"
 */
function addColumnIfNotExists(db, table, column, typeAndConstraints) {
  const cols = db.prepare(`PRAGMA table_info(${table})`).all();
  if (cols.some((c) => c.name === column)) return;
  db.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${typeAndConstraints}`);
}
