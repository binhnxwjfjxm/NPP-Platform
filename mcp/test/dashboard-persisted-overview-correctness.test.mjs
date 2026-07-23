import assert from "node:assert/strict";
import test from "node:test";
import { derivePersistedRouteOverview, vietnamBusinessDate } from "../src/features/dashboard/persisted-overview.ts";
import { readFailure, reports, routes, sessions } from "./fixtures/dashboard-persisted-overview.mjs";

test("derives every managed route from independently sorted latest sessions", () => {
  const result = derivePersistedRouteOverview(routes, sessions, reports);
  assert.equal(result.length, 3, "a global session limit cannot remove managed routes");
  assert.equal(result.find((route) => route.routeId === "route-a")?.sessionId, "a-newer-tie");
  assert.equal(result.find((route) => route.routeId === "route-b")?.sessionState, "cancelled");
  assert.equal(result.find((route) => route.routeId === "route-c")?.sessionState, "none");
  assert.equal(result.find((route) => route.routeId === "route-c")?.health, "watch");
});

test("matches snapshots by session and never adds snapshot and session counters", () => {
  const route = derivePersistedRouteOverview(routes, sessions, reports).find((item) => item.routeId === "route-a");
  assert.equal(route?.reportId, "report-new", "newest global report belongs to an old session and must not match");
  assert.deepEqual({ planned: route?.planned, visited: route?.visited }, { planned: 12, visited: 9 });
  assert.equal(route?.orders, 2, "duplicate order IDs are counted once");
  assert.equal(route?.followups, 3, "duplicate follow-up IDs are counted once");
});

test("uses the Vietnam business date across the UTC day boundary", () => {
  assert.equal(vietnamBusinessDate(new Date("2026-07-20T18:30:00.000Z")), "2026-07-21");
});

test("read failures remain failures rather than empty successful datasets", async () => {
  await assert.rejects(Promise.reject(readFailure), /dashboard_fixture_read_failed/);
});
