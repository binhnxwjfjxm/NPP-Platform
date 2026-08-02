// Issue #158 regression coverage for the production PostgreSQL read boundary.
import test from "node:test";
import assert from "node:assert/strict";
import { Readable } from "node:stream";
import { handleReadApi } from "./read-api.js";

function request(body, method = "POST") {
  const req = Readable.from([JSON.stringify(body)]);
  req.method = method;
  return req;
}

function context(installationId = "installation-1") {
  return { installation: { id: installationId } };
}

function persistenceWith(rows, calls = []) {
  return {
    async assertReady() {
      calls.push({ type: "ready" });
    },
    async withTransaction(callback) {
      calls.push({ type: "transaction" });
      return callback({
        async query(sql, params) {
          calls.push({ type: "query", sql, params });
          return { rows };
        }
      });
    }
  };
}

test("read API scopes the JSON store by installation and logical table", async () => {
  const calls = [];
  const result = await handleReadApi(
    request({
      table: "mcp_routes",
      select: "id,route_name,active",
      order: "route_name.asc",
      filters: { active: "is.true" },
      limit: 25,
      offset: 0
    }),
    new URL("http://127.0.0.1/api/read"),
    context("installation-a"),
    {},
    {
      persistence: persistenceWith([
        { row_key: "route-1", row_data: { id: "route-1", route_name: "Tuyến A", active: true, internal: "hidden" } }
      ], calls)
    }
  );

  assert.equal(result.statusCode, 200);
  assert.deepEqual(result.payload.data, [
    { id: "route-1", route_name: "Tuyến A", active: true }
  ]);
  const query = calls.find((call) => call.type === "query");
  assert.match(query.sql, /FROM mcp\.legacy_read_rows/);
  assert.match(query.sql, /installation_id = \$1/);
  assert.match(query.sql, /table_name = \$2/);
  assert.match(query.sql, /row_data #>> '\{active\}' = 'true'/);
  assert.match(query.sql, /ORDER BY row_data #>> '\{route_name\}' ASC NULLS LAST/);
  assert.deepEqual(query.params.slice(0, 2), ["installation-a", "mcp_routes"]);
});

test("read API returns logical row counts from the JSON store", async () => {
  const calls = [];
  const result = await handleReadApi(
    request({ table: "orders", count: true, filters: { status: "eq.confirmed" } }),
    new URL("http://127.0.0.1/api/read"),
    context(),
    {},
    { persistence: persistenceWith([{ count: 3 }], calls) }
  );

  assert.equal(result.statusCode, 200);
  assert.equal(result.payload.data, 3);
  const query = calls.find((call) => call.type === "query");
  assert.match(query.sql, /SELECT COUNT\(\*\)::integer AS count/);
  assert.deepEqual(query.params, ["installation-1", "orders", "confirmed"]);
});

test("read API returns an empty list when a logical table has no imported rows", async () => {
  const result = await handleReadApi(
    request({ table: "mcp_route_customers", select: "*" }),
    new URL("http://127.0.0.1/api/read"),
    context(),
    {},
    { persistence: persistenceWith([]) }
  );

  assert.equal(result.statusCode, 200);
  assert.deepEqual(result.payload.data, []);
});

test("read API rejects tables outside the reviewed allowlist", async () => {
  await assert.rejects(
    () => handleReadApi(
      request({ table: "shared.customers" }),
      new URL("http://127.0.0.1/api/read"),
      context(),
      {},
      { persistence: persistenceWith([]) }
    ),
    (error) => error?.code === "invalid_read_table" && error?.statusCode === 400
  );
});
