import test from "node:test";
import assert from "node:assert/strict";
import {
  buildMappings,
  buildSnapshotSummary,
  canonicalJson,
  classifyLegacyOrder,
  rowsDigest,
  verifyForeignKeys
} from "./legacy-migration-snapshot.js";

const contract = {
  entities: [
    { name: "routes", required: true, importance: "operational", dependencies: [] },
    { name: "route_customers", required: true, importance: "operational", dependencies: [{ field: "route_id", entity: "routes", required: true }] },
    { name: "orders", required: true, importance: "classified", dependencies: [] },
    { name: "order_items", required: true, importance: "classified", dependencies: [{ field: "order_id", entity: "orders", required: true }] }
  ]
};

test("canonical JSON and row digests are deterministic", () => {
  assert.equal(canonicalJson({ b: 2, a: { d: 4, c: 3 } }), '{"a":{"c":3,"d":4},"b":2}');
  assert.equal(rowsDigest([{ id: "b", x: 2 }, { x: 1, id: "a" }]), rowsDigest([{ id: "a", x: 1 }, { x: 2, id: "b" }]));
});

test("mapping uses stable evidence and never name-only matching", () => {
  const result = buildMappings("route_customers", [
    { id: "legacy-a", customer_name: "Same Shop" },
    { id: "legacy-b", customer_name: "Same Shop" },
    { id: "legacy-c", customer_name: "Other" }
  ], [
    { id: "legacy-a", customer_name: "Changed" },
    { id: "canonical-c", customer_name: "Other", raw_payload: { legacy_route_customer_id: "legacy-c" } }
  ]);
  assert.deepEqual(result.mappings, [
    { entity: "route_customers", sourceId: "legacy-a", targetId: "legacy-a", evidence: "exact_id", status: "mapped" },
    { entity: "route_customers", sourceId: "legacy-b", targetId: "legacy-b", evidence: "preserve_source_id", status: "proposed" },
    { entity: "route_customers", sourceId: "legacy-c", targetId: "canonical-c", evidence: "explicit_legacy_id", status: "mapped" }
  ]);
  assert.equal(result.findings.length, 0);
});

test("mapping reports explicit legacy-id collisions", () => {
  const result = buildMappings("routes", [{ id: "r1" }], [
    { id: "a", raw_payload: { legacy_route_id: "r1" } },
    { id: "b", raw_payload: { legacy_route_id: "r1" } }
  ]);
  assert.equal(result.findings[0].type, "mapping_collision");
});

test("foreign-key lineage reports required missing and orphan references", () => {
  const findings = verifyForeignKeys(contract, {
    routes: [{ id: "r1" }],
    route_customers: [{ id: "c1", route_id: "r-missing" }, { id: "c2" }],
    orders: [],
    order_items: []
  });
  assert.deepEqual(findings.map((row) => row.type).sort(), ["missing_required_fk", "orphan_fk"]);
});

test("legacy order classification keeps the locked five-way boundary", () => {
  assert.equal(classifyLegacyOrder({ id: "o1", note: "gửi mẫu" }, [{ id: "i1" }]), "SAMPLE_TEST_DEMAND");
  assert.equal(classifyLegacyOrder({ id: "o2", note: "nhu cầu" }, [{ id: "i2" }]), "FIELD_ORDER_INTENT");
  assert.equal(classifyLegacyOrder({ id: "o3", core_sales_order_id: "11111111-1111-4111-8111-111111111111" }, [{ id: "i3" }]), "HISTORICAL_DISPLAY_ONLY");
  assert.equal(classifyLegacyOrder({ id: "o4", core_customer_id: "c", status: "draft", created_at: "2026-07-01T00:00:00Z", grand_total: 100 }, [{ id: "i4", sku: "SKU-1", unit: "case", quantity: 1, unit_price: 100 }]), "OFFICIAL_ORDER_MIGRATION_CANDIDATE");
  assert.equal(classifyLegacyOrder({ id: "o5" }, []), "INVALID_ORPHAN_RECONCILIATION_REQUIRED");
});

test("snapshot summary blocks orphan lineage and unresolved orders but proposes stable IDs", () => {
  const sourceByEntity = {
    routes: [{ id: "r1" }],
    route_customers: [{ id: "c1", route_id: "r1" }],
    orders: [{ id: "o1", core_customer_id: "c1", status: "draft", created_at: "2026-07-01T00:00:00Z", grand_total: 10 }],
    order_items: [{ id: "i1", order_id: "o1", sku: "SKU-1", unit: "piece", quantity: 1, unit_price: 10 }]
  };
  const targetByEntity = { routes: [], route_customers: [], orders: [], order_items: [] };
  const summary = buildSnapshotSummary({ contract, sourceByEntity, targetByEntity });
  assert.equal(summary.importReady, true);
  assert.equal(summary.mappingsByEntity.routes[0].status, "proposed");
  assert.equal(summary.classifications.orders[0].classification, "OFFICIAL_ORDER_MIGRATION_CANDIDATE");
});
