import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const runtimeSql = readFileSync(new URL("./sql/005_mcp_session_runtime_contract.sql", import.meta.url), "utf8");
const canonicalSql = readFileSync(
  new URL("../../../../../database/migrations/mcp/005_mcp_session_runtime_contract.sql", import.meta.url),
  "utf8"
);

test("runtime hardening migration stays canonical", () => {
  assert.equal(runtimeSql, canonicalSql);
});

test("runtime hardening serializes media limits per installation and outlet", () => {
  assert.match(runtimeSql, /pg_advisory_xact_lock/);
  assert.match(runtimeSql, /NEW\.installation_id \|\| ':' \|\| NEW\.route_customer_id/);
  assert.match(runtimeSql, /v_active_media_count >= 3/);
});

test("runtime role rejects inherited server file and program privileges", () => {
  for (const role of [
    "pg_read_all_data",
    "pg_write_all_data",
    "pg_execute_server_program",
    "pg_read_server_files",
    "pg_write_server_files"
  ]) {
    assert.match(runtimeSql, new RegExp(role));
  }
  assert.match(runtimeSql, /pg_has_role\(p_role::text, privileged\.oid, 'member'\)/);
});
