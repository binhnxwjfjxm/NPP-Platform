import test from "node:test";
import assert from "node:assert/strict";
import { bindProviderPersistence } from "./provider-runtime.js";
import { postgresqlRead } from "./postgresql-read-adapter.js";
import { postgresqlMediaUploadRpc } from "./postgresql-media-upload-adapter.js";
import { postgresqlSpecialRpc } from "./postgresql-media-adapter.js";
import { loadOutletCustomerProfile } from "./outlet-media-read.js";

function bindQueries(handler) {
  const calls = [];
  bindProviderPersistence({
    async assertReady() {},
    async readiness() { return { ready: true, configured: true, provider: "postgresql" }; },
    async withTransaction(work) {
      return work({
        async query(sql, params) {
          calls.push({ sql, params });
          return handler(sql, params, calls);
        }
      });
    },
    async close() {}
  });
  return calls;
}

const pgConfig = Object.freeze({ installationId: "installation-current" });

test("Issue 623: route-customer enrichment casts shared UUIDs to text and shared gallery uses shared schema", async () => {
  let calls = bindQueries(() => ({ rows: [] }));
  await postgresqlRead(pgConfig, "mcp_route_customers?select=id,google_maps_url&limit=1");
  assert.match(calls[0].sql, /customer_address\.customer_id::text = route_customer\.core_customer_id/);
  assert.match(calls[0].sql, /customer_address\.id::text = route_customer\.core_customer_address_id/);

  calls = bindQueries(() => ({ rows: [] }));
  await postgresqlRead(
    pgConfig,
    "customer_media?select=id,source_app,source_media_id&customer_id=eq.11111111-1111-4111-8111-111111111111&status=eq.ready"
  );
  assert.match(calls[0].sql, /FROM "shared"\."customer_media"/);
  assert.match(calls[0].sql, /WHERE "installation_id" = \$1/);
  assert.deepEqual(
    calls[0].params.slice(0, 3),
    ["installation-current", "11111111-1111-4111-8111-111111111111", "ready"]
  );
});

test("Issue 623: linked MCP upload reserves the one shared three-photo gallery", async () => {
  const sharedCustomerId = "11111111-1111-4111-8111-111111111111";
  const calls = bindQueries((sql, params) => {
    if (sql.includes("FROM mcp.mcp_route_customers")) {
      return { rows: [{ id: "route-customer-1", route_id: "route-1", core_customer_id: sharedCustomerId }] };
    }
    if (sql.includes("FROM mcp.mcp_outlet_media") && sql.includes("client_upload_id")) return { rows: [] };
    if (sql.includes("FROM shared.customers")) return { rows: [{ id: sharedCustomerId, is_active: true }] };
    if (sql.includes("FROM shared.customer_media") && sql.includes("count(*)")) return { rows: [{ count: 2 }] };
    if (sql.includes("INSERT INTO mcp.mcp_outlet_media")) {
      return {
        rows: [{
          id: params[0],
          installation_id: params[1],
          route_customer_id: params[2],
          session_id: params[3],
          object_key: params[4],
          mime_type: params[5],
          expected_byte_size: params[6],
          client_upload_id: params[7],
          status: "pending"
        }]
      };
    }
    if (sql.includes("INSERT INTO shared.customer_media")) return { rows: [{ id: params[0] }] };
    throw new Error(`unexpected_sql:${sql}`);
  });

  const media = await postgresqlMediaUploadRpc(pgConfig, "mcp_prepare_outlet_media_upload", {
    p_route_customer_id: "route-customer-1",
    p_session_id: null,
    p_client_upload_id: "upload-623-a",
    p_mime_type: "image/jpeg",
    p_expected_byte_size: 1234,
    p_context: { actorId: "service:mcp:test" }
  });

  assert.match(media.id, /^mom_[a-f0-9]{32}$/);
  assert.equal(calls.some((call) => call.sql.includes("FROM mcp.mcp_outlet_media") && call.sql.includes("count(*)")), false);
  const sharedInsert = calls.find((call) => call.sql.includes("INSERT INTO shared.customer_media"));
  assert.ok(sharedInsert);
  assert.match(sharedInsert.sql, /source_app, source_media_id/);
  assert.equal(sharedInsert.params[1], "installation-current");
  assert.equal(sharedInsert.params[2], sharedCustomerId);
  assert.equal(sharedInsert.params[3], media.id);
  assert.equal(sharedInsert.params[4], "route-customer-1");
  assert.equal(sharedInsert.params[6], "upload-623-a");
});

test("Issue 623: fourth linked upload is a business conflict before any insert", async () => {
  const sharedCustomerId = "11111111-1111-4111-8111-111111111111";
  const calls = bindQueries((sql) => {
    if (sql.includes("FROM mcp.mcp_route_customers")) {
      return { rows: [{ id: "route-customer-1", route_id: "route-1", core_customer_id: sharedCustomerId }] };
    }
    if (sql.includes("FROM mcp.mcp_outlet_media") && sql.includes("client_upload_id")) return { rows: [] };
    if (sql.includes("FROM shared.customers")) return { rows: [{ id: sharedCustomerId, is_active: true }] };
    if (sql.includes("FROM shared.customer_media") && sql.includes("count(*)")) return { rows: [{ count: 3 }] };
    throw new Error(`unexpected_sql:${sql}`);
  });

  await assert.rejects(
    () => postgresqlMediaUploadRpc(pgConfig, "mcp_prepare_outlet_media_upload", {
      p_route_customer_id: "route-customer-1",
      p_session_id: null,
      p_client_upload_id: "upload-623-limit",
      p_mime_type: "image/jpeg",
      p_expected_byte_size: 1234,
      p_context: { actorId: "service:mcp:test" }
    }),
    (error) => error.code === "outlet_media_limit_reached" && error.statusCode === 409
  );
  assert.equal(calls.some((call) => call.sql.includes("INSERT INTO")), false);
});

test("Issue 623: MCP finalize promotes its shared reservation to ready", async () => {
  const calls = bindQueries((sql, params) => {
    if (sql.startsWith("SELECT * FROM mcp.mcp_outlet_media")) {
      return {
        rows: [{
          id: "mom_123",
          status: "pending",
          mime_type: "image/jpeg",
          actual_byte_size: null,
          width: null,
          height: null,
          etag: null
        }]
      };
    }
    if (sql.startsWith("UPDATE mcp.mcp_outlet_media")) {
      return {
        rows: [{
          id: "mom_123",
          status: "ready",
          mime_type: "image/jpeg",
          actual_byte_size: params[3],
          width: params[4],
          height: params[5],
          etag: params[2]
        }]
      };
    }
    if (sql.startsWith("UPDATE shared.customer_media")) return { rows: [] };
    throw new Error(`unexpected_sql:${sql}`);
  });

  const media = await postgresqlMediaUploadRpc(pgConfig, "mcp_finalize_outlet_media_upload", {
    p_media_id: "mom_123",
    p_content_type: "image/jpeg",
    p_actual_byte_size: 1234,
    p_width: 640,
    p_height: 480,
    p_etag: "etag-123",
    p_context: { actorId: "service:mcp:test" }
  });

  assert.equal(media.status, "ready");
  const sharedUpdate = calls.find((call) => call.sql.startsWith("UPDATE shared.customer_media"));
  assert.ok(sharedUpdate);
  assert.match(sharedUpdate.sql, /source_app = 'MCP'/);
  assert.match(sharedUpdate.sql, /source_media_id = \$2/);
  assert.deepEqual(sharedUpdate.params.slice(0, 3), ["installation-current", "mom_123", 1234]);
});

test("Issue 623: successful MCP delete removes the shared gallery entry", async () => {
  const calls = bindQueries((sql) => {
    if (sql.startsWith("UPDATE mcp.mcp_outlet_media")) {
      return { rows: [{ id: "mom_delete_1", status: "deleted" }] };
    }
    if (sql.startsWith("UPDATE shared.customer_media")) return { rows: [] };
    throw new Error(`unexpected_sql:${sql}`);
  });

  const media = await postgresqlSpecialRpc(pgConfig, "mcp_finish_outlet_media_delete", {
    p_media_id: "mom_delete_1",
    p_succeeded: true,
    p_context: { actorId: "service:mcp:test" }
  });

  assert.equal(media.status, "deleted");
  const sharedUpdate = calls.find((call) => call.sql.startsWith("UPDATE shared.customer_media"));
  assert.ok(sharedUpdate);
  assert.match(sharedUpdate.sql, /status = 'deleted'/);
  assert.match(sharedUpdate.sql, /source_app = 'MCP'/);
  assert.match(sharedUpdate.sql, /source_media_id = \$2/);
});

const readConfig = {
  supabaseUrl: "https://project.example.com",
  supabaseServiceRoleKey: "server-test-value",
  r2: {
    configured: true,
    endpoint: "https://account.r2.cloudflarestorage.com",
    bucket: "hung-phat",
    region: "auto",
    accessKeyId: "test-access-id",
    secretAccessKey: "test-signing-value"
  }
};
const readContext = {
  installation: { id: "installation-a" }
};

function jsonResponse(value, status = 200) {
  return new Response(JSON.stringify(value), { status, headers: { "Content-Type": "application/json" } });
}

test("Issue 623: linked MCP customer reads Công Ty and MCP photos from the same shared gallery", async () => {
  const calls = [];
  const coreCustomerId = "11111111-1111-4111-8111-111111111111";
  const fetchImpl = async (input) => {
    const url = new URL(String(input));
    calls.push(url);
    if (url.pathname.endsWith("/mcp_route_customers")) {
      assert.match(url.searchParams.get("select") || "", /core_customer_id/);
      return jsonResponse([{
        id: "route-customer-1",
        route_id: "route-1",
        customer_name: "Tạp hóa An",
        active: true,
        core_customer_id: coreCustomerId
      }]);
    }
    if (url.pathname.endsWith("/customer_media")) {
      assert.equal(url.searchParams.get("customer_id"), `eq.${coreCustomerId}`);
      assert.equal(url.searchParams.get("status"), "eq.ready");
      return jsonResponse([
        {
          id: "22222222-2222-4222-8222-222222222222",
          source_app: "CORE",
          source_media_id: null,
          source_session_id: null,
          object_key: "company/customer/core.jpg",
          mime_type: "image/jpeg",
          actual_byte_size: 1000,
          width: 800,
          height: 600,
          status: "ready",
          captured_by: "company-user",
          captured_at: "2026-08-17T08:00:00.000Z",
          created_at: "2026-08-17T08:00:00.000Z",
          updated_at: "2026-08-17T08:00:00.000Z"
        },
        {
          id: "33333333-3333-4333-8333-333333333333",
          source_app: "MCP",
          source_media_id: "mom_shared_1",
          source_session_id: "session-1",
          object_key: "mcp/outlet/mcp.jpg",
          mime_type: "image/jpeg",
          actual_byte_size: 1200,
          width: 900,
          height: 700,
          status: "ready",
          captured_by: "mcp-user",
          captured_at: "2026-08-17T07:00:00.000Z",
          created_at: "2026-08-17T07:00:00.000Z",
          updated_at: "2026-08-17T07:00:00.000Z"
        }
      ]);
    }
    throw new Error(`unexpected_request:${url.pathname}`);
  };

  const result = await loadOutletCustomerProfile(
    "route-customer-1",
    readContext,
    readConfig,
    { fetchImpl }
  );

  assert.equal(result.mediaCount, 2);
  assert.deepEqual(
    result.media.map((media) => ({ id: media.id, sourceApp: media.sourceApp })),
    [
      { id: "22222222-2222-4222-8222-222222222222", sourceApp: "CORE" },
      { id: "mom_shared_1", sourceApp: "MCP" }
    ]
  );
  assert.equal(calls.some((url) => url.pathname.endsWith("/mcp_outlet_media")), false);
});
