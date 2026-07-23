import test from "node:test";
import assert from "node:assert/strict";
import { Readable } from "node:stream";
import { authenticateRequestContext } from "./request-context.js";
import { handleTransitionalApi } from "./transitional-api.js";

function request(body = {}, headers = {}) {
  const stream = Readable.from([JSON.stringify(body)]);
  stream.method = "POST";
  stream.headers = headers;
  return stream;
}

const config = {
  backendApiToken: "0123456789abcdef0123456789abcdef",
  installationId: "installation-a",
  nppCode: "NPP-A",
  legacyActorId: "service:npp-a:mcp-v1",
  authMode: "proxy-service",
  supabaseUrl: "https://project.example.com",
  supabaseServiceRoleKey: "server-only-key"
};

function serviceHeaders(actorId) {
  return {
    "x-backend-token": config.backendApiToken,
    "x-request-id": "cleanup_auth_request",
    "x-actor-id": actorId,
    "x-actor-type": "service",
    "x-actor-authentication": "backend-token"
  };
}

test("normal application service actor cannot invoke internal media cleanup", async () => {
  let providerCalled = false;
  const req = request({}, serviceHeaders("service:npp-a:mcp-v1"));
  const context = authenticateRequestContext(req, config);

  await assert.rejects(
    handleTransitionalApi(
      req,
      new URL("http://local/api/internal/outlet-media/cleanup"),
      context,
      config,
      { fetchImpl: async () => { providerCalled = true; } }
    ),
    (error) => error.code === "outlet_media_cleanup_forbidden" && error.statusCode === 403
  );
  assert.equal(providerCalled, false);
});

test("authenticated cleanup system actor reaches the cleanup owner", async () => {
  const calls = [];
  const fetchImpl = async (url, init) => {
    calls.push({ url: String(url), body: JSON.parse(init.body) });
    if (calls.length === 1) return new Response(JSON.stringify([]), { status: 200, headers: { "Content-Type": "application/json" } });
    if (calls.length === 2) return new Response(JSON.stringify([]), { status: 200, headers: { "Content-Type": "application/json" } });
    throw new Error("unexpected_provider_call");
  };

  const req = request(
    { pendingAgeHours: 24, retryAgeMinutes: 15, limit: 10 },
    serviceHeaders("service:mcp-plan:outlet-media-cleanup")
  );
  const context = authenticateRequestContext(req, config);
  const result = await handleTransitionalApi(
    req,
    new URL("http://local/api/internal/outlet-media/cleanup"),
    context,
    config,
    { fetchImpl }
  );

  assert.equal(context.actor.id, "service:mcp-plan:outlet-media-cleanup");
  assert.equal(result.statusCode, 200);
  assert.equal(result.payload.data.claimedCount, 0);
  assert.equal(result.payload.data.claimedDeleteJobCount, 0);
  assert.equal(calls.length, 2);
});
