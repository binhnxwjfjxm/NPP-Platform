import * as repository from '../db/repositories/payable.js';

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;
const SCALE = 1_000_000n;

function failure(code, message, retryable = false, details = {}) {
  return Object.freeze({ ok: false, code, message, retryable, details });
}

function isUuid(value) {
  return typeof value === 'string' && UUID_PATTERN.test(value.trim());
}

function normalizeText(value, max = 256) {
  if (value == null || value === '') return null;
  const normalized = String(value).trim();
  return normalized && normalized.length <= max ? normalized : null;
}

function normalizeDate(value) {
  const normalized = normalizeText(value, 10);
  if (!normalized || !DATE_PATTERN.test(normalized)) return null;
  const parsed = new Date(`${normalized}T00:00:00.000Z`);
  return Number.isNaN(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== normalized ? null : normalized;
}

function dateOnly(value) {
  if (typeof value === 'string') return value.slice(0, 10);
  if (value instanceof Date && !Number.isNaN(value.getTime())) return value.toISOString().slice(0, 10);
  return null;
}

function timestamp(value, fallback = new Date().toISOString()) {
  if (value instanceof Date && !Number.isNaN(value.getTime())) return value.toISOString();
  const parsed = new Date(String(value ?? ''));
  return Number.isNaN(parsed.getTime()) ? fallback : parsed.toISOString();
}

function addDays(dateValue, days) {
  const parsed = new Date(`${dateValue}T00:00:00.000Z`);
  parsed.setUTCDate(parsed.getUTCDate() + Number(days || 0));
  return parsed.toISOString().slice(0, 10);
}

function decimalToScaled(value, { allowZero = true } = {}) {
  const raw = String(value ?? '').trim();
  const match = raw.match(/^(\d+)(?:\.(\d{0,6}))?$/);
  if (!match) return null;
  const scaled = BigInt(match[1]) * SCALE + BigInt((match[2] ?? '').padEnd(6, '0'));
  if ((!allowZero && scaled <= 0n) || scaled < 0n) return null;
  return scaled;
}

function scaledToDecimal(value) {
  const negative = value < 0n;
  const absolute = negative ? -value : value;
  const whole = absolute / SCALE;
  const fraction = String(absolute % SCALE).padStart(6, '0');
  return `${negative ? '-' : ''}${whole}.${fraction}`;
}

function roundPositiveDivision(numerator, denominator) {
  if (denominator <= 0n || numerator < 0n) throw new Error('invalid_payable_decimal_operation');
  return (numerator + denominator / 2n) / denominator;
}

function multiplyScaled(left, right) {
  return roundPositiveDivision(left * right, SCALE);
}

function prorateScaled(amount, quantity, totalQuantity) {
  return roundPositiveDivision(amount * quantity, totalQuantity);
}

function warehouseScopeIds(requestContext) {
  return Array.isArray(requestContext?.scopes?.warehouseIds)
    ? requestContext.scopes.warehouseIds.filter(isUuid)
    : [];
}

function warehouseAllowed(requestContext, warehouseId) {
  return warehouseScopeIds(requestContext).includes(warehouseId);
}

function mapLine(row) {
  return Object.freeze({
    id: row.id,
    lineNumber: Number(row.line_number),
    sourceGoodsReceiptLineId: row.source_goods_receipt_line_id,
    sourceSupplierReturnLineId: row.source_supplier_return_line_id ?? null,
    sourcePurchaseOrderLineId: row.source_purchase_order_line_id,
    sku: row.sku_snapshot,
    itemName: row.item_name_snapshot,
    unitCode: row.unit_code_snapshot,
    quantity: String(row.quantity),
    unitPrice: String(row.unit_price),
    grossAmount: String(row.gross_amount),
    discountAmount: String(row.discount_amount),
    taxAmount: String(row.tax_amount),
    lineAmount: String(row.line_amount),
  });
}

function mapLedgerEntry(row) {
  return Object.freeze({
    id: row.id,
    entryType: row.entry_type,
    amount: String(row.amount),
    sourceRevision: String(row.source_revision),
    documentStatusAfter: row.document_status_after,
    actorId: row.actor_id,
    requestId: row.request_id,
    sourceApp: row.source_app,
    occurredAt: timestamp(row.occurred_at),
    metadata: row.metadata ?? {},
  });
}

function mapDocument(row) {
  return Object.freeze({
    id: row.id,
    supplierId: row.supplier_id,
    supplierCode: row.supplier_code ?? null,
    supplierName: row.supplier_name ?? null,
    warehouseId: row.warehouse_id,
    warehouseCode: row.warehouse_code ?? null,
    warehouseName: row.warehouse_name ?? null,
    direction: row.direction,
    documentType: row.document_type,
    sourceDocumentType: row.source_document_type,
    sourceDocumentId: row.source_document_id,
    sourceDocumentNumber: row.source_document_number,
    sourceDocumentDate: dateOnly(row.source_document_date),
    currencyCode: row.currency_code,
    paymentMethod: row.payment_method_snapshot,
    paymentTermDays: Number(row.payment_term_days_snapshot),
    dueDate: dateOnly(row.due_date),
    originalAmount: String(row.original_amount),
    allocatedAmount: String(row.allocated_amount),
    remainingAmount: String(row.remaining_amount),
    signedOriginalAmount: row.direction === 'DEBIT' ? String(row.original_amount) : `-${row.original_amount}`,
    status: row.status,
    sourceRevision: String(row.source_revision),
    postingOrigin: row.posting_origin,
    postedAt: timestamp(row.posted_at),
    postedBy: row.posted_by,
    reversedAt: row.reversed_at ? timestamp(row.reversed_at) : null,
    reversedBy: row.reversed_by ?? null,
    reversalReason: row.reversal_reason ?? null,
    revision: String(row.revision),
    lines: Object.freeze((row.lines ?? []).map(mapLine)),
    ledgerEntries: Object.freeze((row.ledger_entries ?? []).map(mapLedgerEntry)),
  });
}

function mapBalance(row) {
  return Object.freeze({
    supplierId: row.supplier_id,
    supplierCode: row.supplier_code,
    supplierName: row.supplier_name,
    currencyCode: row.currency_code,
    balance: String(row.balance),
    openAmount: String(row.open_amount),
    overdueAmount: String(row.overdue_amount),
    openDocumentCount: Number(row.open_document_count),
    updatedAt: timestamp(row.updated_at),
  });
}

function normalizePagination(limit, offset) {
  const parsedLimit = Number(limit ?? 100);
  const parsedOffset = Number(offset ?? 0);
  if (!Number.isInteger(parsedLimit) || parsedLimit < 1 || parsedLimit > 1000) {
    return failure('INVALID_LIMIT', 'limit must be an integer between 1 and 1000');
  }
  if (!Number.isInteger(parsedOffset) || parsedOffset < 0 || parsedOffset > 100000) {
    return failure('INVALID_OFFSET', 'offset must be an integer between 0 and 100000');
  }
  return Object.freeze({ ok: true, limit: parsedLimit, offset: parsedOffset });
}

export async function listPayableDocuments(client, input) {
  const scopes = warehouseScopeIds(input.requestContext);
  if (!scopes.length) return failure('WAREHOUSE_SCOPE_DENIED', 'At least one authorized warehouse is required');
  const pagination = normalizePagination(input.limit, input.offset);
  if (!pagination.ok) return pagination;
  const supplierId = input.supplierId == null || input.supplierId === '' ? null : String(input.supplierId).trim();
  if (supplierId && !isUuid(supplierId)) return failure('INVALID_SUPPLIER_ID', 'Supplier ID must be a valid UUID');
  const warehouseId = input.warehouseId == null || input.warehouseId === '' ? null : String(input.warehouseId).trim();
  if (warehouseId && (!isUuid(warehouseId) || !warehouseAllowed(input.requestContext, warehouseId))) {
    return failure('WAREHOUSE_SCOPE_DENIED', 'Warehouse is outside the authorized scope');
  }
  const allowedStatuses = new Set(['open', 'partially_allocated', 'settled', 'reversed']);
  const status = input.status == null || input.status === '' ? null : String(input.status).trim();
  if (status && !allowedStatuses.has(status)) return failure('INVALID_STATUS', 'Invalid payable status');
  const allowedDirections = new Set(['DEBIT', 'CREDIT']);
  const direction = input.direction == null || input.direction === '' ? null : String(input.direction).trim().toUpperCase();
  if (direction && !allowedDirections.has(direction)) return failure('INVALID_DIRECTION', 'Invalid payable direction');
  const dueBefore = input.dueBefore == null || input.dueBefore === '' ? null : normalizeDate(input.dueBefore);
  if (input.dueBefore && !dueBefore) return failure('INVALID_DUE_DATE', 'dueBefore must be a valid YYYY-MM-DD date');
  const search = normalizeText(input.search, 256);
  if (input.search && !search) return failure('INVALID_SEARCH', 'Search must not exceed 256 characters');
  const rows = await repository.listPayableDocuments(client, {
    installationId: input.requestContext.installationId,
    warehouseIds: scopes,
    supplierId,
    warehouseId,
    status,
    direction,
    dueBefore,
    search,
    limit: pagination.limit,
    offset: pagination.offset,
  });
  return Object.freeze({ ok: true, payableDocuments: Object.freeze(rows.map(mapDocument)) });
}

export async function getPayableDocument(client, { requestContext, id }) {
  if (!isUuid(id)) return failure('PAYABLE_DOCUMENT_NOT_FOUND', 'Payable document was not found');
  const scopes = warehouseScopeIds(requestContext);
  if (!scopes.length) return failure('WAREHOUSE_SCOPE_DENIED', 'At least one authorized warehouse is required');
  const row = await repository.getPayableDocumentById(client, {
    installationId: requestContext.installationId,
    id: id.trim(),
    warehouseIds: scopes,
  });
  return row
    ? Object.freeze({ ok: true, payableDocument: mapDocument(row) })
    : failure('PAYABLE_DOCUMENT_NOT_FOUND', 'Payable document was not found');
}

export async function listSupplierPayableBalances(client, input) {
  const scopes = warehouseScopeIds(input.requestContext);
  if (!scopes.length) return failure('WAREHOUSE_SCOPE_DENIED', 'At least one authorized warehouse is required');
  const pagination = normalizePagination(input.limit, input.offset);
  if (!pagination.ok) return pagination;
  const supplierId = input.supplierId == null || input.supplierId === '' ? null : String(input.supplierId).trim();
  if (supplierId && !isUuid(supplierId)) return failure('INVALID_SUPPLIER_ID', 'Supplier ID must be a valid UUID');
  const search = normalizeText(input.search, 256);
  if (input.search && !search) return failure('INVALID_SEARCH', 'Search must not exceed 256 characters');
  const rows = await repository.listSupplierPayableBalances(client, {
    installationId: input.requestContext.installationId,
    warehouseIds: scopes,
    supplierId,
    search,
    limit: pagination.limit,
    offset: pagination.offset,
  });
  return Object.freeze({ ok: true, balances: Object.freeze(rows.map(mapBalance)) });
}

function buildGoodsReceiptLines(source) {
  const lines = [];
  let total = 0n;
  for (const row of source.lines) {
    const quantity = decimalToScaled(row.quantity, { allowZero: false });
    const orderedQuantity = decimalToScaled(row.ordered_quantity, { allowZero: false });
    const unitPrice = decimalToScaled(row.unit_price);
    const orderDiscount = decimalToScaled(row.order_discount_amount);
    const orderTax = decimalToScaled(row.order_tax_amount);
    if ([quantity, orderedQuantity, unitPrice, orderDiscount, orderTax].some((value) => value === null)) {
      return failure('INVALID_SOURCE_AMOUNT', 'Stored purchase pricing snapshot is invalid');
    }
    const gross = multiplyScaled(quantity, unitPrice);
    const discount = prorateScaled(orderDiscount, quantity, orderedQuantity);
    const tax = prorateScaled(orderTax, quantity, orderedQuantity);
    const lineAmount = gross - discount + tax;
    if (lineAmount < 0n) return failure('INVALID_SOURCE_AMOUNT', 'Stored purchase pricing produces a negative payable amount');
    total += lineAmount;
    lines.push(Object.freeze({
      lineNumber: Number(row.line_number),
      sourceGoodsReceiptLineId: row.source_goods_receipt_line_id,
      sourcePurchaseOrderLineId: row.source_purchase_order_line_id,
      skuSnapshot: row.sku_snapshot,
      itemNameSnapshot: row.item_name_snapshot,
      unitCodeSnapshot: row.unit_code_snapshot,
      quantity: scaledToDecimal(quantity),
      unitPrice: scaledToDecimal(unitPrice),
      grossAmount: scaledToDecimal(gross),
      discountAmount: scaledToDecimal(discount),
      taxAmount: scaledToDecimal(tax),
      lineAmount: scaledToDecimal(lineAmount),
    }));
  }
  return Object.freeze({ ok: true, lines: Object.freeze(lines), total });
}

async function createPayableFromSource(client, {
  requestContext,
  source,
  direction,
  documentType,
  sourceDocumentType,
  paymentMethod,
  termDays,
  dueDate,
  lines,
  total,
  entryType,
}) {
  if (total <= 0n) return Object.freeze({ ok: true, payableDocument: null, skipped: true });
  const postedAt = timestamp(source.posted_at, requestContext.receivedAt);
  const document = await repository.insertPayableDocument(client, {
    installationId: requestContext.installationId,
    supplierId: source.supplier_id,
    warehouseId: source.warehouse_id,
    direction,
    documentType,
    sourceDocumentType,
    sourceDocumentId: source.id,
    sourceDocumentNumber: source.document_number,
    sourceDocumentDate: dateOnly(source.receipt_date ?? source.return_date),
    currencyCode: source.currency_code,
    paymentMethodSnapshot: paymentMethod,
    paymentTermDaysSnapshot: termDays,
    dueDate,
    originalAmount: scaledToDecimal(total),
    sourceRevision: String(source.revision),
    postedAt,
    actorId: requestContext.actorId,
  });
  await repository.insertPayableDocumentLines(client, {
    installationId: requestContext.installationId,
    payableDocumentId: document.id,
    lines,
    actorId: requestContext.actorId,
    createdAt: postedAt,
  });
  await repository.insertPayableLedgerEntry(client, {
    installationId: requestContext.installationId,
    payableDocumentId: document.id,
    supplierId: source.supplier_id,
    currencyCode: source.currency_code,
    entryType,
    amount: scaledToDecimal(direction === 'DEBIT' ? total : -total),
    sourceDocumentType,
    sourceDocumentId: source.id,
    sourceDocumentNumber: source.document_number,
    sourceRevision: String(source.revision),
    documentStatusAfter: 'open',
    actorId: requestContext.actorId,
    requestId: requestContext.requestId,
    sourceApp: requestContext.sourceApp,
    occurredAt: postedAt,
    metadata: { warehouseId: source.warehouse_id, postingOrigin: 'runtime' },
  });
  const hydrated = await repository.getPayableDocumentBySource(client, {
    installationId: requestContext.installationId,
    sourceDocumentType,
    sourceDocumentId: source.id,
  });
  return Object.freeze({ ok: true, payableDocument: hydrated ? mapDocument(hydrated) : mapDocument(document) });
}

export async function postGoodsReceiptPayable(client, { requestContext, goodsReceiptId }) {
  const existing = await repository.getPayableDocumentBySource(client, {
    installationId: requestContext.installationId,
    sourceDocumentType: 'GOODS_RECEIPT',
    sourceDocumentId: goodsReceiptId,
    forUpdate: true,
  });
  if (existing) return Object.freeze({ ok: true, payableDocument: mapDocument(existing), replayed: true });
  const source = await repository.getGoodsReceiptPayableSource(client, {
    installationId: requestContext.installationId,
    goodsReceiptId,
  });
  if (!source) return failure('PAYABLE_SOURCE_NOT_POSTED', 'Posted goods receipt payable source was not found');
  const built = buildGoodsReceiptLines(source);
  if (!built.ok) return built;
  const receiptDate = dateOnly(source.receipt_date);
  return createPayableFromSource(client, {
    requestContext,
    source,
    direction: 'DEBIT',
    documentType: 'GOODS_RECEIPT',
    sourceDocumentType: 'GOODS_RECEIPT',
    paymentMethod: source.payment_method,
    termDays: Number(source.term_days),
    dueDate: addDays(receiptDate, source.term_days),
    lines: built.lines,
    total: built.total,
    entryType: 'GOODS_RECEIPT_POST',
  });
}

function buildSupplierReturnLines(source, activeCredits) {
  const lines = [];
  let total = 0n;
  for (const row of source.lines) {
    const quantity = decimalToScaled(row.quantity, { allowZero: false });
    const sourceQuantity = decimalToScaled(row.source_quantity, { allowZero: false });
    const sourceGross = decimalToScaled(row.source_gross_amount);
    const sourceDiscount = decimalToScaled(row.source_discount_amount);
    const sourceTax = decimalToScaled(row.source_tax_amount);
    const sourceTotal = decimalToScaled(row.source_line_amount);
    const unitPrice = decimalToScaled(row.unit_price);
    if ([quantity, sourceQuantity, sourceGross, sourceDiscount, sourceTax, sourceTotal, unitPrice].some((value) => value === null)) {
      return failure('INVALID_SOURCE_AMOUNT', 'Stored goods receipt payable snapshot is invalid');
    }
    const credited = activeCredits.get(row.source_goods_receipt_line_id) ?? {};
    const previousQuantity = decimalToScaled(credited.credited_quantity ?? '0') ?? 0n;
    const previousGross = decimalToScaled(credited.credited_gross ?? '0') ?? 0n;
    const previousDiscount = decimalToScaled(credited.credited_discount ?? '0') ?? 0n;
    const previousTax = decimalToScaled(credited.credited_tax ?? '0') ?? 0n;
    const previousTotal = decimalToScaled(credited.credited_total ?? '0') ?? 0n;
    if (previousQuantity + quantity > sourceQuantity) {
      return failure('PAYABLE_CREDIT_EXCEEDS_SOURCE', 'Supplier return payable credit exceeds the source goods receipt amount');
    }
    const completesSource = previousQuantity + quantity === sourceQuantity;
    const gross = completesSource ? sourceGross - previousGross : prorateScaled(sourceGross, quantity, sourceQuantity);
    const discount = completesSource ? sourceDiscount - previousDiscount : prorateScaled(sourceDiscount, quantity, sourceQuantity);
    const tax = completesSource ? sourceTax - previousTax : prorateScaled(sourceTax, quantity, sourceQuantity);
    const lineAmount = completesSource ? sourceTotal - previousTotal : gross - discount + tax;
    if ([gross, discount, tax, lineAmount].some((value) => value < 0n)) {
      return failure('PAYABLE_CREDIT_EXCEEDS_SOURCE', 'Supplier return payable credit exceeds the source goods receipt amount');
    }
    total += lineAmount;
    lines.push(Object.freeze({
      lineNumber: Number(row.line_number),
      sourceGoodsReceiptLineId: row.source_goods_receipt_line_id,
      sourceSupplierReturnLineId: row.source_supplier_return_line_id,
      sourcePurchaseOrderLineId: row.source_purchase_order_line_id,
      skuSnapshot: row.sku_snapshot,
      itemNameSnapshot: row.item_name_snapshot,
      unitCodeSnapshot: row.unit_code_snapshot,
      quantity: scaledToDecimal(quantity),
      unitPrice: scaledToDecimal(unitPrice),
      grossAmount: scaledToDecimal(gross),
      discountAmount: scaledToDecimal(discount),
      taxAmount: scaledToDecimal(tax),
      lineAmount: scaledToDecimal(lineAmount),
    }));
  }
  return Object.freeze({ ok: true, lines: Object.freeze(lines), total });
}

export async function postSupplierReturnPayable(client, { requestContext, supplierReturnId }) {
  const existing = await repository.getPayableDocumentBySource(client, {
    installationId: requestContext.installationId,
    sourceDocumentType: 'SUPPLIER_RETURN',
    sourceDocumentId: supplierReturnId,
    forUpdate: true,
  });
  if (existing) return Object.freeze({ ok: true, payableDocument: mapDocument(existing), replayed: true });
  const source = await repository.getSupplierReturnPayableSource(client, {
    installationId: requestContext.installationId,
    supplierReturnId,
  });
  if (!source) return failure('PAYABLE_SOURCE_NOT_POSTED', 'Posted supplier return payable source was not found');
  if (!source.lines.length) return Object.freeze({ ok: true, payableDocument: null, skipped: true });
  const currencies = new Set(source.lines.map((line) => line.currency_code));
  if (currencies.size !== 1) return failure('PAYABLE_CURRENCY_MISMATCH', 'Supplier return source payable currencies do not match');
  source.currency_code = source.lines[0].currency_code;
  const activeCredits = await repository.getActiveCreditTotals(client, {
    installationId: requestContext.installationId,
    sourceGoodsReceiptLineIds: source.lines.map((line) => line.source_goods_receipt_line_id),
  });
  const built = buildSupplierReturnLines(source, activeCredits);
  if (!built.ok) return built;
  const returnDate = dateOnly(source.return_date);
  return createPayableFromSource(client, {
    requestContext,
    source,
    direction: 'CREDIT',
    documentType: 'SUPPLIER_RETURN_CREDIT',
    sourceDocumentType: 'SUPPLIER_RETURN',
    paymentMethod: 'CREDIT_NOTE',
    termDays: 0,
    dueDate: returnDate,
    lines: built.lines,
    total: built.total,
    entryType: 'SUPPLIER_RETURN_POST',
  });
}

export async function reverseSourcePayable(client, {
  requestContext,
  sourceDocumentType,
  sourceDocumentId,
  sourceRevision,
  reversedAt,
  reversalReason,
}) {
  const document = await repository.getPayableDocumentBySource(client, {
    installationId: requestContext.installationId,
    sourceDocumentType,
    sourceDocumentId,
    forUpdate: true,
  });
  if (!document) return Object.freeze({ ok: true, payableDocument: null, skipped: true });
  if (document.status === 'reversed') return Object.freeze({ ok: true, payableDocument: mapDocument(document), replayed: true });
  if (decimalToScaled(document.allocated_amount) !== 0n) {
    return failure('PAYABLE_ALLOCATION_EXISTS', 'Allocated payable documents cannot be reversed before allocations are reversed');
  }
  const reason = normalizeText(reversalReason, 2000);
  if (!reason) return failure('PAYABLE_REVERSAL_REASON_REQUIRED', 'Payable reversal reason is required');
  const occurredAt = timestamp(reversedAt, requestContext.receivedAt);
  const reversed = await repository.reversePayableDocument(client, {
    installationId: requestContext.installationId,
    id: document.id,
    actorId: requestContext.actorId,
    reversedAt: occurredAt,
    reversalReason: reason,
  });
  if (!reversed) return failure('PAYABLE_DOCUMENT_CONFLICT', 'Payable document was changed by another request', true);
  const amount = decimalToScaled(document.original_amount, { allowZero: false });
  const isDebit = document.direction === 'DEBIT';
  await repository.insertPayableLedgerEntry(client, {
    installationId: requestContext.installationId,
    payableDocumentId: document.id,
    supplierId: document.supplier_id,
    currencyCode: document.currency_code,
    entryType: sourceDocumentType === 'GOODS_RECEIPT' ? 'GOODS_RECEIPT_REVERSE' : 'SUPPLIER_RETURN_REVERSE',
    amount: scaledToDecimal(isDebit ? -amount : amount),
    sourceDocumentType,
    sourceDocumentId,
    sourceDocumentNumber: document.source_document_number,
    sourceRevision: String(sourceRevision),
    documentStatusAfter: 'reversed',
    actorId: requestContext.actorId,
    requestId: requestContext.requestId,
    sourceApp: requestContext.sourceApp,
    occurredAt,
    metadata: { reason, postingOrigin: 'runtime' },
  });
  const hydrated = await repository.getPayableDocumentBySource(client, {
    installationId: requestContext.installationId,
    sourceDocumentType,
    sourceDocumentId,
  });
  return Object.freeze({ ok: true, payableDocument: mapDocument(hydrated ?? reversed) });
}

export const payableInternals = Object.freeze({
  decimalToScaled,
  scaledToDecimal,
  multiplyScaled,
  prorateScaled,
  addDays,
  buildGoodsReceiptLines,
  buildSupplierReturnLines,
});
