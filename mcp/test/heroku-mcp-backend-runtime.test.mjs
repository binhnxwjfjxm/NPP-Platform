import assert from "node:assert/strict";
import http from "node:http";
import { spawn } from "node:child_process";
import { once } from "node:events";
import net from "node:net";
import test from "node:test";
import { fileURLToPath } from "node:url";

function request(port, path) {
  return new Promise((resolve, reject) => {
    const req = http.request(
      { host: "127.0.0.1", port, path, method: "GET" },
      (res) => {
        const chunks = [];
        res.on("data", (chunk) => chunks.push(chunk));
        res.on("end", () => {
          const text = Buffer.concat(chunks).toString("utf8");
          resolve({
            status: res.statusCode,
            headers: res.headers,
            body: text ? JSON.parse(text) : null
          });
        });
      }
    );
    req.on("error", reject);
    req.end();
  });
}

function getFreePort() {
  return new Promise((resolve, reject) => {
    const server = net.createServer();
    server.unref();
    server.on("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      if (!address || typeof address === "string") {
        reject(new Error("unable_to_reserve_port"));
        return;
      }
      const { port } = address;
      server.close((closeError) => {
        if (closeError) reject(closeError);
        else resolve(port);
      });
    });
  });
}

async function waitForHealth(port, path, timeoutMs = 20000) {
  const deadline = Date.now() + timeoutMs;
  let lastError = null;
  while (Date.now() < deadline) {
    try {
      const result = await request(port, path);
      if (result.status === 200) return result;
      lastError = new Error(`unexpected_status_${result.status}`);
    } catch (error) {
      lastError = error;
    }
    await new Promise((resolve) => setTimeout(resolve, 300));
  }
  throw lastError || new Error("health_timeout");
}

test("bootstrap runtime exposes public health routes without backend token", async (t) => {
  const publicPort = await getFreePort();
  let legacyPort = await getFreePort();
  while (legacyPort === publicPort) {
    legacyPort = await getFreePort();
  }
  const backendDir = fileURLToPath(new URL("../apps/backend/", import.meta.url));

  const child = spawn(process.execPath, ["bootstrap.js"], {
    cwd: backendDir,
    env: {
      ...process.env,
      NODE_ENV: "production",
      HOST: "127.0.0.1",
      PORT: String(publicPort),
      LEGACY_INTERNAL_PORT: String(legacyPort),
      INSTALLATION_ID: "mcp-test-installation",
      NPP_CODE: "MCP-TEST",
      MCP_LEGACY_ACTOR_ID: "service:mcp-test:mcp-v1",
      BACKEND_API_TOKEN: "0123456789abcdef0123456789abcdef",
      SUPABASE_URL: "https://project.example.com",
      SUPABASE_SERVICE_ROLE_KEY: "server-only-service-role-key",
      CORS_ORIGINS: "http://127.0.0.1",
      AUTH_MODE: "proxy-service"
    },
    stdio: ["ignore", "pipe", "pipe"]
  });

  const stdout = [];
  const stderr = [];
  child.stdout.on("data", (chunk) => stdout.push(String(chunk)));
  child.stderr.on("data", (chunk) => stderr.push(String(chunk)));
  const exitPromise = once(child, "exit");

  t.after(async () => {
    child.kill("SIGTERM");
    await exitPromise.catch(() => {});
  });

  const live = await waitForHealth(publicPort, "/health/live");
  const ready = await waitForHealth(publicPort, "/health/ready");
  const legacy = await request(publicPort, "/health");
  const apiHealth = await request(publicPort, "/api/health");

  for (const response of [live, ready, legacy, apiHealth]) {
    assert.equal(response.status, 200);
    assert.equal(response.body.data.service, "mcp-plan-backend");
    assert.equal(response.body.data.installationConfigured, true);
    assert.equal(response.body.data.providerConfigured, true);
  }

  assert.equal(legacy.body.data.authBoundary, "proxy-service");
  assert.equal(apiHealth.body.data.authBoundary, "proxy-service");
  assert.equal(live.body.data.authBoundary, "proxy-service");
  assert.equal(ready.body.data.authBoundary, "proxy-service");

  const combined = stdout.join("\n") + "\n" + stderr.join("\n");
  assert.match(combined, /foundation_gateway_ready|mcp-plan-backend listening/);
});
