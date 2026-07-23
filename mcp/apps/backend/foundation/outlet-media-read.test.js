import test from "node:test";
import assert from "node:assert/strict";
import { handleTransitionalApi } from "./transitional-api.js";

const context = {
  requestId: "request_profile_12345678",
  receivedAt: "2026-07-19T09:00:00.000Z",
  installation: { id: "installation-a", nppCode: "NPP-A" },
  actor: { id: "service:npp-a:mcp-v1", type: "service", authentication: "backend-token" }
};

const config = {
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

function jsonResponse(value, status = 200) {
  return new Response(JSON.stringify(value), { status, headers: { "Content-Type": "application/json" } });
}

test("customer profile returns business fields and short-lived private image URLs", async () => {
  const calls = [];
  const fetchImpl = async (input) => {
    const url = new URL(String(input));
    calls.push(url);
    if (url.pathname.endsWith("/mcp_route_customers")) {
      assert.equal(url.searchParams.get("id"), "eq.route-customer-1");
      return jsonResponse([{
        id: "route-customer-1",
        route_id: "route-1",
        customer_id: "customer-1",
        customer_name: "Tạp hóa An",
        phone: "0909000000",
        area: "Chợ Gạo",
        address: "12 đường A",
        sort_order: 4,
        active: true,
        note: "Gọi trước khi ghé",
        geo_lat: 10.35,
        geo_lng: 106.35,
        geo_accuracy: 12,
        geo_captured_at: "2026-07-18T02:00:00.000Z",
        geo_source: "browser",
        google_maps_url: null,
        sync_status: "synced",
        created_at: "2026-07-01T00:00:00.000Z",
        updated_at: "2026-07-18T02:00:00.000Z"
      }]);
    }
    if (url.pathname.endsWith("/mcp_outlet_media")) {
      assert.equal(url.searchParams.get("installation_id"), "eq.installation-a");
      assert.equal(url.searchParams.get("route_customer_id"), "eq.route-customer-1");
      assert.equal(url.searchParams.get("status"), "eq.ready");
      return jsonResponse([{
        id: "media-1",
        session_id: "session-1",
        object_key: "mcp-plan/outlets/installation-a/route-customer-1/media-1.jpg",
        media_type: "storefront",
        mime_type: "image/jpeg",
        actual_byte_size: 120000,
        width: 1200,
        height: 900,
        status: "ready",
        captured_by: "service:npp-a:mcp-v1",
        captured_at: "2026-07-19T08:30:00.000Z",
        geo_lat: null,
        geo_lng: null,
        geo_accuracy: null,
        created_at: "2026-07-19T08:30:00.000Z",
        updated_at: "2026-07-19T08:31:00.000Z"
      }]);
    }
    throw new Error(`unexpected_request:${url.pathname}`);
  };

  const result = await handleTransitionalApi(
    { method: "GET", headers: {} },
    new URL("http://local/api/outlet-media/customer-profile?routeCustomerId=route-customer-1"),
    context,
    config,
    { fetchImpl }
  );

  assert.equal(result.statusCode, 200);
  assert.equal(result.payload.data.customer.customerName, "Tạp hóa An");
  assert.equal(result.payload.data.customer.phone, "0909000000");
  assert.equal(result.payload.data.customer.address, "12 đường A");
  assert.equal(result.payload.data.mediaCount, 1);
  assert.equal(result.payload.data.media[0].id, "media-1");
  assert.equal("objectKey" in result.payload.data.media[0], false);
  const viewUrl = new URL(result.payload.data.media[0].viewUrl);
  assert.equal(viewUrl.searchParams.get("X-Amz-Expires"), "300");
  assert.equal(viewUrl.searchParams.get("X-Amz-SignedHeaders"), "host");
  assert.match(viewUrl.searchParams.get("X-Amz-Signature") || "", /^[0-9a-f]{64}$/);
  assert.equal(calls.length, 2);
});

test("a customer without photos still opens when R2 is not configured", async () => {
  const fetchImpl = async (input) => {
    const url = new URL(String(input));
    if (url.pathname.endsWith("/mcp_route_customers")) {
      return jsonResponse([{
        id: "route-customer-empty",
        route_id: "route-1",
        customer_name: "Khách cũ chưa có ảnh",
        active: true
      }]);
    }
    if (url.pathname.endsWith("/mcp_outlet_media")) return jsonResponse([]);
    throw new Error(`unexpected_request:${url.pathname}`);
  };

  const result = await handleTransitionalApi(
    { method: "GET", headers: {} },
    new URL("http://local/api/outlet-media/customer-profile?routeCustomerId=route-customer-empty"),
    context,
    { ...config, r2: { configured: false } },
    { fetchImpl }
  );

  assert.equal(result.statusCode, 200);
  assert.equal(result.payload.data.customer.customerName, "Khách cũ chưa có ảnh");
  assert.equal(result.payload.data.mediaCount, 0);
  assert.deepEqual(result.payload.data.media, []);
});

test("customer profile requires a route customer id", async () => {
  await assert.rejects(
    handleTransitionalApi(
      { method: "GET", headers: {} },
      new URL("http://local/api/outlet-media/customer-profile"),
      context,
      config,
      { fetchImpl: async () => { throw new Error("provider_must_not_run"); } }
    ),
    (error) => error.message === "route_customer_id_required" && error.statusCode === 400
  );
});
