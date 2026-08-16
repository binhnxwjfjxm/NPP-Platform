import http from "node:http";

const port = Number(process.env.F05_UI_AUTH_PROXY_PORT || 3000);
const upstreamPort = Number(process.env.F05_UI_NEXT_PORT || 3002);
const fixturePort = Number(process.env.F05_UI_READ_PROXY_PORT || 3110);
const sessionCookie = "hp_mcp_session=ci-f05-session";

function withSessionCookie(value) {
  const kept = String(value || "")
    .split(";")
    .map((item) => item.trim())
    .filter(Boolean)
    .filter((item) => !item.toLowerCase().startsWith("hp_mcp_session="));
  return [...kept, sessionCookie].join("; ");
}

function proxyFixtureAccess(request, response) {
  const upstream = http.request({
    hostname: "127.0.0.1",
    port: fixturePort,
    method: "GET",
    path: "/api/internal-auth/me",
    headers: {
      accept: "application/json",
      "x-request-id": String(request.headers["x-request-id"] || "f05-ui-auth-me")
    }
  }, (upstreamResponse) => {
    const responseHeaders = { ...upstreamResponse.headers };
    responseHeaders["cache-control"] = "no-store";
    responseHeaders["set-cookie"] = [`${sessionCookie}; Path=/; HttpOnly; SameSite=Lax`];
    response.writeHead(upstreamResponse.statusCode || 502, responseHeaders);
    upstreamResponse.pipe(response);
  });

  upstream.on("error", () => {
    if (!response.headersSent) {
      response.writeHead(502, { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" });
    }
    response.end(JSON.stringify({ error: { code: "fixture_auth_unavailable", message: "F05 auth fixture unavailable" } }));
  });
  upstream.end();
}

const server = http.createServer((request, response) => {
  const url = new URL(request.url || "/", `http://${request.headers.host || `127.0.0.1:${port}`}`);
  if (request.method === "GET" && url.pathname === "/api/auth/me") {
    proxyFixtureAccess(request, response);
    return;
  }

  const headers = { ...request.headers };
  headers.host = `127.0.0.1:${upstreamPort}`;
  headers["x-forwarded-proto"] = "https";
  headers.cookie = withSessionCookie(headers.cookie);

  const upstream = http.request({
    hostname: "127.0.0.1",
    port: upstreamPort,
    method: request.method,
    path: request.url,
    headers
  }, (upstreamResponse) => {
    const responseHeaders = { ...upstreamResponse.headers };
    const existing = responseHeaders["set-cookie"];
    const cookies = Array.isArray(existing) ? existing : existing ? [existing] : [];
    responseHeaders["set-cookie"] = [
      ...cookies,
      `${sessionCookie}; Path=/; HttpOnly; SameSite=Lax`
    ];
    response.writeHead(upstreamResponse.statusCode || 502, responseHeaders);
    upstreamResponse.pipe(response);
  });

  upstream.on("error", () => {
    if (!response.headersSent) {
      response.writeHead(502, { "content-type": "text/plain; charset=utf-8" });
    }
    response.end("auth_proxy_upstream_unavailable");
  });

  request.pipe(upstream);
});

server.listen(port, "127.0.0.1", () => {
  console.log(`F05 UI auth proxy listening on 127.0.0.1:${port} -> 127.0.0.1:${upstreamPort}`);
});

for (const signal of ["SIGINT", "SIGTERM"]) {
  process.on(signal, () => server.close(() => process.exit(0)));
}
