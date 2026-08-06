import { createHash, randomUUID } from 'node:crypto';
import * as repository from '../db/repositories/inventory-adjustment.js';
import * as ledgerRepository from '../db/repositories/inventory-ledger.js';

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const QUANTITY_PATTERN = /^(?:0|[1-9]\d{0,13})(?:\.\d{1,6})?$/;
const REVISION_PATTERN = /^(?:0|[1-9]\d{0,18})$/;
const IDEMPOTENCY_PATTERN = /^[A-Za-z0-9._:-]{1,128}$/;
const DOCUMENT_KINDS = new Set([
  'MANUAL_ADJUSTMENT',
  'QUARANTINE_TRANSFER',
  'DAMAGED_TRANSFER',
  'SCRAP',
]);
const STATUSES = new Set(['DRAFT', 'SUBMITTED', 'APPROVED', 'POSTED', 'CANCELLED', 'REVERSED']);
const TRANSFER_KINDS = new Set(['QUARANTINE_TRANSFER', 'DAMAGED_TRANSFER']);
const SCALE_6 = 1_000_000n;
const SCALE_12 = 1_000_000_000_000n;

function failure(code, message, retryable = false, details = {}) {
  return Object.freeze({ ok: false, code, message, retryable, details });
}

function text(value, maxLength = 0) {
  if (value === undefined || value === null) return null;
  const normalized = String(value).trim();
  if (!normalized || (maxLength > 0 && normalized.length > maxLength)) return null;
  return normalized;
}

function upper(value, maxLength = 0) {
  return text(value, maxLength)?.toUpperCase() ?? null;
}

function isUuid(value) {
  return typeof value === 'string' && UUID_PATTERN.test(value.trim());
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

function parsePositiveQuantity(value, field) {
  const normalized = typeof value === 'string' || typeof value === 'number'
    ? String(value).trim()
    : '';
  if (!QUANTITY_PATTERN.test(normalized)) {
    return failure('INVALID_QUANTITY', `${field} must be an unsigned positive decimal with at most 6 fractional digits`);
  }
  const [whole, fractional = ''] = normalized.split('.');
  const scaled = BigInt(whole) * SCALE_6 + BigInt(fractional.padEnd(6, '0'));
  if (scaled <= 0n) return failure('INVALID_QUANTITY', `${field} must be greater than zero`);
  return Object.freeze({ ok: true, value: `${whole}.${fractional.padEnd(6, '0')}`, scaled });
}

function databaseScaled12(value) {
  const match = /^(-?)(\d+)(?:\.(\d{1,12}))?$/.exec(String(value ?? '').trim());
  if (!match) return null;
  const absolute = BigInt(match[2]) * SCALE_12 + BigInt((match[3] ?? '').padEnd(12, '0'));
  return match[1] ? -absolute : absolute;
}

function negateScale12(value) {
  const scaled = databaseScaled12(value);
  if (scaled === null) return null;
  const negative = -scaled;
  const sign = negative < 0n ? '-' : '';
  const absolute = negative < 0n ? -negative : negative;
  return `${sign}${absolute / SCALE_12}.${String(absolute % SCALE_12).padStart(12, '0')}`;
}

function canonicalize(value) {
  if (Array.isArray(value)) return value.map(canonicalize);
  if (value === null || typeof value !== 'object') return value;
  return Object.fromEntries(Object.keys(value).sort().map((key) => [key, canonicalize(value[key])]));
}

function payloadHash(value) {
  return createHash('sha256').update(JSON.stringify(canonicalize(value))).digest('hex');
}

function childIdempotencyKey(parentKey, suffix) {
  const candidate = `${parentKey}:${suffix}`;
  if (candidate.length <= 128) return candidate;
  const digest = createHash('sha256').update(parentKey).digest('hex').slice(0, 32);
  return `${parentKey.slice(0, 80)}:${suffix}:${digest}`;
}

function dateOnly(value) {
  if (!value) return null;
  if (typeof value === 'string') return value.slice(0, 10);
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? null : parsed.toISOString().slice(0, 10);
}

function mapLine(row) {
  return Object.freeze({
    id: row.id,
    lineNumber: Number(row.line_number),
    warehouseId: row.warehouse_id,
    sourceLocationId: row.source_location_id,
    sourceLocationCode: row.source_location_code ?? null,
    sourceLocationName: row.source_location_name ?? null,
    sourceLocationType: row.source_location_type ?? null,
    destinationLocationId: row.destination_location_id ?? null,
    destinationLocationCode: row.destination_location_code ?? null,
    destinationLocationName: row.destination_location_name ?? null,
    destinationLocationType: row.destination_location_type ?? null,
    sourceVariantId: row.source_variant_id,
    sourceSku: row.source_sku,
    sourceUnitId: row.source_unit_id,
    sourceUnitCode: row.source_unit_code,
    quantity: String(row.source_quantity),
    conversionToBase: String(row.conversion_to_base),
    baseVariantId: row.base_variant_id,
    baseSku: row.base_sku,
    baseQuantity: String(row.base_quantity),
    lotId: row.lot_id ?? null,
    lotCode: row.lot_code ?? null,
    expiryDate: dateOnly(row.expiry_date),
    sourceSnapshotScopeVersion: String(row.source_snapshot_scope_version),
    destinationSnapshotScopeVersion: row.destination_snapshot_scope_version === null
      ? null
      : String(row.destination_snapshot_scope_version),
  });
}

function mapPostedScope(row) {
  return Object.freeze({
    lineId: row.adjustment_line_id,
    side: row.scope_side,
    warehouseId: row.warehouse_id,
    locationId: row.location_id,
    baseVariantId: row.base_variant_id,
    lotId: row.lot_id ?? null,
    postedScopeVersion: String(row.posted_scope_version),
  });
}

function mapAdjustment(row, { lines, postedScopes } = {}) {
  return Object.freeze({
    id: row.id,
    adjustmentNumber: row.adjustment_number,
    warehouseId: row.warehouse_id,
    warehouseCode: row.warehouse_code ?? null,
    warehouseName: row.warehouse_name ?? null,
    documentKind: row.document_kind,
    adjustmentDirection: row.adjustment_direction ?? null,
    reasonCode: row.reason_code,
    reasonLabel: row.reason_label ?? null,
    reasonNote: row.reason_note,
    status: row.status,
    revision: String(row.revision),
    correctionOfAdjustmentId: row.correction_of_adjustment_id ?? null,
    inventoryMovementId: row.inventory_movement_id ?? null,
    reversalMovementId: row.reversal_movement_id ?? null,
    createdAt: row.created_at,
    createdBy: row.created_by,
    updatedAt: row.updated_at,
    updatedBy: row.updated_by,
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
    lineCount: Number(row.line_count ?? lines?.length ?? 0),
    lines: lines ? Object.freeze(lines.map(mapLine)) : undefined,
    postedScopes: postedScopes ? Object.freeze(postedScopes.map(mapPostedScope)) : undefined,
  });
}

function mapReason(row) {
  return Object.freeze({
    code: row.code,
    documentKind: row.document_kind,
    adjustmentDirection: row.adjustment_direction ?? null,
    label: row.label,
    description: row.description,
  });
}

async function hydrate(client, row) {
  const [lines, postedScopes] = await Promise.all([
    repository.listLines(client, {
      installationId: row.installation_id,
      adjustmentId: row.id,
    }),
    row.status === 'POSTED' || row.status === 'REVERSED'
      ? repository.listPostedScopes(client, {
        installationId: row.installation_id,
        adjustmentId: row.id,
      })
      : Promise.resolve([]),
  ]);
  return mapAdjustment(row, { lines, postedScopes });
}

async function loadLocked(client, requestContext, adjustmentId) {
  if (!isUuid(adjustmentId)) return failure('INVALID_ADJUSTMENT_ID', 'Adjustment id is invalid');
  const ids = warehouseIds(requestContext);
  if (ids.length === 0) return failure('WAREHOUSE_SCOPE_DENIED', 'At least one authorized warehouse is required');
  const row = await repository.getAdjustment(client, {
    installationId: requestContext.installationId,
    adjustmentId,
    warehouseIds: ids,
    forUpdate: true,
  });
  return row ? Object.freeze({ ok: true, row }) : failure('INVENTORY_ADJUSTMENT_NOT_FOUND', 'Inventory adjustment was not found');
}

function adjustmentNumber(id) {
  const date = new Date().toISOString().slice(0, 10).replaceAll('-', '');
  return `IAD-${date}-${id.slice(0, 8).toUpperCase()}`;
}

function normalizeCreatePayload(payload) {
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
    return failure('INVALID_INPUT', 'Inventory adjustment payload is required');
  }
  const warehouseId = text(payload.warehouseId, 64);
  if (!isUuid(warehouseId)) return failure('INVALID_WAREHOUSE_ID', 'warehouseId is invalid');
  const documentKind = upper(payload.documentKind, 64);
  if (!DOCUMENT_KINDS.has(documentKind)) return failure('INVALID_DOCUMENT_KIND', 'documentKind is invalid');
  const adjustmentDirection = upper(payload.adjustmentDirection, 8);
  if (documentKind === 'MANUAL_ADJUSTMENT') {
    if (!['IN', 'OUT'].includes(adjustmentDirection)) {
      return failure('INVALID_ADJUSTMENT_DIRECTION', 'Manual adjustment requires adjustmentDirection IN or OUT');
    }
  } else if (adjustmentDirection !== null) {
    return failure('INVALID_ADJUSTMENT_DIRECTION', 'Only manual adjustment accepts adjustmentDirection');
  }
  const reasonCode = upper(payload.reasonCode, 64);
  if (!reasonCode || !/^[A-Z0-9_.-]{1,64}$/.test(reasonCode)) {
    return failure('INVALID_REASON_CODE', 'reasonCode is invalid');
  }
  const reasonNote = text(payload.reasonNote, 2000);
  if (!reasonNote) return failure('REASON_NOTE_REQUIRED', 'reasonNote is required');
  const correctionOfAdjustmentId = text(payload.correctionOfAdjustmentId, 64);
  if (correctionOfAdjustmentId && !isUuid(correctionOfAdjustmentId)) {
    return failure('INVALID_CORRECTION_SOURCE', 'correctionOfAdjustmentId is invalid');
  }
  if (payload.signedDelta !== undefined || payload.delta !== undefined || payload.baseQuantityDelta !== undefined) {
    return failure('SIGNED_DELTA_NOT_ALLOWED', 'Client signed delta is not accepted as inventory truth');
  }
  if (!Array.isArray(payload.lines) || payload.lines.length < 1 || payload.lines.length > 200) {
    return failure('INVALID_LINES', 'Inventory adjustment must contain between 1 and 200 lines');
  }

  const lines = [];
  const unique = new Set();
  for (let index = 0; index < payload.lines.length; index += 1) {
    const input = payload.lines[index];
    if (!input || typeof input !== 'object' || Array.isArray(input)) {
      return failure('INVALID_LINE', `Line ${index + 1} is invalid`);
    }
    if (input.direction !== undefined || input.signedDelta !== undefined || input.baseQuantityDelta !== undefined) {
      return failure('SIGNED_DELTA_NOT_ALLOWED', `Line ${index + 1} must use unsigned quantity only`);
    }
    const sourceLocationId = text(input.sourceLocationId ?? input.locationId, 64);
    const destinationLocationId = text(input.destinationLocationId, 64);
    const sourceVariantId = text(input.sourceVariantId, 64);
    const lotId = text(input.lotId, 64);
    if (!isUuid(sourceLocationId)) return failure('INVALID_SOURCE_LOCATION_ID', `Line ${index + 1} sourceLocationId is invalid`);
    if (destinationLocationId && !isUuid(destinationLocationId)) {
      return failure('INVALID_DESTINATION_LOCATION_ID', `Line ${index + 1} destinationLocationId is invalid`);
    }
    if (!isUuid(sourceVariantId)) return failure('INVALID_SOURCE_VARIANT_ID', `Line ${index + 1} sourceVariantId is invalid`);
    if (lotId && !isUuid(lotId)) return failure('INVALID_LOT_ID', `Line ${index + 1} lotId is invalid`);
    if (TRANSFER_KINDS.has(documentKind) && !destinationLocationId) {
      return failure('DESTINATION_LOCATION_REQUIRED', `Line ${index + 1} destinationLocationId is required`);
    }
    if (!TRANSFER_KINDS.has(documentKind) && destinationLocationId) {
      return failure('DESTINATION_LOCATION_NOT_ALLOWED', `Line ${index + 1} destinationLocationId is not allowed`);
    }
    if (destinationLocationId === sourceLocationId) {
      return failure('SAME_LOCATION_TRANSFER_DENIED', `Line ${index + 1} source and destination must differ`);
    }
    const quantity = parsePositiveQuantity(input.quantity, `lines[${index}].quantity`);
    if (!quantity.ok) return quantity;
    const key = [sourceLocationId, destinationLocationId ?? '<null>', sourceVariantId, lotId ?? '<null>'].join(':');
    if (unique.has(key)) return failure('DUPLICATE_ADJUSTMENT_SCOPE', `Line ${index + 1} duplicates an exact scope`);
    unique.add(key);
    lines.push(Object.freeze({
      source_location_id: sourceLocationId,
      destination_location_id: destinationLocationId,
      source_variant_id: sourceVariantId,
      source_quantity: quantity.value,
      lot_id: lotId,
    }));
  }

  return Object.freeze({
    ok: true,
    value: Object.freeze({
      warehouseId,
      documentKind,
      adjustmentDirection,
      reasonCode,
      reasonNote,
      correctionOfAdjustmentId,
      lines: Object.freeze(lines),
    }),
  });
}

function scopeRows(lines, { posted = false } = {}) {
  const scopes = [];
  for (const line of lines) {
    scopes.push({
      scope_key: `${line.id}:SOURCE`,
      line_id: line.id,
      side: 'SOURCE',
      location_id: line.source_location_id,
      base_variant_id: line.base_variant_id,
      lot_id: line.lot_id,
      expected_version: posted ? null : String(line.source_snapshot_scope_version),
    });
    if (line.destination_location_id) {
      scopes.push({
        scope_key: `${line.id}:DESTINATION`,
        line_id: line.id,
        side: 'DESTINATION',
        location_id: line.destination_location_id,
        base_variant_id: line.base_variant_id,
        lot_id: line.lot_id,
        expected_version: posted ? null : String(line.destination_snapshot_scope_version ?? 0),
      });
    }
  }
  return scopes;
}

async function verifySnapshotWatermarks(client, row, lines, { lock = false } = {}) {
  const scopes = scopeRows(lines);
  const current = await repository.currentScopeVersions(client, {
    installationId: row.installation_id,
    warehouseId: row.warehouse_id,
    scopes,
    lock,
  });
  const byKey = new Map(current.map((entry) => [entry.scope_key, entry]));
  const stale = scopes.filter((scope) => String(byKey.get(scope.scope_key)?.version ?? 0) !== scope.expected_version);
  if (stale.length > 0) {
    return failure(
      'INVENTORY_ADJUSTMENT_SCOPE_CHANGED',
      'Inventory moved after the adjustment snapshot; cancel and create a fresh document',
      false,
      {
        stale: stale.map((scope) => ({
          lineId: scope.line_id,
          side: scope.side,
          expectedScopeVersion: scope.expected_version,
          currentScopeVersion: String(byKey.get(scope.scope_key)?.version ?? 0),
        })),
      },
    );
  }
  return Object.freeze({ ok: true, scopes, currentByKey: byKey });
}

function movementTypeFor(row, reversal = false) {
  const base = row.document_kind === 'MANUAL_ADJUSTMENT'
    ? `MANUAL_ADJUSTMENT_${row.adjustment_direction}`
    : row.document_kind;
  return reversal ? `${base}_REVERSAL` : base;
}

function movementDirections(row, line) {
  if (row.document_kind === 'MANUAL_ADJUSTMENT') {
    return [{ side: 'SOURCE', direction: row.adjustment_direction, locationId: line.source_location_id }];
  }
  if (row.document_kind === 'SCRAP') {
    return [{ side: 'SOURCE', direction: 'OUT', locationId: line.source_location_id }];
  }
  return [
    { side: 'SOURCE', direction: 'OUT', locationId: line.source_location_id },
    { side: 'DESTINATION', direction: 'IN', locationId: line.destination_location_id },
  ];
}

function validateOutAvailability(currentByKey, line, side, baseQuantity) {
  const entry = currentByKey.get(`${line.id}:${side}`);
  const onHand = databaseScaled12(entry?.current_on_hand ?? 0);
  const reserved = databaseScaled12(entry?.reserved_quantity ?? 0);
  const quantity = databaseScaled12(baseQuantity);
  if (onHand === null || reserved === null || quantity === null) {
    return failure('INVALID_STORED_QUANTITY', 'Stored inventory quantity is invalid');
  }
  if (onHand - quantity < reserved) {
    return failure('INVENTORY_ADJUSTMENT_RESERVED_CONFLICT', 'Posting would reduce on-hand below reserved quantity', false, {
      lineId: line.id,
      side,
    });
  }
  return Object.freeze({ ok: true });
}

async function insertMovement(client, {
  requestContext,
  adjustment,
  lines,
  currentByKey,
  idempotencyKey,
}) {
  if (!IDEMPOTENCY_PATTERN.test(idempotencyKey)) {
    return failure('INVALID_IDEMPOTENCY_KEY', 'Movement idempotency key is invalid');
  }
  await ledgerRepository.lockIdempotencyKey(client, {
    installationId: adjustment.installation_id,
    idempotencyKey,
  });
  const existing = await ledgerRepository.getMovementByIdempotencyKey(client, {
    installationId: adjustment.installation_id,
    idempotencyKey,
  });
  if (existing) {
    if (existing.source_document_id !== adjustment.id) {
      return failure('IDEMPOTENCY_PAYLOAD_MISMATCH', 'Movement idempotency key belongs to another document');
    }
    return Object.freeze({ ok: true, movement: existing, replayed: true });
  }

  const movementLines = [];
  for (const line of lines) {
    for (const movement of movementDirections(adjustment, line)) {
      if (movement.direction === 'OUT') {
        const availability = validateOutAvailability(currentByKey, line, movement.side, line.base_quantity);
        if (!availability.ok) return availability;
      }
      movementLines.push({ line, ...movement });
    }
  }

  const movementId = randomUUID();
  const now = new Date();
  const hash = payloadHash({
    adjustmentId: adjustment.id,
    movementType: movementTypeFor(adjustment),
    lines: movementLines.map((item) => ({
      lineId: item.line.id,
      side: item.side,
      direction: item.direction,
      baseQuantity: String(item.line.base_quantity),
    })),
  });
  const movement = await ledgerRepository.insertMovement(client, {
    id: movementId,
    installationId: adjustment.installation_id,
    movementType: movementTypeFor(adjustment),
    sourceDomain: 'INVENTORY',
    sourceDocumentType: 'INVENTORY_ADJUSTMENT',
    sourceDocumentId: adjustment.id,
    sourceDocumentNumber: adjustment.adjustment_number,
    documentDate: now.toISOString().slice(0, 10),
    postedAt: now,
    postedBy: actorId(requestContext),
    requestId: requestContext.requestId,
    sourceApp: requestContext.sourceApp ?? 'NPP_CORE',
    idempotencyKey,
    payloadHash: hash,
    reversalOfMovementId: null,
    documentNumber: adjustment.adjustment_number,
    reasonCode: adjustment.reason_code,
    reasonNote: adjustment.reason_note,
    metadata: {
      inventoryAdjustmentId: adjustment.id,
      documentKind: adjustment.document_kind,
      adjustmentDirection: adjustment.adjustment_direction,
      correctionOfAdjustmentId: adjustment.correction_of_adjustment_id,
      correctionPolicy: adjustment.correction_of_adjustment_id ? 'forward_correction' : 'governed_adjustment',
    },
  });

  for (let index = 0; index < movementLines.length; index += 1) {
    const item = movementLines[index];
    const baseDelta = item.direction === 'IN'
      ? String(item.line.base_quantity)
      : `-${String(item.line.base_quantity)}`;
    await ledgerRepository.insertMovementLine(client, {
      id: randomUUID(),
      installationId: adjustment.installation_id,
      movementId,
      lineNumber: index + 1,
      warehouseId: adjustment.warehouse_id,
      locationId: item.locationId,
      sourceVariantId: item.line.source_variant_id,
      sourceSku: item.line.source_sku,
      sourceUnitId: item.line.source_unit_id,
      sourceUnitCode: item.line.source_unit_code,
      sourceQuantity: String(item.line.source_quantity),
      conversionToBase: String(item.line.conversion_to_base),
      baseVariantId: item.line.base_variant_id,
      baseSku: item.line.base_sku,
      direction: item.direction,
      baseQuantityDelta: baseDelta,
      lotId: item.line.lot_id,
      lotCode: item.line.lot_code,
      expiryDate: dateOnly(item.line.expiry_date),
      sourceLineReference: `INVENTORY-ADJUSTMENT-${item.line.id}-${item.side}`,
      metadata: {
        inventoryAdjustmentId: adjustment.id,
        inventoryAdjustmentLineId: item.line.id,
        scopeSide: item.side,
        pairedMovement: TRANSFER_KINDS.has(adjustment.document_kind),
      },
    });
  }
  return Object.freeze({ ok: true, movement, replayed: false });
}

async function insertReversalMovement(client, {
  requestContext,
  adjustment,
  originalLines,
  currentByKey,
  idempotencyKey,
  reason,
}) {
  if (!IDEMPOTENCY_PATTERN.test(idempotencyKey)) {
    return failure('INVALID_IDEMPOTENCY_KEY', 'Reversal idempotency key is invalid');
  }
  await ledgerRepository.lockIdempotencyKey(client, {
    installationId: adjustment.installation_id,
    idempotencyKey,
  });
  const existing = await ledgerRepository.getMovementByIdempotencyKey(client, {
    installationId: adjustment.installation_id,
    idempotencyKey,
  });
  if (existing) {
    if (existing.source_document_id !== adjustment.id
        || existing.reversal_of_movement_id !== adjustment.inventory_movement_id) {
      return failure('IDEMPOTENCY_PAYLOAD_MISMATCH', 'Reversal idempotency key belongs to another movement');
    }
    return Object.freeze({ ok: true, movement: existing, replayed: true });
  }

  const storedLines = await repository.listLines(client, {
    installationId: adjustment.installation_id,
    adjustmentId: adjustment.id,
  });
  const byStoredLine = new Map(storedLines.map((line) => [line.id, line]));
  for (const original of originalLines) {
    if (original.direction !== 'IN') continue;
    const sourceLineId = original.metadata?.inventoryAdjustmentLineId;
    const side = original.metadata?.scopeSide;
    const stored = byStoredLine.get(sourceLineId);
    if (!stored || !side) return failure('INVENTORY_ADJUSTMENT_LINEAGE_INVALID', 'Original movement lineage is incomplete');
    const availability = validateOutAvailability(currentByKey, stored, side, String(stored.base_quantity));
    if (!availability.ok) return availability;
  }

  const movementId = randomUUID();
  const now = new Date();
  const hash = payloadHash({
    adjustmentId: adjustment.id,
    reversalOfMovementId: adjustment.inventory_movement_id,
    reason,
  });
  const movement = await ledgerRepository.insertMovement(client, {
    id: movementId,
    installationId: adjustment.installation_id,
    movementType: movementTypeFor(adjustment, true),
    sourceDomain: 'INVENTORY',
    sourceDocumentType: 'INVENTORY_ADJUSTMENT_REVERSAL',
    sourceDocumentId: adjustment.id,
    sourceDocumentNumber: adjustment.adjustment_number,
    documentDate: now.toISOString().slice(0, 10),
    postedAt: now,
    postedBy: actorId(requestContext),
    requestId: requestContext.requestId,
    sourceApp: requestContext.sourceApp ?? 'NPP_CORE',
    idempotencyKey,
    payloadHash: hash,
    reversalOfMovementId: adjustment.inventory_movement_id,
    documentNumber: `${adjustment.adjustment_number}-REV`,
    reasonCode: 'INVENTORY_ADJUSTMENT_REVERSAL',
    reasonNote: reason,
    metadata: {
      inventoryAdjustmentId: adjustment.id,
      correctionPolicy: 'guarded_reversal',
    },
  });

  for (let index = 0; index < originalLines.length; index += 1) {
    const original = originalLines[index];
    const direction = original.direction === 'IN' ? 'OUT' : 'IN';
    const baseQuantityDelta = negateScale12(original.base_quantity_delta);
    if (!baseQuantityDelta) return failure('INVALID_STORED_QUANTITY', 'Original movement quantity is invalid');
    await ledgerRepository.insertMovementLine(client, {
      id: randomUUID(),
      installationId: adjustment.installation_id,
      movementId,
      lineNumber: index + 1,
      warehouseId: original.warehouse_id,
      locationId: original.location_id,
      sourceVariantId: original.source_variant_id,
      sourceSku: original.source_sku,
      sourceUnitId: original.source_unit_id,
      sourceUnitCode: original.source_unit_code,
      sourceQuantity: String(original.source_quantity),
      conversionToBase: String(original.conversion_to_base),
      baseVariantId: original.base_variant_id,
      baseSku: original.base_sku,
      direction,
      baseQuantityDelta,
      lotId: original.lot_id,
      lotCode: original.lot_code,
      expiryDate: dateOnly(original.expiry_date),
      sourceLineReference: `REVERSAL-${original.id}`,
      metadata: {
        ...(original.metadata ?? {}),
        reversedMovementLineId: original.id,
        inventoryAdjustmentId: adjustment.id,
      },
    });
  }
  return Object.freeze({ ok: true, movement, replayed: false });
}

export async function listReasons(client) {
  const rows = await repository.listReasons(client);
  return Object.freeze({ ok: true, reasons: Object.freeze(rows.map(mapReason)) });
}

export async function listAdjustments(client, {
  requestContext,
  status,
  documentKind,
  limit = 100,
  offset = 0,
}) {
  const ids = warehouseIds(requestContext);
  if (ids.length === 0) return failure('WAREHOUSE_SCOPE_DENIED', 'At least one authorized warehouse is required');
  const normalizedStatus = status ? upper(status, 32) : null;
  const normalizedKind = documentKind ? upper(documentKind, 64) : null;
  if (normalizedStatus && !STATUSES.has(normalizedStatus)) return failure('INVALID_STATUS', 'status is invalid');
  if (normalizedKind && !DOCUMENT_KINDS.has(normalizedKind)) return failure('INVALID_DOCUMENT_KIND', 'documentKind is invalid');
  const rows = await repository.listAdjustments(client, {
    installationId: requestContext.installationId,
    warehouseIds: ids,
    status: normalizedStatus,
    documentKind: normalizedKind,
    limit,
    offset,
  });
  return Object.freeze({ ok: true, adjustments: Object.freeze(rows.map((row) => mapAdjustment(row))) });
}

export async function getAdjustment(client, { requestContext, adjustmentId }) {
  const loaded = await loadLocked(client, requestContext, adjustmentId);
  if (!loaded.ok) return loaded;
  return Object.freeze({ ok: true, adjustment: await hydrate(client, loaded.row) });
}

export async function createAdjustment(client, { requestContext, payload }) {
  const normalized = normalizeCreatePayload(payload);
  if (!normalized.ok) return normalized;
  const input = normalized.value;
  if (!hasWarehouse(requestContext, input.warehouseId)) {
    return failure('WAREHOUSE_SCOPE_DENIED', 'Warehouse is outside the authorized scope');
  }
  const warehouse = await repository.loadWarehouse(client, {
    installationId: requestContext.installationId,
    warehouseId: input.warehouseId,
  });
  if (!warehouse || !warehouse.is_active || ['vehicle', 'transit'].includes(warehouse.warehouse_type)) {
    return failure('WAREHOUSE_NOT_AVAILABLE', 'Warehouse is missing, inactive or not eligible for adjustment');
  }
  const reason = await repository.getReason(client, { code: input.reasonCode });
  if (!reason || !reason.is_active) return failure('ADJUSTMENT_REASON_NOT_AVAILABLE', 'Reason code is not available');
  if (reason.document_kind !== input.documentKind
      || (reason.adjustment_direction ?? null) !== (input.adjustmentDirection ?? null)) {
    return failure('ADJUSTMENT_REASON_MISMATCH', 'Reason code does not match document kind or direction');
  }
  if (input.correctionOfAdjustmentId) {
    const correctionSource = await repository.loadCorrectionSource(client, {
      installationId: requestContext.installationId,
      adjustmentId: input.correctionOfAdjustmentId,
    });
    if (!correctionSource || correctionSource.warehouse_id !== input.warehouseId || correctionSource.status !== 'POSTED') {
      return failure('INVALID_CORRECTION_SOURCE', 'Forward correction must reference a posted adjustment in the same warehouse');
    }
  }
  const snapshots = await repository.loadLineSnapshots(client, {
    installationId: requestContext.installationId,
    warehouseId: input.warehouseId,
    lines: input.lines,
  });
  if (snapshots.length !== input.lines.length) {
    return failure('ADJUSTMENT_SCOPE_NOT_AVAILABLE', 'One or more locations, SKUs or lots are invalid or unavailable');
  }
  for (const snapshot of snapshots) {
    if (input.documentKind === 'QUARANTINE_TRANSFER' && snapshot.destination_location_type !== 'quarantine') {
      return failure('QUARANTINE_LOCATION_REQUIRED', `Line ${snapshot.line_number} destination must be an active quarantine location`);
    }
    if (input.documentKind === 'DAMAGED_TRANSFER' && snapshot.destination_location_type !== 'damaged') {
      return failure('DAMAGED_LOCATION_REQUIRED', `Line ${snapshot.line_number} destination must be an active damaged location`);
    }
  }

  const id = randomUUID();
  const actor = actorId(requestContext);
  const row = await repository.insertAdjustment(client, {
    id,
    installationId: requestContext.installationId,
    adjustmentNumber: adjustmentNumber(id),
    warehouseId: input.warehouseId,
    documentKind: input.documentKind,
    adjustmentDirection: input.adjustmentDirection,
    reasonCode: input.reasonCode,
    reasonNote: input.reasonNote,
    correctionOfAdjustmentId: input.correctionOfAdjustmentId,
    actorId: actor,
  });
  for (const snapshot of snapshots) {
    await repository.insertLine(client, {
      id: randomUUID(),
      installationId: requestContext.installationId,
      adjustmentId: id,
      lineNumber: Number(snapshot.line_number),
      warehouseId: input.warehouseId,
      sourceLocationId: snapshot.source_location_id,
      destinationLocationId: snapshot.destination_location_id,
      sourceVariantId: snapshot.source_variant_id,
      sourceSku: snapshot.source_sku,
      sourceUnitId: snapshot.source_unit_id,
      sourceUnitCode: snapshot.source_unit_code,
      sourceQuantity: String(snapshot.source_quantity),
      conversionToBase: String(snapshot.conversion_to_base),
      baseVariantId: snapshot.base_variant_id,
      baseSku: snapshot.base_sku,
      baseQuantity: String(snapshot.base_quantity),
      lotId: snapshot.lot_id,
      lotCode: snapshot.lot_code,
      expiryDate: dateOnly(snapshot.expiry_date),
      sourceSnapshotScopeVersion: String(snapshot.source_snapshot_scope_version),
      destinationSnapshotScopeVersion: snapshot.destination_snapshot_scope_version === null
        ? null
        : String(snapshot.destination_snapshot_scope_version),
      actorId: actor,
    });
  }
  return Object.freeze({ ok: true, adjustment: await hydrate(client, {
    ...row,
    warehouse_code: warehouse.code,
    warehouse_name: warehouse.name,
    reason_label: reason.label,
  }) });
}

export async function submitAdjustment(client, { requestContext, adjustmentId, payload }) {
  const loaded = await loadLocked(client, requestContext, adjustmentId);
  if (!loaded.ok) return loaded;
  const row = loaded.row;
  if (row.status !== 'DRAFT') return failure('INVALID_STATUS_TRANSITION', 'Only a draft adjustment can be submitted');
  if (String(row.revision) !== parseRevision(payload?.expectedRevision)) {
    return failure('INVENTORY_ADJUSTMENT_REVISION_CONFLICT', 'Adjustment revision is stale');
  }
  const lines = await repository.listLines(client, {
    installationId: row.installation_id,
    adjustmentId: row.id,
    forUpdate: true,
  });
  const watermark = await verifySnapshotWatermarks(client, row, lines, { lock: true });
  if (!watermark.ok) return watermark;
  const next = await repository.markSubmitted(client, {
    installationId: row.installation_id,
    adjustmentId: row.id,
    actorId: actorId(requestContext),
  });
  if (!next) return failure('INVENTORY_ADJUSTMENT_CONFLICT', 'Adjustment changed while submitting', true);
  return Object.freeze({ ok: true, beforeData: mapAdjustment(row), adjustment: await hydrate(client, {
    ...next,
    warehouse_code: row.warehouse_code,
    warehouse_name: row.warehouse_name,
    reason_label: row.reason_label,
  }) });
}

export async function approveAdjustment(client, { requestContext, adjustmentId, payload }) {
  const loaded = await loadLocked(client, requestContext, adjustmentId);
  if (!loaded.ok) return loaded;
  const row = loaded.row;
  if (row.status !== 'SUBMITTED') return failure('INVALID_STATUS_TRANSITION', 'Only a submitted adjustment can be approved');
  if (String(row.revision) !== parseRevision(payload?.expectedRevision)) {
    return failure('INVENTORY_ADJUSTMENT_REVISION_CONFLICT', 'Adjustment revision is stale');
  }
  if (row.created_by === actorId(requestContext)) {
    return failure('INVENTORY_ADJUSTMENT_SELF_APPROVAL_DENIED', 'The creator cannot approve the same adjustment');
  }
  const lines = await repository.listLines(client, {
    installationId: row.installation_id,
    adjustmentId: row.id,
    forUpdate: true,
  });
  const watermark = await verifySnapshotWatermarks(client, row, lines, { lock: true });
  if (!watermark.ok) return watermark;
  const next = await repository.markApproved(client, {
    installationId: row.installation_id,
    adjustmentId: row.id,
    actorId: actorId(requestContext),
  });
  if (!next) return failure('INVENTORY_ADJUSTMENT_CONFLICT', 'Adjustment changed while approving', true);
  return Object.freeze({ ok: true, beforeData: mapAdjustment(row), adjustment: await hydrate(client, {
    ...next,
    warehouse_code: row.warehouse_code,
    warehouse_name: row.warehouse_name,
    reason_label: row.reason_label,
  }) });
}

export async function postAdjustment(client, {
  requestContext,
  adjustmentId,
  payload,
  idempotencyKey,
}) {
  const loaded = await loadLocked(client, requestContext, adjustmentId);
  if (!loaded.ok) return loaded;
  const row = loaded.row;
  if (row.status !== 'APPROVED') return failure('INVALID_STATUS_TRANSITION', 'Only an approved adjustment can be posted');
  if (String(row.revision) !== parseRevision(payload?.expectedRevision)) {
    return failure('INVENTORY_ADJUSTMENT_REVISION_CONFLICT', 'Adjustment revision is stale');
  }
  const lines = await repository.listLines(client, {
    installationId: row.installation_id,
    adjustmentId: row.id,
    forUpdate: true,
  });
  const watermark = await verifySnapshotWatermarks(client, row, lines, { lock: true });
  if (!watermark.ok) return watermark;
  const posted = await insertMovement(client, {
    requestContext,
    adjustment: row,
    lines,
    currentByKey: watermark.currentByKey,
    idempotencyKey: childIdempotencyKey(idempotencyKey, 'movement'),
  });
  if (!posted.ok) return posted;

  const scopes = scopeRows(lines);
  const after = await repository.currentScopeVersions(client, {
    installationId: row.installation_id,
    warehouseId: row.warehouse_id,
    scopes,
    lock: false,
  });
  const afterByKey = new Map(after.map((entry) => [entry.scope_key, entry]));
  for (const scope of scopes) {
    await repository.insertPostedScope(client, {
      id: randomUUID(),
      installationId: row.installation_id,
      adjustmentId: row.id,
      adjustmentLineId: scope.line_id,
      scopeSide: scope.side,
      warehouseId: row.warehouse_id,
      locationId: scope.location_id,
      baseVariantId: scope.base_variant_id,
      lotId: scope.lot_id,
      postedScopeVersion: String(afterByKey.get(scope.scope_key)?.version ?? 0),
    });
  }
  const next = await repository.markPosted(client, {
    installationId: row.installation_id,
    adjustmentId: row.id,
    movementId: posted.movement.id,
    actorId: actorId(requestContext),
  });
  if (!next) return failure('INVENTORY_ADJUSTMENT_CONFLICT', 'Adjustment changed while posting', true);
  return Object.freeze({ ok: true, beforeData: mapAdjustment(row), adjustment: await hydrate(client, {
    ...next,
    warehouse_code: row.warehouse_code,
    warehouse_name: row.warehouse_name,
    reason_label: row.reason_label,
  }) });
}

export async function cancelAdjustment(client, { requestContext, adjustmentId, payload }) {
  const loaded = await loadLocked(client, requestContext, adjustmentId);
  if (!loaded.ok) return loaded;
  const row = loaded.row;
  if (!['DRAFT', 'SUBMITTED', 'APPROVED'].includes(row.status)) {
    return failure('INVALID_STATUS_TRANSITION', 'Adjustment can only be cancelled before posting');
  }
  if (String(row.revision) !== parseRevision(payload?.expectedRevision)) {
    return failure('INVENTORY_ADJUSTMENT_REVISION_CONFLICT', 'Adjustment revision is stale');
  }
  const reason = text(payload?.reason, 2000);
  if (!reason) return failure('CANCEL_REASON_REQUIRED', 'Cancellation reason is required');
  const next = await repository.markCancelled(client, {
    installationId: row.installation_id,
    adjustmentId: row.id,
    actorId: actorId(requestContext),
    reason,
  });
  if (!next) return failure('INVENTORY_ADJUSTMENT_CONFLICT', 'Adjustment changed while cancelling', true);
  return Object.freeze({ ok: true, beforeData: mapAdjustment(row), adjustment: await hydrate(client, {
    ...next,
    warehouse_code: row.warehouse_code,
    warehouse_name: row.warehouse_name,
    reason_label: row.reason_label,
  }) });
}

export async function reverseAdjustment(client, {
  requestContext,
  adjustmentId,
  payload,
  idempotencyKey,
}) {
  const loaded = await loadLocked(client, requestContext, adjustmentId);
  if (!loaded.ok) return loaded;
  const row = loaded.row;
  if (row.status !== 'POSTED') return failure('INVALID_STATUS_TRANSITION', 'Only a posted adjustment can be reversed');
  if (String(row.revision) !== parseRevision(payload?.expectedRevision)) {
    return failure('INVENTORY_ADJUSTMENT_REVISION_CONFLICT', 'Adjustment revision is stale');
  }
  const reason = text(payload?.reason, 2000);
  if (!reason) return failure('REVERSAL_REASON_REQUIRED', 'Reversal reason is required');
  if (!row.inventory_movement_id) return failure('INVENTORY_ADJUSTMENT_LINEAGE_INVALID', 'Posted adjustment has no movement lineage');

  const [lines, postedScopes, originalLines] = await Promise.all([
    repository.listLines(client, {
      installationId: row.installation_id,
      adjustmentId: row.id,
      forUpdate: true,
    }),
    repository.listPostedScopes(client, {
      installationId: row.installation_id,
      adjustmentId: row.id,
    }),
    ledgerRepository.listMovementLines(client, {
      installationId: row.installation_id,
      movementId: row.inventory_movement_id,
    }),
  ]);
  const scopes = postedScopes.map((scope) => ({
    scope_key: `${scope.adjustment_line_id}:${scope.scope_side}`,
    location_id: scope.location_id,
    base_variant_id: scope.base_variant_id,
    lot_id: scope.lot_id,
  }));
  const current = await repository.currentScopeVersions(client, {
    installationId: row.installation_id,
    warehouseId: row.warehouse_id,
    scopes,
    lock: true,
  });
  const currentByKey = new Map(current.map((entry) => [entry.scope_key, entry]));
  const downstream = postedScopes.filter((scope) => (
    String(currentByKey.get(`${scope.adjustment_line_id}:${scope.scope_side}`)?.version ?? 0)
      !== String(scope.posted_scope_version)
  ));
  if (downstream.length > 0) {
    return failure(
      'INVENTORY_ADJUSTMENT_REVERSAL_DOWNSTREAM_CONFLICT',
      'Inventory moved after posting; create a forward correction instead of reversing history',
      false,
      { scopes: downstream.map((scope) => ({ lineId: scope.adjustment_line_id, side: scope.scope_side })) },
    );
  }
  if (originalLines.length === 0) return failure('INVENTORY_ADJUSTMENT_LINEAGE_INVALID', 'Original movement has no lines');
  const reversed = await insertReversalMovement(client, {
    requestContext,
    adjustment: row,
    originalLines,
    currentByKey,
    idempotencyKey: childIdempotencyKey(idempotencyKey, 'reversal'),
    reason,
  });
  if (!reversed.ok) return reversed;
  const next = await repository.markReversed(client, {
    installationId: row.installation_id,
    adjustmentId: row.id,
    reversalMovementId: reversed.movement.id,
    actorId: actorId(requestContext),
    reason,
  });
  if (!next) return failure('INVENTORY_ADJUSTMENT_CONFLICT', 'Adjustment changed while reversing', true);
  return Object.freeze({ ok: true, beforeData: mapAdjustment(row), adjustment: await hydrate(client, {
    ...next,
    warehouse_code: row.warehouse_code,
    warehouse_name: row.warehouse_name,
    reason_label: row.reason_label,
  }) });
}

export const inventoryAdjustmentInternals = Object.freeze({
  normalizeCreatePayload,
  parsePositiveQuantity,
  parseRevision,
  scopeRows,
  movementTypeFor,
  childIdempotencyKey,
});
