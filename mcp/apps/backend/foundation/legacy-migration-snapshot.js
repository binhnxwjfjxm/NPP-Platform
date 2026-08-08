import { createHash } from "node:crypto";

export const LEGACY_ORDER_CLASSES = Object.freeze([
  "OFFICIAL_ORDER_MIGRATION_CANDIDATE",
  "FIELD_ORDER_INTENT",
  "SAMPLE_TEST_DEMAND",
  "HISTORICAL_DISPLAY_ONLY",
  "INVALID_ORPHAN_RECONCILIATION_REQUIRED"
]);

const LEGACY_ID_KEYS_BY_ENTITY = Object.freeze({
  routes: ["legacy_route_id"], route_customers: ["legacy_route_customer_id"], route_sessions: ["legacy_session_id"],
  session_customers: ["legacy_session_customer_id"], visits: ["legacy_visit_id"], followups: ["legacy_followup_id"],
  session_reports: ["legacy_session_report_id"], market_reports: ["legacy_market_report_id"], orders: ["legacy_order_id"],
  order_items: ["legacy_order_item_id"], report_setting_groups: ["legacy_group_id"], report_settings: ["legacy_item_id", "legacy_setting_id"],
  outlet_media: ["legacy_media_id"]
});

export function canonicalize(value) {
  if (Array.isArray(value)) return value.map(canonicalize);
  if (value && typeof value === "object") return Object.fromEntries(Object.keys(value).sort().map((key) => [key, canonicalize(value[key])]));
  return value;
}
export function canonicalJson(value) { return JSON.stringify(canonicalize(value)); }
export function sha256(value) { return createHash("sha256").update(value).digest("hex"); }
export function rowsDigest(rows) { return sha256([...rows].map(canonicalJson).sort().join("\n")); }
function text(value) { const normalized = String(value ?? "").trim(); return normalized || null; }
function rawValue(row, ...keys) {
  const raw = row?.raw_payload;
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
  for (const key of keys) { const value = text(raw[key]); if (value) return value; }
  return null;
}
function explicitLegacyIds(entityName, row) {
  const raw = row?.raw_payload;
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return [];
  const keys = LEGACY_ID_KEYS_BY_ENTITY[entityName] || [];
  return [raw.legacy_id, raw.legacyId, ...keys.map((key) => raw[key])].map(text).filter(Boolean);
}
function installationOf(row, expectedInstallationId) { return text(row?.installation_id) || expectedInstallationId || null; }
function entityIdentity(installationId, entityName, id) { return `${installationId}:${entityName}:${id}`; }

export function buildMappings(entityName, sourceRows, targetRows, expectedInstallationId = null) {
  const targetsById = new Map();
  const targetsByLegacyId = new Map();
  for (const target of targetRows) {
    const installationId = installationOf(target, expectedInstallationId);
    const targetId = text(target?.id);
    if (installationId && targetId) targetsById.set(entityIdentity(installationId, entityName, targetId), target);
    for (const legacyId of explicitLegacyIds(entityName, target)) {
      const key = entityIdentity(installationId, entityName, legacyId);
      const list = targetsByLegacyId.get(key) || [];
      list.push(target); targetsByLegacyId.set(key, list);
    }
  }
  const mappings = [], findings = [], seen = new Set(), targetUse = new Map();
  for (const source of sourceRows) {
    const installationId = installationOf(source, expectedInstallationId);
    const sourceId = text(source?.id);
    if (!installationId || !sourceId) { findings.push({ type: !sourceId ? "missing_source_id" : "missing_installation_id", entity: entityName, sourceId }); continue; }
    if (expectedInstallationId && installationId !== expectedInstallationId) { findings.push({ type: "cross_installation_source", entity: entityName, sourceId }); continue; }
    const sourceIdentity = entityIdentity(installationId, entityName, sourceId);
    if (seen.has(sourceIdentity)) { findings.push({ type: "duplicate_source_id", entity: entityName, installationId, sourceId, sourceIdentity }); continue; }
    seen.add(sourceIdentity);
    let target = targetsById.get(sourceIdentity) || null;
    let evidence = target ? "exact_id" : null;
    if (!target) {
      const explicit = targetsByLegacyId.get(sourceIdentity) || [];
      if (explicit.length === 1) { target = explicit[0]; evidence = "explicit_legacy_id"; }
      else if (explicit.length > 1) findings.push({ type: "mapping_collision", entity: entityName, installationId, sourceId, sourceIdentity, targetIds: explicit.map((r) => text(r.id)).filter(Boolean).sort() });
    }
    let targetId = text(target?.id), status = "mapped";
    if (!targetId) { targetId = sourceId; evidence = "preserve_source_id"; status = "proposed"; }
    const targetIdentity = entityIdentity(installationId, entityName, targetId);
    const existing = targetUse.get(targetIdentity);
    if (existing && existing !== sourceIdentity) findings.push({ type: "target_collision", entity: entityName, installationId, targetId, targetIdentity, sourceIdentities: [existing, sourceIdentity].sort() });
    else targetUse.set(targetIdentity, sourceIdentity);
    mappings.push({ installationId, entity: entityName, sourceId, sourceIdentity, targetId, targetIdentity, evidence, status });
  }
  return { mappings, findings };
}

export function verifyForeignKeys(contract, sourceByEntity) {
  const findings = [], idsByEntity = new Map();
  for (const entity of contract.entities) idsByEntity.set(entity.name, new Set((sourceByEntity[entity.name] || []).map((r) => text(r?.id)).filter(Boolean)));
  for (const entity of contract.entities) for (const dep of entity.dependencies || []) for (const row of sourceByEntity[entity.name] || []) {
    const value = text(row?.[dep.field]);
    if (!value) { if (dep.required) findings.push({ type: "missing_required_fk", entity: entity.name, rowId: text(row?.id), field: dep.field, parentEntity: dep.entity }); continue; }
    if (!(idsByEntity.get(dep.entity) || new Set()).has(value)) findings.push({ type: "orphan_fk", entity: entity.name, rowId: text(row?.id), field: dep.field, value, parentEntity: dep.entity });
  }
  return findings;
}

export function orderSourceIdentity(order) {
  const sourceType = text(order?.source_type), sourceId = text(order?.source_id);
  if (sourceType && sourceId) return `${sourceType}:${sourceId}`;
  const sessionCustomerId = text(order?.session_customer_id) || rawValue(order, "sessionCustomerId", "session_customer_id");
  if (sessionCustomerId) return `mcp_session_customer:${sessionCustomerId}`;
  const routeCustomerId = text(order?.route_customer_id) || rawValue(order, "routeCustomerId", "route_customer_id");
  if (routeCustomerId) return `route_customer:${routeCustomerId}`;
  return null;
}
function fieldContextIdentity(order) { return orderSourceIdentity(order) || text(order?.customer_id) || rawValue(order, "customerId", "customer_id"); }
function finiteNumber(value) { if (value === null || value === undefined || value === "") return null; const n = Number(value); return Number.isFinite(n) ? n : null; }
function totalsReconcile(order, items) {
  const declared = finiteNumber(order?.grand_total ?? order?.total); if (declared === null || declared < 0) return false;
  let computed = 0; for (const item of items) { const line = finiteNumber(item?.line_total); if (line === null || line < 0) return false; computed += line; }
  return Math.abs(computed - declared) <= 0.01;
}

export function verifyOrderEvidence(sourceByEntity) {
  const findings = [], blockingOrderIds = new Set(), orders = sourceByEntity.orders || [];
  const orderIds = new Set(orders.map((r) => text(r?.id)).filter(Boolean));
  const bySourceIdentity = new Map();
  for (const order of orders) { const id = text(order?.id), identity = orderSourceIdentity(order); if (!id || !identity) continue; const list = bySourceIdentity.get(identity) || []; list.push(id); bySourceIdentity.set(identity, list); }
  for (const [identity, ids] of bySourceIdentity) { const unique = [...new Set(ids)].sort(); if (unique.length > 1) { findings.push({ type: "duplicate_order_source_identity", entity: "orders", sourceIdentity: identity, sourceIds: unique }); unique.forEach((id) => blockingOrderIds.add(id)); } }
  const keyGroups = new Map();
  for (const record of sourceByEntity.idempotency_records || []) {
    const aggregateType = text(record?.aggregate_type), aggregateId = text(record?.aggregate_id);
    if (aggregateType === "order" && aggregateId && !orderIds.has(aggregateId)) findings.push({ type: "orphan_order_idempotency_record", entity: "idempotency_records", rowId: text(record?.id), aggregateId });
    const installationId = text(record?.installation_id), operation = text(record?.operation ?? record?.command_name), key = text(record?.idempotency_key);
    if (!installationId || !operation || !key) continue;
    const scopeKey = `${installationId}:${operation}:${key}`, list = keyGroups.get(scopeKey) || []; list.push(record); keyGroups.set(scopeKey, list);
  }
  for (const [scopeKey, records] of keyGroups) {
    const aggregateIds = [...new Set(records.map((r) => text(r?.aggregate_id)).filter(Boolean))].sort();
    const hashes = [...new Set(records.map((r) => text(r?.request_hash ?? r?.fingerprint)).filter(Boolean))].sort();
    if (aggregateIds.length <= 1 && hashes.length <= 1) continue;
    findings.push({ type: "idempotency_conflict", entity: "idempotency_records", scopeSha256: sha256(scopeKey), aggregateIds, requestHashes: hashes });
    aggregateIds.forEach((id) => blockingOrderIds.add(id));
  }
  return { findings, blockingOrderIds };
}

function semanticPurposeText(order, items) {
  return [order?.type, order?.purpose, order?.order_type, order?.note, order?.status_reason, rawValue(order, "type", "purpose", "orderType", "order_type", "note"),
    ...items.flatMap((item) => [item?.purpose, item?.note, rawValue(item, "purpose", "note")])]
    .map((v) => text(v)?.toLowerCase()).filter(Boolean).join(" ");
}

export function classifyLegacyOrder(order, items = [], context = {}) {
  const id = text(order?.id); if (!id) return "INVALID_ORPHAN_RECONCILIATION_REQUIRED";
  const coreSalesOrderId = text(order?.core_sales_order_id);
  if (coreSalesOrderId) return context.coreSalesOrderIds?.has(coreSalesOrderId) ? "HISTORICAL_DISPLAY_ONLY" : "INVALID_ORPHAN_RECONCILIATION_REQUIRED";
  const statusText = [order?.status, order?.sync_status, order?.status_reason, order?.note].map((v) => text(v)?.toLowerCase()).filter(Boolean).join(" ");
  if (/\b(cancel|cancelled|void|deleted|archived?|historical)\b/.test(statusText)) return "HISTORICAL_DISPLAY_ONLY";
  const captureTimestamp = text(order?.created_at ?? order?.order_date), hasFieldContext = Boolean(fieldContextIdentity(order));
  const hasItemDescription = items.length > 0 && items.every((item) => Boolean(text(item?.product_name) || text(item?.sku) || text(item?.variant_id) || text(item?.product_id)));
  const purpose = semanticPurposeText(order, items);
  if (/sample|test|trial|gửi mẫu|thử/.test(purpose)) return hasFieldContext && captureTimestamp && hasItemDescription ? "SAMPLE_TEST_DEMAND" : "INVALID_ORPHAN_RECONCILIATION_REQUIRED";
  if (/\b(intent|request)\b|nhu cầu|đề nghị/.test(purpose)) return hasFieldContext && captureTimestamp && hasItemDescription ? "FIELD_ORDER_INTENT" : "INVALID_ORPHAN_RECONCILIATION_REQUIRED";
  const onboardingStatus = text(order?.customer_onboarding_status);
  const coreCustomerId = text(order?.core_customer_id), coreAddressId = text(order?.core_customer_address_id);
  const hasCanonicalCustomer = Boolean(coreCustomerId) && new Set(["approved", "linked_existing"]).has(onboardingStatus) && (!context.coreCustomerIds || context.coreCustomerIds.has(coreCustomerId));
  const deliveryRequired = Boolean(text(order?.delivery_address));
  const hasCanonicalAddress = !deliveryRequired || (Boolean(coreAddressId) && (!context.coreAddressIds || context.coreAddressIds.has(coreAddressId)));
  const hasLifecycleEvidence = Boolean(text(order?.status)) && Boolean(captureTimestamp);
  const itemsCanonical = items.length > 0 && items.every((item) => Boolean(text(item?.sku_id) || text(item?.variant_id) || text(item?.product_variant_id)) && Boolean(text(item?.unit_id) || text(item?.unit) || text(item?.sell_unit)) && finiteNumber(item?.quantity) > 0 && finiteNumber(item?.unit_price) >= 0 && finiteNumber(item?.line_total) >= 0);
  const noDup = !context.hasDuplicateSourceIdentity && !context.hasIdempotencyConflict;
  if (hasCanonicalCustomer && hasCanonicalAddress && hasLifecycleEvidence && itemsCanonical && totalsReconcile(order, items) && noDup) return "OFFICIAL_ORDER_MIGRATION_CANDIDATE";
  if (hasFieldContext && captureTimestamp && hasItemDescription) return "FIELD_ORDER_INTENT";
  return "INVALID_ORPHAN_RECONCILIATION_REQUIRED";
}

export function classifyRecords(contract, sourceByEntity, mappingsByEntity, orderEvidence, canonicalEvidence = {}) {
  const result = {}, itemsByOrder = new Map();
  for (const item of sourceByEntity.order_items || []) { const id = text(item?.order_id); if (!id) continue; const list = itemsByOrder.get(id) || []; list.push(item); itemsByOrder.set(id, list); }
  const duplicateIds = new Set(orderEvidence.findings.filter((f) => f.type === "duplicate_order_source_identity").flatMap((f) => f.sourceIds || []));
  const conflictIds = new Set(orderEvidence.findings.filter((f) => f.type === "idempotency_conflict").flatMap((f) => f.aggregateIds || []));
  for (const entity of contract.entities) {
    const mappingMap = new Map((mappingsByEntity[entity.name] || []).map((e) => [e.sourceId, e]));
    result[entity.name] = (sourceByEntity[entity.name] || []).map((row) => {
      const sourceId = text(row?.id), mapping = mappingMap.get(sourceId);
      if (entity.name === "orders") {
        const classification = classifyLegacyOrder(row, itemsByOrder.get(sourceId) || [], { ...canonicalEvidence, hasDuplicateSourceIdentity: duplicateIds.has(sourceId), hasIdempotencyConflict: conflictIds.has(sourceId) });
        return { sourceId, sourceIdentity: orderSourceIdentity(row), coreSalesOrderId: text(row?.core_sales_order_id), disposition: classification === "OFFICIAL_ORDER_MIGRATION_CANDIDATE" ? "operational_import" : classification === "INVALID_ORPHAN_RECONCILIATION_REQUIRED" ? "reconciliation_required" : "archive_only", classification };
      }
      if (entity.name === "order_items") return { sourceId, disposition: "follows_order" };
      if (entity.mappingMode === "evidence_only" || entity.importance === "evidence") return { sourceId, disposition: "evidence_only" };
      if (mapping?.status === "mapped") return { sourceId, disposition: "already_canonical" };
      return { sourceId, disposition: entity.importance === "archive" ? "archive_only" : "operational_import" };
    });
  }
  return result;
}

export function buildSnapshotSummary({ contract, sourceByEntity, targetByEntity, installationId = null, canonicalEvidence = {} }) {
  const mappingsByEntity = {}, findings = [], entities = {};
  for (const entity of contract.entities) {
    const sourceRows = sourceByEntity[entity.name] || [], targetRows = targetByEntity[entity.name] || [];
    const mapped = entity.mappingMode === "evidence_only" ? { mappings: [], findings: [] } : buildMappings(entity.name, sourceRows, targetRows, installationId);
    mappingsByEntity[entity.name] = mapped.mappings; findings.push(...mapped.findings);
    entities[entity.name] = { sourceRows: sourceRows.length, sourceSha256: rowsDigest(sourceRows), targetRows: targetRows.length, targetSha256: rowsDigest(targetRows), mappedExisting: mapped.mappings.filter((e) => e.status === "mapped").length, proposed: mapped.mappings.filter((e) => e.status === "proposed").length, mappingMode: entity.mappingMode || "stable_id" };
  }
  findings.push(...verifyForeignKeys(contract, sourceByEntity));
  const orderEvidence = verifyOrderEvidence(sourceByEntity); findings.push(...orderEvidence.findings);
  const classifications = classifyRecords(contract, sourceByEntity, mappingsByEntity, orderEvidence, canonicalEvidence);
  for (const row of classifications.orders || []) if (row.classification === "INVALID_ORPHAN_RECONCILIATION_REQUIRED") findings.push({ type: "order_reconciliation_required", entity: "orders", sourceId: row.sourceId });
  const blockingTypes = new Set(["missing_source_id", "missing_installation_id", "cross_installation_source", "duplicate_source_id", "mapping_collision", "target_collision", "missing_required_fk", "orphan_fk", "duplicate_order_source_identity", "orphan_order_idempotency_record", "idempotency_conflict", "order_reconciliation_required"]);
  const blockingFindings = findings.filter((f) => blockingTypes.has(f.type));
  return { entities, mappingsByEntity, classifications, findings, blockingFindings, importReady: blockingFindings.length === 0 };
}
