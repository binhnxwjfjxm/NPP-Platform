import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const dashboard = await readFile("src/features/dashboard/DashboardPage.tsx", "utf8");

test("dashboard overview is owned by persisted session facts", () => {
  assert.match(dashboard, /homeFacts = await loadHomeFacts\(\)/);
  assert.match(dashboard, /buildOperationalOverview\(homeFacts\)/);
  assert.doesNotMatch(dashboard, /getDashboardOverview\(\)/);
  assert.doesNotMatch(dashboard, /createApiClient/);
});

test("dashboard route health and KPIs derive from complete persisted pages", () => {
  assert.match(dashboard, /derivePersistedRouteOverview/);
  assert.match(dashboard, /for \(let offset = 0; ; offset \+= pageSize\)/);
  assert.doesNotMatch(dashboard, /limit: 12|limit: 8/);
  assert.match(dashboard, /Không tải được dữ liệu/);
  assert.match(dashboard, /SourceBadge source="api"/);
});
