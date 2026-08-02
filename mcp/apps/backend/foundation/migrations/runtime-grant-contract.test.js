import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const sql = readFileSync(
  new URL("./sql/002_mcp_domain_read_models.sql", import.meta.url),
  "utf8"
);

test("runtime grant helper is not executable by PUBLIC and rejects privileged roles", () => {
  assert.match(sql, /REVOKE ALL ON FUNCTION shared\.grant_mcp_runtime_access\(name\) FROM PUBLIC/);
  assert.match(sql, /mcp_runtime_role_is_privileged/);
  assert.match(sql, /rolsuper, rolcreaterole, rolcreatedb, rolreplication, rolbypassrls/);
});

test("runtime grants are explicit and preserve append-only foundation boundaries", () => {
  assert.match(sql, /GRANT SELECT, INSERT, UPDATE ON TABLE mcp\.idempotency_records/);
  assert.match(sql, /GRANT INSERT ON TABLE mcp\.audit_events/);
  assert.match(sql, /GRANT INSERT ON TABLE mcp\.outbox_events/);
  assert.match(sql, /GRANT SELECT ON TABLE mcp\.accounts, mcp\.products/);
  assert.match(sql, /GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE/);

  assert.doesNotMatch(sql, /GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES/);
  assert.doesNotMatch(sql, /GRANT EXECUTE ON ALL FUNCTIONS/);
  assert.doesNotMatch(sql, /GRANT USAGE, SELECT, UPDATE ON ALL SEQUENCES/);
  assert.doesNotMatch(sql, /GRANT SELECT ON TABLE mcp\.audit_events/);
  assert.doesNotMatch(sql, /GRANT SELECT ON TABLE mcp\.outbox_events/);
  assert.doesNotMatch(sql, /GRANT[^\n]+DELETE[^\n]+mcp\.idempotency_records/);
});

test("future MCP objects receive no implicit runtime privileges", () => {
  assert.match(sql, /ALTER DEFAULT PRIVILEGES IN SCHEMA mcp REVOKE ALL ON TABLES/);
  assert.match(sql, /ALTER DEFAULT PRIVILEGES IN SCHEMA mcp REVOKE ALL ON SEQUENCES/);
  assert.match(sql, /ALTER DEFAULT PRIVILEGES IN SCHEMA mcp REVOKE ALL ON FUNCTIONS/);
});
