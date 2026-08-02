import test from "node:test";
import assert from "node:assert/strict";
import { bindProviderPersistence } from "./provider-runtime.js";
import { postgresqlRead } from "./postgresql-read-adapter.js";

function bindCapture() {
  const calls = [];
  bindProviderPersistence({
    async assertReady() {},
    async readiness() { return { ready: true, configured: true, provider: "postgresql" }; },
    async withTransaction(work) {
      return work({
        async query(sql, params) {
          calls.push({ sql, params });
          return { rows: [{ id: "row-1" }] };
        }
      });
    },
    async close() {}
  });
  return calls;
}

const config = Object.freeze({ installationId: "installation-current" });

test("PostgreSQL reads use an explicit schema and force configured installation", async () => {
  const calls = bindCapture();
  const rows = await postgresqlRead(
    config,
    "mcp_route_customers?select=id,customer_name&installation_id=eq.installation-other&id=eq.customer-1&limit=1"
  );
  assert.deepEqual(rows, [{ id: "row-1" }]);
  assert.equal(calls.length, 1);
  assert.match(calls[0].sql, /FROM "mcp"\."mcp_route_customers"/);
  assert.match(calls[0].sql, /"installation_id" = \$1/);
  assert.equal(calls[0].sql.match(/"installation_id"/g)?.length, 1);
  assert.deepEqual(calls[0].params, ["installation-current", "customer-1", 1, 0]);
  assert.equal(calls[0].params.includes("installation-other"), false);
});

test("global report templates are visible without exposing another installation", async () => {
  const calls = bindCapture();
  await postgresqlRead(config, "mcp_report_templates?select=*&status=eq.active");
  assert.match(calls[0].sql, /\("installation_id" = \$1 OR "installation_id" IS NULL\)/);
  assert.deepEqual(calls[0].params.slice(0, 2), ["installation-current", "active"]);
});

test("PostgreSQL reads reject unknown tables and missing configured scope", async () => {
  bindCapture();
  await assert.rejects(
    () => postgresqlRead(config, "shared.customers?select=*"),
    (error) => error.code === "invalid_read_table"
  );
  await assert.rejects(
    () => postgresqlRead({}, "mcp_routes?select=*"),
    (error) => error.code === "installation_id_required"
  );
});
