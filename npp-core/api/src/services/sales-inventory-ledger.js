import { createHash, randomUUID } from 'node:crypto';
import * as inventoryRepository from '../db/repositories/inventory-ledger.js';

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const IDEMPOTENCY_PATTERN = /^[A-Za-z0-9._:-]{1,128}$/;
const QUANTITY_PATTERN = /^(0|[1-9]\d{0,17})(?:\.(\d{1,12}))?$/;
const CODE_PATTERN = /^[A-Z0-9_.-]{1,64}$/;
const SCALE = 1_000_000_000_000n;
const DOMAIN_MOVEMENT_RULES = new Map([
  ['SALES_DELIVERY_ISSUE', Object.freeze({ sourceDomain: 'SALES', direction: 'OUT' })],
  ['SALES_CUSTOMER_RETURN', Object.freeze({ sourceDomain: 'SALES', direction: 'IN' })],
  ['LOGISTICS_TRIP_RETURN', Object.freeze({ sourceDomain: 'LOGISTICS', direction: 'IN' })],
]);

function failure(code, message, retryable = false, details = {}) {
  return Object.freeze({ ok: false, code, message, retryable, details });
}

function canonicalize(value) {
  if (typeof value === 'bigint') return value.toString();
  if (Array.isArray(value)) return value.map(canonicalize);
  if (value === null || typeof value !== 'object') return value;
  return Object.fromEntries(Object.keys(value).sort().map((key) => [key, canonicalize(value[key])]));
}

function payloadHash(value) {
  return createHash('sha256').update(JSON.stringify(canonicalize(value))).digest('hex');
}

function parseQuantity(value) {
  const normalized = String(value ?? '').trim();
  const match = QUANTITY_PATTERN.exec(normalized);
  if (!match) return null;
  return BigInt(match[1]) * SCALE + BigInt((match[2] ?? '').padEnd(12, '0'));
}

function formatQuantity(value) {
  const negative = value < 0n;
  const absolute = negative ? -value : value;
  const whole = absolute / SCALE;
  const fraction = String(absolute % SCALE).padStart(12, '0');
  return `${negative ? '-' : ''}${whole}.${fraction}`;
}

function normalizeDate(value) {
  if (value === null || value === undefined || value === '') return null;
  if (typeof value === 'string') {
    const normalized = value.trim();
    if (/^\d{4}-\d{2}-\d{2}$/.test(normalized)) return normalized;
  }
  const parsed = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(parsed.getTime())) return null;
  return parsed.toISOString().slice(0, 10);
}

function warehouseIds(requestContext) {
  return Array.isArray(requestContext?.scopes?.warehouseIds)
    ? new Set(requestContext.scopes.warehouseIds.filter((id) => UUID_PATTERN.test(id)))
    : new Set();
}

function normalizePayload(payload) {
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
    return failure('INVALID_INVENTORY_MOVEMENT', 'Server-owned domain movement payload is required');
  }
  const movementType = String(payload.movementType ?? '').trim().toUpperCase();
  const rule = DOMAIN_MOVEMENT_RULES.get(movementType);
  if (!rule) return failure('DOMAIN_MOVEMENT_TYPE_NOT_ALLOWED', 'Server-owned domain movement type is not allowed');
  const direction = String(payload.direction ?? '').trim().toUpperCase();
  const sourceDomain = String(payload.sourceDomain ?? rule.sourceDomain).trim().toUpperCase();
  const sourceDocumentType = String(payload.sourceDocumentType ?? '').trim().toUpperCase();
  const sourceDocumentId = String(payload.sourceDocumentId ?? '').trim();
  const sourceDocumentNumber = String(payload.sourceDocumentNumber ?? '').trim();
  const documentDate = String(payload.documentDate ?? '').trim();
  const reasonCode = String(payload.reasonCode ?? movementType).trim().toUpperCase();
  const reasonNote = String(payload.reasonNote ?? '').trim();
  if (direction !== rule.direction || sourceDomain !== rule.sourceDomain) {
    return failure('INVALID_DIRECTION', 'Domain movement direction or owner is invalid');
  }
  if (!CODE_PATTERN.test(sourceDomain)
    || !CODE_PATTERN.test(sourceDocumentType)
    || !UUID_PATTERN.test(sourceDocumentId)) {
    return failure('INVALID_SOURCE_DOCUMENT', 'Domain movement source document is invalid');
  }
  if (!sourceDocumentNumber || sourceDocumentNumber.length > 160) {
    return failure('INVALID_SOURCE_DOCUMENT_NUMBER', 'Domain movement source document number is invalid');
  }
  if (!/^\d{4}-\d{2}-\d{2}$/.test(documentDate)) {
    return failure('INVALID_DOCUMENT_DATE', 'documentDate must use YYYY-MM-DD');
  }
  if (!CODE_PATTERN.test(reasonCode) || !reasonNote || reasonNote.length > 2000) {
    return failure('INVALID_MOVEMENT_REASON', 'Domain movement reason is invalid');
  }
  if (!Array.isArray(payload.lines) || payload.lines.length < 1 || payload.lines.length > 10000) {
    return failure('INVALID_MOVEMENT_LINES', 'Domain movement requires 1-10000 lines');
  }
  const lines = [];
  const lineIds = new Set();
  for (let index = 0; index < payload.lines.length; index += 1) {
    const line = payload.lines[index];
    const sourceLineId = String(line?.sourceLineId ?? '').trim();
    const quantity = parseQuantity(line?.quantity);
    if (!UUID_PATTERN.test(sourceLineId) || lineIds.has(sourceLineId)) {
      return failure('INVALID_SOURCE_LINE', 'Domain movement source line is invalid or duplicated', false, { line: index + 1 });
    }
    if (quantity === null || quantity <= 0n) {
      return failure('INVALID_QUANTITY', 'Domain movement quantity must be a positive exact decimal', false, { line: index + 1 });
    }
    const identities = [line.warehouseId, line.baseVariantId, line.baseUnitId];
    if (identities.some((id) => !UUID_PATTERN.test(String(id ?? '')))
      || (line.locationId && !UUID_PATTERN.test(line.locationId))
      || (line.lotId && !UUID_PATTERN.test(line.lotId))) {
      return failure('INVALID_LINE_IDENTITY', 'Domain movement line identity is invalid', false, { line: index + 1 });
    }
    const baseSku = String(line.baseSku ?? '').trim().toUpperCase();
    const baseUnitCode = String(line.baseUnitCode ?? '').trim().toUpperCase();
    if (!baseSku || baseSku.length > 96 || !baseUnitCode || baseUnitCode.length > 32) {
      return failure('INVALID_LINE_SNAPSHOT', 'Domain movement line snapshot is invalid', false, { line: index + 1 });
    }
    const expiryDate = normalizeDate(line.expiryDate);
    if (line.expiryDate && !expiryDate) {
      return failure('INVALID_EXPIRY_DATE', 'Domain movement expiry date is invalid', false, { line: index + 1 });
    }
    lineIds.add(sourceLineId);
    lines.push(Object.freeze({
      lineNumber: index + 1,
      sourceLineId,
      warehouseId: line.warehouseId,
      locationId: line.locationId ?? null,
      baseVariantId: line.baseVariantId,
      baseSku,
      baseUnitId: line.baseUnitId,
      baseUnitCode,
      lotId: line.lotId ?? null,
      lotCode: line.lotCode ?? null,
      expiryDate,
      quantity,
      metadata: line.metadata && typeof line.metadata === 'object' && !Array.isArray(line.metadata)
        ? line.metadata
        : {},
    }));
  }
  return Object.freeze({
    ok: true,
    value: Object.freeze({
      movementType,
      direction,
      sourceDomain,
      sourceDocumentType,
      sourceDocumentId,
      sourceDocumentNumber,
      documentDate,
      reasonCode,
      reasonNote,
      metadata: payload.metadata && typeof payload.metadata === 'object' && !Array.isArray(payload.metadata)
        ? payload.metadata
        : {},
      lines: Object.freeze(lines),
    }),
  });
}

async function replayOrMismatch(client, { requestContext, idempotencyKey, hash }) {
  const movement = await inventoryRepository.getMovementByIdempotencyKey(client, {
    installationId: requestContext.installationId,
    idempotencyKey,
  });
  if (!movement) return null;
  if (movement.payload_hash !== hash) {
    return failure('IDEMPOTENCY_PAYLOAD_MISMATCH', 'Inventory movement key was used with another payload');
  }
  const lines = await inventoryRepository.listMovementLines(client, {
    installationId: requestContext.installationId,
    movementId: movement.id,
  });
  const allowed = warehouseIds(requestContext);
  if (allowed.size === 0 || lines.some((line) => !allowed.has(line.warehouse_id))) {
    return failure('WAREHOUSE_SCOPE_DENIED', 'Inventory movement is outside the current warehouse scope');
  }
  return Object.freeze({ ok: true, movement, lines: Object.freeze(lines), replayed: true });
}

export async function postServerOwnedDomainMovement(client, {
  requestContext,
  idempotencyKey,
  payload,
}) {
  if (!IDEMPOTENCY_PATTERN.test(String(idempotencyKey ?? ''))) {
    return failure('INVALID_IDEMPOTENCY_KEY', 'Inventory movement idempotency key is invalid');
  }
  const normalized = normalizePayload(payload);
  if (!normalized.ok) return normalized;
  const canonicalPayload = {
    ...normalized.value,
    lines: normalized.value.lines.map((line) => ({
      ...line,
      quantity: formatQuantity(line.quantity),
    })),
  };
  const hash = payloadHash(canonicalPayload);
  await inventoryRepository.lockIdempotencyKey(client, {
    installationId: requestContext.installationId,
    idempotencyKey,
  });
  const replay = await replayOrMismatch(client, { requestContext, idempotencyKey, hash });
  if (replay) return replay;

  const allowedWarehouses = warehouseIds(requestContext);
  if (allowedWarehouses.size === 0
    || normalized.value.lines.some((line) => !allowedWarehouses.has(line.warehouseId))) {
    return failure('WAREHOUSE_SCOPE_DENIED', 'Domain movement is outside the current warehouse scope');
  }

  for (const line of normalized.value.lines) {
    await inventoryRepository.lockInventoryBalanceScope(client, {
      installationId: requestContext.installationId,
      warehouseId: line.warehouseId,
      locationId: line.locationId,
      baseVariantId: line.baseVariantId,
      lotId: line.lotId,
    });
  }

  const postedAt = requestContext.receivedAt ?? new Date().toISOString();
  const movement = await inventoryRepository.insertMovement(client, {
    id: randomUUID(),
    installationId: requestContext.installationId,
    movementType: normalized.value.movementType,
    sourceDomain: normalized.value.sourceDomain,
    sourceDocumentType: normalized.value.sourceDocumentType,
    sourceDocumentId: normalized.value.sourceDocumentId,
    sourceDocumentNumber: normalized.value.sourceDocumentNumber,
    documentDate: normalized.value.documentDate,
    postedAt,
    postedBy: requestContext.actorId,
    requestId: requestContext.requestId,
    sourceApp: requestContext.sourceApp,
    idempotencyKey,
    payloadHash: hash,
    reversalOfMovementId: null,
    documentNumber: null,
    reasonCode: normalized.value.reasonCode,
    reasonNote: normalized.value.reasonNote,
    metadata: normalized.value.metadata,
  });
  const lines = [];
  for (const line of normalized.value.lines) {
    const signedQuantity = normalized.value.direction === 'OUT' ? -line.quantity : line.quantity;
    lines.push(await inventoryRepository.insertMovementLine(client, {
      id: randomUUID(),
      installationId: requestContext.installationId,
      movementId: movement.id,
      lineNumber: line.lineNumber,
      warehouseId: line.warehouseId,
      locationId: line.locationId,
      sourceVariantId: line.baseVariantId,
      sourceSku: line.baseSku,
      sourceUnitId: line.baseUnitId,
      sourceUnitCode: line.baseUnitCode,
      sourceQuantity: formatQuantity(line.quantity),
      conversionToBase: '1.000000000000',
      baseVariantId: line.baseVariantId,
      baseSku: line.baseSku,
      direction: normalized.value.direction,
      baseQuantityDelta: formatQuantity(signedQuantity),
      lotId: line.lotId,
      lotCode: line.lotCode,
      expiryDate: line.expiryDate,
      sourceLineReference: line.sourceLineId,
      metadata: line.metadata,
    }));
  }
  return Object.freeze({ ok: true, movement, lines: Object.freeze(lines), replayed: false });
}

export async function postServerOwnedSalesMovement(client, args) {
  const payload = { ...(args.payload ?? {}), sourceDomain: 'SALES' };
  if (!['SALES_DELIVERY_ISSUE', 'SALES_CUSTOMER_RETURN'].includes(String(payload.movementType ?? '').toUpperCase())) {
    return failure('SALES_MOVEMENT_TYPE_NOT_ALLOWED', 'Sales movement type is not allowed');
  }
  return postServerOwnedDomainMovement(client, { ...args, payload });
}

export const salesInventoryLedgerInternals = Object.freeze({
  canonicalize,
  payloadHash,
  parseQuantity,
  formatQuantity,
  normalizeDate,
  normalizePayload,
});