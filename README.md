# HubSpot MCP Server

An opinionated Model Context Protocol server for HubSpot CRM that is built for real operational work, not demo fluff.

It gives an MCP client a safe, compact interface for:

- Reading `contacts`, `companies`, `deals`, and `tickets`
- Discovering HubSpot property schemas before querying or updating
- Updating records with an audit trail
- Rolling back prior changes with drift detection
- Keeping sandbox and production state cleanly separated

This server runs over `stdio`, uses the official HubSpot SDK under the hood, and persists audit history plus property-schema cache in a local SQLite database.

## Why This Exists

HubSpot is easy to read from and dangerously easy to mutate badly if an agent is operating with weak guardrails.

This server is designed around a few hard rules:

- No silent environment ambiguity: you must choose `sandbox` or `production`
- No blind writes in production: mutation tools require explicit confirmation
- No mystery fields: property discovery is built in
- No write-without-history: updates are audited locally
- No casual rollback footguns: rollback checks for drift before overwriting newer external changes
- No bloated MCP responses: payloads are compacted and bounded

## What It Supports

Supported CRM object types:

- `contacts`
- `companies`
- `deals`
- `tickets`

Current mutation support:

- `create_contact`
- `create_company`
- `create_deal`
- `create_ticket`
- `update_contact`
- `update_company`
- `update_deal`
- `update_ticket`
- `rollback_change` (handles both create and update reversal)

This repo provides safe, audited create and update operations across all four supported object types. Whole-record deletes are intentionally not exposed — the closest equivalent is `rollback_change` reverting a known create, which archives the entity (HubSpot's soft delete; restorable via the recycle bin).

## Architecture

High-level flow:

1. `src/index.js` loads `.env`, constructs the MCP server, and registers tools.
2. Tool handlers in `src/tools/*.js` validate inputs with `zod` and shape responses.
3. Domain wrappers in `src/hubspot/*.js` call the HubSpot SDK and normalize output.
4. `better-sqlite3` stores audit history for mutations and cached property definitions.
5. Each environment gets its own SQLite file: `data/hubspot-sandbox.db` or `data/hubspot-production.db`.

## Requirements

- Node.js `20+`
- A HubSpot private app token for at least one environment

## Installation

```bash
npm install
```

## Configuration

Start from `.env.example` and create a `.env` file in the repo root.

```dotenv
HUBSPOT_ENV=sandbox
HUBSPOT_TOKEN_SANDBOX=your-sandbox-token
HUBSPOT_TOKEN_PRODUCTION=your-production-token
```

### Environment Variables

- `HUBSPOT_ENV`
  Required. Must be `sandbox` or `production`.
- `HUBSPOT_TOKEN_SANDBOX`
  Preferred token when `HUBSPOT_ENV=sandbox`.
- `HUBSPOT_TOKEN_PRODUCTION`
  Preferred token when `HUBSPOT_ENV=production`.
- `HUBSPOT_ACCESS_TOKEN`
  Legacy fallback if env-specific token vars are not set.

The server fails fast on startup if the active environment or matching token is missing.

## Running The Server

For normal use:

```bash
npm start
```

For development:

```bash
npm run dev
```

The server speaks MCP over `stdio`. That means:

- `stdout` is reserved for JSON-RPC traffic
- operational logs go to `stderr`

## MCP Client Wiring

Use your MCP client’s standard `stdio` server configuration and point it at this repo.

Example:

```json
{
  "mcpServers": {
    "hubspot": {
      "command": "node",
      "args": ["/absolute/path/to/MCPServers/hubspot/src/index.js"]
    }
  }
}
```

If your client supports setting environment variables per server, you can supply `HUBSPOT_ENV` there instead of relying on a repo-local `.env`. This server already loads `.env` explicitly to handle clients that launch from arbitrary working directories.

## Tool Catalog

### Schema Discovery

- `list_object_types`
  Returns supported object types.
- `list_properties`
  Lists compact property definitions for an object type. Cached for 5 minutes. Useful before search or update operations.
- `get_property`
  Returns the full schema for one property, including enumeration options.

### Contacts

- `get_contact_by_id`
- `get_contact_by_email`
- `search_contacts`
- `list_recent_contacts`
- `create_contact`
- `update_contact`

### Companies

- `get_company_by_id`
- `get_company_by_domain`
- `search_companies`
- `create_company`
- `update_company`

### Deals

- `get_deal_by_id`
- `search_deals`
- `list_deals_for_company`
- `list_deals_for_contact`
- `create_deal`
- `update_deal`

### Tickets

- `get_ticket_by_id`
- `search_tickets`
- `list_tickets_for_contact`
- `list_tickets_for_company`
- `create_ticket`
- `update_ticket`

Ticket responses omit `content` by default to keep payload size sane. Request it explicitly if you need the body.

### Environment, Audit, Rollback

- `get_environment`
  Reports the active HubSpot environment and local SQLite path.
- `list_recent_changes`
  Lightweight audit log listing.
- `get_change_detail`
  Full audit row detail, including old/new values and original tool args.
- `rollback_change`
  Reverses a prior change by writing captured `old_values` back.
- `prune_audit_log`
  Deletes old audit rows when explicitly confirmed.

## Search Model

All `search_*` tools share the same input pattern:

- `query`
  Optional natural-language search term.
- `filters`
  Flat AND list.
- `filter_groups`
  OR across groups, AND within each group.
- `sorts`
- `properties`
- `limit`
- `after`

Supported filter operators:

- `EQ`
- `NEQ`
- `LT`
- `LTE`
- `GT`
- `GTE`
- `BETWEEN`
- `IN`
- `NOT_IN`
- `HAS_PROPERTY`
- `NOT_HAS_PROPERTY`
- `CONTAINS_TOKEN`
- `NOT_CONTAINS_TOKEN`

Example search:

```json
{
  "filters": [
    {
      "propertyName": "lifecyclestage",
      "operator": "EQ",
      "value": "customer"
    }
  ],
  "properties": ["firstname", "lastname", "email"],
  "limit": 10
}
```

## Safe Mutation Model

Every update tool takes:

- an object ID
- a `properties` map
- optional `confirm_production`

Example:

```json
{
  "contact_id": "123456",
  "properties": {
    "phone": "555-0101",
    "lifecyclestage": "marketingqualifiedlead"
  }
}
```

### Production Writes

When `HUBSPOT_ENV=production`, mutation tools require:

```json
{
  "confirm_production": true
}
```

This is intentional defense in depth on top of any approval UX the MCP client already has.

### Mutation Response Shape

Update tools return:

```json
{
  "audit_id": 42,
  "changed_fields": ["phone", "lifecyclestage"],
  "updated": {
    "id": "123456",
    "properties": {
      "phone": "555-0101",
      "lifecyclestage": "marketingqualifiedlead"
    },
    "updatedAt": "2026-05-02T12:34:56.000Z"
  }
}
```

Create tools return:

```json
{
  "audit_id": 43,
  "created": {
    "id": "789012",
    "properties": {
      "email": "new@example.com",
      "firstname": "New",
      "lastname": "Contact"
    },
    "createdAt": "2026-05-02T12:34:56.000Z",
    "updatedAt": "2026-05-02T12:34:56.000Z"
  },
  "rollback_hint": "Use rollback_change(audit_id=43) to archive this entity."
}
```

That `audit_id` is the handle you use later with `get_change_detail` or `rollback_change`.

## Audit And Rollback

This is the part that makes the server operationally useful instead of reckless.

### What Gets Audited

Every mutation records:

- tool name
- object type
- object ID
- original args
- old values
- new values
- changed fields
- success/failure
- environment
- timestamps

### Rollback Behavior

`rollback_change`:

- creates a new audit row for the rollback itself
- marks the original row as rolled back after a verified successful reversal
- refuses to roll back rows from a different environment
- refuses to roll back failed mutations
- refuses to roll back already-rolled-back rows
- checks for drift before writing

### Drift Detection

Before rollback, the server compares the current HubSpot values to the values originally written by the audited change.

If something changed outside this server in the meantime, rollback refuses by default instead of clobbering newer state.

You can override that only by passing:

```json
{
  "force": true
}
```

Use that only when you have inspected the drift report and explicitly want to overwrite external changes.

### Production Rollback

Rollback is also a write. In production, it requires:

```json
{
  "confirm_production": true
}
```

## Recommended Operating Workflow

For safe agent use, follow this sequence:

1. Call `get_environment`
2. If you need field names, call `list_properties`
3. Read or search the target object
4. Perform a narrow update
5. Save the returned `audit_id`
6. If something looks wrong, inspect with `get_change_detail`
7. Roll back with `rollback_change` if needed

This server is intentionally biased toward small, inspectable changes rather than broad, high-risk mutations.

## Limits And Guardrails

- Max results per page: `100`
- Default page size: `10`
- Max requested properties per call: `75`
- Property metadata cache TTL: `5 minutes`
- Response payload hard cap: about `30,000` bytes
- HubSpot `429` responses are retried automatically

If a response would be too large, the server refuses and expects the caller to narrow scope.

## Repo Layout

```text
src/
  config/      Environment and constants
  db/          SQLite schema and queries
  hubspot/     HubSpot SDK wrappers, retry, compacting, audit logic
  tools/       MCP tool registrations and input schemas
data/          Per-environment SQLite databases
```

## Development Notes

- Tool modules are dynamically imported after `.env` loading on purpose
- The property cache avoids repeated schema fetches from HubSpot
- Responses are compacted so empty HubSpot fields do not waste tokens
- The project uses ESM throughout

## Known Boundaries

- Supported object types are limited to contacts, companies, deals, and tickets
- The current mutation surface is update-focused
- Ticket `content` is opt-in
- Rollback safety is strongest for explicit, narrow property updates

## Practical Prompts For An MCP Client

Examples of the kind of work this server is built for:

- "Show me the 10 most recently updated contacts."
- "Find the company with domain `acme.com`."
- "List deal properties containing `stage`."
- "Update ticket `12345` to high priority."
- "Show me exactly what audit row `42` changed."
- "Roll back audit row `42`, but only if nothing else touched those fields."

## License

`ISC`
