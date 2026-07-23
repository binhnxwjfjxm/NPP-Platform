import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const createSql = await readFile(new URL("../../../supabase/migrations/20260719153000_add_mcp_outlet_media.sql", import.meta.url), "utf8");
const deleteSql = await readFile(new URL("../../../supabase/migrations/20260719160000_add_outlet_media_deletion_lifecycle.sql", import.meta.url), "utf8");
const jobsSql = await readFile(new URL("../../../supabase/migrations/20260719161000_add_outlet_media_delete_jobs.sql", import.meta.url), "utf8");
const reclaimSql = await readFile(new URL("../../../supabase/migrations/20260719162000_reclaim_outlet_media_delete_jobs.sql", import.meta.url), "utf8");

test("outlet media migration owns pending to ready lifecycle", () => {
  assert.match(createSql, /create table if not exists public\.mcp_outlet_media/i);
  assert.match(createSql, /status in \('pending', 'ready', 'failed', 'deleted'\)/i);
  assert.match(createSql, /unique \(installation_id, client_upload_id\)/i);
  assert.match(createSql, /create or replace function public\.mcp_prepare_outlet_media_upload/i);
  assert.match(createSql, /create or replace function public\.mcp_finalize_outlet_media_upload/i);
  assert.match(createSql, /perform public\.mcp_assert_session_mutable/i);
  assert.match(createSql, /route_customer_route_mismatch/i);
  assert.match(createSql, /to service_role/i);
  assert.doesNotMatch(createSql, /grant .* to (?:anon|authenticated)/i);
});

test("deletion lifecycle owns retryable R2 cleanup before hard deletes", () => {
  assert.match(deleteSql, /status in \('pending', 'ready', 'failed', 'deleting', 'delete_failed', 'deleted'\)/i);
  assert.match(deleteSql, /delete_attempt_count integer not null default 0/i);
  assert.match(deleteSql, /create or replace function public\.mcp_claim_outlet_media_delete/i);
  assert.match(deleteSql, /create or replace function public\.mcp_finish_outlet_media_delete/i);
  assert.match(deleteSql, /create or replace function public\.mcp_claim_route_customer_media_delete/i);
  assert.match(deleteSql, /create or replace function public\.mcp_claim_route_media_delete/i);
  assert.match(deleteSql, /create or replace function public\.mcp_claim_stale_outlet_media_delete/i);
  assert.match(deleteSql, /for update skip locked/i);
  assert.match(deleteSql, /set active = false/i);
  assert.doesNotMatch(deleteSql, /delete from public\.mcp_route_customers/i);
  assert.doesNotMatch(deleteSql, /grant .* to (?:anon|authenticated)/i);
});

test("parent delete jobs resume database hard deletion after R2 cleanup", () => {
  assert.match(jobsSql, /create table if not exists public\.mcp_storage_delete_jobs/i);
  assert.match(jobsSql, /target_type in \('route_customer', 'route'\)/i);
  assert.match(jobsSql, /status in \('pending', 'finalizing', 'failed', 'completed'\)/i);
  assert.match(jobsSql, /unique \(installation_id, target_type, target_id\)/i);
  assert.match(jobsSql, /'hard_delete_job_id', v_job\.id/i);
  assert.match(jobsSql, /create or replace function public\.mcp_claim_ready_storage_delete_jobs/i);
  assert.match(jobsSql, /create or replace function public\.mcp_finish_storage_delete_job/i);
  assert.match(jobsSql, /not exists[\s\S]*media\.status <> 'deleted'/i);
  assert.doesNotMatch(jobsSql, /delete from public\.mcp_route_customers/i);
  assert.doesNotMatch(jobsSql, /grant .* to (?:anon|authenticated)/i);
});

test("stale finalizing jobs are reclaimable after a worker crash", () => {
  assert.match(reclaimSql, /drop function if exists public\.mcp_claim_ready_storage_delete_jobs\(text, integer, jsonb\)/i);
  assert.match(reclaimSql, /job\.status = 'finalizing' and job\.updated_at < p_retry_before/i);
  assert.match(reclaimSql, /for update skip locked/i);
  assert.match(reclaimSql, /to service_role/i);
});
