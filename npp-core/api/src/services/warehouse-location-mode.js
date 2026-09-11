import { createHash, randomUUID } from 'node:crypto';
import { createIdempotencyKey, IDEMPOTENCY_KEY_PATTERN } from '@npp/contracts';
import * as repository from '../db/repositories/warehouse-location-mode.js';
import * as ledgerRepository from '../db/repositories/inventory-ledger.js';
import * as reservationRemapRepository from '../db/repositories/warehouse-location-reservation-remap.js';

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const MODES = new Set(['MANAGED', 'UNMANAGED']);
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

function actorId(requestContext) {
  return text(requestContext?.actorId ?? requestContext?.principalId ?? requestContext?.subject, 128) ?? 'system';
}

function sourceApp(requestContext) {
  return text(requestContext?.sourceApp, 128) ?? 'NPP_CORE';
}

function warehouseIds(requestContext) {
  return Array.isArray(requestContext?.scopes?.warehouseIds)
    ? [...new Set(requestContext.scopes.warehouseIds
      .filter((value) => typeof value === 'string' && UUID_PATTERN.test(value.trim()))
      .map((value) => value.trim()))]
    : [];
}

function hasWarehouse(requestContext, warehouseId) {
  return warehouseIds(requestContext).includes(warehouseId);
}

function normalizeMode(value) {
  const normalized = String(value ?? '').trim().toUpperCase();
  return MODES.has(normalized) ? normalized : null;
}

function parse12(value) {
  const match = /^(-?)(\d+)(?:\.(\d{1,12}))?$/.exec(String(value ?? '').trim());
  if (!match) return null;
  const absolute = BigInt(match[2]) * SCALE_12 + BigInt((match[3] ?? '').padEnd(12, '0'));
  return match[1] ? -absolute : absolute;
}

function format12(value) {
  const negative = value < 0n;
  const absolute = negative ? -value : value;
  return `${negative ? '-' : ''}${absolute / SCALE_12}.${String(absolute % SCALE_12).padStart(12, '0')}`;
}

function format6(value) {
  const negative = value < 0n;
  const absolute = negative ? -value : value;
  return `${negative ? '-' : ''}${absolute / SCALE_6}.${String(absolute % SCALE_6).padStart(6, '0')}`;
}

function movementRepresentation(quantityScaled12) {
  const absolute = quantityScaled12 < 0n ? -quantityScaled12 : quantityScaled12;
  if (absolute % SCALE_6 === 0n) {
    return Object.freeze({
      sourceQuantity: format6(absolute / SCALE_6),
      conversionToBase: '1.000000',
    });
  }
  return Object.freeze({
    sourceQuantity: format6(absolute),
    conversionToBase: '0.000001',
  });
}

function transferLegs(quantityScaled12) {
  if (quantityScaled12 === null || quantityScaled12 === 0n) return null;
  const sourceDelta = -quantityScaled12;
  const destinationDelta = quantityScaled12;
  return Object.freeze({
    sourceDirection: sourceDelta > 0n ? 'IN' : 'OUT',
    sourceBaseQuantityDelta: format12(sourceDelta),
    destinationDirection: destinationDelta > 0n ? 'IN' : 'OUT',
    destinationBaseQuantityDelta: format12(destinationDelta),
    negativeRelocation: quantityScaled12 < 0n,
  });
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

function deterministicUuid(value) {
  const bytes = Buffer.from(createHash('sha256').update(value).digest().subarray(0, 16));
  bytes[6] = (bytes[6] & 0x0f) | 0x50;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;
  const hex = bytes.toString('hex');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

function childKey(operation, seed) {
  return createIdempotencyKey(operation, deterministicUuid(seed));
}

function scopeKey(locationId, baseVariantId, lotId) {
  return `${locationId ?? '<null>'}|${baseVariantId}|${lotId ?? '<null>'}`;
}

function isZero(value) {
  return (parse12(value) ?? 0n) === 0n;
}

function inferMode(rows) {
  let hasLocated = false;
  let hasUnlocated = false;
  for (const row of rows) {
    const onHand = parse12(row.on_hand_quantity) ?? 0n;
    const reserved = parse12(row.reserved_quantity) ?? 0n;
    if (onHand === 0n && reserved === 0n) continue;
    if (row.location_id) hasLocated = true;
    else hasUnlocated = true;
  }
  if (hasLocated && !hasUnlocated) return 'MANAGED';
  if (hasUnlocated && !hasLocated) return 'UNMANAGED';
  return null;
}

function blocker(code, message, details = {}) {
  return Object.freeze({ code, message, details: Object.freeze(details) });
}

function mapRun(row, lines = undefined) {
  return Object.freeze({
    id: row.id,
    warehouseId: row.warehouse_id,
    warehouseCode: row.warehouse_code_snapshot,
    warehouseName: row.warehouse_name_snapshot,
    fromMode: row.from_mode ?? null,
    targetMode: row.target_mode,
    destinationLocationId: row.destination_location_id ?? null,
    destinationLocationCode: row.destination_location_code_snapshot ?? null,
    destinationLocationName: row.destination_location_name_snapshot ?? null,
    previewHash: row.preview_hash,
    issueMovementId: row.issue_movement_id ?? null,
    receiptMovementId: row.receipt_movement_id ?? null,
    affectedSkuCount: Number(row.affected_sku_count),
    affectedScopeCount: Number(row.affected_scope_count),
    totalBaseQuantity: String(row.total_base_quantity),
    completedAt: row.completed_at,
    completedBy: row.completed_by,
    requestId: row.request_id,
    sourceApp: row.source_app,
    metadata: row.metadata ?? {},
    lines: lines ? Object.freeze(lines.map((line) => Object.freeze({
      id: line.id,
      lineNumber: Number(line.line_number),
      baseVariantId: line.base_variant_id,
      sku: line.base_sku_snapshot,
      lotId: line.lot_id ?? null,
      lotCode: line.lot_code_snapshot ?? null,
      sourceLocationId: line.source_location_id ?? null,
      sourceLocationCode: line.source_location_code_snapshot ?? null,
      sourceLocationName: line.source_location_name_snapshot ?? null,
      destinationLocationId: line.destination_location_id ?? null,
      destinationLocationCode: line.destination_location_code_snapshot ?? null,
      destinationLocationName: line.destination_location_name_snapshot ?? null,
      baseQuantity: String(line.base_quantity),
      sourceScopeVersion: String(line.source_scope_version),
      destinationScopeVersion: String(line.destination_scope_version),
      issueMovementLineId: line.issue_movement_line_id ?? null,
      receiptMovementLineId: line.receipt_movement_line_id ?? null,
    }))) : undefined,
  });
}

async function hydrateRun(client, row) {
  const lines = await repository.listRunLines(client, {
    installationId: row.installation_id,
    runId: row.id,
  });
  return mapRun(row, lines);
}

function buildScopes(lines) {
  const unique = new Map();
  for (const line of lines) {
    for (const scope of [
      { locationId: line.sourceLocationId, baseVariantId: line.baseVariantId, lotId: line.lotId },
      { locationId: line.destinationLocationId, baseVariantId: line.baseVariantId, lotId: line.lotId },
    ]) {
      unique.set(scopeKey(scope.locationId, scope.baseVariantId, scope.lotId), scope);
    }
  }
  return [...unique.values()];
}

function modeShape(rows) {
  const located = [];
  const unlocated = [];
  const negative = [];
  const reserved = [];
  for (const row of rows) {
    const onHand = parse12(row.on_hand_quantity) ?? 0n;
    const reservedQuantity = parse12(row.reserved_quantity) ?? 0n;
    if (onHand < 0n) negative.push(row);
    if (reservedQuantity > 0n) reserved.push(row);
    if (onHand !== 0n) {
      if (row.location_id) located.push(row);
      else unlocated.push(row);
    }
  }
  return Object.freeze({ located, unlocated, negative, reserved });
}

function reservationPlan(entries, balances, targetMode, destination) {
  const blockers = [];
  const relocations = [];
  const reservedByScope = new Map();

  for (const entry of entries) {
    const reservation = entry.reservation;
    const allocation = entry.allocation;
    const key = scopeKey(reservation.location_id, reservation.base_variant_id, reservation.lot_id);
    reservedByScope.set(key, (reservedByScope.get(key) ?? 0n) + (parse12(reservation.quantity) ?? 0n));

    const alreadyInTargetScope = targetMode === 'UNMANAGED'
      ? !reservation.location_id
      : Boolean(reservation.location_id);
    if (alreadyInTargetScope) continue;

    if (reservation.source_domain !== 'SALES'
        || reservation.source_document_type !== 'SALES_FULFILLMENT_ALLOCATION'
        || !allocation) {
      blockers.push(blocker(
        'ACTIVE_RESERVATION_NOT_RELOCATABLE',
        'Kho đang có phần giữ hàng của nghiệp vụ khác chưa thể chuyển tự động.',
        { reservationId: reservation.id },
      ));
      continue;
    }

    const exactMatch = reservation.source_document_id === allocation.id
      && reservation.warehouse_id === allocation.warehouse_id
      && reservation.location_id === allocation.location_id
      && reservation.base_variant_id === allocation.base_variant_id
      && reservation.lot_id === allocation.lot_id
      && String(reservation.quantity) === String(allocation.allocated_base_quantity);
    if (!exactMatch) {
      blockers.push(blocker(
        'RESERVATION_ALLOCATION_MISMATCH',
        'Phần hàng đã giữ không khớp với phân bổ của đơn. Cần đối soát trước khi chuyển chế độ.',
        { reservationId: reservation.id, allocationId: allocation.id },
      ));
      continue;
    }

    const physicallyStarted = allocation.state !== 'ACTIVE'
      || !isZero(allocation.picked_base_quantity)
      || !isZero(allocation.packed_base_quantity)
      || !isZero(allocation.issued_base_quantity)
      || !isZero(allocation.claimed_base_quantity);
    if (physicallyStarted) {
      blockers.push(blocker(
        'FULFILLMENT_PHYSICAL_EXECUTION_PRESENT',
        'Kho đang có phần hàng đã bắt đầu soạn, đóng gói hoặc lập chứng từ giao. Cần hoàn tất xử lý phần này trước khi chuyển chế độ.',
        { allocationId: allocation.id, salesOrderId: allocation.sales_order_id },
      ));
      continue;
    }

    relocations.push(Object.freeze({
      reservationId: reservation.id,
      allocationId: allocation.id,
      fulfillmentDemandId: allocation.fulfillment_demand_id,
      salesOrderId: allocation.sales_order_id,
      salesOrderVersionId: allocation.sales_order_version_id,
      salesOrderLineId: allocation.sales_order_line_id,
      warehouseId: allocation.warehouse_id,
      baseVariantId: allocation.base_variant_id,
      lotId: allocation.lot_id ?? null,
      sourceLocationId: allocation.location_id ?? null,
      destinationLocationId: targetMode === 'MANAGED' ? destination.id : null,
      quantity: String(allocation.allocated_base_quantity),
      allocationSequence: Number(allocation.allocation_sequence),
      allocationPolicy: allocation.allocation_policy,
      policyRank: Number(allocation.policy_rank),
      manualOverrideReason: allocation.manual_override_reason ?? null,
    }));
  }

  const balanceByScope = new Map(balances.map((row) => [
    scopeKey(row.location_id, row.base_variant_id, row.lot_id),
    row,
  ]));
  const allScopeKeys = new Set([
    ...reservedByScope.keys(),
    ...balances
      .filter((row) => (parse12(row.reserved_quantity) ?? 0n) !== 0n)
      .map((row) => scopeKey(row.location_id, row.base_variant_id, row.lot_id)),
  ]);
  for (const key of allScopeKeys) {
    const balance = balanceByScope.get(key);
    const balanceReserved = parse12(balance?.reserved_quantity ?? 0) ?? 0n;
    const reservationReserved = reservedByScope.get(key) ?? 0n;
    const onHand = parse12(balance?.on_hand_quantity ?? 0) ?? 0n;
    if (balanceReserved !== reservationReserved) {
      blockers.push(blocker(
        'RESERVATION_BALANCE_MISMATCH',
        'Số lượng giữ hàng không khớp số liệu tồn. Cần đối soát trước khi chuyển chế độ.',
        { scopeKey: key, balanceReserved: format12(balanceReserved), reservationReserved: format12(reservationReserved) },
      ));
    }
    if (balanceReserved > onHand) {
      blockers.push(blocker(
        'RESERVATION_EXCEEDS_ON_HAND',
        'Số lượng đang giữ lớn hơn tồn thực tế tại một phạm vi kho. Cần đối soát trước khi chuyển chế độ.',
        { scopeKey: key },
      ));
    }
  }

  return Object.freeze({ blockers: Object.freeze(blockers), relocations: Object.freeze(relocations) });
}

async function previewInternal(client, {
  requestContext,
  warehouseId,
  targetMode,
  destinationLocationId = null,
  lock = false,
}) {
  if (!UUID_PATTERN.test(String(warehouseId ?? ''))) {
    return failure('INVALID_WAREHOUSE_ID', 'Kho không hợp lệ.');
  }
  if (!hasWarehouse(requestContext, warehouseId)) {
    return failure('WAREHOUSE_SCOPE_DENIED', 'Kho nằm ngoài phạm vi được cấp quyền.');
  }
  const normalizedTargetMode = normalizeMode(targetMode);
  if (!normalizedTargetMode) {
    return failure('INVALID_LOCATION_MANAGEMENT_MODE', 'Chế độ quản lý vị trí không hợp lệ.');
  }
  const normalizedDestination = text(destinationLocationId, 64);
  if (normalizedDestination && !UUID_PATTERN.test(normalizedDestination)) {
    return failure('INVALID_DESTINATION_LOCATION_ID', 'Vị trí nhận ban đầu không hợp lệ.');
  }
  if (normalizedTargetMode === 'MANAGED' && !normalizedDestination) {
    return failure('DESTINATION_LOCATION_REQUIRED', 'Cần chọn Vị trí nhận ban đầu trước khi bắt đầu quản lý vị trí.');
  }
  if (normalizedTargetMode === 'UNMANAGED' && normalizedDestination) {
    return failure('DESTINATION_LOCATION_NOT_ALLOWED', 'Kho tồn chung không dùng Vị trí nhận ban đầu.');
  }

  const warehouse = await repository.getWarehouse(client, {
    installationId: requestContext.installationId,
    warehouseId,
    forUpdate: lock,
  });
  if (!warehouse || !warehouse.is_active || ['vehicle', 'transit'].includes(warehouse.warehouse_type)) {
    return failure('WAREHOUSE_NOT_AVAILABLE', 'Kho không tồn tại, đã ngừng sử dụng hoặc không hỗ trợ chuyển chế độ vị trí.');
  }

  let destination = null;
  if (normalizedTargetMode === 'MANAGED') {
    destination = await repository.getActiveLocation(client, {
      installationId: requestContext.installationId,
      warehouseId,
      locationId: normalizedDestination,
    });
    if (!destination || destination.location_type !== 'storage') {
      return failure('DESTINATION_LOCATION_NOT_AVAILABLE', 'Vị trí nhận ban đầu phải là vị trí lưu trữ đang hoạt động trong kho.');
    }
  }

  const balances = await repository.listWarehouseBalances(client, {
    installationId: requestContext.installationId,
    warehouseId,
    lock,
  });
  const activeReservations = await reservationRemapRepository.loadActiveReservations(client, {
    installationId: requestContext.installationId,
    warehouseId,
    lock,
  });
  const shape = modeShape(balances);
  const inferredMode = inferMode(balances);
  const storedMode = normalizeMode(warehouse.location_management_mode);
  const blockers = [];
  const sourceRows = normalizedTargetMode === 'UNMANAGED' ? shape.located : shape.unlocated;

  if (storedMode === normalizedTargetMode && sourceRows.length === 0) {
    blockers.push(blocker(
      'LOCATION_MANAGEMENT_MODE_UNCHANGED',
      'Kho đã ở đúng chế độ quản lý vị trí đã chọn.',
    ));
  }

  const reservationResult = reservationPlan(activeReservations, balances, normalizedTargetMode, destination);
  blockers.push(...reservationResult.blockers);

  const draftLines = sourceRows.map((row, index) => ({
    id: randomUUID(),
    lineNumber: index + 1,
    baseVariantId: row.base_variant_id,
    baseSku: row.base_sku,
    sourceUnitId: row.source_unit_id,
    sourceUnitCode: row.source_unit_code,
    lotId: row.lot_id ?? null,
    lotCode: row.lot_code ?? null,
    expiryDate: row.expiry_date ?? null,
    sourceLocationId: row.location_id ?? null,
    sourceLocationCode: row.location_code ?? null,
    sourceLocationName: row.location_name ?? null,
    destinationLocationId: normalizedTargetMode === 'MANAGED' ? destination.id : null,
    destinationLocationCode: normalizedTargetMode === 'MANAGED' ? destination.code : null,
    destinationLocationName: normalizedTargetMode === 'MANAGED' ? destination.name : null,
    baseQuantity: format12(parse12(row.on_hand_quantity) ?? 0n),
  }));

  const scopes = buildScopes(draftLines);
  const versions = await repository.loadScopeVersions(client, {
    installationId: requestContext.installationId,
    warehouseId,
    scopes,
    lock,
  });
  const versionByKey = new Map(versions.map((row) => [row.scope_key, String(row.version)]));
  const lines = draftLines.map((line) => Object.freeze({
    ...line,
    sourceScopeVersion: versionByKey.get(scopeKey(line.sourceLocationId, line.baseVariantId, line.lotId)) ?? '0',
    destinationScopeVersion: versionByKey.get(scopeKey(line.destinationLocationId, line.baseVariantId, line.lotId)) ?? '0',
  }));

  const skuCount = new Set(lines.map((line) => line.baseVariantId)).size;
  const lotScopeCount = new Set(lines.map((line) => `${line.baseVariantId}|${line.lotId ?? '<null>'}`)).size;
  const totalQuantity = lines.reduce((sum, line) => sum + (parse12(line.baseQuantity) ?? 0n), 0n);
  const effectiveFromMode = storedMode ?? inferredMode;
  const previewShape = {
    warehouseId,
    warehouseUpdatedAt: warehouse.updated_at,
    warehouseModeVersion: String(warehouse.location_management_mode_version ?? 0),
    storedMode,
    effectiveFromMode,
    targetMode: normalizedTargetMode,
    destinationLocationId: destination?.id ?? null,
    lines: lines.map((line) => ({
      baseVariantId: line.baseVariantId,
      lotId: line.lotId,
      sourceLocationId: line.sourceLocationId,
      destinationLocationId: line.destinationLocationId,
      baseQuantity: line.baseQuantity,
      sourceScopeVersion: line.sourceScopeVersion,
      destinationScopeVersion: line.destinationScopeVersion,
    })),
    reservationRelocations: reservationResult.relocations.map((item) => ({
      reservationId: item.reservationId,
      allocationId: item.allocationId,
      baseVariantId: item.baseVariantId,
      lotId: item.lotId,
      sourceLocationId: item.sourceLocationId,
      destinationLocationId: item.destinationLocationId,
      quantity: item.quantity,
    })),
    blockers: blockers.map((item) => ({ code: item.code, details: item.details })),
  };
  const previewHash = payloadHash(previewShape);

  return Object.freeze({
    ok: true,
    preview: Object.freeze({
      warehouse: Object.freeze({
        id: warehouse.id,
        code: warehouse.code,
        name: warehouse.name,
        currentMode: storedMode,
        inferredMode,
        modeVersion: String(warehouse.location_management_mode_version ?? 0),
        updatedAt: warehouse.updated_at,
      }),
      targetMode: normalizedTargetMode,
      destinationLocation: destination ? Object.freeze({
        id: destination.id,
        code: destination.code,
        name: destination.name,
      }) : null,
      summary: Object.freeze({
        affectedSkuCount: skuCount,
        affectedScopeCount: lines.length,
        lotScopeCount,
        totalBaseQuantity: format12(totalQuantity),
        negativeScopeCount: shape.negative.length,
        relocatedReservationCount: reservationResult.relocations.length,
      }),
      lines: Object.freeze(lines),
      reservationRelocations: reservationResult.relocations,
      blockers: Object.freeze(blockers),
      canConvert: blockers.length === 0,
      previewHash,
    }),
  });
}

export async function previewWarehouseLocationMode(client, input) {
  return previewInternal(client, { ...input, lock: false });
}

async function releaseReservationsBeforeStockMove(client, {
  requestContext,
  runId,
  relocations,
  occurredAt,
}) {
  for (const item of relocations) {
    await reservationRemapRepository.lockReservationScope(client, {
      installationId: requestContext.installationId,
      warehouseId: item.warehouseId,
      locationId: item.sourceLocationId,
      baseVariantId: item.baseVariantId,
      lotId: item.lotId,
    });
    const releasedReservation = await reservationRemapRepository.releaseReservation(client, {
      installationId: requestContext.installationId,
      reservationId: item.reservationId,
      transitionedAt: occurredAt,
    });
    if (!releasedReservation) {
      return failure('WAREHOUSE_LOCATION_RESERVATION_CONFLICT', 'Phần hàng đang giữ đã thay đổi. Hãy xem trước lại.', true);
    }
    const reservationEventHash = payloadHash({
      runId,
      reservationId: item.reservationId,
      transition: 'RELEASE_TO_RELEASED',
      destinationLocationId: item.destinationLocationId,
    });
    await reservationRemapRepository.insertReservationEvent(client, {
      id: deterministicUuid(`${runId}|${item.reservationId}|release-event`),
      installationId: requestContext.installationId,
      reservationId: item.reservationId,
      transition: 'RELEASE_TO_RELEASED',
      actorId: actorId(requestContext),
      requestId: requestContext.requestId,
      sourceApp: sourceApp(requestContext),
      payloadHash: reservationEventHash,
      occurredAt,
      metadata: {
        action: 'warehouse-location-mode-change',
        warehouseLocationModeRunId: runId,
        relocatedToLocationId: item.destinationLocationId,
        allocationId: item.allocationId,
        salesOrderId: item.salesOrderId,
      },
    });

    const releasedAllocation = await reservationRemapRepository.releaseAllocation(client, {
      installationId: requestContext.installationId,
      allocationId: item.allocationId,
      actorId: actorId(requestContext),
    });
    if (!releasedAllocation) {
      return failure('WAREHOUSE_LOCATION_ALLOCATION_CONFLICT', 'Phân bổ hàng của đơn đã thay đổi. Hãy xem trước lại.', true);
    }
    const allocationEventHash = payloadHash({
      runId,
      allocationId: item.allocationId,
      eventType: 'RELEASED',
      quantity: item.quantity,
      destinationLocationId: item.destinationLocationId,
    });
    await reservationRemapRepository.insertAllocationEvent(client, {
      id: deterministicUuid(`${runId}|${item.allocationId}|release-event`),
      installationId: requestContext.installationId,
      allocationId: item.allocationId,
      eventType: 'RELEASED',
      quantity: item.quantity,
      actorId: actorId(requestContext),
      requestId: requestContext.requestId,
      sourceApp: sourceApp(requestContext),
      idempotencyKey: childKey('wlm-allocation-release', `${runId}|${item.allocationId}|release-key`),
      payloadHash: allocationEventHash,
      reason: 'Chuyển phần hàng đang giữ theo chế độ vị trí của kho',
      metadata: {
        warehouseLocationModeRunId: runId,
        relocatedToLocationId: item.destinationLocationId,
      },
      occurredAt,
    });
  }
  return Object.freeze({ ok: true });
}

async function recreateReservationsAfterStockMove(client, {
  requestContext,
  runId,
  relocations,
  occurredAt,
}) {
  const mappings = [];
  for (const item of relocations) {
    await reservationRemapRepository.lockReservationScope(client, {
      installationId: requestContext.installationId,
      warehouseId: item.warehouseId,
      locationId: item.destinationLocationId,
      baseVariantId: item.baseVariantId,
      lotId: item.lotId,
    });
    const allocationId = deterministicUuid(`${runId}|${item.allocationId}|replacement-allocation`);
    const reservationId = deterministicUuid(`${runId}|${item.reservationId}|replacement-reservation`);
    const reservationKey = childKey('wlm-reservation-create', `${runId}|${item.reservationId}|reservation-key`);
    const reservationHash = payloadHash({
      runId,
      relocatedFromReservationId: item.reservationId,
      allocationId,
      warehouseId: item.warehouseId,
      locationId: item.destinationLocationId,
      baseVariantId: item.baseVariantId,
      lotId: item.lotId,
      quantity: item.quantity,
    });
    await reservationRemapRepository.insertReservation(client, {
      id: reservationId,
      installationId: requestContext.installationId,
      warehouseId: item.warehouseId,
      locationId: item.destinationLocationId,
      baseVariantId: item.baseVariantId,
      lotId: item.lotId,
      quantity: item.quantity,
      allocationId,
      occurredAt,
      idempotencyKey: reservationKey,
      payloadHash: reservationHash,
      metadata: {
        warehouseLocationModeRunId: runId,
        relocatedFromReservationId: item.reservationId,
        relocatedFromAllocationId: item.allocationId,
        salesOrderId: item.salesOrderId,
      },
    });
    await reservationRemapRepository.insertReservationEvent(client, {
      id: deterministicUuid(`${runId}|${reservationId}|create-event`),
      installationId: requestContext.installationId,
      reservationId,
      transition: 'CREATE_ACTIVE',
      actorId: actorId(requestContext),
      requestId: requestContext.requestId,
      sourceApp: sourceApp(requestContext),
      payloadHash: reservationHash,
      occurredAt,
      metadata: {
        action: 'warehouse-location-mode-change',
        warehouseLocationModeRunId: runId,
        relocatedFromReservationId: item.reservationId,
        allocationId,
        salesOrderId: item.salesOrderId,
      },
    });

    const operationKey = childKey('wlm-allocation-operation', `${runId}|${item.allocationId}|operation-key`);
    const allocationKey = childKey('wlm-allocation-create', `${runId}|${item.allocationId}|allocation-key`);
    const allocationHash = payloadHash({
      runId,
      relocatedFromAllocationId: item.allocationId,
      allocationId,
      reservationId,
      locationId: item.destinationLocationId,
      quantity: item.quantity,
    });
    await reservationRemapRepository.insertAllocation(client, {
      id: allocationId,
      installationId: requestContext.installationId,
      fulfillmentDemandId: item.fulfillmentDemandId,
      salesOrderId: item.salesOrderId,
      salesOrderVersionId: item.salesOrderVersionId,
      salesOrderLineId: item.salesOrderLineId,
      warehouseId: item.warehouseId,
      locationId: item.destinationLocationId,
      baseVariantId: item.baseVariantId,
      lotId: item.lotId,
      inventoryReservationId: reservationId,
      allocationSequence: item.allocationSequence,
      allocationPolicy: item.allocationPolicy,
      policyRank: item.policyRank,
      manualOverrideReason: item.manualOverrideReason,
      quantity: item.quantity,
      operationIdempotencyKey: operationKey,
      idempotencyKey: allocationKey,
      payloadHash: allocationHash,
      actorId: actorId(requestContext),
    });
    await reservationRemapRepository.insertAllocationEvent(client, {
      id: deterministicUuid(`${runId}|${allocationId}|allocated-event`),
      installationId: requestContext.installationId,
      allocationId,
      eventType: 'ALLOCATED',
      quantity: item.quantity,
      actorId: actorId(requestContext),
      requestId: requestContext.requestId,
      sourceApp: sourceApp(requestContext),
      idempotencyKey: childKey('wlm-allocation-event', `${runId}|${item.allocationId}|allocated-event-key`),
      payloadHash: allocationHash,
      reason: 'Giữ lại phần hàng của đơn sau khi chuyển chế độ vị trí kho',
      metadata: {
        warehouseLocationModeRunId: runId,
        relocatedFromAllocationId: item.allocationId,
        relocatedFromReservationId: item.reservationId,
      },
      occurredAt,
    });
    mappings.push(Object.freeze({
      fromReservationId: item.reservationId,
      toReservationId: reservationId,
      fromAllocationId: item.allocationId,
      toAllocationId: allocationId,
    }));
  }
  return Object.freeze(mappings);
}

export async function convertWarehouseLocationMode(client, {
  requestContext,
  warehouseId,
  payload,
  idempotencyKey,
}) {
  if (!IDEMPOTENCY_KEY_PATTERN.test(String(idempotencyKey ?? ''))) {
    return failure('INVALID_IDEMPOTENCY_KEY', 'Idempotency-Key không hợp lệ.');
  }
  const targetMode = normalizeMode(payload?.targetMode);
  const destinationLocationId = text(payload?.destinationLocationId, 64);
  const suppliedPreviewHash = text(payload?.previewHash, 64);
  if (!targetMode) return failure('INVALID_LOCATION_MANAGEMENT_MODE', 'Chế độ quản lý vị trí không hợp lệ.');
  if (!suppliedPreviewHash || !/^[0-9a-f]{64}$/.test(suppliedPreviewHash)) {
    return failure('PREVIEW_HASH_REQUIRED', 'Cần xem trước lại trước khi xác nhận chuyển chế độ.');
  }
  const requestHash = payloadHash({
    warehouseId,
    targetMode,
    destinationLocationId: destinationLocationId ?? null,
    previewHash: suppliedPreviewHash,
  });
  const replay = await repository.getRunByIdempotencyKey(client, {
    installationId: requestContext.installationId,
    idempotencyKey,
  });
  if (replay) {
    if (!hasWarehouse(requestContext, replay.warehouse_id)) {
      return failure('WAREHOUSE_SCOPE_DENIED', 'Kho nằm ngoài phạm vi được cấp quyền.');
    }
    if (replay.payload_hash !== requestHash) {
      return failure('IDEMPOTENCY_PAYLOAD_MISMATCH', 'Idempotency-Key đã được dùng cho một lần chuyển chế độ khác.');
    }
    return Object.freeze({ ok: true, run: await hydrateRun(client, replay), replayed: true });
  }

  const previewResult = await previewInternal(client, {
    requestContext,
    warehouseId,
    targetMode,
    destinationLocationId,
    lock: true,
  });
  if (!previewResult.ok) return previewResult;
  const preview = previewResult.preview;
  if (preview.previewHash !== suppliedPreviewHash) {
    return failure(
      'WAREHOUSE_LOCATION_PREVIEW_STALE',
      'Dữ liệu tồn kho hoặc phần hàng đang giữ đã thay đổi. Hãy xem trước lại trước khi xác nhận.',
      false,
      { currentPreviewHash: preview.previewHash },
    );
  }
  if (!preview.canConvert) {
    const first = preview.blockers[0];
    return failure(first.code, first.message, false, first.details);
  }

  const runId = randomUUID();
  const completedAt = new Date();
  const occurredAt = completedAt.toISOString();
  const issueMovementId = preview.lines.length > 0 ? randomUUID() : null;
  const receiptMovementId = preview.lines.length > 0 ? randomUUID() : null;
  const issueKey = issueMovementId ? createIdempotencyKey('warehouse-location-mode-issue', runId) : null;
  const receiptKey = receiptMovementId ? createIdempotencyKey('warehouse-location-mode-receipt', runId) : null;

  if (issueKey) {
    await ledgerRepository.lockIdempotencyKey(client, {
      installationId: requestContext.installationId,
      idempotencyKey: issueKey,
    });
    const collision = await ledgerRepository.getMovementByIdempotencyKey(client, {
      installationId: requestContext.installationId,
      idempotencyKey: issueKey,
    });
    if (collision) return failure('IDEMPOTENCY_PAYLOAD_MISMATCH', 'Khóa ghi sổ chuyển vị trí đã tồn tại.');
  }
  if (receiptKey) {
    await ledgerRepository.lockIdempotencyKey(client, {
      installationId: requestContext.installationId,
      idempotencyKey: receiptKey,
    });
    const collision = await ledgerRepository.getMovementByIdempotencyKey(client, {
      installationId: requestContext.installationId,
      idempotencyKey: receiptKey,
    });
    if (collision) return failure('IDEMPOTENCY_PAYLOAD_MISMATCH', 'Khóa ghi sổ nhận vị trí đã tồn tại.');
  }

  const releaseResult = await releaseReservationsBeforeStockMove(client, {
    requestContext,
    runId,
    relocations: preview.reservationRelocations,
    occurredAt,
  });
  if (!releaseResult.ok) return releaseResult;

  const issueLineIds = new Map();
  const receiptLineIds = new Map();
  if (preview.lines.length > 0) {
    const movementMetadata = {
      warehouseLocationModeRunId: runId,
      fromMode: preview.warehouse.currentMode ?? preview.warehouse.inferredMode,
      targetMode,
      destinationLocationId: preview.destinationLocation?.id ?? null,
      transferKind: 'WAREHOUSE_LOCATION_MODE',
    };
    await ledgerRepository.insertMovement(client, {
      id: issueMovementId,
      installationId: requestContext.installationId,
      movementType: 'TRANSFER_ISSUE',
      sourceDomain: 'INVENTORY',
      sourceDocumentType: 'WAREHOUSE_LOCATION_MODE_RUN',
      sourceDocumentId: runId,
      sourceDocumentNumber: `WLM-${runId.slice(0, 8).toUpperCase()}`,
      documentDate: completedAt.toISOString().slice(0, 10),
      postedAt: completedAt,
      postedBy: actorId(requestContext),
      requestId: requestContext.requestId,
      sourceApp: sourceApp(requestContext),
      idempotencyKey: issueKey,
      payloadHash: payloadHash({ runId, side: 'ISSUE', lines: preview.lines }),
      reversalOfMovementId: null,
      documentNumber: `WLM-${runId.slice(0, 8).toUpperCase()}-OUT`,
      reasonCode: 'WAREHOUSE_LOCATION_MODE_CHANGE',
      reasonNote: targetMode === 'UNMANAGED' ? 'Chuyển sang tồn chung' : 'Bắt đầu quản lý vị trí',
      metadata: movementMetadata,
    });

    for (let index = 0; index < preview.lines.length; index += 1) {
      const line = preview.lines[index];
      const lineId = randomUUID();
      const movementLineId = randomUUID();
      issueLineIds.set(line.id, { runLineId: lineId, movementLineId });
      const quantity = parse12(line.baseQuantity);
      const representation = movementRepresentation(quantity);
      const legs = transferLegs(quantity);
      await ledgerRepository.insertMovementLine(client, {
        id: movementLineId,
        installationId: requestContext.installationId,
        movementId: issueMovementId,
        lineNumber: index + 1,
        warehouseId,
        locationId: line.sourceLocationId,
        sourceVariantId: line.baseVariantId,
        sourceSku: line.baseSku,
        sourceUnitId: line.sourceUnitId,
        sourceUnitCode: line.sourceUnitCode,
        sourceQuantity: representation.sourceQuantity,
        conversionToBase: representation.conversionToBase,
        baseVariantId: line.baseVariantId,
        baseSku: line.baseSku,
        direction: legs.sourceDirection,
        baseQuantityDelta: legs.sourceBaseQuantityDelta,
        lotId: line.lotId,
        lotCode: line.lotCode,
        expiryDate: line.expiryDate,
        sourceLineReference: `WAREHOUSE-LOCATION-MODE-${lineId}-SOURCE`,
        metadata: {
          warehouseLocationModeRunId: runId,
          warehouseLocationModeRunLineId: lineId,
          inventoryTransferLineId: lineId,
          scopeSide: 'SOURCE',
          transferKind: 'WAREHOUSE_LOCATION_MODE',
          negativeRelocation: legs.negativeRelocation,
          signedBaseQuantity: line.baseQuantity,
        },
      });
    }

    const receiptAt = new Date(completedAt.getTime() + 1);
    await ledgerRepository.insertMovement(client, {
      id: receiptMovementId,
      installationId: requestContext.installationId,
      movementType: 'TRANSFER_RECEIPT',
      sourceDomain: 'INVENTORY',
      sourceDocumentType: 'WAREHOUSE_LOCATION_MODE_RUN',
      sourceDocumentId: runId,
      sourceDocumentNumber: `WLM-${runId.slice(0, 8).toUpperCase()}`,
      documentDate: completedAt.toISOString().slice(0, 10),
      postedAt: receiptAt,
      postedBy: actorId(requestContext),
      requestId: requestContext.requestId,
      sourceApp: sourceApp(requestContext),
      idempotencyKey: receiptKey,
      payloadHash: payloadHash({ runId, side: 'RECEIPT', lines: preview.lines }),
      reversalOfMovementId: null,
      documentNumber: `WLM-${runId.slice(0, 8).toUpperCase()}-IN`,
      reasonCode: 'WAREHOUSE_LOCATION_MODE_CHANGE',
      reasonNote: targetMode === 'UNMANAGED' ? 'Chuyển sang tồn chung' : 'Bắt đầu quản lý vị trí',
      metadata: movementMetadata,
    });

    for (let index = 0; index < preview.lines.length; index += 1) {
      const line = preview.lines[index];
      const sourceIds = issueLineIds.get(line.id);
      const movementLineId = randomUUID();
      receiptLineIds.set(line.id, movementLineId);
      const quantity = parse12(line.baseQuantity);
      const representation = movementRepresentation(quantity);
      const legs = transferLegs(quantity);
      if (legs.negativeRelocation) {
        await client.query(
          `SELECT set_config('npp.warehouse_location_mode_negative_relocation', $1, true)`,
          [JSON.stringify({
            source: 'WAREHOUSE_LOCATION_MODE_SERVICE',
            installationId: requestContext.installationId,
            warehouseId,
            runId,
            issueMovementId,
            receiptMovementId,
            transferLineId: sourceIds.runLineId,
            sourceLocationId: line.sourceLocationId,
            destinationLocationId: line.destinationLocationId,
            baseVariantId: line.baseVariantId,
            lotId: line.lotId,
            signedBaseQuantity: line.baseQuantity,
          })],
        );
      }
      await ledgerRepository.insertMovementLine(client, {
        id: movementLineId,
        installationId: requestContext.installationId,
        movementId: receiptMovementId,
        lineNumber: index + 1,
        warehouseId,
        locationId: line.destinationLocationId,
        sourceVariantId: line.baseVariantId,
        sourceSku: line.baseSku,
        sourceUnitId: line.sourceUnitId,
        sourceUnitCode: line.sourceUnitCode,
        sourceQuantity: representation.sourceQuantity,
        conversionToBase: representation.conversionToBase,
        baseVariantId: line.baseVariantId,
        baseSku: line.baseSku,
        direction: legs.destinationDirection,
        baseQuantityDelta: legs.destinationBaseQuantityDelta,
        lotId: line.lotId,
        lotCode: line.lotCode,
        expiryDate: line.expiryDate,
        sourceLineReference: `WAREHOUSE-LOCATION-MODE-${sourceIds.runLineId}-DESTINATION`,
        metadata: {
          warehouseLocationModeRunId: runId,
          warehouseLocationModeRunLineId: sourceIds.runLineId,
          inventoryTransferLineId: sourceIds.runLineId,
          scopeSide: 'DESTINATION',
          transferKind: 'WAREHOUSE_LOCATION_MODE',
          negativeRelocation: legs.negativeRelocation,
          signedBaseQuantity: line.baseQuantity,
        },
      });
      if (legs.negativeRelocation) {
        await client.query(
          `SELECT set_config('npp.warehouse_location_mode_negative_relocation', '', true)`,
        );
      }
    }
  }

  const reservationMappings = await recreateReservationsAfterStockMove(client, {
    requestContext,
    runId,
    relocations: preview.reservationRelocations,
    occurredAt: new Date(completedAt.getTime() + 2).toISOString(),
  });

  const updatedWarehouse = await repository.updateWarehouseMode(client, {
    installationId: requestContext.installationId,
    warehouseId,
    targetMode,
    expectedModeVersion: Number(preview.warehouse.modeVersion),
    actorId: actorId(requestContext),
  });
  if (!updatedWarehouse) {
    return failure('WAREHOUSE_LOCATION_MODE_CONFLICT', 'Thiết lập kho đã thay đổi. Hãy xem trước lại.');
  }

  const runRow = await repository.insertRun(client, {
    id: runId,
    installationId: requestContext.installationId,
    warehouseId,
    warehouseCode: preview.warehouse.code,
    warehouseName: preview.warehouse.name,
    fromMode: preview.warehouse.currentMode ?? preview.warehouse.inferredMode,
    targetMode,
    destinationLocationId: preview.destinationLocation?.id ?? null,
    destinationLocationCode: preview.destinationLocation?.code ?? null,
    destinationLocationName: preview.destinationLocation?.name ?? null,
    previewHash: suppliedPreviewHash,
    payloadHash: requestHash,
    idempotencyKey,
    issueMovementId,
    receiptMovementId,
    affectedSkuCount: preview.summary.affectedSkuCount,
    affectedScopeCount: preview.summary.affectedScopeCount,
    totalBaseQuantity: preview.summary.totalBaseQuantity,
    completedAt,
    completedBy: actorId(requestContext),
    requestId: requestContext.requestId,
    sourceApp: sourceApp(requestContext),
    metadata: {
      previousModeVersion: preview.warehouse.modeVersion,
      nextModeVersion: String(updatedWarehouse.location_management_mode_version),
      lotScopeCount: preview.summary.lotScopeCount,
      negativeScopeCount: preview.summary.negativeScopeCount,
      relocatedReservationCount: reservationMappings.length,
      reservationMappings,
      quantityInvariant: 'warehouse_total_unchanged',
      reservedQuantityInvariant: 'warehouse_reserved_total_unchanged',
      valueInvariant: 'transfer_carrying_cost',
    },
  });

  for (const line of preview.lines) {
    const sourceIds = issueLineIds.get(line.id);
    await repository.insertRunLine(client, {
      id: sourceIds.runLineId,
      installationId: requestContext.installationId,
      runId,
      lineNumber: line.lineNumber,
      warehouseId,
      baseVariantId: line.baseVariantId,
      baseSku: line.baseSku,
      lotId: line.lotId,
      lotCode: line.lotCode,
      sourceLocationId: line.sourceLocationId,
      sourceLocationCode: line.sourceLocationCode,
      sourceLocationName: line.sourceLocationName,
      destinationLocationId: line.destinationLocationId,
      destinationLocationCode: line.destinationLocationCode,
      destinationLocationName: line.destinationLocationName,
      baseQuantity: line.baseQuantity,
      sourceScopeVersion: line.sourceScopeVersion,
      destinationScopeVersion: line.destinationScopeVersion,
      issueMovementLineId: sourceIds.movementLineId,
      receiptMovementLineId: receiptLineIds.get(line.id),
    });
  }

  return Object.freeze({ ok: true, run: await hydrateRun(client, runRow), replayed: false });
}

export async function listWarehouseLocationModeRuns(client, {
  requestContext,
  warehouseId = null,
  limit = 100,
  offset = 0,
}) {
  if (warehouseId && (!UUID_PATTERN.test(String(warehouseId)) || !hasWarehouse(requestContext, warehouseId))) {
    return failure('WAREHOUSE_SCOPE_DENIED', 'Kho nằm ngoài phạm vi được cấp quyền.');
  }
  const rows = await repository.listRuns(client, {
    installationId: requestContext.installationId,
    warehouseId,
    warehouseIds: warehouseIds(requestContext),
    limit,
    offset,
  });
  return Object.freeze({ ok: true, runs: Object.freeze(rows.map((row) => mapRun(row))) });
}

export async function getWarehouseLocationModeRun(client, {
  requestContext,
  runId,
}) {
  if (!UUID_PATTERN.test(String(runId ?? ''))) return failure('INVALID_RUN_ID', 'Lịch sử chuyển chế độ không hợp lệ.');
  const row = await repository.getRun(client, {
    installationId: requestContext.installationId,
    runId,
    warehouseIds: warehouseIds(requestContext),
  });
  if (!row) return failure('WAREHOUSE_LOCATION_MODE_RUN_NOT_FOUND', 'Không tìm thấy lịch sử chuyển chế độ trong phạm vi được cấp quyền.');
  return Object.freeze({ ok: true, run: await hydrateRun(client, row) });
}

export const warehouseLocationModeInternals = Object.freeze({
  inferMode,
  movementRepresentation,
  transferLegs,
  parse12,
  format12,
  payloadHash,
  scopeKey,
  modeShape,
  reservationPlan,
  deterministicUuid,
});