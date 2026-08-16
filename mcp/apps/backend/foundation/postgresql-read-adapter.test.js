import test from "node:test";
import assert from "node:assert/strict";
import { bindProviderPersistence } from "./provider-runtime.js";
import { postgresqlRead } from "./postgresql-read-adapter.js";

function bindCapture(rows = [{ id: "row-1" }]) {
  const calls = [];
  bindProviderPersistence({
    async assertReady() {},
    async readiness() { return { ready: true, configured: true, provider: "postgresql" }; },
    async withTransaction(work) {
      return work({
        async query(sql, params) {
          calls.push({ sql, params });
          return { rows };
        }
      });
    },
    async close() {}
  });
  return calls;
}

const config = Object.freeze({ installationId: "installation-current" });

test("PostgreSQL reads use an explicit schema and force configured installation", async () => {
  const calls = bindCapture([{ id: "row-1" }]);
  const rows = await postgresqlRead(
    config,
    "mcp_route_customers?select=id,customer_name&installation_id=eq.installation-other&id=eq.customer-1&limit=1"
  );
  assert.deepEqual(rows, [{ id: "row-1" }]);
  assert.equal(calls.length, 1);
  assert.match(calls[0].sql, /FROM \([\s\S]*"mcp"\."mcp_route_customers" AS route_customer/);
  assert.match(calls[0].sql, /WHERE "installation_id" = \$1/);
  assert.doesNotMatch(calls[0].sql, /SELECT "id", "customer_name", "__canonical_google_maps_url"/);
  assert.deepEqual(calls[0].params, ["installation-current", "customer-1", 1, 0]);
  assert.equal(calls[0].params.includes("installation-other"), false);
});

test("linked route-customer read prefers canonical shared.customer_addresses location_url", async () => {
  const calls = bindCapture([{ id: "route-customer-1", google_maps_url: "https://legacy.example", __canonical_google_maps_url: "https://maps.example/canonical" }]);
  const rows = await postgresqlRead(config, "mcp_route_customers?select=id,google_maps_url&limit=1");
  assert.equal(rows[0].google_maps_url, "https://maps.example/canonical");
  assert.equal(Object.prototype.hasOwnProperty.call(rows[0], "__canonical_google_maps_url"), false);
  assert.match(calls[0].sql, /LEFT JOIN "shared"\."customer_addresses" AS customer_address/);
  assert.match(calls[0].sql, /core_onboarding_status IN \('approved', 'linked_existing'\)/);
  assert.match(calls[0].sql, /WHEN customer_address\.is_active IS TRUE THEN customer_address\.location_url/);
  assert.match(calls[0].sql, /ELSE NULL/);
});

test("linked route-customer never falls back to legacy GPS when the canonical address has no active location", async () => {
  bindCapture([{ id: "route-customer-1", google_maps_url: "https://legacy.example", __canonical_google_maps_url: null }]);
  const rows = await postgresqlRead(config, "mcp_route_customers?select=id,google_maps_url&limit=1");
  assert.equal(rows[0].google_maps_url, null);
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
