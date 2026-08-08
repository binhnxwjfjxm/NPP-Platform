import test from "node:test";
import assert from "node:assert/strict";
import { buildMappings, buildSnapshotSummary, canonicalJson, classifyLegacyOrder, orderSourceIdentity, rowsDigest, verifyForeignKeys, verifyOrderEvidence } from "./legacy-migration-snapshot.js";

const contract = { entities: [
  { name: "routes", required: true, importance: "operational", dependencies: [] },
  { name: "route_customers", required: true, importance: "operational", dependencies: [{ field: "route_id", entity: "routes", required: true }] },
  { name: "idempotency_records", required: true, importance: "evidence", mappingMode: "evidence_only", dependencies: [] },
  { name: "orders", required: true, importance: "classified", dependencies: [] },
  { name: "order_items", required: true, importance: "classified", dependencies: [{ field: "order_id", entity: "orders", required: true }] }
] };
const officialOrder = { id: "o1", installation_id: "i1", source_type: "mcp_session_customer", source_id: "sc1", customer_onboarding_status: "approved", core_customer_id: "core-c1", core_customer_address_id: "addr-1", delivery_address: "1 Main St", status: "draft", created_at: "2026-07-01T00:00:00Z", grand_total: 100, note: "deliver normally", raw_payload: { foundation_context: { requestId: "req-1" } } };
const officialItems = [{ id: "i1", installation_id: "i1", order_id: "o1", variant_id: "v1", unit: "case", product_name: "P1", quantity: 1, unit_price: 100, line_total: 100 }];
const canonicalEvidence = { coreSalesOrderIds: new Set(["core-o"]), coreCustomerIds: new Set(["core-c1"]), coreAddressIds: new Set(["addr-1"]) };

test("canonical JSON and row digests are deterministic", () => {
  assert.equal(canonicalJson({ b: 2, a: { d: 4, c: 3 } }), '{"a":{"c":3,"d":4},"b":2}');
  assert.equal(rowsDigest([{ id: "b", x: 2 }, { x: 1, id: "a" }]), rowsDigest([{ id: "a", x: 1 }, { x: 2, id: "b" }]));
});

test("mapping is installation-scoped and never name-only", () => {
  const result = buildMappings("route_customers", [{ id: "legacy-a", customer_name: "Same" }, { id: "legacy-b", customer_name: "Same" }], [{ id: "legacy-a" }], "i1");
  assert.equal(result.findings.length, 0);
  assert.equal(result.mappings[0].sourceIdentity, "i1:route_customers:legacy-a");
  assert.equal(result.mappings[0].status, "mapped");
  assert.equal(result.mappings[1].status, "proposed");
});

test("entity-specific legacy IDs cannot cross-map unrelated payload keys", () => {
  const result = buildMappings("routes", [{ id: "legacy-route" }], [{ id: "wrong", raw_payload: { legacy_route_customer_id: "legacy-route" } }], "i1");
  assert.equal(result.mappings[0].targetId, "legacy-route"); assert.equal(result.mappings[0].status, "proposed");
});

test("mapping blocks cross-installation rows and explicit collisions", () => {
  assert.equal(buildMappings("routes", [{ id: "r1", installation_id: "i2" }], [], "i1").findings[0].type, "cross_installation_source");
  const result = buildMappings("routes", [{ id: "r1" }], [{ id: "a", raw_payload: { legacy_route_id: "r1" } }, { id: "b", raw_payload: { legacy_route_id: "r1" } }], "i1");
  assert.equal(result.findings[0].type, "mapping_collision");
});

test("foreign-key lineage reports missing and orphan references", () => {
  const findings = verifyForeignKeys(contract, { routes: [{ id: "r1" }], route_customers: [{ id: "c1", route_id: "missing" }, { id: "c2" }], idempotency_records: [], orders: [], order_items: [] });
  assert.deepEqual(findings.map((r) => r.type).sort(), ["missing_required_fk", "orphan_fk"]);
});

test("order classification uses semantic fields, verified Core lineage and reconciled totals", () => {
  assert.equal(classifyLegacyOrder({ id: "hist", core_sales_order_id: "core-o" }, [], canonicalEvidence), "HISTORICAL_DISPLAY_ONLY");
  assert.equal(classifyLegacyOrder({ id: "bad-hist", core_sales_order_id: "missing" }, [], canonicalEvidence), "INVALID_ORPHAN_RECONCILIATION_REQUIRED");
  assert.equal(classifyLegacyOrder(officialOrder, officialItems, canonicalEvidence), "OFFICIAL_ORDER_MIGRATION_CANDIDATE");
  assert.equal(classifyLegacyOrder({ ...officialOrder, grand_total: 0 }, officialItems, canonicalEvidence), "FIELD_ORDER_INTENT");
  assert.equal(classifyLegacyOrder({ ...officialOrder, note: "gửi mẫu" }, officialItems, canonicalEvidence), "SAMPLE_TEST_DEMAND");
  assert.equal(classifyLegacyOrder({ ...officialOrder, note: "customer request" }, officialItems, canonicalEvidence), "FIELD_ORDER_INTENT");
});

test("metadata requestId does not turn a valid commercial order into intent", () => {
  assert.equal(classifyLegacyOrder({ ...officialOrder, note: null, raw_payload: { foundation_context: { requestId: "request-123" } } }, officialItems, canonicalEvidence), "OFFICIAL_ORDER_MIGRATION_CANDIDATE");
});

test("order source identity matches audited hierarchy", () => {
  assert.equal(orderSourceIdentity({ source_type: "session", source_id: "s1" }), "session:s1");
  assert.equal(orderSourceIdentity({ raw_payload: { sessionCustomerId: "sc1" } }), "mcp_session_customer:sc1");
  assert.equal(orderSourceIdentity({ raw_payload: { route_customer_id: "rc1" } }), "route_customer:rc1");
});

test("duplicate source identity and idempotency conflict are blocking", () => {
  const evidence = verifyOrderEvidence({ orders: [{ id: "o1", source_type: "session", source_id: "s1" }, { id: "o2", source_type: "session", source_id: "s1" }], idempotency_records: [{ id: "e1", installation_id: "i1", operation: "order.create", idempotency_key: "k1", aggregate_type: "order", aggregate_id: "o1", request_hash: "h1" }, { id: "e2", installation_id: "i1", operation: "order.create", idempotency_key: "k1", aggregate_type: "order", aggregate_id: "o2", request_hash: "h2" }] });
  assert.deepEqual(evidence.findings.map((r) => r.type).sort(), ["duplicate_order_source_identity", "idempotency_conflict"]);
});

test("snapshot summary keeps evidence-only rows and exact Core evidence", () => {
  const sourceByEntity = { routes: [{ id: "r1", installation_id: "i1" }], route_customers: [{ id: "c1", installation_id: "i1", route_id: "r1" }], idempotency_records: [], orders: [officialOrder], order_items: officialItems };
  const targetByEntity = { routes: [], route_customers: [], idempotency_records: [], orders: [], order_items: [] };
  const summary = buildSnapshotSummary({ contract, sourceByEntity, targetByEntity, installationId: "i1", canonicalEvidence });
  assert.equal(summary.importReady, true); assert.equal(summary.mappingsByEntity.idempotency_records.length, 0); assert.equal(summary.classifications.orders[0].classification, "OFFICIAL_ORDER_MIGRATION_CANDIDATE");
});
