import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const sql = await readFile(
  new URL("../../../supabase/migrations/20260717183000_single_active_route_session.sql", import.meta.url),
  "utf8"
);

function functionBody(name) {
  const start = sql.indexOf(`create or replace function public.${name}(`);
  assert.notEqual(start, -1, `${name} must exist`);
  const next = sql.indexOf("create or replace function public.", start + 1);
  return sql.slice(start, next === -1 ? undefined : next);
}

function normalizationBody() {
  const start = sql.indexOf("do $migration$");
  const end = sql.indexOf("create unique index", start);
  assert.ok(start >= 0 && end > start, "normalization block must exist before the index");
  return sql.slice(start, end);
}

test("duplicate active sessions are normalized before the invariant is installed", () => {
  const normalizeAt = sql.indexOf("row_number() over");
  const indexAt = sql.indexOf("create unique index");

  assert.ok(normalizeAt >= 0, "migration must rank existing active sessions");
  assert.ok(indexAt > normalizeAt, "data repair must run before the unique index");
  assert.match(sql, /partition by route_id[\s\S]*?order by session_date desc, created_at desc, id desc/i);
  assert.match(sql, /where lower\(coalesce\(status, 'active'\)\) = 'active'/i);
  assert.match(sql, /perform public\.mcp_recalc_route_session_counters\(v_session\.id\)/i);
  assert.match(sql, /public\.mcp_update_route_session\([\s\S]*?'done'/i);
  assert.match(sql, /public\.mcp_update_route_session\([\s\S]*?'cancelled'/i);
  assert.doesNotMatch(sql, /delete from public\.mcp_route_sessions/i);
  assert.doesNotMatch(sql, /delete from public\.mcp_session_customers/i);
});

test("activity classification preserves operational history", () => {
  assert.match(sql, /visited_customers[\s\S]*?order_count[\s\S]*?test_count[\s\S]*?report_count[\s\S]*?followup_count/i);
  assert.match(sql, /exists\s*\([\s\S]*?from public\.mcp_visits[\s\S]*?session_id = v_session\.id/i);
  assert.match(sql, /exists\s*\([\s\S]*?from public\.mcp_session_customers[\s\S]*?session_id = v_session\.id[\s\S]*?checkin_at is not null/i);
});

test("database permits at most one active session for each route", () => {
  assert.match(
    sql,
    /create unique index if not exists mcp_route_sessions_one_active_per_route_uidx[\s\S]*?on public\.mcp_route_sessions \(route_id\)[\s\S]*?where lower\(coalesce\(status, 'active'\)\) = 'active'/i
  );
});

test("opening a newer daily session atomically finalizes the stale active session", () => {
  const body = functionBody("mcp_open_route_session");
  const sessionLock = body.indexOf("from public.mcp_route_sessions");
  const routeLock = body.indexOf("from public.mcp_routes");
  const insert = body.indexOf("insert into public.mcp_route_sessions");

  assert.match(body, /from public\.mcp_route_sessions[\s\S]*?for update;/i);
  assert.match(body, /from public\.mcp_routes[\s\S]*?for update;/i);
  assert.ok(sessionLock >= 0 && routeLock > sessionLock && insert > routeLock, "open-session must follow session -> route lock order before insert");
  assert.match(body, /session_date < p_session_date/i);
  assert.match(body, /mcp_update_route_session\([\s\S]*?'done'/i);
  assert.match(body, /mcp_update_route_session\([\s\S]*?'cancelled'/i);
  assert.match(body, /mcp_backfill_session_customers_from_route\(v_session\.id, true\)/i);
});

test("historical repair does not copy or rewrite customer snapshots", () => {
  const body = normalizationBody();
  assert.doesNotMatch(body, /insert into public\.mcp_session_customers/i);
  assert.doesNotMatch(body, /mcp_backfill_session_customers_from_route/i);
  assert.doesNotMatch(body, /update public\.mcp_session_customers/i);
});
