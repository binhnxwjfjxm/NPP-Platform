import assert from "node:assert/strict";
import test from "node:test";

test("F05 live smoke sends the complete authenticated service actor context", async () => {
  const envKeys = [
    "MCP_API_BASE_URL",
    "BACKEND_API_TOKEN",
    "NPP_F05_EXPECTED_ACTOR_ID",
    "NPP_F05_EXPECTED_ACTOR_AUTHENTICATION"
  ];
  const previousEnv = Object.fromEntries(envKeys.map((key) => [key, process.env[key]]));
  const previousFetch = globalThis.fetch;
  let capturedHeaders;

  process.env.MCP_API_BASE_URL = "http://127.0.0.1:3001";
  process.env.BACKEND_API_TOKEN = "b".repeat(32);
  process.env.NPP_F05_EXPECTED_ACTOR_ID = "service:mcp-plan:f05-runtime-smoke";
  process.env.NPP_F05_EXPECTED_ACTOR_AUTHENTICATION = "backend-token";

  globalThis.fetch = async (_url, init = {}) => {
    capturedHeaders = init.headers;
    return new Response(JSON.stringify({
      requestId: "req_actor_context_12345678",
      receivedAt: new Date().toISOString(),
      data: {}
    }), {
      status: 200,
      headers: { "content-type": "application/json" }
    });
  };

  try {
    const { gateway } = await import(`./runtime/a5-5-2-smoke-http.mjs?actor-context=${Date.now()}`);
    await gateway("/api/test", { requestId: "req_actor_context_12345678" });

    assert.equal(capturedHeaders["X-Actor-Id"], "service:mcp-plan:f05-runtime-smoke");
    assert.equal(capturedHeaders["X-Actor-Type"], "service");
    assert.equal(capturedHeaders["X-Actor-Authentication"], "backend-token");
  } finally {
    globalThis.fetch = previousFetch;
    for (const key of envKeys) {
      if (previousEnv[key] === undefined) delete process.env[key];
      else process.env[key] = previousEnv[key];
    }
  }
});
