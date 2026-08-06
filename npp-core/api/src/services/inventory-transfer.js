import { randomUUID } from 'node:crypto';
import * as repository from '../db/repositories/inventory-transfer.js';
import * as documentNumberRepository from '../db/repositories/document-numbering.js';
import { allocateDocumentNumber } from './document-numbering.js';
import { postInventoryMovement } from './inventory-ledger.js';

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const DATE_PATTERN = /^(\d{4})-(\d{2})-(\d{2})$/;
const DECIMAL_PATTERN = /^(0|[1-9]\d{0,13})(?:\.(\d{1,6}))?$/;
const REVISION_PATTERN = /^[1-9]\d{0,18}$/;
const STATUSES = new Set(['draft', 'approved', 'dispatched', 'cancelled']);
const TRANSFER_SERIES_CODE = 'INVENTORY_TRANSFER';
const SCALE_6 = 1_000_000n;
const SCALE_12 = 1_000_000_000_000n;

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

function normalizeDate(value) {
  const normalized = text(value, 10);
  const match = normalized ? DATE_PATTERN.exec(normalized) : null;
  if (!match) return null;
  const parsed = new Date(Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3])));
  return parsed.getUTCFullYear() === Number(match[1])
    && parsed.getUTCMonth() === Number(match[2]) - 1
    && parsed.getUTCDate() === Number(match[3])
    ? normalized
    : null;
}

function dateOnly(value) {
  if (!value) return null;
  if (typeof value === 'string') return value.slice(0, 10);
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? null : parsed.toISOString().slice(0, 10);
}

function decimalToScaled6(value) {
  const normalized = typeof value === 'string' || typeof value === 'number' ? String(value).trim() : '';
  const match = DECIMAL_PATTERN.exec(normalized);
  if (!match) return null;
  const scaled = BigInt(match[1]) * SCALE_6 + BigInt((match[2] ?? '').padEnd(6, '0'));
  return scaled > 0n ? scaled : null;
}

function databaseDecimalToScaled6(value) {
  const normalized = String(value ?? '').trim();
  const match = /^(0|[1-9]\d*)(?:\.(\d{1,6}))?$/.exec(normalized);
  if (!match) return null;
  return BigInt(match[1]) * SCALE_6 + BigInt((match[2] ?? '').padEnd(6, '0'));
}

function scaledToDecimal(value, scale, digits) {
  const integer = value / scale;
  const fraction = (value % scale).toString().padStart(digits, '0').replace(/0+$/, '');
  return fraction ? `${integer}.${fraction}` : integer.toString();
}

function normalizeRevision(value) {
  const normalized = String(value ?? '').trim();
  return REVISION_PATTERN.test(normalized) ? normalized : null;
}

function warehouseScopeIds(requestContext) {
  return Array.isArray(requestContext?.scopes?.warehouseIds)
    ? [...new Set(requestContext.scopes.warehouseIds.filter(isUuid).map((value) => value.trim()))]
    : [];
}

function warehousesAllowed(requestContext, warehouseIds) {
  const allowed = new Set(warehouseScopeIds(requestContext));
  return warehouseIds.every((id) => allowed.has(id));
}

function mapLine(line) {
  return Object.freeze({
    id: line.id,
    lineNumber: Number(line.line_number),
    sourceLocationId: line.source_location_id ?? null,
    sourceVariantId: line.source_variant_id,
    sourceSku: line.source_sku,
    itemName: line.item_name,
    sourceUnitId: line.source_unit_id,
    sourceUnitCode: line.source_unit_code,
    sourceQuantity: String(line.source_quantity),
    conversionToBase: String(line.conversion_to_base),
    baseVariantId: line.base_variant_id,
    baseSku: line.base_sku,
    baseQuantity: String(line.base_quantity),
    lotId: line.lot_id ?? null,
    lotCode: line.lot_code ?? null,
    expiryDate: dateOnly(line.expiry_date),
    note: line.note ?? null,
  });
}

function mapTransfer(transfer) {
  return Object.freeze({
    id: transfer.id,
    documentNumber: transfer.document_number ?? null,
    transferDate: dateOnly(transfer.transfer_date),
    sourceWarehouseId: transfer.source_warehouse_id,
    sourceWarehouseCode: transfer.source_warehouse_code,
    sourceWarehouseName: transfer.source_warehouse_name,
    destinationWarehouseId: transfer.destination_warehouse_id,
    destinationWarehouseCode: transfer.destination_warehouse_code,
    destinationWarehouseName: transfer.destination_warehouse_name,
    status: transfer.status,
    note: transfer.note ?? null,
    revision: String(transfer.revision),
    inventoryMovementId: transfer.inventory_movement_id ?? null,
    approvedAt: transfer.approved_at ?? null,
    approvedBy: transfer.approved_by ?? null,
    dispatchedAt: transfer.dispatched_at ?? null,
    dispatchedBy: transfer.dispatched_by ?? null,
    cancelledAt: transfer.cancelled_at ?? null,
    cancelledBy: transfer.cancelled_by ?? null,
    cancellationReason: transfer.cancellation_reason ?? null,
    lineCount: Number(transfer.line_count ?? transfer.lines?.length ?? 0),
    baseQuantityTotal: String(transfer.base_quantity_total ?? '0'),
    createdAt: transfer.created_at,
    updatedAt: transfer.updated_at,
    createdBy: transfer.created_by,
    updatedBy: transfer.updated_by,
    lines: Array.isArray(transfer.lines) ? Object.freeze(transfer.lines.map(mapLine)) : undefined,
  });
}

function mapInTransit(row) {
  return Object.freeze({
    transferId: row.transfer_id,
    documentNumber: row.document_number,
    transferDate: dateOnly(row.transfer_date),
    dispatchedAt: row.dispatched_at,
    sourceWarehouseId: row.source_warehouse_id,
    sourceWarehouseCode: row.source_warehouse_code,
    sourceWarehouseName: row.source_warehouse_name,
    destinationWarehouseId: row.destination_warehouse_id,
    destinationWarehouseCode: row.destination_warehouse_code,
    destinationWarehouseName: row.destination_warehouse_name,
    transferLineId: row.transfer_line_id,
    lineNumber: Number(row.line_number),
    sourceVariantId: row.source_variant_id,
    sourceSku: row.source_sku,
    itemName: row.item_name,
    sourceUnitCode: row.source_unit_code,
    sourceQuantity: String(row.source_quantity),
    baseVariantId: row.base_variant_id,
    baseSku: row.base_sku,
    baseQuantity: String(row.base_quantity),
    lotId: row.lot_id ?? null,
    lotCode: row.lot_code ?? null,
    expiryDate: dateOnly(row.expiry_date),
    inventoryMovementId: row.inventory_movement_id,
  });
}

function normalizeLineInput(line, index) {
  if (!line || typeof line !== 'object' || Array.isArray(line)) {
    return failure('INVALID_TRANSFER_LINE', `Line ${index + 1} is invalid`);
  }
  const sourceVariantId = text(line.sourceVariantId ?? line.source_variant_id, 64);
  if (!isUuid(sourceVariantId)) return failure('INVALID_SOURCE_VARIANT_ID', `Line ${index + 1} sourceVariantId is invalid`);
  const sourceQuantityScaled = decimalToScaled6(line.sourceQuantity ?? line.source_quantity);
  if (sourceQuantityScaled === null) return failure('INVALID_SOURCE_QUANTITY', `Line ${index + 1} sourceQuantity must be a positive decimal with at most 6 fractional digits`);
  const sourceLocationId = text(line.sourceLocationId ?? line.source_location_id, 64);
  if (sourceLocationId && !isUuid(sourceLocationId)) return failure('INVALID_SOURCE_LOCATION_ID', `Line ${index + 1} sourceLocationId is invalid`);
  const lotId = text(line.lotId ?? line.lot_id, 64);
  if (lotId && !isUuid(lotId)) return failure('INVALID_LOT_ID', `Line ${index + 1} lotId is invalid`);
  const note = text(line.note, 2000);
  if (line.note && note === null) return failure('INVALID_LINE_NOTE', `Line ${index + 1} note must not exceed 2000 characters`);
  return Object.freeze({
    ok: true,
    value: Object.freeze({ sourceVariantId, sourceQuantityScaled, sourceLocationId, lotId, note }),
  });
}

async function validateDraftPayload(client, { requestContext, payload }) {
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
    return failure('INVALID_INPUT', 'Transfer data is required');
  }
  const transferDate = normalizeDate(payload.transferDate ?? payload.transfer_date);
  if (!transferDate) return failure('INVALID_TRANSFER_DATE', 'transferDate must be a valid YYYY-MM-DD date');
  const sourceWarehouseId = text(payload.sourceWarehouseId ?? payload.source_warehouse_id, 64);
  const destinationWarehouseId = text(payload.destinationWarehouseId ?? payload.destination_warehouse_id, 64);
  if (!isUuid(sourceWarehouseId)) return failure('INVALID_SOURCE_WAREHOUSE_ID', 'sourceWarehouseId is invalid');
  if (!isUuid(destinationWarehouseId)) return failure('INVALID_DESTINATION_WAREHOUSE_ID', 'destinationWarehouseId is invalid');
  if (sourceWarehouseId === destinationWarehouseId) return failure('TRANSFER_WAREHOUSES_MUST_DIFFER', 'Source and destination warehouses must differ');
  if (!warehousesAllowed(requestContext, [sourceWarehouseId, destinationWarehouseId])) {
    return failure('WAREHOUSE_SCOPE_DENIED', 'Both source and destination warehouses must be inside the authorized scope');
  }
  const note = text(payload.note, 4000);
  if (payload.note && note === null) return failure('INVALID_NOTE', 'Note must not exceed 4000 characters');
  if (!Array.isArray(payload.lines) || payload.lines.length < 1 || payload.lines.length > 500) {
    return failure('INVALID_TRANSFER_LINES', 'Transfer must contain between 1 and 500 lines');
  }
  const normalizedLines = [];
  for (let index = 0; index < payload.lines.length; index += 1) {
    const normalized = normalizeLineInput(payload.lines[index], index);
    if (!normalized.ok) return normalized;
    normalizedLines.push(normalized.value);
  }

  const warehouses = await repository.loadTransferWarehouses(client, {
    installationId: requestContext.installationId,
    warehouseIds: [sourceWarehouseId, destinationWarehouseId],
  });
  if (warehouses.length !== 2 || warehouses.some((warehouse) => !warehouse.is_active)) {
    return failure('WAREHOUSE_NOT_FOUND', 'Both warehouses must exist and be active');
  }
  if (warehouses.some((warehouse) => ['vehicle', 'transit'].includes(warehouse.warehouse_type))) {
    return failure('TRANSFER_WAREHOUSE_TYPE_NOT_ALLOWED', 'Vehicle and transit warehouses are not enabled for Phase 7.1');
  }

  const variantIds = [...new Set(normalizedLines.map((line) => line.sourceVariantId))];
  const locationIds = [...new Set(normalizedLines.map((line) => line.sourceLocationId).filter(Boolean))];
  const lotIds = [...new Set(normalizedLines.map((line) => line.lotId).filter(Boolean))];
  const [variants, locations, lots] = await Promise.all([
    repository.loadTransferVariants(client, { installationId: requestContext.installationId, variantIds }),
    repository.loadTransferLocations(client, { installationId: requestContext.installationId, locationIds }),
    repository.loadTransferLots(client, { installationId: requestContext.installationId, lotIds }),
  ]);
  const variantById = new Map(variants.map((variant) => [variant.id, variant]));
  const locationById = new Map(locations.map((location) => [location.id, location]));
  const lotById = new Map(lots.map((lot) => [lot.id, lot]));

  const hydratedLines = [];
  for (let index = 0; index < normalizedLines.length; index += 1) {
    const input = normalizedLines[index];
    const variant = variantById.get(input.sourceVariantId);
    if (!variant || !variant.is_active || !variant.unit_is_active || !variant.unit_id || variant.conversion_to_base === null) {
      return failure('TRANSFER_VARIANT_NOT_AVAILABLE', `Line ${index + 1} variant/unit/conversion is not available`);
    }
    if (!variant.allows_fractional && input.sourceQuantityScaled % SCALE_6 !== 0n) {
      return failure('FRACTIONAL_QUANTITY_NOT_ALLOWED', `Line ${index + 1} unit does not allow fractional quantity`);
    }
    if (input.sourceLocationId) {
      const location = locationById.get(input.sourceLocationId);
      if (!location || !location.is_active || location.warehouse_id !== sourceWarehouseId) {
        return failure('SOURCE_LOCATION_MISMATCH', `Line ${index + 1} source location is not active in the source warehouse`);
      }
    }
    const conversionScaled = databaseDecimalToScaled6(variant.conversion_to_base);
    if (conversionScaled === null || conversionScaled <= 0n) {
      return failure('INVALID_VARIANT_CONVERSION', `Line ${index + 1} conversion is invalid`);
    }
    const baseQuantityScaled = input.sourceQuantityScaled * conversionScaled;
    const lot = input.lotId ? lotById.get(input.lotId) : null;
    if (input.lotId && (!lot || lot.base_variant_id !== variant.base_variant_id)) {
      return failure('LOT_VARIANT_MISMATCH', `Line ${index + 1} lot does not belong to the inventory base variant`);
    }
    hydratedLines.push(Object.freeze({
      id: randomUUID(),
      lineNumber: index + 1,
      sourceLocationId: input.sourceLocationId,
      sourceVariantId: variant.id,
      sourceSku: variant.sku,
      itemName: variant.name,
      sourceUnitId: variant.unit_id,
      sourceUnitCode: variant.unit_code,
      sourceQuantity: scaledToDecimal(input.sourceQuantityScaled, SCALE_6, 6),
      conversionToBase: scaledToDecimal(conversionScaled, SCALE_6, 6),
      baseVariantId: variant.base_variant_id,
      baseSku: variant.base_sku,
      baseQuantity: scaledToDecimal(baseQuantityScaled, SCALE_12, 12),
      lotId: lot?.id ?? null,
      lotCode: lot?.lot_code ?? null,
      expiryDate: dateOnly(lot?.expiry_date),
      note: input.note,
    }));
  }

  return Object.freeze({
    ok: true,
    value: Object.freeze({ transferDate, sourceWarehouseId, destinationWarehouseId, note, lines: Object.freeze(hydratedLines) }),
  });
}

async function ensureTransferSeries(client, { installationId, actorId }) {
  let series = await documentNumberRepository.getDocumentNumberSeriesByCode(client, {
    installationId,
    code: TRANSFER_SERIES_CODE,
  });
  if (series) return series;
  series = await documentNumberRepository.insertDocumentNumberSeries(client, {
    installationId,
    code: TRANSFER_SERIES_CODE,
    documentType: 'INVENTORY_TRANSFER',
    name: 'Phieu chuyen kho',
    prefix: 'TR-',
    numberTemplate: '{PREFIX}{YYYY}{MM}-{SEQ}',
    resetPolicy: 'MONTHLY',
    sequenceWidth: 6,
    startCounter: '1',
    timezoneName: 'Asia/Ho_Chi_Minh',
    description: 'Series mac dinh cho phieu chuyen kho noi bo.',
    isActive: true,
    createdBy: actorId,
  });
  return series ?? documentNumberRepository.getDocumentNumberSeriesByCode(client, {
    installationId,
    code: TRANSFER_SERIES_CODE,
  });
}

export async function listInventoryTransfers(client, input) {
  const warehouseIds = warehouseScopeIds(input.requestContext);
  if (warehouseIds.length === 0) return failure('WAREHOUSE_SCOPE_DENIED', 'At least one authorized warehouse is required');
  const status = input.status ? String(input.status).trim().toLowerCase() : null;
  if (status && !STATUSES.has(status)) return failure('INVALID_STATUS', 'Transfer status is invalid');
  const search = input.search ? text(input.search, 256) : null;
  if (input.search && search === null) return failure('INVALID_SEARCH', 'Search must not exceed 256 characters');
  const transfers = await repository.listInventoryTransfers(client, {
    installationId: input.requestContext.installationId,
    warehouseIds,
    status,
    search,
    limit: input.limit,
    offset: input.offset,
  });
  return Object.freeze({ ok: true, transfers: Object.freeze(transfers.map(mapTransfer)) });
}

export async function listInventoryTransferInTransit(client, input) {
  const warehouseIds = warehouseScopeIds(input.requestContext);
  if (warehouseIds.length === 0) return failure('WAREHOUSE_SCOPE_DENIED', 'At least one authorized warehouse is required');
  const rows = await repository.listInventoryTransferInTransit(client, {
    installationId: input.requestContext.installationId,
    warehouseIds,
    limit: input.limit,
    offset: input.offset,
  });
  return Object.freeze({ ok: true, inTransit: Object.freeze(rows.map(mapInTransit)) });
}

export async function getInventoryTransfer(client, { requestContext, id, forUpdate = false }) {
  if (!isUuid(id)) return failure('INVENTORY_TRANSFER_NOT_FOUND', 'Transfer was not found');
  const transfer = await repository.getInventoryTransferById(client, {
    installationId: requestContext.installationId,
    id: id.trim(),
    warehouseIds: warehouseScopeIds(requestContext),
    forUpdate,
  });
  return transfer
    ? Object.freeze({ ok: true, transfer: mapTransfer(transfer), raw: transfer })
    : failure('INVENTORY_TRANSFER_NOT_FOUND', 'Transfer was not found');
}

export async function createInventoryTransfer(client, { requestContext, payload }) {
  const validation = await validateDraftPayload(client, { requestContext, payload });
  if (!validation.ok) return validation;
  const created = await repository.insertInventoryTransferDraft(client, {
    id: randomUUID(),
    installationId: requestContext.installationId,
    actorId: requestContext.actorId,
    ...validation.value,
  });
  return Object.freeze({ ok: true, transfer: mapTransfer(created) });
}

export async function updateInventoryTransfer(client, { requestContext, id, payload }) {
  const current = await getInventoryTransfer(client, { requestContext, id, forUpdate: true });
  if (!current.ok) return current;
  if (current.raw.status !== 'draft') return failure('INVENTORY_TRANSFER_LOCKED', 'Only draft transfers can be edited');
  const expectedRevision = normalizeRevision(payload?.expectedRevision);
  if (!expectedRevision) return failure('EXPECTED_REVISION_REQUIRED', 'expectedRevision is required');
  if (String(current.raw.revision) !== expectedRevision) return failure('CONFLICT', 'Transfer was changed by another request', true);
  const validation = await validateDraftPayload(client, { requestContext, payload });
  if (!validation.ok) return validation;
  const updated = await repository.updateInventoryTransferDraft(client, {
    installationId: requestContext.installationId,
    id: current.raw.id,
    actorId: requestContext.actorId,
    expectedRevision,
    ...validation.value,
  });
  if (!updated) return failure('CONFLICT', 'Transfer was changed by another request', true);
  return Object.freeze({ ok: true, transfer: mapTransfer(updated), beforeData: current.transfer });
}

export async function approveInventoryTransfer(client, { requestContext, id, payload, idempotencyKey }) {
  const current = await getInventoryTransfer(client, { requestContext, id, forUpdate: true });
  if (!current.ok) return current;
  if (current.raw.status !== 'draft') return failure('INVALID_STATUS_TRANSITION', 'Only draft transfers can be approved');
  const expectedRevision = normalizeRevision(payload?.expectedRevision);
  if (!expectedRevision) return failure('EXPECTED_REVISION_REQUIRED', 'expectedRevision is required');
  if (String(current.raw.revision) !== expectedRevision) return failure('CONFLICT', 'Transfer was changed by another request', true);
  const series = await ensureTransferSeries(client, {
    installationId: requestContext.installationId,
    actorId: requestContext.actorId,
  });
  if (!series) return failure('DOCUMENT_NUMBER_SERIES_UNAVAILABLE', 'Transfer number series is unavailable', true);
  const allocation = await allocateDocumentNumber(client, {
    installationId: requestContext.installationId,
    seriesId: series.id,
    idempotencyKey,
    payload: {
      documentDate: dateOnly(current.raw.transfer_date),
      metadata: { inventoryTransferId: current.raw.id },
    },
    actorId: requestContext.actorId,
    requestId: requestContext.requestId,
    sourceApp: requestContext.sourceApp,
  });
  if (!allocation.ok) return allocation;
  const changed = await repository.approveInventoryTransfer(client, {
    installationId: requestContext.installationId,
    id: current.raw.id,
    expectedRevision,
    documentNumber: allocation.allocation.document_number,
    documentNumberAllocationId: allocation.allocation.id,
    actorId: requestContext.actorId,
  });
  if (!changed) return failure('CONFLICT', 'Transfer was changed by another request', true);
  const updated = await getInventoryTransfer(client, { requestContext, id });
  return Object.freeze({ ok: true, transfer: updated.transfer, beforeData: current.transfer });
}

export async function cancelInventoryTransfer(client, { requestContext, id, payload }) {
  const current = await getInventoryTransfer(client, { requestContext, id, forUpdate: true });
  if (!current.ok) return current;
  if (!['draft', 'approved'].includes(current.raw.status)) {
    return failure('INVALID_STATUS_TRANSITION', 'Only draft or approved transfers can be cancelled');
  }
  const expectedRevision = normalizeRevision(payload?.expectedRevision);
  if (!expectedRevision) return failure('EXPECTED_REVISION_REQUIRED', 'expectedRevision is required');
  if (String(current.raw.revision) !== expectedRevision) return failure('CONFLICT', 'Transfer was changed by another request', true);
  const reason = text(payload?.reason ?? payload?.cancellationReason, 2000);
  if (!reason) return failure('CANCELLATION_REASON_REQUIRED', 'Cancellation reason is required');
  const changed = await repository.cancelInventoryTransfer(client, {
    installationId: requestContext.installationId,
    id: current.raw.id,
    expectedRevision,
    reason,
    actorId: requestContext.actorId,
  });
  if (!changed) return failure('CONFLICT', 'Transfer was changed by another request', true);
  const updated = await getInventoryTransfer(client, { requestContext, id });
  return Object.freeze({ ok: true, transfer: updated.transfer, beforeData: current.transfer });
}

export async function dispatchInventoryTransfer(client, { requestContext, id, payload, idempotencyKey }) {
  const current = await getInventoryTransfer(client, { requestContext, id, forUpdate: true });
  if (!current.ok) return current;
  if (current.raw.status !== 'approved') return failure('INVALID_STATUS_TRANSITION', 'Only approved transfers can be dispatched');
  const expectedRevision = normalizeRevision(payload?.expectedRevision);
  if (!expectedRevision) return failure('EXPECTED_REVISION_REQUIRED', 'expectedRevision is required');
  if (String(current.raw.revision) !== expectedRevision) return failure('CONFLICT', 'Transfer was changed by another request', true);
  if (!current.raw.document_number) return failure('TRANSFER_NUMBER_REQUIRED', 'Approved transfer number is missing');

  const movement = await postInventoryMovement(client, {
    requestContext,
    idempotencyKey,
    payload: {
      movementType: 'TRANSFER_ISSUE',
      sourceDomain: 'INVENTORY',
      sourceDocumentType: 'INVENTORY_TRANSFER',
      sourceDocumentId: current.raw.id,
      sourceDocumentNumber: current.raw.document_number,
      documentDate: dateOnly(current.raw.transfer_date),
      reasonCode: 'TRANSFER_DISPATCH',
      reasonNote: current.raw.note ?? 'Warehouse transfer dispatched',
      metadata: {
        inventoryTransferId: current.raw.id,
        destinationWarehouseId: current.raw.destination_warehouse_id,
      },
      lines: current.raw.lines.map((line) => ({
        warehouseId: current.raw.source_warehouse_id,
        locationId: line.source_location_id,
        sourceVariantId: line.source_variant_id,
        direction: 'OUT',
        sourceQuantity: String(line.source_quantity),
        sourceLineReference: `TRANSFER-LINE-${line.line_number}`,
        lotId: line.lot_id,
        metadata: {
          inventoryTransferId: current.raw.id,
          inventoryTransferLineId: line.id,
          destinationWarehouseId: current.raw.destination_warehouse_id,
        },
      })),
    },
  });
  if (!movement.ok) return movement;

  const changed = await repository.dispatchInventoryTransfer(client, {
    installationId: requestContext.installationId,
    id: current.raw.id,
    expectedRevision,
    inventoryMovementId: movement.movement.id,
    actorId: requestContext.actorId,
  });
  if (!changed) return failure('CONFLICT', 'Transfer was changed by another request', true);
  const updated = await getInventoryTransfer(client, { requestContext, id });
  return Object.freeze({ ok: true, transfer: updated.transfer, beforeData: current.transfer });
}
