import { createHash, randomUUID } from 'node:crypto';
import * as repository from '../db/repositories/inventory-stocktake.js';
import * as ledgerRepository from '../db/repositories/inventory-ledger.js';

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const DECIMAL_PATTERN = /^(0|[1-9]\d{0,13})(?:\.(\d{1,12}))?$/;
const REVISION_PATTERN = /^(0|[1-9]\d{0,18})$/;
const IDEMPOTENCY_PATTERN = /^[A-Za-z0-9._:-]{1,128}$/;
const SCALE_6 = 1_000_000n;
const SCALE_12 = 1_000_000_000_000n;
const STATUSES = new Set([
  'draft', 'counted', 'submitted', 'recount_required',
  'approved', 'posted', 'cancelled', 'reversed',
]);

function failure(code, message, retryable = false, details = {}) {
  return Object.freeze({ ok: false, code, message, retryable, details });
}

function isUuid(value) {
  return typeof value === 'string' && UUID_PATTERN.test(value.trim());
}

function text(value, maxLength = 0) {
  if (value === undefined || value === null) return null;
  const normalized = String(value).trim();
  if (!normalized || (maxLength > 0 && normalized.length > maxLength)) return null;
  return normalized;
}

function actorId(requestContext) {
  return text(requestContext?.actorId ?? requestContext?.principalId ?? requestContext?.subject, 128) ?? 'system';
}

function warehouseIds(requestContext) {
  return Array.isArray(requestContext?.scopes?.warehouseIds)
    ? [...new Set(requestContext.scopes.warehouseIds.filter(isUuid).map((value) => value.trim()))]
    : [];
}

function hasWarehouse(requestContext, warehouseId) {
  return warehouseIds(requestContext).includes(warehouseId);
}

function parseRevision(value) {
  const normalized = String(value ?? '').trim();
  return REVISION_PATTERN.test(normalized) ? normalized : null;
}

function parseDecimal12(value, field, { allowZero = true } = {}) {
  const normalized = typeof value === 'string' || typeof value === 'number'
    ? String(value).trim()
    : '';
  const match = DECIMAL_PATTERN.exec(normalized);
  if (!match) return failure('INVALID_QUANTITY', `${field} must be a decimal string with at most 12 fractional digits`);
  const scaled = BigInt(match[1]) * SCALE_12 + BigInt((match[2] ?? '').padEnd(12, '0'));
  if (!allowZero && scaled === 0n) return failure('INVALID_QUANTITY', `${field} must be greater than zero`);
  return Object.freeze({ ok: true, scaled, value: formatScale12(scaled) });
}

function databaseScaled12(value) {
  const normalized = String(value ?? '').trim();
  const match = /^(-?)(\d+)(?:\.(\d{1,12}))?$/.exec(normalized);
  if (!match) return null;
  const absolute = BigInt(match[2]) * SCALE_12 + BigInt((match[3] ?? '').padEnd(12, '0'));
  return match[1] ? -absolute : absolute;
}

function formatScale12(value) {
  const negative = value < 0n;
  const absolute = negative ? -value : value;
  const whole = absolute / SCALE_12;
  const fractional = String(absolute % SCALE_12).padStart(12, '0');
  return `${negative ? '-' : ''}${whole}.${fractional}`;
}

function formatScale6(value) {
  const whole = value / SCALE_6;
  const fractional = String(value % SCALE_6).padStart(6, '0');
  return `${whole}.${fractional}`;
}

function canonicalize(value) {
  if (Array.isArray(value)) return value.map(canonicalize);
  if (value === null || typeof value !== 'object') return value;
  return Object.fromEntries(Object.keys(value).sort().map((key) => [key, canonicalize(value[key])]));
}

function payloadHash(value) {
  return createHash('sha256').update(JSON.stringify(canonicalize(value))).digest('hex');
}

function dateOnly(value) {
  if (!value) return null;
  if (typeof value === 'string') return value.slice(0, 10);
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? null : parsed.toISOString().slice(0, 10);
}

function mapLine(row, revealExpected) {
  return Object.freeze({
    id: row.id,
    roundNumber: Number(row.round_number),
    lineNumber: Number(row.line_number),
    warehouseId: row.warehouse_id,
    locationId: row.location_id ?? null,
    locationCode: row.location_code ?? null,
    locationName: row.location_name ?? null,
    sourceVariantId: row.source_variant_id,
    sourceSku: row.source_sku,
    sourceUnitId: row.source_unit_id,
    sourceUnitCode: row.source_unit_code,
    conversionToBase: String(row.conversion_to_base),
    baseVariantId: row.base_variant_id,
    baseSku: row.base_sku,
    lotId: row.lot_id ?? null,
    lotCode: row.lot_code ?? null,
    expiryDate: dateOnly(row.expiry_date),
    expectedBaseQuantity: revealExpected ? String(row.expected_base_quantity) : undefined,
    countedBaseQuantity: row.counted_base_quantity === null ? null : String(row.counted_base_quantity),
    finalDelta: row.final_delta === null ? null : String(row.final_delta),
    snapshotScopeVersion: revealExpected ? String(row.snapshot_scope_version) : undefined,
    postedScopeVersion: row.posted_scope_version === null ? null : String(row.posted_scope_version),
    countedAt: row.counted_at ?? null,
    countedBy: row.counted_by ?? null,
  });
}

function mapRound(row) {
  return Object.freeze({
    id: row.id,
    roundNumber: Number(row.round_number),
    status: row.status,
    reason: row.reason ?? null,
    createdAt: row.created_at,
    createdBy: row.created_by,
    countedAt: row.counted_at ?? null,
    countedBy: row.counted_by ?? null,
    submittedAt: row.submitted_at ?? null,
    submittedBy: row.submitted_by ?? null,
    approvedAt: row.approved_at ?? null,
    approvedBy: row.approved_by ?? null,
  });
}

function mapStocktake(row, { rounds, lines, revealExpected } = {}) {
  return Object.freeze({
    id: row.id,
    stocktakeNumber: row.stocktake_number,
    warehouseId: row.warehouse_id,
    warehouseCode: row.warehouse_code,
    warehouseName: row.warehouse_name,
    status: row.status,
    currentRound: Number(row.current_round),
    revision: String(row.revision),
    note: row.note ?? null,
    inventoryMovementId: row.inventory_movement_id ?? null,
    reversalMovementId: row.reversal_movement_id ?? null,
    submittedAt: row.submitted_at ?? null,
    submittedBy: row.submitted_by ?? null,
    approvedAt: row.approved_at ?? null,
    approvedBy: row.approved_by ?? null,
    postedAt: row.posted_at ?? null,
    postedBy: row.posted_by ?? null,
    cancelledAt: row.cancelled_at ?? null,
    cancelledBy: row.cancelled_by ?? null,
    cancelReason: row.cancel_reason ?? null,
    reversedAt: row.reversed_at ?? null,
    reversedBy: row.reversed_by ?? null,
    reversalReason: row.reversal_reason ?? null,
    createdAt: row.created_at,
    createdBy: row.created_by,
    updatedAt: row.updated_at,
    updatedBy: row.updated_by,
    lineCount: Number(row.line_count ?? lines?.length ?? 0),
    rounds: rounds ? Object.freeze(rounds.map(mapRound)) : undefined,
    lines: lines ? Object.freeze(lines.map((line) => mapLine(line, revealExpected))) : undefined,
  });
}

function normalizeScopes(payload) {
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
    return failure('INVALID_INPUT', 'Stocktake payload is required');
  }
  const warehouseId = text(payload.warehouseId, 64);
  if (!isUuid(warehouseId)) return failure('INVALID_WAREHOUSE_ID', 'warehouseId is invalid');
  const note = text(payload.note, 4000);
  if (payload.note && note === null) return failure('INVALID_NOTE', 'note must not exceed 4000 characters');
  if (!Array.isArray(payload.scopes) || payload.scopes.length < 1 || payload.scopes.length > 500) {
    return failure('INVALID_STOCKTAKE_SCOPES', 'Stocktake must contain between 1 and 500 exact scopes');
  }
  const scopes = [];
  const keys = new Set();
  for (let index = 0; index < payload.scopes.length; index += 1) {
    const input = payload.scopes[index];
    if (!input || typeof input !== 'object' || Array.isArray(input)) {
      return failure('INVALID_STOCKTAKE_SCOPE', `Scope ${index + 1} is invalid`);
    }
    const locationId = text(input.locationId, 64);
    const baseVariantId = text(input.baseVariantId, 64);
    const lotId = text(input.lotId, 64);
    if (locationId && !isUuid(locationId)) return failure('INVALID_LOCATION_ID', `Scope ${index + 1} locationId is invalid`);
    if (!isUuid(baseVariantId)) return failure('INVALID_BASE_VARIANT_ID', `Scope ${index + 1} baseVariantId is invalid`);
    if (lotId && !isUuid(lotId)) return failure('INVALID_LOT_ID', `Scope ${index + 1} lotId is invalid`);
    const key = `${locationId ?? '<null>'}:${baseVariantId}:${lotId ?? '<null>'}`;
    if (keys.has(key)) return failure('DUPLICATE_STOCKTAKE_SCOPE', `Scope ${index + 1} is duplicated`);
    keys.add(key);
    scopes.push(Object.freeze({ location_id: locationId, base_variant_id: baseVariantId, lot_id: lotId }));
  }
  return Object.freeze({ ok: true, value: Object.freeze({ warehouseId, note, scopes: Object.freeze(scopes) }) });
}

async function hydrate(client, row, { revealExpected = true } = {}) {
  const [rounds, lines] = await Promise.all([
    repository.listStocktakeRounds(client, {
      installationId: row.installation_id,
      stocktakeId: row.id,
    }),
    repository.listStocktakeLines(client, {
      installationId: row.installation_id,
      stocktakeId: row.id,
      roundNumber: Number(row.current_round),
    }),
  ]);
  return mapStocktake(row, { rounds, lines, revealExpected });
}

async function loadLocked(client, requestContext, stocktakeId) {
  const ids = warehouseIds(requestContext);
  if (!isUuid(stocktakeId)) return failure('INVALID_STOCKTAKE_ID', 'Stocktake id is invalid');
  if (ids.length === 0) return failure('WAREHOUSE_SCOPE_DENIED', 'At least one authorized warehouse is required');
  const row = await repository.getStocktake(client, {
    installationId: requestContext.installationId,
    stocktakeId,
    warehouseIds: ids,
    forUpdate: true,
  });
  return row ? Object.freeze({ ok: true, row }) : failure('STOCKTAKE_NOT_FOUND', 'Stocktake was not found');
}

function revisionMatches(row, value) {
  const expected = parseRevision(value);
  return expected && String(row.revision) === expected;
}

async function verifyWatermarks(client, row, lines, { lock = false } = {}) {
  const scopes = lines.map((line) => ({
    line_id: line.id,
    location_id: line.location_id,
    base_variant_id: line.base_variant_id,
    lot_id: line.lot_id,
  }));
  const current = await repository.currentScopeVersions(client, {
    installationId: row.installation_id,
    warehouseId: row.warehouse_id,
    lines: scopes,
    lock,
  });
  const byLine = new Map(current.map((entry) => [entry.line_id, entry]));
  const stale = [];
  for (const line of lines) {
    const entry = byLine.get(line.id);
    if (!entry || String(entry.version) !== String(line.snapshot_scope_version)) {
      stale.push({
        lineId: line.id,
        expectedScopeVersion: String(line.snapshot_scope_version),
        currentScopeVersion: String(entry?.version ?? 0),
      });
    }
  }
  return stale.length > 0
    ? failure('STOCKTAKE_SCOPE_CHANGED', 'Inventory moved after the count snapshot; refresh and recount are required', false, { stale })
    : Object.freeze({ ok: true, currentByLine: byLine });
}

function stocktakeNumber(id) {
  const date = new Date().toISOString().slice(0, 10).replaceAll('-', '');
  return `STK-${date}-${id.slice(0, 8).toUpperCase()}`;
}

export async function listStocktakes(client, { requestContext, status, limit = 100, offset = 0 }) {
  const ids = warehouseIds(requestContext);
  if (ids.length === 0) return failure('WAREHOUSE_SCOPE_DENIED', 'At least one authorized warehouse is required');
  if (status && !STATUSES.has(status)) return failure('INVALID_STATUS', 'status is invalid');
  const rows = await repository.listStocktakes(client, {
    installationId: requestContext.installationId,
    warehouseIds: ids,
    status,
    limit,
    offset,
  });
  return Object.freeze({ ok: true, stocktakes: Object.freeze(rows.map((row) => mapStocktake(row))) });
}

export async function getStocktake(client, { requestContext, stocktakeId, revealExpected = true }) {
  const loaded = await loadLocked(client, requestContext, stocktakeId);
  if (!loaded.ok) return loaded;
  const mayReveal = revealExpected
    && !['draft', 'counted', 'recount_required'].includes(loaded.row.status);
  return Object.freeze({ ok: true, stocktake: await hydrate(client, loaded.row, { revealExpected: mayReveal }) });
}

export async function createStocktake(client, { requestContext, payload }) {
  const normalized = normalizeScopes(payload);
  if (!normalized.ok) return normalized;
  if (!hasWarehouse(requestContext, normalized.value.warehouseId)) {
    return failure('WAREHOUSE_SCOPE_DENIED', 'Warehouse is outside the authorized scope');
  }
  const warehouse = await repository.loadWarehouse(client, {
    installationId: requestContext.installationId,
    warehouseId: normalized.value.warehouseId,
  });
  if (!warehouse || !warehouse.is_active || ['vehicle', 'transit'].includes(warehouse.warehouse_type)) {
    return failure('WAREHOUSE_NOT_AVAILABLE', 'Warehouse is missing, inactive or not eligible for stocktake');
  }
  const snapshots = await repository.loadScopeSnapshots(client, {
    installationId: requestContext.installationId,
    warehouseId: normalized.value.warehouseId,
    scopes: normalized.value.scopes,
  });
  if (snapshots.length !== normalized.value.scopes.length) {
    return failure('STOCKTAKE_SCOPE_NOT_AVAILABLE', 'One or more stocktake scopes are invalid or unavailable');
  }

  const id = randomUUID();
  const roundId = randomUUID();
  const actor = actorId(requestContext);
  const row = await repository.insertStocktake(client, {
    id,
    installationId: requestContext.installationId,
    stocktakeNumber: stocktakeNumber(id),
    warehouseId: normalized.value.warehouseId,
    note: normalized.value.note,
    actorId: actor,
  });
  await repository.insertRound(client, {
    id: roundId,
    installationId: requestContext.installationId,
    stocktakeId: id,
    roundNumber: 1,
    reason: null,
    actorId: actor,
  });
  for (const snapshot of snapshots) {
    await repository.insertLine(client, {
      id: randomUUID(),
      installationId: requestContext.installationId,
      stocktakeId: id,
      roundId,
      roundNumber: 1,
      lineNumber: Number(snapshot.line_number),
      warehouseId: normalized.value.warehouseId,
      locationId: snapshot.location_id,
      sourceVariantId: snapshot.source_variant_id,
      sourceSku: snapshot.source_sku,
      sourceUnitId: snapshot.source_unit_id,
      sourceUnitCode: snapshot.source_unit_code,
      conversionToBase: String(snapshot.conversion_to_base),
      baseVariantId: snapshot.base_variant_id,
      baseSku: snapshot.base_sku,
      lotId: snapshot.lot_id,
      lotCode: snapshot.lot_code,
      expiryDate: dateOnly(snapshot.expiry_date),
      expectedBaseQuantity: String(snapshot.expected_base_quantity),
      snapshotScopeVersion: String(snapshot.snapshot_scope_version),
    });
  }
  return Object.freeze({ ok: true, stocktake: await hydrate(client, {
    ...row,
    warehouse_code: warehouse.code,
    warehouse_name: warehouse.name,
  }, { revealExpected: false }) });
}

export async function countStocktake(client, { requestContext, stocktakeId, payload }) {
  const loaded = await loadLocked(client, requestContext, stocktakeId);
  if (!loaded.ok) return loaded;
  const row = loaded.row;
  if (!['draft', 'recount_required'].includes(row.status)) {
    return failure('INVALID_STATUS_TRANSITION', 'Only a draft or recount-required stocktake can be counted');
  }
  if (!revisionMatches(row, payload?.expectedRevision)) {
    return failure('STOCKTAKE_REVISION_CONFLICT', 'Stocktake revision is stale');
  }
  const lines = await repository.listStocktakeLines(client, {
    installationId: row.installation_id,
    stocktakeId: row.id,
    roundNumber: Number(row.current_round),
    forUpdate: true,
  });
  if (!Array.isArray(payload?.counts) || payload.counts.length !== lines.length) {
    return failure('INCOMPLETE_STOCKTAKE_COUNT', 'Every scope in the current round must be counted exactly once');
  }
  const known = new Set(lines.map((line) => line.id));
  const seen = new Set();
  const counts = [];
  for (let index = 0; index < payload.counts.length; index += 1) {
    const count = payload.counts[index];
    if (!isUuid(count?.lineId) || !known.has(count.lineId) || seen.has(count.lineId)) {
      return failure('INVALID_STOCKTAKE_COUNT_LINE', `Count line ${index + 1} is invalid or duplicated`);
    }
    const quantity = parseDecimal12(count.countedBaseQuantity, `counts[${index}].countedBaseQuantity`);
    if (!quantity.ok) return quantity;
    seen.add(count.lineId);
    counts.push({ id: count.lineId, counted_quantity: quantity.value });
  }
  const updated = await repository.updateCountedLines(client, {
    installationId: row.installation_id,
    stocktakeId: row.id,
    roundNumber: Number(row.current_round),
    counts,
    actorId: actorId(requestContext),
  });
  if (updated.length !== lines.length) return failure('STOCKTAKE_COUNT_CONFLICT', 'Count lines changed while saving', true);
  const next = await repository.markCounted(client, {
    installationId: row.installation_id,
    stocktakeId: row.id,
    roundNumber: Number(row.current_round),
    actorId: actorId(requestContext),
  });
  return Object.freeze({ ok: true, beforeData: mapStocktake(row), stocktake: await hydrate(client, {
    ...next,
    warehouse_code: row.warehouse_code,
    warehouse_name: row.warehouse_name,
  }, { revealExpected: false }) });
}

export async function submitStocktake(client, { requestContext, stocktakeId, payload }) {
  const loaded = await loadLocked(client, requestContext, stocktakeId);
  if (!loaded.ok) return loaded;
  const row = loaded.row;
  if (row.status !== 'counted') return failure('INVALID_STATUS_TRANSITION', 'Only a counted stocktake can be submitted');
  if (!revisionMatches(row, payload?.expectedRevision)) return failure('STOCKTAKE_REVISION_CONFLICT', 'Stocktake revision is stale');
  const lines = await repository.listStocktakeLines(client, {
    installationId: row.installation_id,
    stocktakeId: row.id,
    roundNumber: Number(row.current_round),
    forUpdate: true,
  });
  const watermark = await verifyWatermarks(client, row, lines, { lock: true });
  if (!watermark.ok) return watermark;
  const next = await repository.transitionSubmitted(client, {
    installationId: row.installation_id,
    stocktakeId: row.id,
    roundNumber: Number(row.current_round),
    actorId: actorId(requestContext),
  });
  return Object.freeze({ ok: true, beforeData: mapStocktake(row), stocktake: await hydrate(client, {
    ...next,
    warehouse_code: row.warehouse_code,
    warehouse_name: row.warehouse_name,
  }, { revealExpected: true }) });
}

export async function requestRecount(client, { requestContext, stocktakeId, payload }) {
  const loaded = await loadLocked(client, requestContext, stocktakeId);
  if (!loaded.ok) return loaded;
  const row = loaded.row;
  if (!['counted', 'submitted', 'approved'].includes(row.status)) return failure('INVALID_STATUS_TRANSITION', 'Only a counted, submitted or approved stocktake can require recount');
  if (!revisionMatches(row, payload?.expectedRevision)) return failure('STOCKTAKE_REVISION_CONFLICT', 'Stocktake revision is stale');
  const reason = text(payload?.reason, 2000);
  if (!reason) return failure('RECOUNT_REASON_REQUIRED', 'A recount reason is required');
  const oldLines = await repository.listStocktakeLines(client, {
    installationId: row.installation_id,
    stocktakeId: row.id,
    roundNumber: Number(row.current_round),
    forUpdate: true,
  });
  const nextRound = Number(row.current_round) + 1;
  const roundId = randomUUID();
  const scopes = oldLines.map((line) => ({
    location_id: line.location_id,
    base_variant_id: line.base_variant_id,
    lot_id: line.lot_id,
  }));
  const snapshots = await repository.loadScopeSnapshots(client, {
    installationId: row.installation_id,
    warehouseId: row.warehouse_id,
    scopes,
  });
  if (snapshots.length !== oldLines.length) return failure('STOCKTAKE_SCOPE_NOT_AVAILABLE', 'A recount scope is no longer available');
  await repository.insertRound(client, {
    id: roundId,
    installationId: row.installation_id,
    stocktakeId: row.id,
    roundNumber: nextRound,
    reason,
    actorId: actorId(requestContext),
  });
  for (const snapshot of snapshots) {
    await repository.insertLine(client, {
      id: randomUUID(),
      installationId: row.installation_id,
      stocktakeId: row.id,
      roundId,
      roundNumber: nextRound,
      lineNumber: Number(snapshot.line_number),
      warehouseId: row.warehouse_id,
      locationId: snapshot.location_id,
      sourceVariantId: snapshot.source_variant_id,
      sourceSku: snapshot.source_sku,
      sourceUnitId: snapshot.source_unit_id,
      sourceUnitCode: snapshot.source_unit_code,
      conversionToBase: String(snapshot.conversion_to_base),
      baseVariantId: snapshot.base_variant_id,
      baseSku: snapshot.base_sku,
      lotId: snapshot.lot_id,
      lotCode: snapshot.lot_code,
      expiryDate: dateOnly(snapshot.expiry_date),
      expectedBaseQuantity: String(snapshot.expected_base_quantity),
      snapshotScopeVersion: String(snapshot.snapshot_scope_version),
    });
  }
  const next = await repository.markRecountRequired(client, {
    installationId: row.installation_id,
    stocktakeId: row.id,
    roundNumber: Number(row.current_round),
    nextRound,
    reason,
    actorId: actorId(requestContext),
  });
  return Object.freeze({ ok: true, beforeData: mapStocktake(row), stocktake: await hydrate(client, {
    ...next,
    warehouse_code: row.warehouse_code,
    warehouse_name: row.warehouse_name,
  }, { revealExpected: false }) });
}

export async function approveStocktake(client, { requestContext, stocktakeId, payload }) {
  const loaded = await loadLocked(client, requestContext, stocktakeId);
  if (!loaded.ok) return loaded;
  const row = loaded.row;
  if (row.status !== 'submitted') return failure('INVALID_STATUS_TRANSITION', 'Only a submitted stocktake can be approved');
  if (!revisionMatches(row, payload?.expectedRevision)) return failure('STOCKTAKE_REVISION_CONFLICT', 'Stocktake revision is stale');
  if (row.submitted_by === actorId(requestContext)) {
    return failure('STOCKTAKE_SELF_APPROVAL_DENIED', 'The submitter cannot approve the same submitted version');
  }
  const lines = await repository.listStocktakeLines(client, {
    installationId: row.installation_id,
    stocktakeId: row.id,
    roundNumber: Number(row.current_round),
    forUpdate: true,
  });
  const watermark = await verifyWatermarks(client, row, lines, { lock: true });
  if (!watermark.ok) return watermark;
  const next = await repository.transitionApproved(client, {
    installationId: row.installation_id,
    stocktakeId: row.id,
    roundNumber: Number(row.current_round),
    actorId: actorId(requestContext),
  });
  return Object.freeze({ ok: true, beforeData: mapStocktake(row), stocktake: await hydrate(client, {
    ...next,
    warehouse_code: row.warehouse_code,
    warehouse_name: row.warehouse_name,
  }, { revealExpected: true }) });
}

function movementRepresentation(deltaScaled12) {
  const absolute = deltaScaled12 < 0n ? -deltaScaled12 : deltaScaled12;
  if (absolute % SCALE_6 === 0n) {
    return {
      sourceQuantity: formatScale6(absolute / SCALE_6),
      conversionToBase: '1.000000',
    };
  }
  return {
    sourceQuantity: formatScale6(absolute),
    conversionToBase: '0.000001',
  };
}

async function insertAdjustmentMovement(client, {
  requestContext,
  stocktake,
  lines,
  currentByLine,
  idempotencyKey,
  reversalOfMovementId = null,
  reversalReason = null,
}) {
  if (!IDEMPOTENCY_PATTERN.test(idempotencyKey)) return failure('INVALID_IDEMPOTENCY_KEY', 'Movement idempotency key is invalid');
  await ledgerRepository.lockIdempotencyKey(client, {
    installationId: stocktake.installation_id,
    idempotencyKey,
  });
  const existing = await ledgerRepository.getMovementByIdempotencyKey(client, {
    installationId: stocktake.installation_id,
    idempotencyKey,
  });
  if (existing) {
    const existingLines = await ledgerRepository.listMovementLines(client, {
      installationId: stocktake.installation_id,
      movementId: existing.id,
    });
    return Object.freeze({ ok: true, movement: existing, lines: existingLines, replayed: true });
  }

  const adjustmentLines = [];
  for (const line of lines) {
    const counted = databaseScaled12(line.counted_base_quantity);
    const current = databaseScaled12(currentByLine.get(line.id)?.current_on_hand ?? 0);
    if (counted === null || current === null) return failure('INVALID_STOCKTAKE_QUANTITY', 'Stored stocktake quantity is invalid');
    const delta = reversalOfMovementId
      ? -(databaseScaled12(line.final_delta) ?? 0n)
      : counted - current;
    if (delta === 0n) continue;
    const representation = movementRepresentation(delta);
    adjustmentLines.push({
      id: randomUUID(),
      stocktakeLineId: line.id,
      warehouseId: line.warehouse_id,
      locationId: line.location_id,
      sourceVariantId: line.base_variant_id,
      sourceSku: line.base_sku,
      sourceUnitId: line.source_unit_id,
      sourceUnitCode: line.source_unit_code,
      sourceQuantity: representation.sourceQuantity,
      conversionToBase: representation.conversionToBase,
      baseVariantId: line.base_variant_id,
      baseSku: line.base_sku,
      lotId: line.lot_id,
      lotCode: line.lot_code,
      expiryDate: dateOnly(line.expiry_date),
      direction: delta > 0n ? 'IN' : 'OUT',
      baseQuantityDelta: formatScale12(delta),
      finalDelta: formatScale12(delta),
    });
  }
  if (adjustmentLines.length === 0) return Object.freeze({ ok: true, movement: null, lines: [], replayed: false });

  for (const item of adjustmentLines) {
    const scope = currentByLine.get(item.stocktakeLineId);
    const current = databaseScaled12(scope?.current_on_hand ?? 0) ?? 0n;
    const reserved = databaseScaled12(scope?.reserved_quantity ?? 0) ?? 0n;
    const delta = databaseScaled12(item.baseQuantityDelta) ?? 0n;
    if (delta < 0n && current + delta < reserved) {
      return failure('STOCKTAKE_RESERVED_CONFLICT', 'Stocktake posting would reduce on-hand below reserved quantity', false, {
        lineId: item.stocktakeLineId,
      });
    }
  }

  const movementId = randomUUID();
  const now = new Date();
  const documentDate = now.toISOString().slice(0, 10);
  const hash = payloadHash({
    stocktakeId: stocktake.id,
    reversalOfMovementId,
    lines: adjustmentLines.map((line) => ({
      stocktakeLineId: line.stocktakeLineId,
      direction: line.direction,
      baseQuantityDelta: line.baseQuantityDelta,
    })),
  });
  const movement = await ledgerRepository.insertMovement(client, {
    id: movementId,
    installationId: stocktake.installation_id,
    movementType: reversalOfMovementId ? 'STOCKTAKE_ADJUSTMENT_REVERSAL' : 'STOCKTAKE_ADJUSTMENT',
    sourceDomain: 'INVENTORY',
    sourceDocumentType: 'STOCKTAKE',
    sourceDocumentId: stocktake.id,
    sourceDocumentNumber: stocktake.stocktake_number,
    documentDate,
    postedAt: now,
    postedBy: actorId(requestContext),
    requestId: requestContext.requestId,
    sourceApp: requestContext.sourceApp ?? 'NPP_CORE',
    idempotencyKey,
    payloadHash: hash,
    reversalOfMovementId,
    documentNumber: stocktake.stocktake_number,
    reasonCode: reversalOfMovementId ? 'STOCKTAKE_REVERSE' : 'STOCKTAKE_POST',
    reasonNote: reversalReason,
    metadata: {
      stocktakeId: stocktake.id,
      stocktakeRound: Number(stocktake.current_round),
      correctionPolicy: reversalOfMovementId ? 'guarded_reversal' : 'stocktake_adjustment',
    },
  });
  for (let index = 0; index < adjustmentLines.length; index += 1) {
    const line = adjustmentLines[index];
    await ledgerRepository.insertMovementLine(client, {
      id: line.id,
      installationId: stocktake.installation_id,
      movementId,
      lineNumber: index + 1,
      warehouseId: line.warehouseId,
      locationId: line.locationId,
      sourceVariantId: line.sourceVariantId,
      sourceSku: line.sourceSku,
      sourceUnitId: line.sourceUnitId,
      sourceUnitCode: line.sourceUnitCode,
      sourceQuantity: line.sourceQuantity,
      conversionToBase: line.conversionToBase,
      baseVariantId: line.baseVariantId,
      baseSku: line.baseSku,
      direction: line.direction,
      baseQuantityDelta: line.baseQuantityDelta,
      lotId: line.lotId,
      lotCode: line.lotCode,
      expiryDate: line.expiryDate,
      sourceLineReference: `STOCKTAKE-LINE-${line.stocktakeLineId}`,
      metadata: {
        stocktakeId: stocktake.id,
        stocktakeLineId: line.stocktakeLineId,
        representation: line.conversionToBase === '0.000001' ? 'micro_base_exact' : 'base_unit',
      },
    });
  }
  return Object.freeze({ ok: true, movement, lines: adjustmentLines, replayed: false });
}

export async function postStocktake(client, { requestContext, stocktakeId, payload, idempotencyKey }) {
  const loaded = await loadLocked(client, requestContext, stocktakeId);
  if (!loaded.ok) return loaded;
  const row = loaded.row;
  if (row.status !== 'approved') return failure('INVALID_STATUS_TRANSITION', 'Only an approved stocktake can be posted');
  if (!revisionMatches(row, payload?.expectedRevision)) return failure('STOCKTAKE_REVISION_CONFLICT', 'Stocktake revision is stale');
  const lines = await repository.listStocktakeLines(client, {
    installationId: row.installation_id,
    stocktakeId: row.id,
    roundNumber: Number(row.current_round),
    forUpdate: true,
  });
  const watermark = await verifyWatermarks(client, row, lines, { lock: true });
  if (!watermark.ok) return watermark;
  const posted = await insertAdjustmentMovement(client, {
    requestContext,
    stocktake: row,
    lines,
    currentByLine: watermark.currentByLine,
    idempotencyKey: `${idempotencyKey}:movement`,
  });
  if (!posted.ok) return posted;

  let afterVersions = watermark.currentByLine;
  if (posted.movement) {
    afterVersions = new Map((await repository.currentScopeVersions(client, {
      installationId: row.installation_id,
      warehouseId: row.warehouse_id,
      lines: lines.map((line) => ({
        line_id: line.id,
        location_id: line.location_id,
        base_variant_id: line.base_variant_id,
        lot_id: line.lot_id,
      })),
      lock: false,
    })).map((entry) => [entry.line_id, entry]));
  }
  const lineVersions = lines.map((line) => {
    const counted = databaseScaled12(line.counted_base_quantity) ?? 0n;
    const current = databaseScaled12(watermark.currentByLine.get(line.id)?.current_on_hand ?? 0) ?? 0n;
    return {
      id: line.id,
      final_delta: formatScale12(counted - current),
      posted_scope_version: String(afterVersions.get(line.id)?.version ?? line.snapshot_scope_version),
    };
  });
  const next = await repository.markPosted(client, {
    installationId: row.installation_id,
    stocktakeId: row.id,
    actorId: actorId(requestContext),
    movementId: posted.movement?.id ?? null,
    lineVersions,
  });
  return Object.freeze({
    ok: true,
    beforeData: mapStocktake(row),
    stocktake: await hydrate(client, {
      ...next,
      warehouse_code: row.warehouse_code,
      warehouse_name: row.warehouse_name,
    }, { revealExpected: true }),
  });
}

export async function cancelStocktake(client, { requestContext, stocktakeId, payload }) {
  const loaded = await loadLocked(client, requestContext, stocktakeId);
  if (!loaded.ok) return loaded;
  const row = loaded.row;
  if (!['draft', 'counted', 'recount_required'].includes(row.status)) {
    return failure('INVALID_STATUS_TRANSITION', 'Stocktake can only be cancelled before submission');
  }
  if (!revisionMatches(row, payload?.expectedRevision)) return failure('STOCKTAKE_REVISION_CONFLICT', 'Stocktake revision is stale');
  const reason = text(payload?.reason, 2000);
  if (!reason) return failure('CANCEL_REASON_REQUIRED', 'A cancellation reason is required');
  const next = await repository.markCancelled(client, {
    installationId: row.installation_id,
    stocktakeId: row.id,
    actorId: actorId(requestContext),
    reason,
  });
  return Object.freeze({ ok: true, beforeData: mapStocktake(row), stocktake: mapStocktake({
    ...next,
    warehouse_code: row.warehouse_code,
    warehouse_name: row.warehouse_name,
  }) });
}

export async function reverseStocktake(client, { requestContext, stocktakeId, payload, idempotencyKey }) {
  const loaded = await loadLocked(client, requestContext, stocktakeId);
  if (!loaded.ok) return loaded;
  const row = loaded.row;
  if (row.status !== 'posted') return failure('INVALID_STATUS_TRANSITION', 'Only a posted stocktake can be reversed');
  if (!revisionMatches(row, payload?.expectedRevision)) return failure('STOCKTAKE_REVISION_CONFLICT', 'Stocktake revision is stale');
  const reason = text(payload?.reason, 2000);
  if (!reason) return failure('REVERSAL_REASON_REQUIRED', 'A reversal reason is required');
  const lines = await repository.listStocktakeLines(client, {
    installationId: row.installation_id,
    stocktakeId: row.id,
    roundNumber: Number(row.current_round),
    forUpdate: true,
  });
  const current = await repository.currentScopeVersions(client, {
    installationId: row.installation_id,
    warehouseId: row.warehouse_id,
    lines: lines.map((line) => ({
      line_id: line.id,
      location_id: line.location_id,
      base_variant_id: line.base_variant_id,
      lot_id: line.lot_id,
    })),
    lock: true,
  });
  const currentByLine = new Map(current.map((entry) => [entry.line_id, entry]));
  const downstream = lines.filter((line) => String(currentByLine.get(line.id)?.version ?? 0) !== String(line.posted_scope_version ?? 0));
  if (downstream.length > 0) {
    return failure(
      'STOCKTAKE_REVERSAL_DOWNSTREAM_CONFLICT',
      'Inventory moved after posting; create a new stocktake or forward correction instead of reversing history',
      false,
      { lineIds: downstream.map((line) => line.id) },
    );
  }
  if (!row.inventory_movement_id) {
    const next = await repository.markReversed(client, {
      installationId: row.installation_id,
      stocktakeId: row.id,
      reversalMovementId: null,
      actorId: actorId(requestContext),
      reason,
    });
    return Object.freeze({ ok: true, beforeData: mapStocktake(row), stocktake: mapStocktake({
      ...next,
      warehouse_code: row.warehouse_code,
      warehouse_name: row.warehouse_name,
    }) });
  }
  const reversed = await insertAdjustmentMovement(client, {
    requestContext,
    stocktake: row,
    lines,
    currentByLine,
    idempotencyKey: `${idempotencyKey}:reversal`,
    reversalOfMovementId: row.inventory_movement_id,
    reversalReason: reason,
  });
  if (!reversed.ok) return reversed;
  const next = await repository.markReversed(client, {
    installationId: row.installation_id,
    stocktakeId: row.id,
    reversalMovementId: reversed.movement?.id ?? null,
    actorId: actorId(requestContext),
    reason,
  });
  return Object.freeze({ ok: true, beforeData: mapStocktake(row), stocktake: await hydrate(client, {
    ...next,
    warehouse_code: row.warehouse_code,
    warehouse_name: row.warehouse_name,
  }, { revealExpected: true }) });
}

export const stocktakeInternals = Object.freeze({
  parseRevision,
  parseDecimal12,
  databaseScaled12,
  formatScale12,
  movementRepresentation,
  normalizeScopes,
});
