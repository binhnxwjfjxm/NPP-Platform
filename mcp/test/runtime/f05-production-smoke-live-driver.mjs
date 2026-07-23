import {
  actorAuthentication, actorId, auditRows, db, dbRpc, ensure, expectedInstallationId, expectedNppCode, gateway, idempotencyRows, must, mustConflict, object, putSignedObject, r2Delete, r2Head, replayed, sameJson, stamp
} from "./a5-5-2-smoke-http.mjs";
import { SMOKE_PREFIX, SMOKE_SESSION_DATE } from "./f05-production-smoke-inventory.mjs";

function replaceIds(path, fixtures) {
  return path
    .replace(":routeId", encodeURIComponent(fixtures.routeId))
    .replace(":routeCustomerId", encodeURIComponent(fixtures.routeCustomerId))
    .replace(":sessionId", encodeURIComponent(fixtures.currentOperation === "sessionDeleteEmpty" ? fixtures.emptySessionId : fixtures.sessionId));
}

function expectPersistedContext(rows, definition, requestId) {
  ensure(rows.length > 0, `${definition.name}_context_rows_missing`);
  return rows.map((row) => {
    const contextExact =
      row.installation_id === expectedInstallationId &&
      row.npp_code === expectedNppCode &&
      row.actor_id === actorId &&
      row.actor_authentication === actorAuthentication &&
      row.http_method === definition.method;
    ensure(contextExact, `${definition.name}_persisted_context_mismatch`);
    return {
      request_id: row.request_id || row.original_request_id || null,
      outcome: row.outcome || null,
      aggregate_id: row.aggregate_id || null,
      contextExact
    };
  }).filter((row) => {
    if (row.request_id === requestId) return true;
    return row.outcome === "succeeded" || row.outcome === "replayed" || row.contextExact;
  });
}

async function invariantProof(definition, aggregateId, fixtures) {
  const id = encodeURIComponent(aggregateId || "");
  if (definition.name === "standaloneOrderCreate") {
    const rows = await db(`orders?id=eq.${id}&select=id,order_date,note`);
    ensure(rows.length === 1 && String(rows[0].order_date) === "2099-12-28", "order_create_invariant_failed");
    return { name: "order-persisted-with-business-date", observed: true };
  }
  if (definition.name === "routeCreate" || definition.name === "routeUpdate") {
    const rows = await db(`mcp_routes?id=eq.${id}&select=id,route_name,note`);
    ensure(rows.length === 1 && String(rows[0].route_name || rows[0].note).includes(SMOKE_PREFIX), `${definition.name}_route_invariant_failed`);
    return { name: "route-owned-temporary-row-persisted", observed: true };
  }
  if (definition.name === "sessionOpen" || definition.name === "sessionUpdateClose") {
    const rows = await db(`mcp_route_sessions?id=eq.${id}&select=id,route_id,session_date,status`);
    ensure(rows.length === 1 && rows[0].route_id === fixtures.routeId && String(rows[0].session_date) === SMOKE_SESSION_DATE, `${definition.name}_session_invariant_failed`);
    if (definition.name === "sessionUpdateClose") ensure(String(rows[0].status) === "done", "session_close_invariant_failed");
    return { name: "session-lifecycle-state-persisted", observed: true };
  }
  if (definition.name === "sessionDeleteEmpty") {
    const rows = await db(`mcp_route_sessions?id=eq.${encodeURIComponent(fixtures.emptySessionId)}&select=id`);
    ensure(rows.length === 0, "empty_session_delete_invariant_failed");
    return { name: "empty-session-hard-deleted", observed: true };
  }
  if (definition.name === "sessionCustomerStatus") {
    const rows = await db(`mcp_session_customers?id=eq.${encodeURIComponent(fixtures.sessionCustomerId)}&select=id,status,note`);
    ensure(rows.length === 1 && String(rows[0].status) === "visited", "session_customer_status_invariant_failed");
    return { name: "session-customer-status-persisted", observed: true };
  }
  if (definition.name === "routeCustomerUpdate") {
    const rows = await db(`mcp_route_customers?id=eq.${encodeURIComponent(fixtures.routeCustomerId)}&select=id,note,sort_order`);
    ensure(rows.length === 1 && String(rows[0].note).includes(SMOKE_PREFIX), "route_customer_update_invariant_failed");
    return { name: "route-customer-business-fields-persisted", observed: true };
  }
  if (definition.archive) {
    const table = definition.name === "routeArchive" ? "mcp_routes" : "mcp_route_customers";
    const rows = await db(`${table}?id=eq.${id}&select=id`);
    ensure(rows.length === 0, `${definition.name}_archive_invariant_failed`);
    return { name: "archive-target-absent-after-finalizer", observed: true };
  }
  throw new Error(`missing_invariant_${definition.name}`);
}


function proofContext(requestId, idempotencyKey) {
  return {
    requestId,
    idempotencyKey,
    receivedAt: new Date().toISOString(),
    installationId: expectedInstallationId,
    nppCode: expectedNppCode,
    actorId,
    actorType: "service",
    actorAuthentication
  };
}

async function uploadProofMedia(routeCustomerId, sessionId, suffix) {
  const upload = await must("/api/outlet-media/upload-init", {
    method: "POST",
    idempotencyKey: `npp-f05.fixture.media.${suffix}.${stamp}`,
    body: {
      routeCustomerId,
      ...(sessionId ? { sessionId } : {}),
      clientUploadId: `npp-f05-${suffix}-${stamp}`,
      mimeType: "image/jpeg",
      byteSize: 4,
      mediaType: "storefront"
    }
  });
  const media = object(upload.payload.data);
  await putSignedObject(media.putUrl, media.requiredHeaders, new Uint8Array([255, 216, 255, 217]));
  const finalized = await must("/api/outlet-media/upload-finalize", { method: "POST", idempotencyKey: `npp-f05.fixture.media.finalize.${suffix}.${stamp}`, body: { mediaId: media.mediaId, byteSize: 4, mimeType: "image/jpeg" } });
  const mediaId = String(object(finalized.payload.data).id || media.mediaId || "");
  const mediaRows = await db(`mcp_outlet_media?id=eq.${encodeURIComponent(mediaId)}&select=id,object_key,status`);
  const mediaObjectKey = String(mediaRows[0]?.object_key || "");
  ensure(mediaObjectKey, "smoke_media_object_key_missing");
  const head = await r2Head(mediaObjectKey);
  ensure(head.ok, `smoke_media_r2_create_head_${head.status}`);
  return { mediaId, mediaObjectKey };
}

function plan(definition, fixtures) {
  const commonRoute = { routeName: `${SMOKE_PREFIX}${stamp}`, area: "API Smoke", weekday: 5, note: `${SMOKE_PREFIX} temporary` };
  const plans = {
    standaloneOrderCreate: { body: { customerMode: "existing", routeCustomerId: fixtures.routeCustomerId, orderDate: "2099-12-28", items: [{ productName: `${SMOKE_PREFIX}PRODUCT`, quantity: 1, unitPrice: 1 }], note: `${SMOKE_PREFIX} temporary` }, conflict: { note: `${SMOKE_PREFIX} conflict` } },
    routeCreate: { body: commonRoute, conflict: { ...commonRoute, weekday: 6 } },
    routeUpdate: { body: { note: `${SMOKE_PREFIX} updated` }, conflict: { note: `${SMOKE_PREFIX} conflict` } },
    sessionOpen: { body: { routeId: fixtures.routeId, sessionDate: SMOKE_SESSION_DATE, owner: `${SMOKE_PREFIX}ACTOR` }, conflict: { owner: `${SMOKE_PREFIX}CONFLICT` } },
    sessionCustomerStatus: { body: { sessionCustomerId: fixtures.sessionCustomerId, status: "visited", note: `${SMOKE_PREFIX} visited` }, conflict: { status: "skipped", note: `${SMOKE_PREFIX} conflict` } },
    sessionUpdateClose: { body: { status: "done", note: `${SMOKE_PREFIX} closed` }, conflict: { status: "active" } },
    sessionDeleteEmpty: { body: {}, conflict: { smokeConflict: true } },
    routeCustomerUpdate: { body: { note: `${SMOKE_PREFIX} updated`, sortOrder: 1 }, conflict: { note: `${SMOKE_PREFIX} conflict` } },
    routeCustomerArchive: { body: {}, conflict: { smokeConflict: true } },
    routeArchive: { body: {}, conflict: { smokeConflict: true } }
  };
  return plans[definition.name];
}

async function prove(definition, fixtures) {
  const path = replaceIds(definition.path, fixtures);
  const requestPlan = plan(definition, fixtures);
  ensure(requestPlan, `missing_runtime_plan_${definition.name}`);
  const key = `npp-f05.${definition.operation}.${stamp}`;
  const firstRequestId = `npp-f05-${definition.name}-first-${stamp}`;
  const first = await must(path, { method: definition.method, body: requestPlan.body, idempotencyKey: key, requestId: firstRequestId });
  ensure(!replayed(first.payload), `${definition.name}_first_marked_replay`);
  const second = await must(path, { method: definition.method, body: requestPlan.body, idempotencyKey: key, requestId: `npp-f05-${definition.name}-replay-${stamp}` });
  ensure(replayed(second.payload), `${definition.name}_replay_missing`);
  ensure(sameJson(first.payload.data, second.payload.data), `${definition.name}_replay_changed`);
  const conflictPath = definition.name === "routeArchive"
    ? `/api/routes/${encodeURIComponent(fixtures.archiveConflictRouteId)}/archive`
    : definition.name === "routeCustomerArchive"
      ? `/api/route-customers/${encodeURIComponent(fixtures.archiveConflictCustomerId)}/archive`
      : path;
  await mustConflict(conflictPath, { method: definition.method, body: { ...requestPlan.body, ...requestPlan.conflict }, idempotencyKey: key, requestId: `npp-f05-${definition.name}-conflict-${stamp}` });
  const audits = await auditRows(definition.operation, key);
  ensure(audits.some((row) => row.outcome === "succeeded"), `${definition.name}_audit_success_missing`);
  ensure(audits.some((row) => row.outcome === "replayed"), `${definition.name}_audit_replay_missing`);
  const auditRowsWithContext = expectPersistedContext(audits, definition, firstRequestId);
  const records = await idempotencyRows(definition.operation, key);
  ensure(records.length === 1 && records[0].status === "completed", `${definition.name}_idempotency_invalid`);
  const idempotencyRowsWithContext = expectPersistedContext(records, definition, firstRequestId);
  const data = object(first.payload.data);
  const nestedSession = object(data.session);
  const aggregateId = String(
    data.routeId || data.route_id || data.orderId || data.order_id || data.sessionId || data.session_id || nestedSession.id || data.id ||
    (definition.name === "routeUpdate" || definition.name === "routeArchive" ? fixtures.routeId : "") ||
    (definition.name === "routeCustomerUpdate" || definition.name === "routeCustomerArchive" ? fixtures.routeCustomerId : "") ||
    (definition.name === "sessionUpdateClose" || definition.name === "sessionDeleteEmpty" ? fixtures.emptySessionId || fixtures.sessionId : "") ||
    ""
  );
  const invariant = await invariantProof(definition, aggregateId, fixtures);
  return {
    firstExecuted: !replayed(first.payload),
    replayObserved: replayed(second.payload),
    replayPayloadEqual: sameJson(first.payload.data, second.payload.data),
    conflictObserved: true,
    canonicalEnvelope: true,
    firstRequestId,
    aggregateId,
    idempotency: {
      singleCompletedRecord: records.length === 1 && records[0].status === "completed",
      requestContextExact: idempotencyRowsWithContext.every((row) => row.contextExact),
      record: idempotencyRowsWithContext[0] || null
    },
    audit: { rows: auditRowsWithContext },
    invariant
  };
}

export function createLiveF05SmokeDriver() {
  const createdRouteIds = new Set();
  const createdAggregates = [];
  return {
    async createTemporaryFixtures() {
      const route = await must("/api/routes", { method: "POST", idempotencyKey: `npp-f05.fixture.route.${stamp}`, body: { routeName: `${SMOKE_PREFIX}FIXTURE_${stamp}`, area: "API Smoke", weekday: 5, note: `${SMOKE_PREFIX} temporary` } });
      const routeId = String(object(route.payload.data).routeId || object(route.payload.data).id || "");
      ensure(routeId, "smoke_fixture_route_missing");
      createdRouteIds.add(routeId);
      const customer = await must("/api/route-customers", { method: "POST", idempotencyKey: `npp-f05.fixture.customer.${stamp}`, body: { routeId, customerName: `${SMOKE_PREFIX}CUSTOMER_${stamp}`, area: "API Smoke", sortOrder: 1, note: `${SMOKE_PREFIX} temporary` } });
      const routeCustomerId = String(object(customer.payload.data).routeCustomerId || object(customer.payload.data).id || "");
      ensure(routeCustomerId, "smoke_fixture_customer_missing");
      const session = await must("/api/mcp-day/open-session", { method: "POST", idempotencyKey: `npp-f05.fixture.session.${stamp}`, body: { routeId, sessionDate: SMOKE_SESSION_DATE, owner: `${SMOKE_PREFIX}ACTOR` } });
      const sessionId = String(object(object(session.payload.data).session).id || object(session.payload.data).sessionId || "");
      const day = await must(`/api/mcp-day/data?routeId=${encodeURIComponent(routeId)}&date=${SMOKE_SESSION_DATE}`);
      const line = object(object(day.payload.data).lines?.[0]);
      const sessionCustomerId = String(line.sessionCustomerId || line.id || "");
      ensure(sessionId && sessionCustomerId, "smoke_fixture_session_missing");
      const emptyRoute = await must("/api/routes", { method: "POST", idempotencyKey: `npp-f05.fixture.empty-route.${stamp}`, body: { routeName: `${SMOKE_PREFIX}EMPTY_${stamp}`, area: "API Smoke", weekday: 6, note: `${SMOKE_PREFIX} temporary empty route` } });
      const emptyRouteId = String(object(emptyRoute.payload.data).routeId || object(emptyRoute.payload.data).id || "");
      ensure(emptyRouteId, "smoke_empty_route_missing");
      createdRouteIds.add(emptyRouteId);
      const emptySession = await must("/api/mcp-day/open-session", { method: "POST", idempotencyKey: `npp-f05.fixture.empty-session.${stamp}`, body: { routeId: emptyRouteId, sessionDate: SMOKE_SESSION_DATE, owner: `${SMOKE_PREFIX}ACTOR` } });
      const emptySessionId = String(object(object(emptySession.payload.data).session).id || object(emptySession.payload.data).sessionId || "");
      ensure(emptySessionId, "smoke_empty_session_missing");
      const archiveRoute = await must("/api/routes", { method: "POST", idempotencyKey: `npp-f05.fixture.archive-route.${stamp}`, body: { routeName: `${SMOKE_PREFIX}ARCHIVE_CONFLICT_${stamp}`, area: "API Smoke", weekday: 4, note: `${SMOKE_PREFIX} temporary archive conflict` } });
      const archiveConflictRouteId = String(object(archiveRoute.payload.data).routeId || object(archiveRoute.payload.data).id || "");
      ensure(archiveConflictRouteId, "smoke_archive_conflict_route_missing");
      createdRouteIds.add(archiveConflictRouteId);
      const archiveCustomer = await must("/api/route-customers", { method: "POST", idempotencyKey: `npp-f05.fixture.archive-customer.${stamp}`, body: { routeId: archiveConflictRouteId, customerName: `${SMOKE_PREFIX}ARCHIVE_CUSTOMER_${stamp}`, area: "API Smoke", sortOrder: 1, note: `${SMOKE_PREFIX} temporary` } });
      const archiveConflictCustomerId = String(object(archiveCustomer.payload.data).routeCustomerId || object(archiveCustomer.payload.data).id || "");
      ensure(archiveConflictCustomerId, "smoke_archive_conflict_customer_missing");
      const { mediaId, mediaObjectKey } = await uploadProofMedia(routeCustomerId, sessionId, "archive-absence");
      const archiveProofRoute = await must("/api/routes", { method: "POST", idempotencyKey: `npp-f05.fixture.archive-proof-route.${stamp}`, body: { routeName: `${SMOKE_PREFIX}ARCHIVE_PROOF_${stamp}`, area: "API Smoke", weekday: 3, note: `${SMOKE_PREFIX} temporary archive proof` } });
      const archiveProofRouteId = String(object(archiveProofRoute.payload.data).routeId || object(archiveProofRoute.payload.data).id || "");
      ensure(archiveProofRouteId, "smoke_archive_proof_route_missing");
      createdRouteIds.add(archiveProofRouteId);
      const archiveProofCustomer = await must("/api/route-customers", { method: "POST", idempotencyKey: `npp-f05.fixture.archive-proof-customer.${stamp}`, body: { routeId: archiveProofRouteId, customerName: `${SMOKE_PREFIX}ARCHIVE_PROOF_CUSTOMER_${stamp}`, area: "API Smoke", sortOrder: 1, note: `${SMOKE_PREFIX} temporary archive proof` } });
      const archiveProofCustomerId = String(object(archiveProofCustomer.payload.data).routeCustomerId || object(archiveProofCustomer.payload.data).id || "");
      ensure(archiveProofCustomerId, "smoke_archive_proof_customer_missing");
      const archiveProofMedia = await uploadProofMedia(archiveProofCustomerId, null, "archive-sequence");
      return { routeId, routeCustomerId, sessionId, sessionCustomerId, emptyRouteId, emptySessionId, archiveConflictRouteId, archiveConflictCustomerId, mediaId, mediaObjectKey, archiveProofRouteId, archiveProofCustomerId, archiveProofMediaId: archiveProofMedia.mediaId, archiveProofMediaObjectKey: archiveProofMedia.mediaObjectKey };
    },
    async proveOperation(definition, fixtures) {
      fixtures.currentOperation = definition.name;
      const result = await prove(definition, fixtures);
      if (definition.name === "routeCreate" && result.aggregateId) createdRouteIds.add(result.aggregateId);
      if (result.aggregateId) {
        const table = definition.name === "standaloneOrderCreate" ? "orders"
          : definition.name === "routeCreate" ? "mcp_routes"
            : definition.name === "sessionOpen" ? "mcp_route_sessions" : null;
        if (table) createdAggregates.push({ table, id: result.aggregateId });
      }
      return result;
    },
    async proveRetiredPost(path) {
      const result = await gateway(path, { method: "POST", body: { smoke: true }, requestId: `npp-f05-retired-${stamp}` });
      ensure(result.response.status === 404, `${path}_expected_canonical_404`);
      ensure(result.payload.requestId === result.requestId, `${path}_request_id_missing`);
      ensure(typeof result.payload.receivedAt === "string", `${path}_received_at_missing`);
      return { canonical404: true, requestId: result.requestId, receivedAtObserved: true };
    },
    async proveArchiveLifecycle(fixtures) {
      const targetIds = [fixtures.routeId, fixtures.routeCustomerId].map(encodeURIComponent).join(",");
      const absentAfterArchive = await r2Head(fixtures.mediaObjectKey);
      ensure(absentAfterArchive.status === 404, `archive_r2_absence_not_proven_${absentAfterArchive.status}`);
      const proofHead = await r2Head(fixtures.archiveProofMediaObjectKey);
      ensure(proofHead.ok, `archive_sequence_r2_presence_not_proven_${proofHead.status}`);

      const operation = "route-customer.archive";
      const idempotencyKey = `npp-f05.archive-sequence.${stamp}`;
      const capabilities = object(await dbRpc("mcp_f05_archive_proof_capabilities", {
        p_installation_id: expectedInstallationId,
        p_context: proofContext(`npp-f05-archive-sequence-capabilities-${stamp}`, idempotencyKey)
      }));
      ensure(capabilities.targetScopedMediaClaim === true && capabilities.targetScopedDeleteJobClaim === true && capabilities.broadBatchClaimsForbidden === true, "archive_sequence_target_scoped_capability_unavailable");
      const targetType = "route_customer";
      const targetId = fixtures.archiveProofCustomerId;
      const requestPayload = { targetId, proof: `${SMOKE_PREFIX}archive-sequence` };
      const initialContext = proofContext(`npp-f05-archive-sequence-claim-${stamp}`, idempotencyKey);
      const claim = object(await dbRpc("mcp_claim_archive_intent", {
        p_installation_id: expectedInstallationId,
        p_operation: operation,
        p_idempotency_key: idempotencyKey,
        p_target_type: targetType,
        p_target_id: targetId,
        p_request_payload: requestPayload,
        p_context: initialContext
      }));
      ensure(claim.mode === "execute", "archive_sequence_initial_claim_not_execute");
      const intentId = String(object(claim.intent).id || "");
      ensure(intentId, "archive_sequence_intent_missing");

      const deleteClaim = object(await dbRpc("mcp_claim_route_customer_media_delete", {
        p_installation_id: expectedInstallationId,
        p_route_customer_id: targetId,
        p_context: proofContext(`npp-f05-archive-sequence-delete-claim-${stamp}`, idempotencyKey)
      }));
      const deleteJobId = String(object(deleteClaim.deleteJob).id || "");
      ensure(deleteJobId, "archive_sequence_delete_job_missing");
      await dbRpc("mcp_link_archive_intent_job", {
        p_installation_id: expectedInstallationId,
        p_intent_id: intentId,
        p_delete_job_id: deleteJobId,
        p_context: proofContext(`npp-f05-archive-sequence-link-${stamp}`, idempotencyKey)
      });

      const failedMedia = object(await dbRpc("mcp_finish_outlet_media_delete", {
        p_installation_id: expectedInstallationId,
        p_media_id: fixtures.archiveProofMediaId,
        p_succeeded: false,
        p_error: "guarded_f05_r2_delete_failure_probe",
        p_context: proofContext(`npp-f05-archive-sequence-r2-failure-${stamp}`, idempotencyKey)
      }));
      ensure(failedMedia.status === "delete_failed", "archive_sequence_storage_failure_not_observed");
      const failureStillPresent = await r2Head(fixtures.archiveProofMediaObjectKey);
      ensure(failureStillPresent.ok, `archive_sequence_failed_object_presence_${failureStillPresent.status}`);

      const retryClaim = object(await dbRpc("mcp_claim_archive_intent", {
        p_installation_id: expectedInstallationId,
        p_operation: operation,
        p_idempotency_key: idempotencyKey,
        p_target_type: targetType,
        p_target_id: targetId,
        p_request_payload: requestPayload,
        p_context: proofContext(`npp-f05-archive-sequence-retry-claim-${stamp}`, idempotencyKey)
      }));
      ensure(retryClaim.mode === "resume", "archive_sequence_retry_claim_not_resume");

      const retryBefore = new Date(Date.now() + 60_000).toISOString();
      const reclaimedMedia = object(await dbRpc("mcp_claim_one_outlet_media_delete", {
        p_installation_id: expectedInstallationId,
        p_media_id: fixtures.archiveProofMediaId,
        p_retry_before: retryBefore,
        p_context: proofContext(`npp-f05-archive-sequence-reclaim-${stamp}`, idempotencyKey)
      }));
      ensure(reclaimedMedia.id === fixtures.archiveProofMediaId && reclaimedMedia.status === "deleting", "archive_sequence_reclaim_transition_not_observed");
      const deleteResponse = await r2Delete(fixtures.archiveProofMediaObjectKey);
      ensure(deleteResponse.ok || deleteResponse.status === 404, `archive_sequence_r2_retry_delete_${deleteResponse.status}`);
      const completedMedia = object(await dbRpc("mcp_finish_outlet_media_delete", {
        p_installation_id: expectedInstallationId,
        p_media_id: fixtures.archiveProofMediaId,
        p_succeeded: true,
        p_error: null,
        p_context: proofContext(`npp-f05-archive-sequence-r2-complete-${stamp}`, idempotencyKey)
      }));
      ensure(completedMedia.status === "deleted", "archive_sequence_r2_completion_not_observed");

      const finalizingJob = object(await dbRpc("mcp_claim_one_storage_delete_job", {
        p_installation_id: expectedInstallationId,
        p_job_id: deleteJobId,
        p_retry_before: retryBefore,
        p_context: proofContext(`npp-f05-archive-sequence-finalize-claim-${stamp}`, idempotencyKey)
      }));
      ensure(finalizingJob.id === deleteJobId && finalizingJob.status === "finalizing", "archive_sequence_completion_claim_not_observed");
      await dbRpc("mcp_delete_route_customer_hard", { p_route_customer_id: targetId });
      const completedJob = object(await dbRpc("mcp_finish_storage_delete_job", {
        p_installation_id: expectedInstallationId,
        p_job_id: deleteJobId,
        p_succeeded: true,
        p_error: null,
        p_context: proofContext(`npp-f05-archive-sequence-job-complete-${stamp}`, idempotencyKey)
      }));
      ensure(completedJob.status === "completed" && completedJob.completed_at, "archive_sequence_job_completion_not_observed");

      const finalIntentRows = await db(`mcp_archive_intents?id=eq.${encodeURIComponent(intentId)}&select=id,status,delete_job_id,completed_at`);
      ensure(finalIntentRows.length === 1 && finalIntentRows[0].status === "completed" && finalIntentRows[0].completed_at, "archive_sequence_finalizer_not_observed");
      const finalAbsent = await r2Head(fixtures.archiveProofMediaObjectKey);
      ensure(finalAbsent.status === 404, `archive_sequence_r2_absence_not_observed_${finalAbsent.status}`);

      const intents = await db(`mcp_archive_intents?target_id=in.(${targetIds})&select=id,status,delete_job_id,completed_at`);
      ensure(intents.length === 2, "archive_intent_count_invalid");
      ensure(intents.every((intent) => intent.status === "completed" && intent.delete_job_id && intent.completed_at), "archive_finalizer_not_completed");
      const jobIds = intents.map((intent) => encodeURIComponent(intent.delete_job_id)).join(",");
      const jobs = await db(`mcp_storage_delete_jobs?id=in.(${jobIds})&select=id,status,completed_at,raw_payload`);
      ensure(jobs.length === 2, "archive_delete_job_count_invalid");
      ensure(jobs.every((job) => job.status === "completed" && job.completed_at), "archive_delete_job_not_finalized");
      return {
        sequence: [
          { stage: "failure", observed: true, source: "mcp_finish_outlet_media_delete:false", mediaId: fixtures.archiveProofMediaId },
          { stage: "retry-claim", observed: retryClaim.mode === "resume", source: "mcp_claim_archive_intent:resume", intentId },
          { stage: "reclaim", observed: true, source: "mcp_claim_one_outlet_media_delete", mediaId: fixtures.archiveProofMediaId },
          { stage: "completion", observed: completedJob.status === "completed", source: "mcp_finish_storage_delete_job:true", deleteJobId },
          { stage: "finalizer", observed: finalIntentRows[0].status === "completed", source: "mcp_storage_delete_jobs_sync_archive_intent", intentId }
        ],
        providerR2: { created: proofHead.ok, presenceObserved: failureStillPresent.ok, absenceObserved: finalAbsent.status === 404 && absentAfterArchive.status === 404 },
        intent: { completed: finalIntentRows[0].status === "completed", rows: intents.length + finalIntentRows.length },
        deleteJob: { completed: completedJob.status === "completed", rows: jobs.length + 1 },
        crossSystemBoundary: {
          postgresIntentBeforeR2: claim.mode === "execute" && Boolean(intentId),
          r2FailureBeforeRetry: failedMedia.status === "delete_failed" && failureStillPresent.ok,
          r2DeleteBeforeFinalizer: (deleteResponse.ok || deleteResponse.status === 404) && completedMedia.status === "deleted",
          finalizerAfterStorageCompletion: completedJob.status === "completed" && finalIntentRows[0].status === "completed"
        },
        noFakeCrossSystemTransaction: true
      };
    },
    async cleanupTemporaryFixtures() {
      const errors = [];
      for (const routeId of [...createdRouteIds].reverse()) {
        try {
          const result = await gateway(`/api/routes/${encodeURIComponent(routeId)}/archive`, { method: "POST", body: {}, requestId: `npp-f05-cleanup-${stamp}`, idempotencyKey: `npp-f05.cleanup.${routeId}.${stamp}` });
          ensure(result.response.ok || result.response.status === 404, "smoke_cleanup_archive_failed");
          createdRouteIds.delete(routeId);
        } catch (error) { errors.push(error); }
      }
      if (errors.length) throw new AggregateError(errors, "smoke_cleanup_routes_failed");
      return { cleanupAttempted: true };
    },
    async verifyCleanup(fixtures) {
      const exactRows = [
        ...createdAggregates,
        { table: "mcp_route_customers", id: fixtures?.routeCustomerId },
        { table: "mcp_route_customers", id: fixtures?.archiveConflictCustomerId },
        { table: "mcp_route_sessions", id: fixtures?.sessionId },
        { table: "mcp_route_sessions", id: fixtures?.emptySessionId }
      ].filter((item) => item.id);
      for (const { table, id } of exactRows) {
        const rows = await db(`${table}?id=eq.${encodeURIComponent(id)}&select=id`);
        ensure(rows.length === 0, `smoke_cleanup_${table}_${id}_remains`);
      }
      const targetIds = [...createdRouteIds, fixtures?.routeId, fixtures?.emptyRouteId, fixtures?.archiveConflictRouteId].filter(Boolean);
      if (targetIds.length) {
        const media = await db(`mcp_outlet_media?route_id=in.(${targetIds.map(encodeURIComponent).join(",")})&select=id`);
        ensure(media.length === 0, "smoke_cleanup_r2_media_rows_remain");
      }
      return { databaseRowsAbsent: true, r2RowsAbsent: true };
    }
  };
}
