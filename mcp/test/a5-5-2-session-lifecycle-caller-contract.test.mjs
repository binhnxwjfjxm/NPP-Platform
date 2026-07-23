import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const master = await readFile(new URL("../src/features/mcp/McpMasterView.tsx", import.meta.url), "utf8");
const session = await readFile(new URL("../src/features/mcp/McpSessionCompactViewFinal2.tsx", import.meta.url), "utf8");
const manager = await readFile(new URL("../src/features/mcp/McpSessionsManagerSafe.tsx", import.meta.url), "utf8");
const openProxy = await readFile(new URL("../src/app/api/backend/mcp-day/open-session/route.ts", import.meta.url), "utf8");
const statusProxy = await readFile(new URL("../src/app/api/backend/mcp-day/session-customer/status/route.ts", import.meta.url), "utf8");
const actionProxy = await readFile(new URL("../src/app/api/backend/mcp-session-actions/[id]/route.ts", import.meta.url), "utf8");

test("open-session browser intent uses one idempotent mutation helper invocation", () => {
  assert.match(master, /idempotentMutationFetch\([\s\S]*?"\/api\/backend\/mcp-day\/open-session"[\s\S]*?operation: "route-session\.open"/);
  assert.doesNotMatch(master, /fetch\("\/api\/backend\/mcp-day\/open-session"/);
  assert.match(openProxy, /proxyBackendRequest\(request, "\/api\/mcp-day\/open-session", "POST"\)/);
});

test("session-customer status keeps its exact persisted-idempotency operation", () => {
  assert.match(session, /"\/api\/backend\/mcp-day\/session-customer\/status"\) return "session-customer\.status\.update"/);
  assert.match(session, /idempotentMutationFetch\(path[\s\S]*?operation: mutationOperation\(path\)/);
  assert.match(statusProxy, /"\/api\/mcp-day\/session-customer\/status"[\s\S]*?"POST"/);
});

test("session edit and delete map to distinct stable operations", () => {
  assert.match(manager, /method === "PATCH"\) return "route-session\.update"/);
  assert.match(manager, /method === "DELETE"\) return "route-session\.delete-empty"/);
  assert.match(manager, /async function callApi[\s\S]*?idempotentMutationFetch\([\s\S]*?sessionMutationOperation\(init\.method\)/);
  assert.doesNotMatch(manager, /async function callApi[\s\S]*?await fetch\(/);
  assert.match(actionProxy, /`\/api\/mcp-sessions\/\$\{encodeURIComponent\(id\)\}`[\s\S]*?"PATCH"/);
  assert.match(actionProxy, /`\/api\/mcp-sessions\/\$\{encodeURIComponent\(id\)\}`[\s\S]*?"DELETE"/);
});
