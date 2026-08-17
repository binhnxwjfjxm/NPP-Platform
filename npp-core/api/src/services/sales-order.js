import * as legacy from './sales-order-legacy.js';
import * as pricingService from './pricing.js';
import * as fulfillmentService from './sales-fulfillment.js';
import * as commercialRepository from '../db/repositories/sales-order-commercial.js';
import * as sourceEmployeeRepository from '../db/repositories/sales-order-provenance.js';
import * as deliveryExecutionRepository from '../db/repositories/sales-order-delivery-execution.js';
import {
  allocateLargestRemainder,
  canonicalPricingFingerprint,
  documentDiscountTarget,
  halfUp,
  normalizeDocumentDiscount,
  parseScaledDecimal,
} from './sales-order-commercial.js';

export * from './sales-order-legacy.js';

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const MONEY_PATTERN = /^(?:0|[1-9]\d{0,18})$/;
const SCALE = 1_000_000n;
const DELIVERY_EXECUTION_MODES = new Set(['TRIP', 'MANUAL']);

function failure(code, message, retryable = false, details = {}) {
  return Object.freeze({ ok: false, code, message, retryable, details });
}

function normalizeDeliveryExecution(payload) {
  const deliveryMode = String(payload?.deliveryMode ?? 'DELIVERY').trim().toUpperCase();
  const rawExecutionMode = payload?.deliveryExecutionMode;
  const supplied = rawExecutionMode !== undefined
    && rawExecutionMode !== null
    && String(rawExecutionMode).trim() !== '';

  if (deliveryMode === 'DELIVERY') {
    const deliveryExecutionMode = supplied
      ? String(rawExecutionMode).trim().toUpperCase()
      : 'TRIP';
    if (!DELIVERY_EXECUTION_MODES.has(deliveryExecutionMode)) {
      return failure('INVALID_DELIVERY_EXECUTION_MODE', 'Hình thức giao nhận không hợp lệ.');
    }
    return Object.freeze({ ok: true, deliveryExecutionMode });
  }

  if (deliveryMode === 'PICKUP') {
    if (supplied) {
      return failure(
        'DELIVERY_EXECUTION_MODE_NOT_APPLICABLE',
        'Khách nhận tại kho không dùng hình thức giao theo chuyến hoặc giao thủ công.',
      );
    }
    return Object.freeze({ ok: true, deliveryExecutionMode: null });
  }

  // Let the existing Sales Order validation own invalid broad delivery modes.
  return Object.freeze({ ok: true, deliveryExecutionMode: null });
}

function fallbackExecutionMode(deliveryMode, deliveryExecutionMode) {
  if (deliveryMode === 'PICKUP') return null;
  return deliveryExecutionMode ?? 'TRIP';
}

function mergeDetailedOrder(order, rows) {
  if (!order) return order;
  const facts = new Map((rows ?? []).map((row) => [
    String(row.version_number),
    fallbackExecutionMode(row.delivery_mode, row.delivery_execution_mode),
  ]));
  const versions = Array.isArray(order.versions)
    ? order.versions.map((version) => Object.freeze({
        ...version,
        deliveryExecutionMode: facts.has(String(version.versionNumber))
          ? facts.get(String(version.versionNumber))
          : fallbackExecutionMode(version.deliveryMode, null),
      }))
    : order.versions;
  const current = Array.isArray(versions)
    ? versions.find((version) => String(version.versionNumber) === String(order.currentVersionNumber))
      ?? versions.at(-1)
    : null;
  return Object.freeze({
    ...order,
    deliveryExecutionMode: current?.deliveryExecutionMode
      ?? fallbackExecutionMode(order.deliveryMode, null),
    versions: Array.isArray(versions) ? Object.freeze(versions) : versions,
  });
}

function sourceEmployeeContext(requestContext, payload) {
  const sourceType = String(payload?.sourceType ?? 'MANUAL').trim().toUpperCase();
  if (sourceType !== 'MCP') return { ok: true, employeeId: null };
  if (!Array.isArray(requestContext?.roles) || !requestContext.roles.includes('mcp-sales-order-service')) {
    return failure('MCP_SOURCE_CONTEXT_REQUIRED', 'Đơn MCP chỉ được tạo từ ngữ cảnh máy chủ MCP đã xác thực.');
  }
  const employeeId = String(requestContext?.employeeId ?? '').trim().toLowerCase();
  if (!UUID_PATTERN.test(employeeId)) {
    return failure('MCP_SOURCE_EMPLOYEE_REQUIRED', 'Thiếu ngữ cảnh nhân viên MCP đã xác thực.');
  }
  return { ok: true, employeeId };
}

function hasPermission(requestContext, permission) {
  return Array.isArray(requestContext?.permissions)
    && requestContext.permissions.includes(permission);
}

function withInternalPricePermission(requestContext) {
  const permissions = new Set(Array.isArray(requestContext?.permissions)
    ? requestContext.permissions
    : []);
  permissions.add('core.sales-order.price.override');
  return Object.freeze({
    ...requestContext,
    permissions: Object.freeze([...permissions]),
    authContext: requestContext?.authContext
      ? Object.freeze({
          ...requestContext.authContext,
          permissions: Object.freeze([...permissions]),
        })
      : requestContext?.authContext,
  });
}

function nonZeroLegacyLineDiscount(line) {
  const value = parseScaledDecimal(line?.discountValue ?? '0', { allowZero: true });
  return value !== null && value > 0n;
}

function priceContext(payload, line) {
  return {
    variantId: line.variantId,
    quantity: line.quantity,
    currencyCode: payload.currency ?? 'VND',
    priceAt: new Date().toISOString(),
    channelId: payload.salesChannelId,
    ...(String(payload.customerMode ?? 'EXISTING').toUpperCase() === 'WALK_IN'
      ? {}
      : { customerId: payload.customerId }),
  };
}

function manualOverride(line, requestContext, lineNumber) {
  const supplied = line?.manualUnitPriceMinor !== undefined
    && line?.manualUnitPriceMinor !== null
    && line?.manualUnitPriceMinor !== '';
  if (!supplied) return { ok: true, value: null, reason: null };
  if (!hasPermission(requestContext, 'core.sales-order.price.override')) {
    return failure(
      'PRICE_OVERRIDE_FORBIDDEN',
      'Price override permission is required',
      false,
      { line: lineNumber },
    );
  }
  const value = String(line.manualUnitPriceMinor).trim();
  if (!MONEY_PATTERN.test(value)) {
    return failure('INVALID_MONEY', 'Manual unit price must be a non-negative VND amount', false, { line: lineNumber });
  }
  const reason = String(line.manualReason ?? '').trim();
  if (!reason || reason.length > 500) {
    return failure(
      'PRICE_OVERRIDE_REASON_REQUIRED',
      'Price override reason is required and must not exceed 500 characters',
      false,
      { line: lineNumber },
    );
  }
  return { ok: true, value, reason };
}

async function resolveChannel(client, { requestContext, payload }) {
  let id = String(payload?.salesChannelId ?? '').trim();
  if (!id) {
    id = await commercialRepository.getDefaultSalesChannelId(client, {
      installationId: requestContext.installationId,
    }) ?? '';
  }
  if (!UUID_PATTERN.test(id)) {
    return failure('SALES_CHANNEL_REQUIRED', 'An active Sales channel is required');
  }
  const channel = await commercialRepository.getActiveSalesChannel(client, {
    installationId: requestContext.installationId,
    id,
  });
  if (!channel) {
    return failure('SALES_CHANNEL_NOT_FOUND', 'Active Sales channel not found');
  }
  return { ok: true, channel };
}

async function prepareCommercialPayload(client, { requestContext, payload }) {
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
    return failure('INVALID_INPUT', 'Sales Order payload is required');
  }
  if (!Array.isArray(payload.lines) || payload.lines.length === 0) {
    return failure('EMPTY_SALES_ORDER', 'Sales Order must contain at least one line');
  }

  const channelResult = await resolveChannel(client, { requestContext, payload });
  if (!channelResult.ok) return channelResult;
  const salesChannelId = channelResult.channel.id;
  const normalizedPayload = { ...payload, salesChannelId };
  const documentDiscount = normalizeDocumentDiscount(payload, requestContext);
  if (!documentDiscount.ok) return documentDiscount;
  if (documentDiscount.positive && payload.lines.some(nonZeroLegacyLineDiscount)) {
    return failure(
      'MIXED_DISCOUNT_SCOPE',
      'Document discount and non-zero line discount cannot be used together',
    );
  }

  const commercialLines = [];
  const grossByLine = [];
  for (let index = 0; index < payload.lines.length; index += 1) {
    const input = payload.lines[index] ?? {};
    const quantity = parseScaledDecimal(input.quantity, { allowZero: false, maxWholeDigits: 14 });
    if (quantity === null) {
      return failure('INVALID_QUANTITY', 'Quantity is invalid', false, { line: index + 1 });
    }
    const resolutionResult = await pricingService.resolvePrice(client, {
      installationId: requestContext.installationId,
      payload: {
        ...priceContext(normalizedPayload, input),
        salesChannelId,
        channelId: salesChannelId,
      },
    });
    if (!resolutionResult.ok) {
      return failure(
        resolutionResult.code,
        resolutionResult.message,
        Boolean(resolutionResult.retryable),
        { line: index + 1 },
      );
    }
    const resolution = resolutionResult.resolution;
    const systemUnitPriceMinor = String(
      resolution.systemUnitPriceMinor ?? resolution.finalUnitPriceMinor,
    );
    const fingerprint = resolution.resolutionFingerprint
      ?? canonicalPricingFingerprint({ ...resolution, systemUnitPriceMinor });
    if (
      input.expectedSystemUnitPriceMinor !== undefined
      && String(input.expectedSystemUnitPriceMinor) !== systemUnitPriceMinor
    ) {
      return failure(
        'SALES_PRICE_CHANGED',
        'System price changed after preview',
        false,
        {
          line: index + 1,
          variantId: input.variantId,
          expectedSystemUnitPriceMinor: String(input.expectedSystemUnitPriceMinor),
          currentSystemUnitPriceMinor: systemUnitPriceMinor,
          currentPricingFingerprint: fingerprint,
        },
      );
    }
    if (
      input.expectedPricingFingerprint
      && String(input.expectedPricingFingerprint) !== fingerprint
    ) {
      return failure(
        'SALES_PRICE_CHANGED',
        'Pricing rules changed after preview',
        false,
        {
          line: index + 1,
          variantId: input.variantId,
          expectedPricingFingerprint: String(input.expectedPricingFingerprint),
          currentPricingFingerprint: fingerprint,
          currentSystemUnitPriceMinor: systemUnitPriceMinor,
        },
      );
    }

    const manual = manualOverride(input, requestContext, index + 1);
    if (!manual.ok) return manual;
    const finalUnitPriceMinor = manual.value ?? systemUnitPriceMinor;
    const grossMinor = halfUp(quantity * BigInt(finalUnitPriceMinor), SCALE);
    grossByLine.push(grossMinor);
    commercialLines.push(Object.freeze({
      lineNumber: index + 1,
      input,
      quantity,
      baseUnitPriceMinor: String(resolution.baseUnitPriceMinor),
      systemUnitPriceMinor,
      finalUnitPriceMinor,
      systemTrace: Object.freeze([...(resolution.steps ?? [])]),
      fingerprint,
      manualReason: manual.reason,
    }));
  }

  const grossTotalMinor = grossByLine.reduce((sum, value) => sum + value, 0n);
  const targetMinor = documentDiscountTarget({
    mode: documentDiscount.mode,
    valueScaled: documentDiscount.scaled,
    grossTotalMinor,
  });
  const allocated = allocateLargestRemainder(grossByLine, targetMinor);
  if (!allocated.ok) return allocated;

  const legacyLines = commercialLines.map((line, index) => ({
    ...line.input,
    manualUnitPriceMinor: line.finalUnitPriceMinor,
    manualReason: line.manualReason ?? `system-price:${line.fingerprint}`,
    ...(documentDiscount.positive
      ? {
          discountMode: 'TOTAL_AMOUNT',
          discountValue: allocated.allocations[index].toString(),
        }
      : {}),
  }));

  return Object.freeze({
    ok: true,
    channel: channelResult.channel,
    documentDiscount,
    commercialLines,
    legacyPayload: Object.freeze({
      ...normalizedPayload,
      lines: Object.freeze(legacyLines),
    }),
    legacyRequestContext: withInternalPricePermission(requestContext),
  });
}

function mergeCommercialFacts(salesOrder, facts) {
  if (!salesOrder || !Array.isArray(salesOrder.versions)) return salesOrder;
  const versionFacts = new Map(
    facts.versions.map((version) => [String(version.version_number), version]),
  );
  const lineFacts = new Map();
  for (const line of facts.lines) {
    const key = `${line.version_number}:${line.line_number}`;
    lineFacts.set(key, line);
  }
  const versions = salesOrder.versions.map((version) => {
    const commercial = versionFacts.get(String(version.versionNumber));
    const lines = Array.isArray(version.lines)
      ? version.lines.map((line) => {
          const fact = lineFacts.get(`${version.versionNumber}:${line.lineNumber}`);
          return fact ? Object.freeze({
            ...line,
            baseUnitPrice: fact.base_unit_price === null ? null : String(fact.base_unit_price),
            systemUnitPrice: fact.system_unit_price === null ? null : String(fact.system_unit_price),
            manualOverrideReason: fact.manual_override_reason ?? null,
            pricingTrace: Array.isArray(fact.pricing_trace_snapshot)
              ? fact.pricing_trace_snapshot
              : [],
          }) : line;
        })
      : version.lines;
    return commercial ? Object.freeze({
      ...version,
      salesChannelId: commercial.sales_channel_id ?? null,
      salesChannelCode: commercial.sales_channel_code_snapshot ?? null,
      salesChannelName: commercial.sales_channel_name_snapshot ?? null,
      documentDiscountMode: commercial.document_discount_mode ?? 'NONE',
      documentDiscountValue: String(commercial.document_discount_value ?? 0),
      documentDiscountReason: commercial.document_discount_reason ?? null,
      lines,
    }) : version;
  });
  const current = versions.find(
    (version) => String(version.versionNumber) === String(salesOrder.currentVersionNumber),
  ) ?? versions.at(-1);
  return Object.freeze({
    ...salesOrder,
    salesChannelId: current?.salesChannelId ?? null,
    salesChannelCode: current?.salesChannelCode ?? null,
    salesChannelName: current?.salesChannelName ?? null,
    versions: Object.freeze(versions),
  });
}

function mergeSourceEmployeeFacts(salesOrder, facts) {
  if (!salesOrder) return salesOrder;
  const versionFacts = new Map(
    (facts?.versions ?? []).map((version) => [String(version.version_number), version.source_employee_id ?? null]),
  );
  const versions = Array.isArray(salesOrder.versions)
    ? salesOrder.versions.map((version) => Object.freeze({
        ...version,
        sourceEmployeeId: versionFacts.get(String(version.versionNumber)) ?? null,
      }))
    : salesOrder.versions;
  return Object.freeze({
    ...salesOrder,
    sourceEmployeeId: facts?.order?.source_employee_id ?? null,
    versions,
  });
}

function mergeFulfillmentProjection(salesOrder, fulfillment) {
  if (!salesOrder) return salesOrder;
  return Object.freeze({
    ...salesOrder,
    fulfillmentStatus: fulfillment?.status ?? salesOrder.fulfillmentStatus,
    fulfillment: fulfillment ?? null,
  });
}

async function enrichResult(client, requestContext, result) {
  if (!result?.ok || !result.salesOrder?.id) return result;
  const [facts, fulfillment, sourceEmployeeFacts, deliveryExecutionFacts] = await Promise.all([
    commercialRepository.loadCommercialFacts(client, {
      installationId: requestContext.installationId,
      salesOrderId: result.salesOrder.id,
    }),
    fulfillmentService.loadSalesOrderFulfillment(client, {
      requestContext,
      salesOrderId: result.salesOrder.id,
    }),
    sourceEmployeeRepository.loadSourceEmployeeFacts(client, {
      installationId: requestContext.installationId,
      salesOrderId: result.salesOrder.id,
    }),
    deliveryExecutionRepository.listVersionDeliveryExecutionModes(client, {
      installationId: requestContext.installationId,
      salesOrderId: result.salesOrder.id,
    }),
  ]);
  const enrichedOrder = mergeFulfillmentProjection(
    mergeSourceEmployeeFacts(
      mergeCommercialFacts(result.salesOrder, facts),
      sourceEmployeeFacts,
    ),
    fulfillment,
  );
  return Object.freeze({
    ...result,
    salesOrder: mergeDetailedOrder(enrichedOrder, deliveryExecutionFacts),
  });
}

async function applySnapshotAndReload(client, {
  requestContext,
  result,
  versionNumber,
  prepared,
}) {
  if (!result.ok) return result;
  const applied = await commercialRepository.applyCommercialSnapshot(client, {
    installationId: requestContext.installationId,
    salesOrderId: result.salesOrder.id,
    versionNumber,
    channel: prepared.channel,
    documentDiscount: prepared.documentDiscount,
    lines: prepared.commercialLines,
  });
  if (!applied) {
    return failure(
      'SALES_ORDER_COMMERCIAL_SNAPSHOT_FAILED',
      'Sales Order commercial snapshot could not be persisted',
      true,
    );
  }
  const reloaded = await legacy.getSalesOrder(client, {
    requestContext,
    id: result.salesOrder.id,
  });
  return enrichResult(client, requestContext, reloaded);
}

export async function listSalesOrders(client, input) {
  const result = await legacy.listSalesOrders(client, input);
  if (!result?.ok || !Array.isArray(result.salesOrders) || result.salesOrders.length === 0) return result;
  const rows = await deliveryExecutionRepository.listCurrentDeliveryExecutionModes(client, {
    installationId: input.requestContext.installationId,
    salesOrderIds: result.salesOrders.map((order) => order.id),
  });
  const facts = new Map(rows.map((row) => [
    row.sales_order_id,
    fallbackExecutionMode(row.delivery_mode, row.delivery_execution_mode),
  ]));
  return Object.freeze({
    ...result,
    salesOrders: Object.freeze(result.salesOrders.map((order) => Object.freeze({
      ...order,
      deliveryExecutionMode: facts.has(order.id)
        ? facts.get(order.id)
        : fallbackExecutionMode(order.deliveryMode, null),
    }))),
  });
}

export async function getSalesOrder(client, input) {
  return enrichResult(client, input.requestContext, await legacy.getSalesOrder(client, input));
}

export async function createSalesOrder(client, { requestContext, payload }) {
  const deliveryExecution = normalizeDeliveryExecution(payload);
  if (!deliveryExecution.ok) return deliveryExecution;

  const sourceEmployee = sourceEmployeeContext(requestContext, payload);
  if (!sourceEmployee.ok) return sourceEmployee;
  if (sourceEmployee.employeeId) {
    const activeEmployee = await sourceEmployeeRepository.getActiveSourceEmployee(client, {
      installationId: requestContext.installationId,
      employeeId: sourceEmployee.employeeId,
    });
    if (!activeEmployee) {
      return failure('MCP_SOURCE_EMPLOYEE_INVALID', 'Nhân viên MCP không còn hiệu lực trong Công Ty.');
    }
  }

  const prepared = await prepareCommercialPayload(client, { requestContext, payload });
  if (!prepared.ok) return prepared;
  const result = await legacy.createSalesOrder(client, {
    requestContext: prepared.legacyRequestContext,
    payload: prepared.legacyPayload,
  });
  if (!result.ok) return result;
  if (sourceEmployee.employeeId) {
    const provenanceApplied = await sourceEmployeeRepository.setInitialSourceEmployeeSnapshot(client, {
      installationId: requestContext.installationId,
      salesOrderId: result.salesOrder.id,
      versionNumber: 1,
      employeeId: sourceEmployee.employeeId,
    });
    if (!provenanceApplied) {
      return failure(
        'MCP_SOURCE_EMPLOYEE_SNAPSHOT_FAILED',
        'Không thể ghi nhận nhân viên nguồn cho đơn MCP.',
        true,
      );
    }
  }
  const executionApplied = await deliveryExecutionRepository.setVersionDeliveryExecutionMode(client, {
    installationId: requestContext.installationId,
    salesOrderId: result.salesOrder.id,
    versionNumber: 1,
    deliveryExecutionMode: deliveryExecution.deliveryExecutionMode,
  });
  if (!executionApplied) {
    return failure(
      'SALES_ORDER_DELIVERY_EXECUTION_SNAPSHOT_FAILED',
      'Không thể lưu hình thức giao nhận của đơn.',
      true,
    );
  }
  return applySnapshotAndReload(client, {
    requestContext,
    result,
    versionNumber: 1,
    prepared,
  });
}

export async function updateSalesOrderDraft(client, {
  requestContext,
  id,
  versionNumber,
  payload,
}) {
  const deliveryExecution = normalizeDeliveryExecution(payload);
  if (!deliveryExecution.ok) return deliveryExecution;

  const prepared = await prepareCommercialPayload(client, { requestContext, payload });
  if (!prepared.ok) return prepared;
  const result = await legacy.updateSalesOrderDraft(client, {
    requestContext: prepared.legacyRequestContext,
    id,
    versionNumber,
    payload: prepared.legacyPayload,
  });
  if (!result.ok) return result;
  const draft = result.salesOrder.versions?.find((version) => version.status === 'draft');
  const resolvedVersion = Number(versionNumber ?? draft?.versionNumber ?? result.salesOrder.currentVersionNumber);
  const executionApplied = await deliveryExecutionRepository.setVersionDeliveryExecutionMode(client, {
    installationId: requestContext.installationId,
    salesOrderId: id,
    versionNumber: resolvedVersion,
    deliveryExecutionMode: deliveryExecution.deliveryExecutionMode,
  });
  if (!executionApplied) {
    return failure(
      'SALES_ORDER_DELIVERY_EXECUTION_SNAPSHOT_FAILED',
      'Không thể lưu hình thức giao nhận của đơn.',
      true,
    );
  }
  return applySnapshotAndReload(client, {
    requestContext,
    result,
    versionNumber: resolvedVersion,
    prepared,
  });
}

export async function createSalesOrderAmendment(client, { requestContext, id, payload }) {
  const before = await getSalesOrder(client, { requestContext, id });
  if (!before.ok) return before;
  const fromVersionNumber = Number(before.salesOrder.currentVersionNumber);
  const sourceExecutionMode = before.salesOrder.deliveryExecutionMode;
  const result = await legacy.createSalesOrderAmendment(client, { requestContext, id, payload });
  if (!result.ok) return result;
  const draft = result.salesOrder.versions?.find((version) => version.status === 'draft');
  const toVersionNumber = Number(draft?.versionNumber ?? fromVersionNumber + 1);
  const provenanceCopied = await sourceEmployeeRepository.copySourceEmployeeSnapshotToDraft(client, {
    installationId: requestContext.installationId,
    salesOrderId: id,
    fromVersionNumber,
    toVersionNumber,
  });
  if (!provenanceCopied) {
    return failure(
      'SALES_ORDER_SOURCE_EMPLOYEE_SNAPSHOT_FAILED',
      'Không thể sao chép nguồn nhân viên sang phiên bản điều chỉnh.',
      true,
    );
  }
  const copied = await commercialRepository.copyCommercialSnapshotToDraft(client, {
    installationId: requestContext.installationId,
    salesOrderId: id,
    fromVersionNumber,
    toVersionNumber,
  });
  if (!copied) {
    return failure(
      'SALES_ORDER_COMMERCIAL_SNAPSHOT_FAILED',
      'Amendment commercial snapshot could not be copied',
      true,
    );
  }
  const executionApplied = await deliveryExecutionRepository.setVersionDeliveryExecutionMode(client, {
    installationId: requestContext.installationId,
    salesOrderId: id,
    versionNumber: toVersionNumber,
    deliveryExecutionMode: fallbackExecutionMode(draft?.deliveryMode, sourceExecutionMode),
  });
  if (!executionApplied) {
    return failure(
      'SALES_ORDER_DELIVERY_EXECUTION_SNAPSHOT_FAILED',
      'Không thể sao chép hình thức giao nhận sang bản điều chỉnh.',
      true,
    );
  }
  return enrichResult(
    client,
    requestContext,
    await legacy.getSalesOrder(client, { requestContext, id }),
  );
}

async function verifyDraftPricing(client, {
  requestContext,
  id,
  versionNumber,
}) {
  const snapshot = await commercialRepository.getDraftCommercialSnapshot(client, {
    installationId: requestContext.installationId,
    salesOrderId: id,
    versionNumber,
  });
  if (!snapshot) return failure('SALES_ORDER_DRAFT_NOT_FOUND', 'Draft version not found');
  if (!snapshot.version.sales_channel_id) {
    return failure('SALES_CHANNEL_REQUIRED', 'An active Sales channel is required');
  }
  const channel = await commercialRepository.getActiveSalesChannel(client, {
    installationId: requestContext.installationId,
    id: snapshot.version.sales_channel_id,
  });
  if (!channel) return failure('SALES_CHANNEL_NOT_FOUND', 'Active Sales channel not found');

  const changed = [];
  for (const line of snapshot.lines) {
    const automatic = await pricingService.resolvePrice(client, {
      installationId: requestContext.installationId,
      payload: {
        variantId: line.variant_id,
        quantity: String(line.ordered_quantity),
        currencyCode: snapshot.version.currency_code,
        channelId: channel.id,
        ...(snapshot.version.customer_mode_snapshot === 'WALK_IN'
          ? {}
          : { customerId: snapshot.version.customer_id }),
      },
    });
    if (!automatic.ok) {
      changed.push({
        line: Number(line.line_number),
        variantId: line.variant_id,
        code: automatic.code,
      });
      continue;
    }
    const currentSystem = String(
      automatic.resolution.systemUnitPriceMinor
        ?? automatic.resolution.finalUnitPriceMinor,
    );
    const currentFingerprint = automatic.resolution.resolutionFingerprint
      ?? canonicalPricingFingerprint(automatic.resolution);
    const storedTrace = Array.isArray(line.pricing_trace_snapshot)
      ? line.pricing_trace_snapshot
      : [];
    const storedFingerprint = storedTrace.find(
      (step) => step?.kind === 'RESOLUTION',
    )?.resolutionFingerprint ?? null;
    if (
      currentSystem !== String(line.system_unit_price)
      || (storedFingerprint && storedFingerprint !== currentFingerprint)
    ) {
      changed.push({
        line: Number(line.line_number),
        variantId: line.variant_id,
        previousSystemUnitPriceMinor: String(line.system_unit_price),
        currentSystemUnitPriceMinor: currentSystem,
        previousPricingFingerprint: storedFingerprint,
        currentPricingFingerprint: currentFingerprint,
      });
    }
  }
  return changed.length > 0
    ? failure(
        'SALES_PRICE_CHANGED',
        'System price changed after the draft was reviewed',
        false,
        { lines: changed },
      )
    : { ok: true };
}

export async function confirmSalesOrder(client, {
  requestContext,
  id,
  versionNumber,
  idempotencyKey,
}) {
  const existing = await legacy.getSalesOrder(client, { requestContext, id });
  if (!existing.ok) return existing;
  const draft = existing.salesOrder.versions?.find((version) => version.status === 'draft');
  const resolvedVersion = Number(
    versionNumber
      ?? draft?.versionNumber
      ?? existing.salesOrder.currentVersionNumber,
  );
  const verified = await verifyDraftPricing(client, {
    requestContext,
    id,
    versionNumber: resolvedVersion,
  });
  if (!verified.ok) return verified;
  const result = await legacy.confirmSalesOrder(client, {
    requestContext,
    id,
    versionNumber: resolvedVersion,
    idempotencyKey,
  });
  if (!result.ok) return result;
  const fulfillment = await fulfillmentService.replaceSalesOrderFulfillmentDemand(client, {
    requestContext,
    salesOrderId: id,
    versionNumber: resolvedVersion,
  });
  if (!fulfillment.ok) return fulfillment;
  return enrichResult(client, requestContext, result);
}

export async function cancelSalesOrder(client, input) {
  const result = await legacy.cancelSalesOrder(client, input);
  if (!result.ok) return result;
  const fulfillment = await fulfillmentService.cancelSalesOrderFulfillmentDemand(client, {
    requestContext: input.requestContext,
    salesOrderId: input.id,
  });
  if (!fulfillment.ok) return fulfillment;
  return enrichResult(client, input.requestContext, result);
}

export const salesOrderDeliveryExecutionInternals = Object.freeze({
  normalizeDeliveryExecution,
  fallbackExecutionMode,
  mergeDetailedOrder,
});
