import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const sql = await readFile(
  new URL("../../../supabase/migrations/20260718120000_a5_5_2_session_action_idempotency.sql", import.meta.url),
  "utf8"
);

const wrappers = [
  "mcp_idempotent_create_order_from_session_customer",
  "mcp_idempotent_create_test_from_session_customer",
  "mcp_idempotent_create_report_from_session_customer",
  "mcp_idempotent_create_followup_from_session_customer"
];

const owners = [
  "mcp_create_order_from_session_customer",
  "mcp_create_test_from_session_customer",
  "mcp_create_report_from_session_customer",
  "mcp_create_followup_from_session_customer"
];

test("A5.5.2 first slice adds four typed idempotent wrappers", () => {
  for (const wrapper of wrappers) {
    assert.match(sql, new RegExp(`create or replace function public\\.${wrapper}\\(`, "i"));
    assert.match(sql, new RegExp(`grant execute on function public\\.${wrapper}\\([\\s\\S]*?to service_role;`, "i"));
  }
  assert.equal((sql.match(/mcp_idempotency_begin\(/g) || []).length, 4);
  assert.equal((sql.match(/mcp_idempotency_complete\(/g) || []).length, 4);
  assert.equal((sql.match(/->> 'mode' = 'replay'/g) || []).length, 4);
});

test("typed wrappers preserve existing business owners and trusted context", () => {
  for (const owner of owners) assert.match(sql, new RegExp(`public\\.${owner}\\(`, "i"));
  assert.equal((sql.match(/'\{foundation_context\}'/g) || []).length, 4);
  assert.equal((sql.match(/coalesce\(p_context, '\{\}'::jsonb\)/g) || []).length >= 4, true);
  assert.doesNotMatch(sql, /p_table_name|generic_table|execute format/i);
});

test("operation inventory is explicit for order test report and follow-up", () => {
  for (const operation of [
    "session-customer.order.create",
    "session-customer.test.create",
    "session-customer.report.create",
    "session-customer.followup.create"
  ]) assert.match(sql, new RegExp(operation.replaceAll(".", "\\.")));
});
