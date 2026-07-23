import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";

test("archive proof media uses a session captured from the same temporary route", async () => {
  const driver = await readFile("test/runtime/f05-production-smoke-live-driver.mjs", "utf8");
  assert.match(driver, /body: \{ routeId: archiveProofRouteId, sessionDate: SMOKE_SESSION_DATE/);
  assert.match(driver, /archiveProofSessionId/);
  assert.match(driver, /uploadProofMedia\(archiveProofCustomerId, archiveProofSessionId, "archive-sequence"\)/);
  assert.doesNotMatch(driver, /uploadProofMedia\(archiveProofCustomerId, sessionId, "archive-sequence"\)/);
  assert.match(driver, /\{ table: "mcp_route_sessions", id: fixtures\?\.archiveProofSessionId \}/);
});
