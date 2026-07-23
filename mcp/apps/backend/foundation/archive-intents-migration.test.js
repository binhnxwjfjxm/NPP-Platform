import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const migration = await readFile(
  new URL("../../../supabase/migrations/20260720223000_add_archive_intents.sql", import.meta.url),
  "utf8"
);
const terminal = await readFile(
  new URL("../../../supabase/migrations/20260720223500_link_archive_intent_delete_job_terminal.sql", import.meta.url),
  "utf8"
);
const locking = await readFile(
  new URL("../../../supabase/migrations/20260720224500_lock_archive_intent_claims.sql", import.meta.url),
  "utf8"
);
const failureGuard = await readFile(
  new URL("../../../supabase/migrations/20260720224600_preserve_archive_terminal_failure.sql", import.meta.url),
  "utf8"
);

test("archive intents persist exact key, payload, target and delete-job linkage", () => {
  assert.match(migration, /create table if not exists public\.mcp_archive_intents/i);
  assert.match(migration, /unique \(installation_id, operation, idempotency_key\)/i);
  assert.match(migration, /unique \(installation_id, target_type, target_id\)/i);
  assert.match(migration, /delete_job_id text references public\.mcp_storage_delete_jobs\(id\)/i);
  assert.match(migration, /request_hash text not null/i);
  assert.match(migration, /response_payload jsonb/i);
  assert.match(migration, /grant select on table public\.mcp_archive_intents to service_role/i);
  assert.doesNotMatch(migration, /grant (?:insert|update|delete)[^;]*mcp_archive_intents/i);
});

test("archive claim enforces stable-key replay, resume and conflict", () => {
  assert.match(migration, /create or replace function public\.mcp_claim_archive_intent/i);
  assert.match(migration, /invalid_idempotency_key/i);
  assert.match(migration, /archive_idempotency_context_mismatch/i);
  assert.match(migration, /public\.mcp_idempotency_request_hash\(p_operation/i);
  assert.match(migration, /idempotency_key_conflict/i);
  assert.match(migration, /archive_target_intent_conflict/i);
  assert.match(migration, /'latest_request_context'/i);
  assert.match(migration, /where installation_id = p_installation_id[\s\S]*target_type = p_target_type[\s\S]*target_id = p_target_id[\s\S]*for update/i);
});

test("archive claim serialization classifies concurrent key and target races", () => {
  assert.match(locking, /rename to mcp_claim_archive_intent_unlocked/i);
  assert.match(locking, /pg_catalog\.pg_advisory_xact_lock/i);
  assert.match(locking, /mcp_archive_intent:key:/i);
  assert.match(locking, /mcp_archive_intent:target:/i);
  assert.ok(
    locking.indexOf("mcp_archive_intent:key:") < locking.indexOf("mcp_archive_intent:target:"),
    "claim locks must always acquire key before target"
  );
  assert.match(locking, /mcp_claim_archive_intent_unlocked[\s\S]*from public, anon, authenticated, service_role/i);
  assert.match(locking, /grant execute on function public\.mcp_claim_archive_intent\([\s\S]*to service_role/i);
});

test("archive terminal result appends the Foundation audit event once", () => {
  assert.match(migration, /create or replace function public\.mcp_append_archive_intent_audit/i);
  assert.match(migration, /public\.mcp_append_audit_event\(/i);
  assert.match(migration, /'replayed'/i);
  assert.match(migration, /case when coalesce\(p_succeeded, false\) then 'succeeded' else 'failed' end/i);
  assert.match(migration, /if v_intent\.status = 'completed'[\s\S]*return to_jsonb\(v_intent\)/i);
});

test("failed archive remains terminal until a new claim moves it to processing", () => {
  assert.match(failureGuard, /rename to mcp_finish_archive_intent_mutable/i);
  assert.match(failureGuard, /v_intent\.status = 'failed'[\s\S]*coalesce\(p_succeeded, false\) is not true[\s\S]*return to_jsonb\(v_intent\)/i);
  assert.match(failureGuard, /mcp_finish_archive_intent_mutable[\s\S]*from public, anon, authenticated, service_role/i);
  assert.match(failureGuard, /grant execute on function public\.mcp_finish_archive_intent\([\s\S]*to service_role/i);
});

test("storage job creation links the exact target intent in the same transaction", () => {
  assert.match(terminal, /create or replace function public\.mcp_link_archive_intent_from_delete_job/i);
  assert.match(terminal, /before insert or update of status, target_type, target_id, raw_payload/i);
  assert.match(terminal, /where installation_id = new\.installation_id[\s\S]*target_type = new\.target_type[\s\S]*target_id = new\.target_id/i);
  assert.match(terminal, /delete_job_id = new\.id/i);
  assert.match(terminal, /archive_media_count/i);
});

test("cleanup-completed or failed jobs use the canonical intent finalizer", () => {
  assert.match(terminal, /create or replace function public\.mcp_sync_archive_intent_from_delete_job/i);
  assert.match(terminal, /new\.status not in \('completed', 'failed'\)/i);
  assert.match(terminal, /public\.mcp_finish_archive_intent\(/i);
  assert.match(terminal, /'deletedMediaCount'/i);
  assert.doesNotMatch(terminal, /update public\.mcp_archive_intents[\s\S]*response_payload/i);
});

test("archive intent persistence is service-role only", () => {
  assert.match(migration, /revoke all on table public\.mcp_archive_intents from public, anon, authenticated/i);
  for (const fn of ["mcp_claim_archive_intent", "mcp_link_archive_intent_job", "mcp_finish_archive_intent"]) {
    assert.match(migration, new RegExp(`revoke all on function public\\.${fn}\\([\\s\\S]*?from public, anon, authenticated`, "i"));
    assert.match(migration, new RegExp(`grant execute on function public\\.${fn}\\([\\s\\S]*?to service_role`, "i"));
  }
  assert.match(migration, /mcp_append_archive_intent_audit[\s\S]*from public, anon, authenticated, service_role/i);
  assert.match(terminal, /mcp_link_archive_intent_from_delete_job[\s\S]*from public, anon, authenticated, service_role/i);
});

const targetScopedProof = await readFile(
  new URL("../../../supabase/migrations/20260722060000_add_target_scoped_archive_proof_claims.sql", import.meta.url),
  "utf8"
);

test("F05 archive proof claims are target-scoped and fail closed when unavailable", () => {
  assert.match(targetScopedProof, /create or replace function public\.mcp_f05_archive_proof_capabilities/i);
  assert.match(targetScopedProof, /'targetScopedMediaClaim', true/i);
  assert.match(targetScopedProof, /'targetScopedDeleteJobClaim', true/i);
  assert.match(targetScopedProof, /'broadBatchClaimsForbidden', true/i);
  assert.match(targetScopedProof, /create or replace function public\.mcp_claim_one_outlet_media_delete/i);
  assert.match(targetScopedProof, /media\.id = p_media_id/i);
  assert.match(targetScopedProof, /target_scoped_media_not_reclaimable/i);
  assert.match(targetScopedProof, /create or replace function public\.mcp_claim_one_storage_delete_job/i);
  assert.match(targetScopedProof, /job\.id = p_job_id/i);
  assert.match(targetScopedProof, /target_scoped_delete_job_not_claimable/i);
  for (const fn of ["mcp_f05_archive_proof_capabilities", "mcp_claim_one_outlet_media_delete", "mcp_claim_one_storage_delete_job"]) {
    assert.match(targetScopedProof, new RegExp(`revoke all on function public\\.${fn}\\([\\s\\S]*?from public, anon, authenticated`, "i"));
    assert.match(targetScopedProof, new RegExp(`grant execute on function public\\.${fn}\\([\\s\\S]*?to service_role`, "i"));
  }
});
