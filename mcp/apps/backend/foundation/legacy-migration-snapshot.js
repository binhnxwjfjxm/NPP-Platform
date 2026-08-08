import { createHash } from "node:crypto";

export const LEGACY_ORDER_CLASSES = Object.freeze([
  "OFFICIAL_ORDER_MIGRATION_CANDIDATE",
  "FIELD_ORDER_INTENT",
  "SAMPLE_TEST_DEMAND",
  "HISTORICAL_DISPLAY_ONLY",
  "INVALID_ORPHAN_RECONCILIATION_REQUIRED"
]);

export function canonicalize(value) {
  if (Array.isArray(value)) return value.map(canonicalize);
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.keys(value).sort().map((key) => [key, canonicalize(value[key])])
    );
  }
  return value;
}

export function canonicalJson(value) {
  return JSON.stringify(canonicalize(value));
}

export function sha256(value) {
  return createHash("sha256").update(value).digest("hex");
}

export function rowsDigest(rows) {
  return sha256(
    [...rows]
      .map((row) => canonicalJson(row))
      .sort()
      .join("\n")
  );
}

function text(value) {
  const normalized = String(value ?? "").trim();
  return normalized || null;
}

function explicitLegacyIds(row) {
  const raw = row?.raw_payload;
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return [];
  return [
    raw.legacy_id,
    raw.legacyId,
    raw.legacy_route_id,
    raw.legacy_route_customer_id,
    raw.legacy_session_id,
    raw.legacy_session_customer_id,
    raw.legacy_visit_id,
    raw.legacy_order_id,
    raw.legacy_order_item_id,
    raw.legacy_group_id,
    raw.legacy_item_id,
    raw.legacy_media_id,
    raw.source_id
  ].map(text).filter(Boolean);
}

export function buildMappings(entityName, sourceRows, targetRows) {
  const targetsById = new Map();
  const targetsByLegacyId = new Map();
  for (const target of targetRows) {
    const targetId = text(target?.id);
    if (targetId) targetsById.set(targetId, target);
    for (const legacyId of explicitLegacyIds(target)) {
      const list = targetsByLegacyId.get(legacyId) || [];
      list.push(target);
      targetsByLegacyId.set(legacyId, list);
    }
  }

  const mappings = [];
  const findings = [];
  const seenSourceIds = new Set();
  const targetUse = new Map();

  for (const source of sourceRows) {
    const sourceId = text(source?.id);
    if (!sourceId) {
      findings.push({ type: "missing_source_id", entity: entityName });
      continue;
    }
    if (seenSourceIds.has(sourceId)) {
      findings.push({ type: "duplicate_source_id", entity: entityName, sourceId });
      continue;
    }
    seenSourceIds.add(sourceId);

    let target = targetsById.get(sourceId) || null;
    let evidence = target ? "exact_id" : null;
    if (!target) {
      const explicit = targetsByLegacyId.get(sourceId) || [];
      if (explicit.length === 1) {
        target = explicit[0];
        evidence = "explicit_legacy_id";
      } else if (explicit.length > 1) {
        findings.push({
          type: "mapping_collision",
          entity: entityName,
          sourceId,
          targetIds: explicit.map((row) => text(row.id)).filter(Boolean).sort()
        });
      }
    }

    let targetId = text(target?.id);
    let status = "mapped";
    if (!targetId) {
      targetId = sourceId;
      evidence = "preserve_source_id";
      status = "proposed";
    }

    const existingSource = targetUse.get(targetId);
    if (existingSource && existingSource !== sourceId) {
      findings.push({ type: "target_collision", entity: entityName, targetId, sourceIds: [existingSource, sourceId].sort() });
    } else {
      targetUse.set(targetId, sourceId);
    }
    mappings.push({ entity: entityName, sourceId, targetId, evidence, status });
  }

  return { mappings, findings };
}

export function verifyForeignKeys(contract, sourceByEntity) {
  const findings = [];
  const idsByEntity = new Map();
  for (const entity of contract.entities) {
    const ids = new Set((sourceByEntity[entity.name] || []).map((row) => text(row?.id)).filter(Boolean));
    idsByEntity.set(entity.name, ids);
  }

  for (const entity of contract.entities) {
    const rows = sourceByEntity[entity.name] || [];
    for (const dep of entity.dependencies || []) {
      const parentIds = idsByEntity.get(dep.entity) || new Set();
      for (const row of rows) {
        const value = text(row?.[dep.field]);
        if (!value) {
          if (dep.required) findings.push({ type: "missing_required_fk", entity: entity.name, rowId: text(row?.id), field: dep.field, parentEntity: dep.entity });
          continue;
        }
        if (!parentIds.has(value)) findings.push({ type: "orphan_fk", entity: entity.name, rowId: text(row?.id), field: dep.field, value, parentEntity: dep.entity });
      }
    }
  }
  return findings;
}

function lowerBlob(order) {
  return canonicalJson(order).toLowerCase();
}

export function classifyLegacyOrder(order, items = []) {
  const id = text(order?.id);
  if (!id || items.length === 0) return "INVALID_ORPHAN_RECONCILIATION_REQUIRED";
  const blob = lowerBlob(order);
  if (/sample|test|trial|gửi mẫu|thử/.test(blob)) return "SAMPLE_TEST_DEMAND";
  if (/intent|request|nhu cầu|đề nghị/.test(blob)) return "FIELD_ORDER_INTENT";

  const coreId = text(order?.core_sales_order_id);
  if (coreId) return "HISTORICAL_DISPLAY_ONLY";

  const onboardingStatus = text(order?.customer_onboarding_status);
  const hasCanonicalCustomer = Boolean(text(order?.core_customer_id)) &&
    (!onboardingStatus || new Set(["approved", "linked_existing"]).has(onboardingStatus));
  const hasLifecycleEvidence = Boolean(text(order?.status)) && Boolean(text(order?.created_at ?? order?.order_date));
  const itemsCanonical = items.every((item) =>
    Boolean(text(item?.sku) || text(item?.variant_id)) &&
    Boolean(text(item?.unit)) &&
    Number.isFinite(Number(item?.quantity)) && Number(item.quantity) > 0 &&
    Number.isFinite(Number(item?.unit_price ?? 0)) && Number(item?.unit_price ?? 0) >= 0
  );
  const total = Number(order?.grand_total ?? order?.total);

  if (hasCanonicalCustomer && hasLifecycleEvidence && itemsCanonical && Number.isFinite(total) && total >= 0) {
    return "OFFICIAL_ORDER_MIGRATION_CANDIDATE";
  }
  if (/cancel|void|deleted|archive|histor/.test(blob)) return "HISTORICAL_DISPLAY_ONLY";
  return "INVALID_ORPHAN_RECONCILIATION_REQUIRED";
}

export function classifyRecords(contract, sourceByEntity, mappingsByEntity) {
  const result = {};
  const itemsByOrder = new Map();
  for (const item of sourceByEntity.order_items || []) {
    const orderId = text(item?.order_id);
    if (!orderId) continue;
    const list = itemsByOrder.get(orderId) || [];
    list.push(item);
    itemsByOrder.set(orderId, list);
  }

  for (const entity of contract.entities) {
    const mappingMap = new Map((mappingsByEntity[entity.name] || []).map((entry) => [entry.sourceId, entry]));
    result[entity.name] = (sourceByEntity[entity.name] || []).map((row) => {
      const sourceId = text(row?.id);
      const mapping = mappingMap.get(sourceId);
      if (entity.name === "orders") {
        const classification = classifyLegacyOrder(row, itemsByOrder.get(sourceId) || []);
        return {
          sourceId,
          disposition: classification === "OFFICIAL_ORDER_MIGRATION_CANDIDATE" ? "operational_import" :
            classification === "INVALID_ORPHAN_RECONCILIATION_REQUIRED" ? "reconciliation_required" : "archive_only",
          classification
        };
      }
      if (entity.name === "order_items") {
        return { sourceId, disposition: "follows_order" };
      }
      if (mapping?.status === "mapped") return { sourceId, disposition: "already_canonical" };
      return { sourceId, disposition: entity.importance === "archive" ? "archive_only" : "operational_import" };
    });
  }
  return result;
}

export function buildSnapshotSummary({ contract, sourceByEntity, targetByEntity }) {
  const mappingsByEntity = {};
  const findings = [];
  const entities = {};

  for (const entity of contract.entities) {
    const sourceRows = sourceByEntity[entity.name] || [];
    const targetRows = targetByEntity[entity.name] || [];
    const mapped = buildMappings(entity.name, sourceRows, targetRows);
    mappingsByEntity[entity.name] = mapped.mappings;
    findings.push(...mapped.findings);
    entities[entity.name] = {
      sourceRows: sourceRows.length,
      sourceSha256: rowsDigest(sourceRows),
      targetRows: targetRows.length,
      targetSha256: rowsDigest(targetRows),
      mappedExisting: mapped.mappings.filter((entry) => entry.status === "mapped").length,
      proposed: mapped.mappings.filter((entry) => entry.status === "proposed").length
    };
  }

  findings.push(...verifyForeignKeys(contract, sourceByEntity));
  const classifications = classifyRecords(contract, sourceByEntity, mappingsByEntity);

  for (const row of classifications.orders || []) {
    if (row.classification === "INVALID_ORPHAN_RECONCILIATION_REQUIRED") {
      findings.push({ type: "order_reconciliation_required", entity: "orders", sourceId: row.sourceId });
    }
  }

  const blockingTypes = new Set([
    "missing_source_id", "duplicate_source_id", "mapping_collision", "target_collision",
    "missing_required_fk", "orphan_fk", "order_reconciliation_required"
  ]);
  const blockingFindings = findings.filter((finding) => blockingTypes.has(finding.type));
  return {
    entities,
    mappingsByEntity,
    classifications,
    findings,
    blockingFindings,
    importReady: blockingFindings.length === 0
  };
}
