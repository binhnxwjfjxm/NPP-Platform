import { randomUUID } from 'node:crypto';
import {
  buildAuditRecord,
  buildOutboxEvent,
  insertAuditRecord,
  insertOutboxEvent,
  withAuditOutboxTransaction,
} from '../audit-outbox.js';
import { PERMISSIONS } from '../access/permissions.js';
import { inventoryLedgerInternals, postInventoryMovement } from './inventory-ledger.js';
import {
  getInventoryLot,
  inventoryLotInternals,
  listInventoryLots,
  resolveOrCreateInventoryLot,
} from './inventory-lots.js';
import * as lotRepository from '../db/repositories/inventory-lots.js';
import * as repository from '../db/repositories/opening-balance.js';

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const SOURCE_KEY_PATTERN = /^[A-Za-z0-9._:-]{1,128}$/;
const CHECKSUM_PATTERN = /^[0-9a-f]{64}$/;
const SCALE_6 = 1_000_000n;
const SCALE_12 = 1_000_000_000_000n;
const OPENING_BALANCE_MAX_ROWS = 1000;

function failure(code, message, retryable = false, details = {}) {
  return Object.freeze({ ok: false, code, message, retryable, details });
}

function hasPermission(requestContext, permission) {
  return Array.isArray(requestContext?.permissions)
    && requestContext.permissions.includes(permission);
}

function text(value, maxLength = 0) {
  if (value === undefined || value === null) return null;
  const normalized = String(value).trim();
  if (!normalized || (maxLength > 0 && normalized.length > maxLength)) return null;
  return normalized;
}

function strictDate(value) {
  const normalized = text(value, 10);
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(normalized ?? '');
  if (!match) return null;
  const parsed = new Date(Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3])));
  if (parsed.getUTCFullYear() !== Number(match[1])
    || parsed.getUTCMonth() !== Number(match[2]) - 1
    || parsed.getUTCDate() !== Number(match[3])) return null;
  return normalized;
}

function canonicalDate(value) {
  if (value === null || value === undefined || value === '') return null;
  if (value instanceof Date) {
    const year = String(value.getFullYear()).padStart(4, '0');
    const month = String(value.getMonth() + 1).padStart(2, '0');
    const day = String(value.getDate()).padStart(2, '0');
    return `${year}-${month}-${day}`;
  }
  return strictDate(value);
}

function objectValue(value, maxBytes = 16000) {
  if (value === undefined || value === null) return {};
  if (typeof value !== 'object' || Array.isArray(value)) return null;
  try {
    return JSON.stringify(value).length <= maxBytes ? value : null;
  } catch {
    return null;
  }
}

function canonicalize(value) {
  if (typeof value === 'bigint') return value.toString();
  if (Array.isArray(value)) return value.map(canonicalize);
  if (value === null || typeof value !== 'object') return value;
  return Object.fromEntries(Object.keys(value).sort().map((key) => [key, canonicalize(value[key])]));
}

function parseScaled(value, scale, field, maxFractionDigits) {
  const normalized = typeof value === 'string' ? text(value, 32) : null;
  const pattern = maxFractionDigits === 6
    ? /^(?:0|[1-9]\d{0,13})(?:\.\d{1,6})?$/
    : /^(?:0|[1-9]\d{0,13})(?:\.\d{1,12})?$/;
  if (!normalized || !pattern.test(normalized)) {
    return failure('INVALID_QUANTITY', `${field} must be a decimal string with at most ${maxFractionDigits} fractional digits`);
  }
  const [whole, fractional = ''] = normalized.split('.');
  const scaled = BigInt(whole) * scale + BigInt((fractional + '0'.repeat(Number(String(scale).length - 1))).slice(0, Number(String(scale).length - 1)));
  return Object.freeze({ ok: true, scaled, value: `${whole}.${(fractional + '0'.repeat(Number(String(scale).length - 1))).slice(0, Number(String(scale).length - 1))}` });
}

function parseDecimal6(value, field) {
  const normalized = typeof value === 'string' ? text(value, 32) : null;
  if (!normalized || !/^(?:0|[1-9]\d{0,13})(?:\.\d{1,6})?$/.test(normalized)) {
    return failure('INVALID_QUANTITY', `${field} must be a decimal string with at most 6 fractional digits`);
  }
  const [whole, fractional = ''] = normalized.split('.');
  const scaled = BigInt(whole) * SCALE_6 + BigInt((fractional + '000000').slice(0, 6));
  if (scaled <= 0n) return failure('INVALID_QUANTITY', `${field} must be greater than zero`);
  return Object.freeze({ ok: true, scaled, value: `${whole}.${(fractional + '000000').slice(0, 6)}` });
}

function formatScaled(value, scale) {
  const negative = value < 0n;
  const absolute = negative ? -value : value;
  const whole = absolute / scale;
  const fractional = String(absolute % scale).padStart(String(scale).length - 1, '0');
  return `${negative ? '-' : ''}${whole}.${fractional}`;
}

function payloadHash(value) {
  return inventoryLedgerInternals.payloadHash(canonicalize(value));
}

function validateSourceKey(value) {
  const candidate = text(value, 128);
  return candidate && SOURCE_KEY_PATTERN.test(candidate)
    ? { ok: true, value: candidate }
    : failure('INVALID_SOURCE_KEY', 'sourceKey must be 1-128 safe characters');
}

function validateChecksum(value) {
  const candidate = text(value, 64)?.toLowerCase();
  return candidate && CHECKSUM_PATTERN.test(candidate)
    ? { ok: true, value: candidate }
    : failure('INVALID_CONTENT_CHECKSUM', 'contentChecksum must be a 64-character sha256 hex digest');
}

function warehouseScope(requestContext) {
  const ids = requestContext?.scopes?.warehouseIds;
  return Array.isArray(ids)
    ? new Set(ids.filter((id) => typeof id === 'string' && id.trim()))
    : new Set();
}

function rowScopeKey(row) {
  return [
    row.warehouseId,
    row.locationId ?? '<null>',
    row.sourceVariantId,
    row.lotId ?? row.normalizedLotCode ?? '<null>',
    row.expiryDate ?? '<null>',
  ].join(':');
}

function normalizeRequestBody(body) {
  if (!body || typeof body !== 'object' || Array.isArray(body)) {
    return failure('INVALID_INPUT', 'Opening balance payload is required');
  }
  const sourceKey = validateSourceKey(body.sourceKey);
  if (!sourceKey.ok) return sourceKey;
  const contentChecksum = validateChecksum(body.contentChecksum);
  if (!contentChecksum.ok) return contentChecksum;
  const documentDate = strictDate(body.documentDate);
  if (!documentDate) return failure('INVALID_DOCUMENT_DATE', 'documentDate must be a valid YYYY-MM-DD date');
  const metadata = objectValue(body.metadata);
  if (metadata === null) return failure('INVALID_METADATA', 'metadata must be a JSON object no larger than 16 KB');
  if (!Array.isArray(body.rows) || body.rows.length < 1 || body.rows.length > OPENING_BALANCE_MAX_ROWS) {
    return failure('INVALID_ROWS', `rows must contain between 1 and ${OPENING_BALANCE_MAX_ROWS} items`);
  }

  const normalizedRows = [];
  const seenScopes = new Set();
  for (let index = 0; index < body.rows.length; index += 1) {
    const row = body.rows[index];
    if (!row || typeof row !== 'object' || Array.isArray(row)) {
      return failure('INVALID_ROW', `Row ${index + 1} is invalid`);
    }
    if (!UUID_PATTERN.test(String(row.warehouseId ?? ''))) return failure('INVALID_WAREHOUSE_ID', `Row ${index + 1} warehouseId is invalid`);
    if (row.locationId !== undefined && row.locationId !== null && row.locationId !== '' && !UUID_PATTERN.test(String(row.locationId))) {
      return failure('INVALID_LOCATION_ID', `Row ${index + 1} locationId is invalid`);
    }
    if (!UUID_PATTERN.test(String(row.sourceVariantId ?? ''))) return failure('INVALID_SOURCE_VARIANT_ID', `Row ${index + 1} sourceVariantId is invalid`);
    const sourceQuantity = parseDecimal6(row.sourceQuantity, `rows[${index}].sourceQuantity`);
    if (!sourceQuantity.ok) return sourceQuantity;
    const lineMetadata = objectValue(row.metadata);
    if (lineMetadata === null) return failure('INVALID_ROW_METADATA', `Row ${index + 1} metadata is invalid`);
    const normalizedLot = row.lotCode === undefined || row.lotCode === null || row.lotCode === ''
      ? null
      : inventoryLotInternals.normalizeLotCode(row.lotCode);
    if (normalizedLot && !normalizedLot.ok) return normalizedLot;
    const manufacturedDate = row.manufacturedDate === undefined || row.manufacturedDate === null || row.manufacturedDate === ''
      ? null
      : strictDate(row.manufacturedDate);
    if (row.manufacturedDate && !manufacturedDate) return failure('INVALID_MANUFACTURED_DATE', `Row ${index + 1} manufacturedDate is invalid`);
    const expiryDate = row.expiryDate === undefined || row.expiryDate === null || row.expiryDate === ''
      ? null
      : strictDate(row.expiryDate);
    if (row.expiryDate && !expiryDate) return failure('INVALID_EXPIRY_DATE', `Row ${index + 1} expiryDate is invalid`);
    const normalized = Object.freeze({
      lineNumber: index + 1,
      warehouseId: row.warehouseId,
      locationId: text(row.locationId, 64),
      sourceVariantId: row.sourceVariantId,
      sourceQuantity: sourceQuantity.value,
      sourceQuantityScaled: sourceQuantity.scaled,
      lotId: row.lotId === undefined || row.lotId === null || row.lotId === '' ? null : String(row.lotId),
      lotCode: normalizedLot?.value ?? null,
      normalizedLotCode: normalizedLot?.value ?? null,
      manufacturedDate,
      expiryDate,
      supplierLotReference: text(row.supplierLotReference, 160),
      sourceLineReference: text(row.sourceLineReference, 160),
      metadata: lineMetadata,
    });
    const scopeKey = rowScopeKey(normalized);
    if (seenScopes.has(scopeKey)) {
      return failure('DUPLICATE_IMPORT_SCOPE', `Row ${index + 1} duplicates an existing exact scope`);
    }
    seenScopes.add(scopeKey);
    normalizedRows.push(normalized);
  }

  return Object.freeze({
    ok: true,
    value: Object.freeze({
      sourceKey: sourceKey.value,
      sourceFilename: text(body.sourceFilename, 256),
      contentChecksum: contentChecksum.value,
      documentDate,
      metadata,
      rows: Object.freeze(normalizedRows),
    }),
  });
}

async function validateRows(client, requestContext, normalizedBody) {
  const scope = warehouseScope(requestContext);
  if (scope.size === 0) return failure('WAREHOUSE_SCOPE_DENIED', 'At least one server-owned warehouse scope is required');

  const rowErrors = [];
  const normalizedRows = [];
  let sourceQuantityTotal = 0n;
  let baseQuantityTotal = 0n;

  for (const row of normalizedBody.rows) {
    if (!scope.has(row.warehouseId)) {
      rowErrors.push({ lineNumber: row.lineNumber, code: 'WAREHOUSE_SCOPE_DENIED', message: 'Warehouse is outside the server-owned request scope' });
      continue;
    }

    const warehouse = await client.query(
      `SELECT warehouse.id AS warehouse_id,
              warehouse.is_active AS warehouse_active,
              location.id AS location_id,
              location.is_active AS location_active
         FROM shared.warehouses warehouse
         LEFT JOIN shared.warehouse_locations location
           ON location.installation_id = warehouse.installation_id
          AND location.warehouse_id = warehouse.id
          AND location.id = $3
        WHERE warehouse.installation_id = $1
          AND warehouse.id = $2`,
      [requestContext.installationId, row.warehouseId, row.locationId],
    );
    const warehouseRow = warehouse.rows?.[0] ?? null;
    if (!warehouseRow || !warehouseRow.warehouse_active) {
      rowErrors.push({ lineNumber: row.lineNumber, code: 'WAREHOUSE_NOT_AVAILABLE', message: 'Warehouse is missing or inactive' });
      continue;
    }
    if (row.locationId && (!warehouseRow.location_id || !warehouseRow.location_active)) {
      rowErrors.push({ lineNumber: row.lineNumber, code: 'LOCATION_NOT_AVAILABLE', message: 'Location is missing, inactive or belongs to another warehouse' });
      continue;
    }

    const variantResult = await client.query(
      `SELECT source.id AS source_variant_id,
              source.sku AS source_sku,
              source.product_id,
              source.is_active AS source_variant_active,
              source.unit_id AS source_unit_id,
              source.conversion_to_base,
              unit.code AS source_unit_code,
              unit.allows_fractional,
              unit.is_active AS source_unit_active,
              base.id AS base_variant_id,
              base.sku AS base_sku,
              base.is_active AS base_variant_active
         FROM shared.product_variants source
         JOIN shared.units_of_measure unit
           ON unit.installation_id = source.installation_id
          AND unit.id = source.unit_id
         JOIN shared.product_variants base
           ON base.installation_id = source.installation_id
          AND base.product_id = source.product_id
          AND base.is_inventory_base = true
          AND base.is_active = true
        WHERE source.installation_id = $1
          AND source.id = $2
        LIMIT 1`,
      [requestContext.installationId, row.sourceVariantId],
    );
    const variant = variantResult.rows?.[0] ?? null;
    if (!variant || !variant.source_variant_active || !variant.base_variant_active || !variant.source_unit_active) {
      rowErrors.push({ lineNumber: row.lineNumber, code: 'SKU_UNIT_NOT_AVAILABLE', message: 'SKU, base SKU or unit is missing or inactive' });
      continue;
    }
    if (variant.conversion_to_base === null || variant.conversion_to_base === undefined) {
      rowErrors.push({ lineNumber: row.lineNumber, code: 'CONVERSION_NOT_CONFIGURED', message: 'SKU conversion to inventory base is not configured' });
      continue;
    }
    if (!variant.allows_fractional && row.sourceQuantityScaled % SCALE_6 !== 0n) {
      rowErrors.push({ lineNumber: row.lineNumber, code: 'FRACTIONAL_QUANTITY_NOT_ALLOWED', message: 'Source unit does not allow fractional quantity' });
      continue;
    }

    const policyResult = await lotRepository.getTrackingPolicyByBaseVariant(client, {
      installationId: requestContext.installationId,
      baseVariantId: variant.base_variant_id,
    });
    if (!policyResult) {
      rowErrors.push({ lineNumber: row.lineNumber, code: 'TRACKING_POLICY_NOT_FOUND', message: 'Tracking policy was not found' });
      continue;
    }
    if (!policyResult.is_inventory_base || !policyResult.base_variant_active) {
      rowErrors.push({ lineNumber: row.lineNumber, code: 'BASE_VARIANT_NOT_AVAILABLE', message: 'Inventory base SKU is missing, inactive or invalid' });
      continue;
    }

    if (policyResult.location_required && !row.locationId) {
      rowErrors.push({ lineNumber: row.lineNumber, code: 'LOCATION_REQUIRED', message: 'Location is required by the active tracking policy' });
      continue;
    }
    if (policyResult.lot_tracking_mode === 'NONE') {
      if (row.lotId || row.lotCode || row.expiryDate || row.manufacturedDate || row.supplierLotReference) {
        rowErrors.push({ lineNumber: row.lineNumber, code: 'LOT_NOT_ALLOWED', message: 'Lot data is not allowed by the active tracking policy' });
        continue;
      }
    } else {
      if (!row.lotId && !row.lotCode) {
        rowErrors.push({ lineNumber: row.lineNumber, code: 'LOT_REQUIRED', message: 'lotCode or lotId is required by the active tracking policy' });
        continue;
      }
      if (policyResult.expiry_tracking_mode === 'REQUIRED' && !row.expiryDate && !row.lotId) {
        rowErrors.push({ lineNumber: row.lineNumber, code: 'EXPIRY_REQUIRED', message: 'expiryDate is required by the active tracking policy' });
        continue;
      }
      if (policyResult.expiry_tracking_mode === 'NONE' && row.expiryDate) {
        rowErrors.push({ lineNumber: row.lineNumber, code: 'EXPIRY_NOT_ALLOWED', message: 'expiryDate is not allowed by the active tracking policy' });
        continue;
      }
    }

    if (row.lotId) {
      const lot = await lotRepository.getInventoryLotById(client, {
        installationId: requestContext.installationId,
        id: row.lotId,
      });
      if (!lot) {
        rowErrors.push({ lineNumber: row.lineNumber, code: 'LOT_NOT_FOUND', message: 'Lot was not found' });
        continue;
      }
      if (lot.base_variant_id !== variant.base_variant_id) {
        rowErrors.push({ lineNumber: row.lineNumber, code: 'LOT_SKU_MISMATCH', message: 'Lot belongs to another SKU' });
        continue;
      }
      if (row.lotCode && lot.normalized_lot_code !== row.lotCode) {
        rowErrors.push({ lineNumber: row.lineNumber, code: 'LOT_SKU_MISMATCH', message: 'Lot code does not match the canonical lot' });
        continue;
      }
      if (row.expiryDate !== null && canonicalDate(lot.expiry_date) !== row.expiryDate) {
        rowErrors.push({ lineNumber: row.lineNumber, code: 'LOT_EXPIRY_MISMATCH', message: 'Lot expiry does not match the canonical expiry' });
        continue;
      }
    } else if (row.lotCode) {
      const existingLot = await lotRepository.getInventoryLotByIdentity(client, {
        installationId: requestContext.installationId,
        baseVariantId: variant.base_variant_id,
        normalizedLotCode: row.lotCode,
      });
      if (existingLot && row.expiryDate !== null && canonicalDate(existingLot.expiry_date) !== row.expiryDate) {
        rowErrors.push({ lineNumber: row.lineNumber, code: 'LOT_EXPIRY_MISMATCH', message: 'Lot expiry does not match the canonical expiry' });
        continue;
      }
    }

    const multiplication = inventoryLedgerInternals.multiplyToBase(
      row.sourceQuantity,
      String(variant.conversion_to_base),
      'IN',
    );
    if (!multiplication.ok) {
      rowErrors.push({ lineNumber: row.lineNumber, code: multiplication.code, message: multiplication.message });
      continue;
    }

    sourceQuantityTotal += row.sourceQuantityScaled;
    baseQuantityTotal += BigInt(String(multiplication.baseQuantityDelta).replace('.', ''));
    normalizedRows.push(Object.freeze({
      ...row,
      sourceSku: variant.source_sku,
      sourceUnitId: variant.source_unit_id,
      sourceUnitCode: variant.source_unit_code,
      conversionToBase: multiplication.conversionToBase,
      baseVariantId: variant.base_variant_id,
      baseSku: variant.base_sku,
      baseQuantity: multiplication.baseQuantityDelta,
      lotTrackingMode: policyResult.lot_tracking_mode,
      expiryTrackingMode: policyResult.expiry_tracking_mode,
      locationRequired: policyResult.location_required,
      sourceQuantity: multiplication.sourceQuantity,
      lotCode: row.lotCode ?? null,
      normalizedLotCode: row.normalizedLotCode ?? null,
    }));
  }

  return Object.freeze({
    ok: rowErrors.length === 0,
    rowErrors: Object.freeze(rowErrors),
    normalizedRows: Object.freeze(normalizedRows),
    totals: Object.freeze({
      rowCount: normalizedRows.length,
      sourceQuantityTotal: formatScaled(sourceQuantityTotal, SCALE_6),
      baseQuantityTotal: formatScaled(baseQuantityTotal, SCALE_12),
    }),
  });
}

function openingBalanceMovementPayload(normalizedBody, validation) {
  return {
    movementType: 'OPENING_BALANCE',
    sourceDomain: 'INVENTORY',
    sourceDocumentType: 'OPENING_BALANCE_IMPORT',
    sourceDocumentId: normalizedBody.sourceKey,
    sourceDocumentNumber: normalizedBody.sourceFilename ?? null,
    documentDate: normalizedBody.documentDate,
    metadata: normalizedBody.metadata,
    lines: validation.normalizedRows.map((row) => ({
      warehouseId: row.warehouseId,
      locationId: row.locationId,
      sourceVariantId: row.sourceVariantId,
      sourceQuantity: row.sourceQuantity,
      direction: 'IN',
      sourceLineReference: row.sourceLineReference,
      metadata: row.metadata,
      lotId: row.lotId,
      lotCode: row.lotCode,
      manufacturedDate: row.manufacturedDate,
      expiryDate: row.expiryDate,
      supplierLotReference: row.supplierLotReference,
    })),
  };
}

export async function validateOpeningBalanceImport(client, { requestContext, payload }) {
  if (!hasPermission(requestContext, PERMISSIONS.coreInventoryOpeningBalanceImport)) {
    return failure('PERMISSION_DENIED', 'Permission core.inventory.opening-balance.import is required');
  }
  const normalized = normalizeRequestBody(payload);
  if (!normalized.ok) return normalized;
  const validation = await validateRows(client, requestContext, normalized.value);
  return Object.freeze({
    ok: validation.ok,
    normalized: validation.ok ? normalized.value : null,
    rowErrors: validation.rowErrors,
    rows: validation.normalizedRows,
    totals: validation.totals,
  });
}

export async function postOpeningBalanceImport({ adapter, requestContext, idempotencyKey, payload }) {
  if (!hasPermission(requestContext, PERMISSIONS.coreInventoryOpeningBalanceImport)) {
    return failure('PERMISSION_DENIED', 'Permission core.inventory.opening-balance.import is required');
  }
  const idempotency = text(idempotencyKey, 128);
  if (!idempotency) return failure('INVALID_IDEMPOTENCY_KEY', 'idempotencyKey must contain 1-128 safe characters');

  const normalized = normalizeRequestBody(payload);
  if (!normalized.ok) return normalized;

  const validation = await withAuditOutboxTransaction({
    adapter,
    mutate: async (client) => {
      await repository.lockOpeningBalanceSourceKey(client, {
        installationId: requestContext.installationId,
        sourceKey: normalized.value.sourceKey,
      });
      const existing = await repository.getOpeningBalanceImportBySourceKey(client, {
        installationId: requestContext.installationId,
        sourceKey: normalized.value.sourceKey,
      });
      const hash = payloadHash(normalized.value);
      if (existing) {
        if (existing.payload_hash !== hash) {
          return { failed: failure('OPENING_BALANCE_SOURCE_KEY_CONFLICT', 'sourceKey was already used with different content'), skipAudit: true };
        }
        const replayMovement = existing.movement_id
          ? await client.query(
            `SELECT * FROM inventory.inventory_movements WHERE installation_id = $1 AND id = $2`,
            [requestContext.installationId, existing.movement_id],
          )
          : { rows: [] };
        const replayImport = await repository.getOpeningBalanceImportById(client, {
          installationId: requestContext.installationId,
          id: existing.id,
        });
        const replayRows = await repository.listOpeningBalanceImportRows(client, {
          installationId: requestContext.installationId,
          importId: existing.id,
        });
        return {
          ok: true,
          replayed: true,
          import: replayImport,
          movement: replayMovement.rows?.[0] ?? null,
          rows: replayRows,
          totals: {
            rowCount: replayRows.length,
            sourceQuantityTotal: String(existing.source_quantity_total),
            baseQuantityTotal: String(existing.base_quantity_total),
          },
        };
      }

      const rowValidation = await validateRows(client, requestContext, normalized.value);
      if (!rowValidation.ok) {
        return { failed: failure('OPENING_BALANCE_VALIDATION_FAILED', 'Opening balance validation failed', false, { rowErrors: rowValidation.rowErrors }), skipAudit: true };
      }

      const postingPayload = openingBalanceMovementPayload(normalized.value, rowValidation);
      const movementResult = await postInventoryMovement(client, {
        requestContext,
        idempotencyKey: idempotency,
        payload: postingPayload,
      });
      if (!movementResult.ok) return { failed: movementResult, skipAudit: true };

      const importId = randomUUID();
      const importHeader = await repository.insertOpeningBalanceImport(client, {
        id: importId,
        installationId: requestContext.installationId,
        sourceKey: normalized.value.sourceKey,
        sourceFilename: normalized.value.sourceFilename,
        contentChecksum: normalized.value.contentChecksum,
        payloadHash: hash,
        status: 'POSTED',
        documentDate: normalized.value.documentDate,
        movementId: movementResult.movement.id,
        rowCount: rowValidation.normalizedRows.length,
        sourceQuantityTotal: rowValidation.totals.sourceQuantityTotal,
        baseQuantityTotal: rowValidation.totals.baseQuantityTotal,
        createdAt: requestContext.receivedAt ?? new Date().toISOString(),
        createdBy: requestContext.actorId,
        requestId: requestContext.requestId,
        metadata: normalized.value.metadata,
      });

      const importRows = await repository.insertOpeningBalanceImportRows(client, rowValidation.normalizedRows.map((row) => ({
        id: randomUUID(),
        installationId: requestContext.installationId,
        importId,
        lineNumber: row.lineNumber,
        warehouseId: row.warehouseId,
        locationId: row.locationId,
        sourceVariantId: row.sourceVariantId,
        sourceSku: row.sourceSku,
        sourceUnitId: row.sourceUnitId,
        sourceUnitCode: row.sourceUnitCode,
        sourceQuantity: row.sourceQuantity,
        conversionToBase: row.conversionToBase,
        baseVariantId: row.baseVariantId,
        baseSku: row.baseSku,
        baseQuantity: row.baseQuantity,
        lotId: movementResult.lines[row.lineNumber - 1]?.lot_id ?? null,
        lotCode: movementResult.lines[row.lineNumber - 1]?.lot_code ?? row.lotCode ?? null,
        expiryDate: movementResult.lines[row.lineNumber - 1]?.expiry_date ?? row.expiryDate ?? null,
        sourceLineReference: row.sourceLineReference,
        metadata: row.metadata,
      })));

      const summary = {
        importId,
        movementId: movementResult.movement.id,
        rowCount: rowValidation.normalizedRows.length,
        sourceQuantityTotal: rowValidation.totals.sourceQuantityTotal,
        baseQuantityTotal: rowValidation.totals.baseQuantityTotal,
      };
      const audit = buildAuditRecord({
        requestContext,
        action: 'inventory.opening_balance.post',
        resourceType: 'opening_balance_import',
        resourceId: importId,
        afterData: { import: importHeader, movement: movementResult.movement, rows: importRows, summary },
        metadata: { sourceKey: normalized.value.sourceKey, rowCount: rowValidation.normalizedRows.length },
      });
      const event = buildOutboxEvent({
        requestContext,
        aggregateType: 'opening_balance_import',
        aggregateId: importId,
        eventType: 'inventory.opening-balance.posted',
        eventVersion: 1,
        payload: summary,
        metadata: {},
      });
      await insertAuditRecord(client, audit);
      await insertOutboxEvent(client, event);

      return {
        ok: true,
        replayed: false,
        import: importHeader,
        movement: movementResult.movement,
        rows: importRows,
        auditId: audit.auditId,
        eventId: event.eventId,
        totals: {
          rowCount: rowValidation.normalizedRows.length,
          sourceQuantityTotal: rowValidation.totals.sourceQuantityTotal,
          baseQuantityTotal: rowValidation.totals.baseQuantityTotal,
        },
      };
    },
  });

  return validation?.failed ?? validation;
}

export async function getOpeningBalanceImport(client, { requestContext, id }) {
  if (!hasPermission(requestContext, PERMISSIONS.coreInventoryRead)) {
    return failure('PERMISSION_DENIED', 'Permission core.inventory.read is required');
  }
  const header = await repository.getOpeningBalanceImportById(client, {
    installationId: requestContext.installationId,
    id,
  });
  if (!header) return failure('OPENING_BALANCE_IMPORT_NOT_FOUND', 'Opening balance import was not found');
  const rows = await repository.listOpeningBalanceImportRows(client, {
    installationId: requestContext.installationId,
    importId: id,
  });
  return Object.freeze({ ok: true, import: header, rows: Object.freeze(rows) });
}

export async function listOpeningBalanceImports(client, { requestContext, limit = 100, offset = 0 }) {
  if (!hasPermission(requestContext, PERMISSIONS.coreInventoryRead)) {
    return failure('PERMISSION_DENIED', 'Permission core.inventory.read is required');
  }
  const imports = await repository.listOpeningBalanceImports(client, {
    installationId: requestContext.installationId,
    limit,
    offset,
  });
  return Object.freeze({ ok: true, imports: Object.freeze(imports) });
}

export const openingBalanceInternals = Object.freeze({
  normalizeRequestBody,
  validateRows,
  payloadHash,
  formatScaled,
});
