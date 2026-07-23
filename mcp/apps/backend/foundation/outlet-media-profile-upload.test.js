import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { prepareOutletMediaUpload } from "./outlet-media.js";

const migration = await readFile(
  new URL("../../../supabase/migrations/20260720210000_allow_route_customer_profile_media.sql", import.meta.url),
  "utf8"
);

const config = {
  supabaseUrl: "https://project.example.com",
  supabaseServiceRoleKey: "service-role",
  r2: {
    configured: true,
    endpoint: "https://account.r2.cloudflarestorage.com",
    bucket: "private-test-bucket",
    region: "auto",
    accessKeyId: "access-key",
    secretAccessKey: "secret-key"
  }
};

const context = {
  requestId: "req-profile-photo",
  receivedAt: "2026-07-20T08:00:00.000Z",
  installation: { id: "npp-demo", nppCode: "NPP-DEMO" },
  actor: { id: "sales-1", type: "service", authentication: "backend-token" }
};

function json(value, status = 200) {
  return new Response(JSON.stringify(value), {
    status,
    headers: { "Content-Type": "application/json" }
  });
}

test("profile media migration keeps the existing owner and makes session optional", () => {
  assert.match(migration, /alter column session_id drop not null/i);
  assert.match(migration, /create or replace function public\.mcp_prepare_outlet_media_upload/i);
  assert.match(migration, /if nullif\(btrim\(coalesce\(p_session_id, ''\)\), ''\) is not null then/i);
  assert.match(migration, /perform public\.mcp_assert_session_mutable\(v_session\.id\)/i);
  assert.match(migration, /v_route_customer\.route_id is distinct from v_session\.route_id/i);
  assert.match(migration, /from public\.mcp_route_customers[\s\S]*for update/i);
  assert.doesNotMatch(migration, /raise exception 'session_id_required'/i);
  assert.doesNotMatch(migration, /grant .* to (?:anon|authenticated)/i);
  assert.match(migration, /to service_role/i);
});

test("profile media migration enforces the three-photo limit in the database owner", () => {
  assert.match(migration, /select count\(\*\) into v_active_media_count/i);
  assert.match(migration, /installation_id = p_installation_id/i);
  assert.match(migration, /route_customer_id = p_route_customer_id/i);
  assert.match(migration, /status in \('pending', 'ready', 'deleting', 'delete_failed'\)/i);
  assert.match(migration, /if v_active_media_count >= 3 then/i);
  assert.match(migration, /raise exception 'outlet_media_limit_reached'/i);
});

test("upload-init passes null session to the canonical RPC for fixed-route profile photos", async () => {
  let rpcBody = null;
  const rpcPath = ["", "rest", "v1", "rpc", "mcp_prepare_outlet_media_upload"].join("/");
  const fetchImpl = async (input, init = {}) => {
    const url = new URL(typeof input === "string" ? input : input.url || String(input));
    if (url.pathname === rpcPath) {
      rpcBody = JSON.parse(init.body);
      return json({
        id: "media-profile-1",
        object_key: "internal/private/object.jpg",
        mime_type: "image/jpeg",
        status: "pending"
      });
    }
    throw new Error(`unexpected_request:${init.method || "GET"}:${url}`);
  };

  const result = await prepareOutletMediaUpload({
    routeCustomerId: "route-customer-1",
    clientUploadId: "client-upload-1",
    mimeType: "image/jpeg",
    byteSize: 1024
  }, context, config, { fetchImpl });

  assert.equal(rpcBody.p_route_customer_id, "route-customer-1");
  assert.equal(rpcBody.p_session_id, null);
  assert.equal(result.mediaId, "media-profile-1");
  assert.match(result.putUrl, /^https:\/\//);
  assert.equal("objectKey" in result, false, "public upload-init DTO must not expose the private object key");
});
