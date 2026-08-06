import { createHash, randomUUID } from 'node:crypto';
import * as receiptRepository from '../db/repositories/inventory-transfer-receipt.js';
import * as ledgerRepository from '../db/repositories/inventory-ledger.js';
import { reverseInventoryMovement } from './inventory-ledger-core.js';
import { getInventoryTransfer } from './inventory-transfer.js';

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const DATE_PATTERN = /^(\d{4})-(\d{2})-(\d{2})$/;
const DECIMAL_PATTERN = /^(0|[1-9]\d{0,13})(?:\.(\d{1,6}))?$/;
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

function isUuid(value) {
  return typeof value === 'string' && UUID_PATTERN.test(value.trim());
}

function strictDate(value) {
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

function parseNonNegativeDecimal(value, field, { optional = true } = {}) {
  if ((value === undefined || value === null || value === '') && optional) {
    return Object.freeze({ ok: true, scaled: 0n, value: '0.000000' });
  }
  const normalized = typeof value === 'string' || typeof value === 'number' ? String(value).trim() : '';
  const match = DECIMAL_PATTERN.exec(normalized);
  if (!match) return failure('INVALID_QUANTITY', `${field} must be a non-negative decimal with at most 6 fractional digits`);
  const scaled = BigInt(match[1]) * SCALE_6 + BigInt((match[2] ?? '').padEnd(6, '0'));
  return Object.freeze({ ok: true, scaled, value: formatScaled(scaled, SCALE_6, 6) });
}

function parseDatabaseScaled6(value) {
  const parsed = parseNonNegativeDecimal(String(value ?? ''), 'database quantity', { optional: false });
  return parsed.ok ? parsed.scaled : null;
}

function formatScaled(value, scale, digits) {
  const integer = value / scale;
  const fraction = (value % scale).toString().padStart(digits, '0');
  return `${integer}.${fraction}`;
}

function canonicalize(value) {
  if (Array.isArray(value)) return value.map(canonicalize);
  if (value === null || typeof value !== 'object') return value;
  return Object.fromEntries(Object.keys(value).sort().map((key) => [key, canonicalize(value[key])]));
}

function payloadHash(value) {
  return createHash('sha256').update(JSON.stringify(canonicalize(value))).digest('hex');
}

function mapReceiptLine(line) {
  return Object.freeze({
    id: line.id,
    transferLineId: line.transfer_line_id,
    lineNumber: Number(line.line_number),
    destinationLocationId: line.destination_location_id ?? null,
    destinationLocationCode: line.destination_location_code ?? null,
    destinationLocationName: line.destination_location_name ?? null,
    sourceSku: line.source_sku,
    itemName: line.item_name,
    sourceUnitCode: line.source_unit_code,
    baseSku: line.base_sku,
    lotCode: line.lot_code ?? null,
    expiryDate: dateOnly(line.expiry_date),
    acceptedQuantity: String(line.accepted_source_quantity),
    damagedQuantity: String(line.damaged_source_quantity),
    overQuantity: String(line.over_source_quantity),
    acceptedBaseQuantity: String(line.accepted_base_quantity),
    damagedBaseQuantity: String(line.damaged_base_quantity),
    overBaseQuantity: String(line.over_base_quantity),
    note: line.note ?? null,
  });
}

function mapReceipt(receipt) {
  const lines = Array.isArray(receipt.lines) ? receipt.lines.map(mapReceiptLine) : [];
  return Object.freeze({
    id: receipt.id,
    transferId: receipt.transfer_id,
    receiptSequence: Number(receipt.receipt_sequence),
    receiptDate: dateOnly(receipt.receipt_date),
    inventoryMovementId: receipt.inventory_movement_id ?? null,
    note: receipt.note ?? null,
    createdAt: receipt.created_at,
    createdBy: receipt.created_by,
    damageApproval: receipt.damage_approval_id ? Object.freeze({
      id: receipt.damage_approval_id,
      note: receipt.damage_approval_note ?? null,
      approvedAt: receipt.damage_approved_at,
      approvedBy: receipt.damage_approved_by,
    }) : null,
    reversal: receipt.reversal_id ? Object.freeze({
      id: receipt.reversal_id,
      inventoryMovementId: receipt.reversal_movement_id ?? null,
      reason: receipt.reversal_reason,
      reversedAt: receipt.reversed_at,
      reversedBy: receipt.reversed_by,
    }) : null,
    lines: Object.freeze(lines),
  });
}

function mapResolutionLine(line) {
  return Object.freeze({
    transferLineId: line.id,
    lineNumber: Number(line.line_number),
    sourceSku: line.source_sku,
    itemName: line.item_name,
    sourceUnitCode: line.source_unit_code,
    lotCode: line.lot_code ?? null,
    expiryDate: dateOnly(line.expiry_date),
    dispatchedQuantity: String(line.source_quantity),
    acceptedQuantity: String(line.accepted_source_quantity),
    damagedQuantity: String(line.damaged_source_quantity),
    overQuantity: String(line.over_source_quantity),
    shortQuantity: String(line.short_source_quantity),
    remainingQuantity: String(line.remaining_source_quantity),
    dispatchedBaseQuantity: String(line.base_quantity),
    acceptedBaseQuantity: String(line.accepted_base_quantity),
    damagedBaseQuantity: String(line.damaged_base_quantity),
    overBaseQuantity: String(line.over_base_quantity),
    shortBaseQuantity: String(line.short_base_quantity),
    remainingBaseQuantity: String(line.remaining_base_quantity),
  });
}

async function loadScopedTransfer(client, { requestContext, transferId, forUpdate = true }) {
  const transfer = await getInventoryTransfer(client, {
    requestContext,
    id: transferId,
    forUpdate,
  });
  if (!transfer.ok) return transfer;
  if (transfer.raw.status !== 'dispatched') {
    return failure('TRANSFER_NOT_DISPATCHED', 'Only dispatched transfers can be received or resolved');
  }
  return transfer;
}

async function normalizeReceiptPayload(client, { requestContext, transfer, payload }) {
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
    return failure('INVALID_INPUT', 'Receipt data is required');
  }
  const receiptDate = strictDate(payload.receiptDate ?? payload.receipt_date);
  if (!receiptDate) return failure('INVALID_RECEIPT_DATE', 'receiptDate must be a valid YYYY-MM-DD date');
  const note = text(payload.note, 4000);
  if (payload.note && note === null) return failure('INVALID_NOTE', 'Receipt note must not exceed 4000 characters');
  if (!Array.isArray(payload.lines) || payload.lines.length < 1 || payload.lines.length > 500) {
    return failure('INVALID_RECEIPT_LINES', 'Receipt must contain between 1 and 500 lines');
  }

  const resolutionRows = await receiptRepository.getTransferResolutionRows(client, {
    installationId: requestContext.installationId,
    transferId: transfer.raw.id,
  });
  const resolutionById = new Map(resolutionRows.map((line) => [line.id, line]));
  const seen = new Set();
  const normalizedInputs = [];
  const locationIds = new Set();

  for (let index = 0; index < payload.lines.length; index += 1) {
    const input = payload.lines[index];
    if (!input || typeof input !== 'object' || Array.isArray(input)) {
      return failure('INVALID_RECEIPT_LINE', `Line ${index + 1} is invalid`);
    }
    const transferLineId = text(input.transferLineId ?? input.transfer_line_id, 64);
    if (!isUuid(transferLineId) || seen.has(transferLineId)) {
      return failure('INVALID_TRANSFER_LINE_ID', `Line ${index + 1} transferLineId is invalid or duplicated`);
    }
    seen.add(transferLineId);
    const source = resolutionById.get(transferLineId);
    if (!source) return failure('TRANSFER_LINE_NOT_FOUND', `Line ${index + 1} does not belong to this transfer`);

    const accepted = parseNonNegativeDecimal(input.acceptedQuantity ?? input.accepted_quantity, `lines[${index}].acceptedQuantity`);
    if (!accepted.ok) return accepted;
    const damaged = parseNonNegativeDecimal(input.damagedQuantity ?? input.damaged_quantity, `lines[${index}].damagedQuantity`);
    if (!damaged.ok) return damaged;
    const over = parseNonNegativeDecimal(input.overQuantity ?? input.over_quantity, `lines[${index}].overQuantity`);
    if (!over.ok) return over;
    if (accepted.scaled + damaged.scaled + over.scaled === 0n) {
      return failure('RECEIPT_LINE_QUANTITY_REQUIRED', `Line ${index + 1} must contain accepted, damaged or over quantity`);
    }
    const remaining = parseDatabaseScaled6(source.remaining_source_quantity);
    if (remaining === null || accepted.scaled + damaged.scaled > remaining) {
      return failure('RECEIPT_EXCEEDS_IN_TRANSIT', `Line ${index + 1} accepted plus damaged quantity exceeds remaining in-transit quantity`);
    }
    if (!source.location_required && source.location_required !== false) {
      return failure('TRACKING_POLICY_NOT_FOUND', `Line ${index + 1} inventory tracking policy was not found`);
    }

    const destinationLocationId = text(input.destinationLocationId ?? input.destination_location_id, 64);
    if (destinationLocationId && !isUuid(destinationLocationId)) {
      return failure('INVALID_DESTINATION_LOCATION_ID', `Line ${index + 1} destinationLocationId is invalid`);
    }
    if (accepted.scaled > 0n && source.location_required && !destinationLocationId) {
      return failure('DESTINATION_LOCATION_REQUIRED', `Line ${index + 1} destination location is required for accepted stock`);
    }
    if (destinationLocationId) locationIds.add(destinationLocationId);
    const lineNote = text(input.note, 2000);
    if (input.note && lineNote === null) return failure('INVALID_LINE_NOTE', `Line ${index + 1} note must not exceed 2000 characters`);

    normalizedInputs.push({
      source,
      transferLineId,
      destinationLocationId,
      accepted,
      damaged,
      over,
      note: lineNote,
    });
  }

  const locations = await receiptRepository.loadDestinationLocations(client, {
    installationId: requestContext.installationId,
    destinationWarehouseId: transfer.raw.destination_warehouse_id,
    locationIds: [...locationIds],
  });
  const locationById = new Map(locations.map((location) => [location.id, location]));
  for (let index = 0; index < normalizedInputs.length; index += 1) {
    const input = normalizedInputs[index];
    if (input.destinationLocationId) {
      const location = locationById.get(input.destinationLocationId);
      if (!location || !location.is_active) {
        return failure('DESTINATION_LOCATION_NOT_AVAILABLE', `Line ${index + 1} destination location is missing, inactive or belongs to another warehouse`);
      }
    }
  }

  const lines = normalizedInputs.map((input, index) => {
    const conversionScaled = parseDatabaseScaled6(input.source.conversion_to_base);
    if (conversionScaled === null || conversionScaled <= 0n) throw new Error('invalid_transfer_conversion');
    return Object.freeze({
      id: randomUUID(),
      lineNumber: index + 1,
      transferLineId: input.transferLineId,
      destinationLocationId: input.destinationLocationId,
      acceptedSourceQuantity: input.accepted.value,
      damagedSourceQuantity: input.damaged.value,
      overSourceQuantity: input.over.value,
      conversionToBase: formatScaled(conversionScaled, SCALE_6, 6),
      acceptedBaseQuantity: formatScaled(input.accepted.scaled * conversionScaled, SCALE_12, 12),
      damagedBaseQuantity: formatScaled(input.damaged.scaled * conversionScaled, SCALE_12, 12),
      overBaseQuantity: formatScaled(input.over.scaled * conversionScaled, SCALE_12, 12),
      note: input.note,
      source: input.source,
      acceptedScaled: input.accepted.scaled,
    });
  });

  return Object.freeze({
    ok: true,
    value: Object.freeze({ receiptDate, note, lines: Object.freeze(lines) }),
  });
}

async function postReceiptMovement(client, {
  requestContext,
  transfer,
  receiptId,
  receiptSequence,
  receiptDate,
  note,
  hash,
  lines,
}) {
  const accepted = lines.filter((line) => line.acceptedScaled > 0n);
  if (accepted.length === 0) return Object.freeze({ ok: true, movement: null, lines: Object.freeze([]) });
  const movementId = randomUUID();
  const movementKey = `transfer-receipt-${receiptId}`;
  await ledgerRepository.lockIdempotencyKey(client, {
    installationId: requestContext.installationId,
    idempotencyKey: movementKey,
  });
  const existing = await ledgerRepository.getMovementByIdempotencyKey(client, {
    installationId: requestContext.installationId,
    idempotencyKey: movementKey,
  });
  if (existing) {
    if (existing.payload_hash !== hash) return failure('IDEMPOTENCY_PAYLOAD_MISMATCH', 'Receipt movement payload does not match the existing movement');
    const existingLines = await ledgerRepository.listMovementLines(client, {
      installationId: requestContext.installationId,
      movementId: existing.id,
    });
    return Object.freeze({ ok: true, movement: existing, lines: Object.freeze(existingLines), replayed: true });
  }

  const movement = await ledgerRepository.insertMovement(client, {
    id: movementId,
    installationId: requestContext.installationId,
    movementType: 'TRANSFER_RECEIPT',
    sourceDomain: 'INVENTORY',
    sourceDocumentType: 'INVENTORY_TRANSFER_RECEIPT',
    sourceDocumentId: receiptId,
    sourceDocumentNumber: transfer.raw.document_number,
    documentDate: receiptDate,
    postedAt: requestContext.receivedAt ?? new Date().toISOString(),
    postedBy: requestContext.actorId,
    requestId: requestContext.requestId,
    sourceApp: requestContext.sourceApp,
    idempotencyKey: movementKey,
    payloadHash: hash,
    reversalOfMovementId: null,
    documentNumber: null,
    reasonCode: 'TRANSFER_RECEIPT',
    reasonNote: note ?? 'Warehouse transfer receipt',
    metadata: {
      inventoryTransferId: transfer.raw.id,
      inventoryTransferReceiptId: receiptId,
      receiptSequence,
      sourceWarehouseId: transfer.raw.source_warehouse_id,
      destinationWarehouseId: transfer.raw.destination_warehouse_id,
    },
  });

  const movementLines = [];
  for (let index = 0; index < accepted.length; index += 1) {
    const line = accepted[index];
    movementLines.push(await ledgerRepository.insertMovementLine(client, {
      id: randomUUID(),
      installationId: requestContext.installationId,
      movementId: movement.id,
      lineNumber: index + 1,
      warehouseId: transfer.raw.destination_warehouse_id,
      locationId: line.destinationLocationId,
      sourceVariantId: line.source.source_variant_id,
      sourceSku: line.source.source_sku,
      sourceUnitId: line.source.source_unit_id,
      sourceUnitCode: line.source.source_unit_code,
      sourceQuantity: line.acceptedSourceQuantity,
      conversionToBase: line.conversionToBase,
      baseVariantId: line.source.base_variant_id,
      baseSku: line.source.base_sku,
      direction: 'IN',
      baseQuantityDelta: line.acceptedBaseQuantity,
      lotId: line.source.lot_id,
      lotCode: line.source.lot_code,
      expiryDate: line.source.expiry_date,
      sourceLineReference: `TRANSFER-RECEIPT-${receiptSequence}-LINE-${line.source.line_number}`,
      metadata: {
        inventoryTransferId: transfer.raw.id,
        inventoryTransferLineId: line.transferLineId,
        inventoryTransferReceiptId: receiptId,
        sourceWarehouseId: transfer.raw.source_warehouse_id,
      },
    }));
  }
  return Object.freeze({ ok: true, movement, lines: Object.freeze(movementLines), replayed: false });
}

export async function listTransferReceipts(client, { requestContext, transferId }) {
  const transfer = await loadScopedTransfer(client, { requestContext, transferId, forUpdate: false });
  if (!transfer.ok) return transfer;
  const [receipts, resolutionRows, shortClosure] = await Promise.all([
    receiptRepository.listTransferReceipts(client, {
      installationId: requestContext.installationId,
      transferId: transfer.raw.id,
    }),
    receiptRepository.getTransferResolutionRows(client, {
      installationId: requestContext.installationId,
      transferId: transfer.raw.id,
    }),
    receiptRepository.getShortClosure(client, {
      installationId: requestContext.installationId,
      transferId: transfer.raw.id,
    }),
  ]);
  return Object.freeze({
    ok: true,
    transfer: transfer.transfer,
    receipts: Object.freeze(receipts.map(mapReceipt)),
    resolution: Object.freeze(resolutionRows.map(mapResolutionLine)),
    shortClosure: shortClosure ? Object.freeze({
      id: shortClosure.id,
      reason: shortClosure.reason,
      closedAt: shortClosure.closed_at,
      closedBy: shortClosure.closed_by,
    }) : null,
  });
}

export async function createTransferReceipt(client, {
  requestContext,
  transferId,
  payload,
  idempotencyKey,
}) {
  const transfer = await loadScopedTransfer(client, { requestContext, transferId, forUpdate: true });
  if (!transfer.ok) return transfer;
  const existing = await receiptRepository.getReceiptByIdempotencyKey(client, {
    installationId: requestContext.installationId,
    idempotencyKey,
  });
  const normalized = await normalizeReceiptPayload(client, { requestContext, transfer, payload });
  if (!normalized.ok) return normalized;
  const hash = payloadHash({ transferId: transfer.raw.id, ...normalized.value, lines: normalized.value.lines.map((line) => ({
    transferLineId: line.transferLineId,
    destinationLocationId: line.destinationLocationId,
    acceptedSourceQuantity: line.acceptedSourceQuantity,
    damagedSourceQuantity: line.damagedSourceQuantity,
    overSourceQuantity: line.overSourceQuantity,
    note: line.note,
  })) });
  if (existing) {
    if (existing.transfer_id !== transfer.raw.id || existing.payload_hash !== hash) {
      return failure('IDEMPOTENCY_PAYLOAD_MISMATCH', 'Idempotency key was already used with different receipt data');
    }
    const receipt = await receiptRepository.getTransferReceiptById(client, {
      installationId: requestContext.installationId,
      receiptId: existing.id,
      forUpdate: false,
    });
    return Object.freeze({ ok: true, receipt: mapReceipt(receipt), transfer: transfer.transfer, replayed: true });
  }
  if (await receiptRepository.getShortClosure(client, {
    installationId: requestContext.installationId,
    transferId: transfer.raw.id,
  })) return failure('TRANSFER_SHORT_CLOSED', 'This transfer was closed short and cannot receive more quantities');

  const receiptId = randomUUID();
  const receiptSequence = await receiptRepository.getNextReceiptSequence(client, {
    installationId: requestContext.installationId,
    transferId: transfer.raw.id,
  });
  const movement = await postReceiptMovement(client, {
    requestContext,
    transfer,
    receiptId,
    receiptSequence,
    receiptDate: normalized.value.receiptDate,
    note: normalized.value.note,
    hash,
    lines: normalized.value.lines,
  });
  if (!movement.ok) return movement;
  const receipt = await receiptRepository.insertTransferReceipt(client, {
    id: receiptId,
    installationId: requestContext.installationId,
    transferId: transfer.raw.id,
    receiptSequence,
    receiptDate: normalized.value.receiptDate,
    inventoryMovementId: movement.movement?.id ?? null,
    idempotencyKey,
    payloadHash: hash,
    note: normalized.value.note,
    actorId: requestContext.actorId,
    lines: normalized.value.lines,
  });
  return Object.freeze({ ok: true, receipt: mapReceipt(receipt), transfer: transfer.transfer, replayed: false });
}

export async function approveTransferReceiptDamage(client, {
  requestContext,
  transferId,
  receiptId,
  payload,
}) {
  const transfer = await loadScopedTransfer(client, { requestContext, transferId, forUpdate: true });
  if (!transfer.ok) return transfer;
  if (!isUuid(receiptId)) return failure('TRANSFER_RECEIPT_NOT_FOUND', 'Receipt was not found');
  const receipt = await receiptRepository.getTransferReceiptById(client, {
    installationId: requestContext.installationId,
    receiptId: receiptId.trim(),
    forUpdate: true,
  });
  if (!receipt || receipt.transfer_id !== transfer.raw.id) return failure('TRANSFER_RECEIPT_NOT_FOUND', 'Receipt was not found');
  if (receipt.reversal_id) return failure('TRANSFER_RECEIPT_REVERSED', 'A reversed receipt cannot have damage approved');
  const hasDamage = receipt.lines.some((line) => parseDatabaseScaled6(line.damaged_source_quantity) > 0n);
  if (!hasDamage) return failure('TRANSFER_RECEIPT_HAS_NO_DAMAGE', 'Receipt has no damaged quantity to approve');
  if (receipt.damage_approval_id) return Object.freeze({ ok: true, receipt: mapReceipt(receipt), transfer: transfer.transfer, replayed: true });
  const note = text(payload?.note ?? payload?.approvalNote, 2000);
  if ((payload?.note || payload?.approvalNote) && note === null) return failure('INVALID_APPROVAL_NOTE', 'Approval note must not exceed 2000 characters');
  const approved = await receiptRepository.insertDamageApproval(client, {
    id: randomUUID(),
    installationId: requestContext.installationId,
    receiptId: receipt.id,
    note,
    actorId: requestContext.actorId,
  });
  if (!approved) return failure('CONFLICT', 'Damage approval was recorded by another request', true);
  const updated = await receiptRepository.getTransferReceiptById(client, {
    installationId: requestContext.installationId,
    receiptId: receipt.id,
    forUpdate: false,
  });
  return Object.freeze({ ok: true, receipt: mapReceipt(updated), transfer: transfer.transfer, replayed: false });
}

export async function closeTransferShortage(client, {
  requestContext,
  transferId,
  payload,
}) {
  const transfer = await loadScopedTransfer(client, { requestContext, transferId, forUpdate: true });
  if (!transfer.ok) return transfer;
  const reason = text(payload?.reason, 2000);
  if (!reason) return failure('SHORT_CLOSURE_REASON_REQUIRED', 'A reason is required to close the remaining shortage');
  const existing = await receiptRepository.getShortClosure(client, {
    installationId: requestContext.installationId,
    transferId: transfer.raw.id,
  });
  if (existing) return failure('TRANSFER_SHORT_ALREADY_CLOSED', 'This transfer was already closed short');
  const rows = await receiptRepository.getTransferResolutionRows(client, {
    installationId: requestContext.installationId,
    transferId: transfer.raw.id,
  });
  const remaining = rows.filter((line) => parseDatabaseScaled6(line.remaining_source_quantity) > 0n);
  if (remaining.length === 0) return failure('TRANSFER_ALREADY_RESOLVED', 'This transfer has no remaining in-transit quantity');
  const lines = remaining.map((line) => Object.freeze({
    id: randomUUID(),
    transferLineId: line.id,
    shortSourceQuantity: String(line.remaining_source_quantity),
    conversionToBase: String(line.conversion_to_base),
    shortBaseQuantity: String(line.remaining_base_quantity),
  }));
  const closure = await receiptRepository.insertShortClosure(client, {
    id: randomUUID(),
    installationId: requestContext.installationId,
    transferId: transfer.raw.id,
    reason,
    actorId: requestContext.actorId,
    lines,
  });
  const updatedRows = await receiptRepository.getTransferResolutionRows(client, {
    installationId: requestContext.installationId,
    transferId: transfer.raw.id,
  });
  return Object.freeze({
    ok: true,
    transfer: transfer.transfer,
    shortClosure: Object.freeze({
      id: closure.id,
      reason: closure.reason,
      closedAt: closure.closed_at,
      closedBy: closure.closed_by,
    }),
    resolution: Object.freeze(updatedRows.map(mapResolutionLine)),
  });
}

export async function reverseTransferReceipt(client, {
  requestContext,
  transferId,
  receiptId,
  payload,
  idempotencyKey,
}) {
  const transfer = await loadScopedTransfer(client, { requestContext, transferId, forUpdate: true });
  if (!transfer.ok) return transfer;
  if (!isUuid(receiptId)) return failure('TRANSFER_RECEIPT_NOT_FOUND', 'Receipt was not found');
  if (await receiptRepository.getShortClosure(client, {
    installationId: requestContext.installationId,
    transferId: transfer.raw.id,
  })) return failure('SHORT_CLOSURE_BLOCKS_RECEIPT_REVERSAL', 'Receipt cannot be reversed after the transfer was closed short; use a forward correction');
  const receipt = await receiptRepository.getTransferReceiptById(client, {
    installationId: requestContext.installationId,
    receiptId: receiptId.trim(),
    forUpdate: true,
  });
  if (!receipt || receipt.transfer_id !== transfer.raw.id) return failure('TRANSFER_RECEIPT_NOT_FOUND', 'Receipt was not found');
  if (receipt.reversal_id) return Object.freeze({ ok: true, receipt: mapReceipt(receipt), transfer: transfer.transfer, replayed: true });
  const reason = text(payload?.reason, 2000);
  if (!reason) return failure('RECEIPT_REVERSAL_REASON_REQUIRED', 'Receipt reversal reason is required');
  const documentDate = strictDate(payload?.documentDate ?? payload?.document_date);
  if (!documentDate) return failure('INVALID_DOCUMENT_DATE', 'documentDate must be a valid YYYY-MM-DD date');

  let reversalMovementId = null;
  if (receipt.inventory_movement_id) {
    if (await receiptRepository.hasDownstreamOutboundMovement(client, {
      installationId: requestContext.installationId,
      receiptMovementId: receipt.inventory_movement_id,
    })) return failure('RECEIPT_HAS_DOWNSTREAM_CONSUMPTION', 'Receipt cannot be reversed because stock in the same destination scope has later outbound consumption');
    const reversal = await reverseInventoryMovement(client, {
      requestContext,
      idempotencyKey: `transfer-receipt-reversal-${receipt.id}`,
      movementId: receipt.inventory_movement_id,
      payload: {
        documentDate,
        reasonCode: 'TRANSFER_RECEIPT_REVERSAL',
        reasonNote: reason,
      },
    });
    if (!reversal.ok) return reversal;
    reversalMovementId = reversal.movement.id;
  }
  await receiptRepository.insertReceiptReversal(client, {
    id: randomUUID(),
    installationId: requestContext.installationId,
    receiptId: receipt.id,
    reversalMovementId,
    reason,
    actorId: requestContext.actorId,
  });
  const updated = await receiptRepository.getTransferReceiptById(client, {
    installationId: requestContext.installationId,
    receiptId: receipt.id,
    forUpdate: false,
  });
  return Object.freeze({ ok: true, receipt: mapReceipt(updated), transfer: transfer.transfer, replayed: false, idempotencyKey });
}

export const transferReceiptInternals = Object.freeze({
  parseNonNegativeDecimal,
  payloadHash,
  normalizeReceiptPayload,
});
