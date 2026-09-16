import { createWriteStream } from 'node:fs';
import { mkdtemp, rm, stat } from 'node:fs/promises';
import { once } from 'node:events';
import { finished } from 'node:stream/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { buildMultiSheetXlsx } from '../backup/artifacts.js';
import { grossMarginReport } from '../routes/reporting-finance.js';

const FORMATS = new Set(['xlsx', 'csv']);
const MAX_EXPORT_ROWS = 100_000;

function column(key, label) {
  return Object.freeze({ key, label });
}

const COLUMN_DEFINITIONS = Object.freeze({
  customerCode: column('customerCode', 'Mã khách hàng'),
  customerName: column('customerName', 'Khách hàng'),
  sku: column('sku', 'SKU'),
  productName: column('productName', 'Tên sản phẩm'),
  lineCount: column('lineCount', 'Số dòng'),
  documentDate: column('documentDate', 'Ngày'),
  documentNumber: column('documentNumber', 'Chứng từ'),
  eventKind: column('eventKind', 'Loại phát sinh'),
  warehouseCode: column('warehouseCode', 'Kho'),
  currencyCode: column('currencyCode', 'Tiền tệ'),
  netRevenue: column('netRevenue', 'Doanh thu'),
  cogs: column('cogs', 'Giá vốn'),
  grossMargin: column('grossMargin', 'Lãi gộp'),
  grossMarginPercent: column('grossMarginPercent', 'Tỷ lệ lãi gộp (%)'),
  exceptionReason: column('exceptionReason', 'Nguyên nhân'),
});

function dimension(label, slug, allowedColumns, defaultColumns) {
  return Object.freeze({
    label,
    slug,
    allowedColumns: Object.freeze(allowedColumns),
    defaultColumns: Object.freeze(defaultColumns),
  });
}

const DIMENSIONS = Object.freeze({
  customers: dimension(
    'Theo khách hàng',
    'Khach-hang',
    ['customerCode', 'customerName', 'lineCount', 'netRevenue', 'cogs', 'grossMargin', 'grossMarginPercent'],
    ['customerCode', 'customerName', 'netRevenue', 'cogs', 'grossMargin', 'grossMarginPercent'],
  ),
  skus: dimension(
    'Theo SKU',
    'SKU',
    ['sku', 'productName', 'lineCount', 'netRevenue', 'cogs', 'grossMargin', 'grossMarginPercent'],
    ['sku', 'productName', 'netRevenue', 'cogs', 'grossMargin', 'grossMarginPercent'],
  ),
  lines: dimension(
    'Chi tiết dòng',
    'Chi-tiet',
    ['documentDate', 'documentNumber', 'eventKind', 'customerCode', 'customerName', 'warehouseCode', 'sku', 'productName', 'currencyCode', 'netRevenue', 'cogs', 'grossMargin', 'grossMarginPercent'],
    ['documentDate', 'documentNumber', 'eventKind', 'customerCode', 'customerName', 'warehouseCode', 'sku', 'productName', 'netRevenue', 'cogs', 'grossMargin'],
  ),
  exceptions: dimension(
    'Ngoại lệ',
    'Ngoai-le',
    ['documentDate', 'documentNumber', 'eventKind', 'customerCode', 'customerName', 'warehouseCode', 'sku', 'productName', 'currencyCode', 'netRevenue', 'exceptionReason'],
    ['documentDate', 'documentNumber', 'eventKind', 'customerCode', 'customerName', 'warehouseCode', 'sku', 'productName', 'netRevenue', 'exceptionReason'],
  ),
});

const EVENT_LABELS = Object.freeze({ SALE: 'Bán hàng', RETURN: 'Trả hàng' });
const EXCEPTION_LABELS = Object.freeze({
  NON_VND_REVENUE: 'Doanh thu không phải VND',
  MISSING_INVENTORY_LINEAGE: 'Thiếu liên kết xuất/nhập kho',
  MISSING_COST_FACT: 'Chưa có dữ liệu giá vốn',
  COST_ANOMALY: 'Dữ liệu giá vốn có bất thường',
});

const EVENTS_CTE = `WITH latest_cost AS (
    SELECT DISTINCT ON (fact.inventory_movement_line_id)
           fact.inventory_movement_line_id, fact.status, fact.value_delta,
           fact.currency_code, fact.rebuild_run_id, run.completed_at AS costing_completed_at
      FROM inventory.inventory_cost_facts fact
      JOIN inventory.inventory_cost_rebuild_runs run
        ON run.installation_id = fact.installation_id
       AND run.id = fact.rebuild_run_id
     WHERE fact.installation_id = $1
       AND fact.warehouse_id = ANY($2::uuid[])
       AND ($5::uuid IS NULL OR fact.warehouse_id = $5::uuid)
     ORDER BY fact.inventory_movement_line_id, run.completed_at DESC, fact.rebuild_run_id DESC
  ), delivery_sales_events AS (
    SELECT 'SALE'::text AS event_kind,
           document.id AS accounting_document_id,
           document.source_document_number AS document_number,
           document.source_document_date AS document_date,
           document.customer_id, document.customer_code_snapshot AS customer_code,
           document.customer_name_snapshot AS customer_name,
           document.warehouse_id, document.warehouse_code_snapshot AS warehouse_code,
           issue_line.base_variant_id AS variant_id, line.sku_snapshot AS sku,
           document.currency_code,
           (line.gross_amount - line.discount_amount)::numeric AS net_revenue,
           CASE WHEN cost.status = 'COSTED' THEN -cost.value_delta ELSE NULL END::numeric AS cogs,
           cost.status AS cost_status, cost.rebuild_run_id, cost.costing_completed_at,
           line.id AS source_line_id,
           issue_line.inventory_movement_line_id AS costing_movement_line_id
      FROM accounting.receivable_documents document
      JOIN accounting.receivable_document_lines line
        ON line.installation_id = document.installation_id
       AND line.receivable_document_id = document.id
      LEFT JOIN sales.delivery_order_inventory_issue_lines issue_line
        ON issue_line.installation_id = line.installation_id
       AND issue_line.id = line.inventory_issue_line_id
      LEFT JOIN latest_cost cost
        ON cost.inventory_movement_line_id = issue_line.inventory_movement_line_id
     WHERE document.installation_id = $1
       AND document.warehouse_id = ANY($2::uuid[])
       AND ($5::uuid IS NULL OR document.warehouse_id = $5::uuid)
       AND document.direction = 'DEBIT'
       AND document.source_document_type NOT IN ('MANUAL_SALES_ORDER', 'DIRECT_PICKUP_SALES_ORDER')
       AND document.document_type IN ('SALE_DELIVERY','SALE_PICKUP')
       AND document.status <> 'reversed'
       AND document.source_document_date BETWEEN $3::date AND $4::date
  ), direct_sales_events AS (
    SELECT 'SALE'::text AS event_kind,
           document.id AS accounting_document_id,
           document.source_document_number AS document_number,
           document.source_document_date AS document_date,
           document.customer_id, document.customer_code_snapshot AS customer_code,
           document.customer_name_snapshot AS customer_name,
           document.warehouse_id, document.warehouse_code_snapshot AS warehouse_code,
           movement_line.base_variant_id AS variant_id, line.sku_snapshot AS sku,
           document.currency_code,
           CASE WHEN movement_line.id IS NULL THEN (line.gross_amount - line.discount_amount)::numeric
                ELSE round((line.gross_amount - line.discount_amount)
                           * abs(movement_line.base_quantity_delta) / line.accepted_base_quantity, 6)::numeric END AS net_revenue,
           CASE WHEN cost.status = 'COSTED' THEN -cost.value_delta ELSE NULL END::numeric AS cogs,
           cost.status AS cost_status, cost.rebuild_run_id, cost.costing_completed_at,
           line.id AS source_line_id,
           movement_line.id AS costing_movement_line_id
      FROM accounting.receivable_documents document
      JOIN accounting.receivable_document_lines line
        ON line.installation_id = document.installation_id
       AND line.receivable_document_id = document.id
      LEFT JOIN LATERAL (
        SELECT direct_line.*
          FROM inventory.inventory_movements movement
          JOIN inventory.inventory_movement_lines direct_line
            ON direct_line.installation_id = movement.installation_id
           AND direct_line.movement_id = movement.id
         WHERE movement.installation_id = document.installation_id
           AND movement.source_document_type = 'SALES_ORDER'
           AND movement.source_document_id = document.sales_order_id::text
           AND movement.movement_type = 'SALES_DELIVERY_ISSUE'
           AND direct_line.direction = 'OUT'
           AND direct_line.metadata ->> 'salesOrderLineId' = line.sales_order_line_id::text
           AND (
             (document.source_document_type = 'MANUAL_SALES_ORDER'
              AND direct_line.metadata ->> 'manualStockIssue' = 'true')
             OR
             (document.source_document_type = 'DIRECT_PICKUP_SALES_ORDER'
              AND direct_line.metadata ->> 'pickupStockIssue' = 'true')
           )
      ) movement_line ON true
      LEFT JOIN latest_cost cost
        ON cost.inventory_movement_line_id = movement_line.id
     WHERE document.installation_id = $1
       AND document.warehouse_id = ANY($2::uuid[])
       AND ($5::uuid IS NULL OR document.warehouse_id = $5::uuid)
       AND document.direction = 'DEBIT'
       AND document.source_document_type IN ('MANUAL_SALES_ORDER', 'DIRECT_PICKUP_SALES_ORDER')
       AND document.document_type IN ('SALE_DELIVERY','SALE_PICKUP')
       AND document.status <> 'reversed'
       AND document.source_document_date BETWEEN $3::date AND $4::date
  ), return_events AS (
    SELECT 'RETURN'::text AS event_kind,
           adjustment_document.id AS accounting_document_id,
           adjustment_document.source_document_number AS document_number,
           adjustment_document.source_document_date AS document_date,
           adjustment_document.customer_id,
           adjustment_document.customer_code_snapshot AS customer_code,
           adjustment_document.customer_name_snapshot AS customer_name,
           adjustment_document.warehouse_id,
           adjustment_document.warehouse_code_snapshot AS warehouse_code,
           return_line.base_variant_id AS variant_id, return_line.sku_snapshot AS sku,
           adjustment.currency_code,
           -round((source_line.gross_amount - source_line.discount_amount)
                  * adjustment.accepted_base_quantity / source_line.accepted_base_quantity, 6)::numeric AS net_revenue,
           CASE WHEN cost.status = 'COSTED' THEN -cost.value_delta ELSE NULL END::numeric AS cogs,
           cost.status AS cost_status, cost.rebuild_run_id, cost.costing_completed_at,
           adjustment.id AS source_line_id,
           receipt.inventory_movement_line_id AS costing_movement_line_id
      FROM accounting.customer_return_adjustment_lines adjustment
      JOIN accounting.receivable_documents adjustment_document
        ON adjustment_document.installation_id = adjustment.installation_id
       AND adjustment_document.id = adjustment.adjustment_receivable_document_id
      JOIN accounting.receivable_document_lines source_line
        ON source_line.installation_id = adjustment.installation_id
       AND source_line.id = adjustment.source_receivable_line_id
      JOIN sales.customer_return_lines return_line
        ON return_line.installation_id = adjustment.installation_id
       AND return_line.id = adjustment.customer_return_line_id
      JOIN sales.customer_return_receipt_lines receipt
        ON receipt.installation_id = adjustment.installation_id
       AND receipt.id = adjustment.customer_return_receipt_line_id
      LEFT JOIN latest_cost cost
        ON cost.inventory_movement_line_id = receipt.inventory_movement_line_id
     WHERE adjustment.installation_id = $1
       AND adjustment_document.warehouse_id = ANY($2::uuid[])
       AND ($5::uuid IS NULL OR adjustment_document.warehouse_id = $5::uuid)
       AND adjustment_document.document_type = 'CUSTOMER_RETURN_CREDIT'
       AND adjustment_document.status <> 'reversed'
       AND adjustment_document.source_document_date BETWEEN $3::date AND $4::date
  ), events AS (
    SELECT * FROM delivery_sales_events
    UNION ALL
    SELECT * FROM direct_sales_events
    UNION ALL
    SELECT * FROM return_events
  ), classified AS (
    SELECT events.*,
           (currency_code = 'VND' AND cost_status = 'COSTED' AND cogs IS NOT NULL) AS comparable,
           CASE
             WHEN currency_code <> 'VND' THEN 'NON_VND_REVENUE'
             WHEN costing_movement_line_id IS NULL THEN 'MISSING_INVENTORY_LINEAGE'
             WHEN cost_status IS NULL THEN 'MISSING_COST_FACT'
             WHEN cost_status <> 'COSTED' OR cogs IS NULL THEN 'COST_ANOMALY'
             ELSE NULL
           END AS exception_code
      FROM events
  )`;

function invalid(code, message, details = {}) {
  return Object.freeze({ ok: false, code, message, details, statusCode: 400 });
}

export function normalizeGrossMarginReportingExportSelection({ dimension: rawDimension, format: rawFormat, columns: rawColumns }) {
  const dimensionKey = String(rawDimension ?? '').trim();
  const definition = DIMENSIONS[dimensionKey];
  if (!definition) return invalid('INVALID_GROSS_MARGIN_EXPORT_DIMENSION', 'Nội dung cần xuất không hợp lệ');

  const format = String(rawFormat ?? 'xlsx').trim().toLowerCase();
  if (!FORMATS.has(format)) return invalid('INVALID_GROSS_MARGIN_EXPORT_FORMAT', 'Định dạng xuất chỉ hỗ trợ Excel hoặc CSV');

  const supplied = Array.isArray(rawColumns)
    ? rawColumns.map((value) => String(value ?? '').trim()).filter(Boolean)
    : [];
  if (supplied.length > 32) return invalid('INVALID_GROSS_MARGIN_EXPORT_COLUMNS', 'Danh sách cột xuất vượt giới hạn cho phép');

  const selected = supplied.length ? [...new Set(supplied)] : [...definition.defaultColumns];
  const allowed = new Set(definition.allowedColumns);
  const rejected = selected.filter((key) => !allowed.has(key) || !Object.prototype.hasOwnProperty.call(COLUMN_DEFINITIONS, key));
  if (!selected.length || rejected.length) {
    return invalid('INVALID_GROSS_MARGIN_EXPORT_COLUMNS', rejected.length ? 'Có cột không hợp lệ cho nội dung đang chọn' : 'Cần chọn ít nhất một cột để xuất', rejected.length ? { rejected } : {});
  }

  return Object.freeze({
    ok: true,
    dimension: dimensionKey,
    dimensionLabel: definition.label,
    dimensionSlug: definition.slug,
    format,
    columns: Object.freeze(selected.map((key) => COLUMN_DEFINITIONS[key])),
  });
}

function exportSql(dimensionKey) {
  const limit = MAX_EXPORT_ROWS + 1;
  if (dimensionKey === 'customers') return `${EVENTS_CTE}
    SELECT customer_id AS "customerId", max(customer_code) AS "customerCode", max(customer_name) AS "customerName",
           count(*)::text AS "lineCount",
           sum(net_revenue)::text AS "netRevenue",
           sum(cogs)::text AS "cogs",
           sum(net_revenue - cogs)::text AS "grossMargin",
           CASE WHEN sum(net_revenue) = 0 THEN NULL ELSE round(100 * sum(net_revenue - cogs) / sum(net_revenue), 4)::text END AS "grossMarginPercent",
           sum(sum(net_revenue)) OVER ()::text AS "_totalNetRevenue",
           sum(sum(cogs)) OVER ()::text AS "_totalCogs",
           sum(sum(net_revenue - cogs)) OVER ()::text AS "_totalGrossMargin"
      FROM classified
     WHERE comparable
     GROUP BY customer_id
     ORDER BY sum(net_revenue - cogs) DESC, max(customer_code)
     LIMIT ${limit}`;

  if (dimensionKey === 'skus') return `${EVENTS_CTE}
    SELECT classified.variant_id AS "variantId", max(classified.sku) AS "sku", max(product.name) AS "productName",
           count(*)::text AS "lineCount",
           sum(classified.net_revenue)::text AS "netRevenue",
           sum(classified.cogs)::text AS "cogs",
           sum(classified.net_revenue - classified.cogs)::text AS "grossMargin",
           CASE WHEN sum(classified.net_revenue) = 0 THEN NULL ELSE round(100 * sum(classified.net_revenue - classified.cogs) / sum(classified.net_revenue), 4)::text END AS "grossMarginPercent",
           sum(sum(classified.net_revenue)) OVER ()::text AS "_totalNetRevenue",
           sum(sum(classified.cogs)) OVER ()::text AS "_totalCogs",
           sum(sum(classified.net_revenue - classified.cogs)) OVER ()::text AS "_totalGrossMargin"
      FROM classified
      LEFT JOIN shared.product_variants variant
        ON variant.installation_id = $1 AND variant.id = classified.variant_id
      LEFT JOIN shared.products product
        ON product.installation_id = variant.installation_id AND product.id = variant.product_id
     WHERE classified.comparable
     GROUP BY classified.variant_id
     ORDER BY sum(classified.net_revenue - classified.cogs) DESC, max(classified.sku)
     LIMIT ${limit}`;

  if (dimensionKey === 'lines') return `${EVENTS_CTE}
    SELECT classified.event_kind AS "eventKind", classified.document_number AS "documentNumber", classified.document_date::text AS "documentDate",
           classified.customer_code AS "customerCode", classified.customer_name AS "customerName",
           classified.warehouse_code AS "warehouseCode", classified.sku AS "sku", product.name AS "productName",
           classified.currency_code AS "currencyCode", classified.net_revenue::text AS "netRevenue",
           classified.cogs::text AS "cogs", (classified.net_revenue - classified.cogs)::text AS "grossMargin",
           CASE WHEN classified.net_revenue = 0 THEN NULL ELSE round(100 * (classified.net_revenue - classified.cogs) / classified.net_revenue, 4)::text END AS "grossMarginPercent",
           sum(classified.net_revenue) OVER ()::text AS "_totalNetRevenue",
           sum(classified.cogs) OVER ()::text AS "_totalCogs",
           sum(classified.net_revenue - classified.cogs) OVER ()::text AS "_totalGrossMargin"
      FROM classified
      LEFT JOIN shared.product_variants variant
        ON variant.installation_id = $1 AND variant.id = classified.variant_id
      LEFT JOIN shared.products product
        ON product.installation_id = variant.installation_id AND product.id = variant.product_id
     WHERE classified.comparable
     ORDER BY classified.document_date DESC, classified.document_number, classified.source_line_id
     LIMIT ${limit}`;

  return `${EVENTS_CTE}
    SELECT classified.event_kind AS "eventKind", classified.document_number AS "documentNumber", classified.document_date::text AS "documentDate",
           classified.customer_code AS "customerCode", classified.customer_name AS "customerName",
           classified.warehouse_code AS "warehouseCode", classified.sku AS "sku", product.name AS "productName",
           classified.currency_code AS "currencyCode", classified.net_revenue::text AS "netRevenue",
           classified.exception_code AS "exceptionCode", count(*) OVER ()::text AS "_rowCount"
      FROM classified
      LEFT JOIN shared.product_variants variant
        ON variant.installation_id = $1 AND variant.id = classified.variant_id
      LEFT JOIN shared.products product
        ON product.installation_id = variant.installation_id AND product.id = variant.product_id
     WHERE NOT classified.comparable
     ORDER BY classified.document_date DESC, classified.document_number, classified.source_line_id
     LIMIT ${limit}`;
}

function canonicalDecimal(value) {
  const text = String(value ?? '0').trim();
  const match = /^(-?)(\d+)(?:\.(\d+))?$/.exec(text);
  if (!match) return text;
  const integer = match[2].replace(/^0+(?=\d)/, '') || '0';
  const fraction = (match[3] ?? '').replace(/0+$/, '');
  const zero = integer === '0' && !fraction;
  return `${zero ? '' : match[1]}${integer}${fraction ? `.${fraction}` : ''}`;
}

function expectedExceptionCount(summary) {
  return [summary?.missingLineageCount, summary?.missingCostCount, summary?.costAnomalyCount, summary?.nonVndCount]
    .reduce((total, value) => total + BigInt(String(value ?? '0')), 0n)
    .toString();
}

function reconcileRows(dimensionKey, rows, summary) {
  if (dimensionKey === 'exceptions') {
    const actual = rows[0]?._rowCount ?? '0';
    return String(actual) === expectedExceptionCount(summary);
  }
  const first = rows[0] ?? {};
  return canonicalDecimal(first._totalNetRevenue ?? '0') === canonicalDecimal(summary?.netRevenueVnd ?? '0')
    && canonicalDecimal(first._totalCogs ?? '0') === canonicalDecimal(summary?.cogsVnd ?? '0')
    && canonicalDecimal(first._totalGrossMargin ?? '0') === canonicalDecimal(summary?.grossMarginVnd ?? '0');
}

function valueText(value) {
  if (value === null || value === undefined) return '';
  if (value instanceof Date) return value.toISOString();
  if (typeof value === 'boolean') return value ? 'Có' : 'Không';
  if (typeof value === 'object') return JSON.stringify(value);
  return String(value);
}

function formatGroupedDecimal(value, maxFractionDigits = 2) {
  const normalized = valueText(value).trim();
  if (!normalized) return '';
  const match = /^(-?)(\d+)(?:\.(\d+))?$/.exec(normalized);
  if (!match) return normalized;
  const [, sign, rawInteger, rawFraction = ''] = match;
  const scale = Math.max(0, maxFractionDigits);
  let integer = rawInteger;
  let fraction = rawFraction.slice(0, scale);
  if (rawFraction.length > scale && rawFraction.charCodeAt(scale) >= 53) {
    const factor = 10n ** BigInt(scale);
    const absolute = (BigInt(integer) * factor) + BigInt(fraction || '0') + 1n;
    integer = (absolute / factor).toString();
    fraction = scale ? (absolute % factor).toString().padStart(scale, '0') : '';
  }
  fraction = fraction.replace(/0+$/, '');
  const grouped = integer.replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  return `${sign}${grouped}${fraction ? `.${fraction}` : ''}`;
}

function formatRow(row) {
  return Object.freeze({
    customerCode: row.customerCode ?? '',
    customerName: row.customerName ?? '',
    sku: row.sku ?? '',
    productName: row.productName ?? '',
    lineCount: row.lineCount ?? '',
    documentDate: row.documentDate ?? '',
    documentNumber: row.documentNumber ?? '',
    eventKind: EVENT_LABELS[row.eventKind] ?? row.eventKind ?? '',
    warehouseCode: row.warehouseCode ?? '',
    currencyCode: row.currencyCode ?? '',
    netRevenue: formatGroupedDecimal(row.netRevenue, 2),
    cogs: formatGroupedDecimal(row.cogs, 2),
    grossMargin: formatGroupedDecimal(row.grossMargin, 2),
    grossMarginPercent: row.grossMarginPercent === null || row.grossMarginPercent === undefined ? '' : `${formatGroupedDecimal(row.grossMarginPercent, 2)}%`,
    exceptionReason: EXCEPTION_LABELS[row.exceptionCode] ?? row.exceptionCode ?? '',
  });
}

function xmlEscape(value) {
  return String(value)
    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, ' ')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;');
}

function columnName(index) {
  let value = index + 1;
  let result = '';
  while (value > 0) {
    const remainder = (value - 1) % 26;
    result = String.fromCharCode(65 + remainder) + result;
    value = Math.floor((value - 1) / 26);
  }
  return result;
}

function xlsxCell(reference, value, header = false) {
  return `<c r="${reference}" t="inlineStr"${header ? ' s="1"' : ''}><is><t xml:space="preserve">${xmlEscape(value)}</t></is></c>`;
}

async function writeChunk(stream, chunk) {
  if (stream.write(chunk)) return;
  await once(stream, 'drain');
}

async function writeWorksheet(filePath, columns, rows) {
  const stream = createWriteStream(filePath);
  try {
    await writeChunk(stream, '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetData>');
    await writeChunk(stream, `<row r="1">${columns.map((definition, index) => xlsxCell(`${columnName(index)}1`, definition.label, true)).join('')}</row>`);
    let rowNumber = 1;
    for (const row of rows) {
      rowNumber += 1;
      await writeChunk(stream, `<row r="${rowNumber}">${columns.map((definition, index) => xlsxCell(`${columnName(index)}${rowNumber}`, valueText(row[definition.key]))).join('')}</row>`);
    }
    await writeChunk(stream, '</sheetData></worksheet>');
    stream.end();
    await finished(stream);
  } catch (error) {
    stream.destroy();
    throw error;
  }
}

function csvCell(value) {
  const raw = valueText(value);
  const safe = /^[=+@]/.test(raw) || /^-[^0-9.]/.test(raw) ? `'${raw}` : raw;
  return `"${safe.replaceAll('"', '""')}"`;
}

async function writeCsv(filePath, columns, rows) {
  const stream = createWriteStream(filePath);
  try {
    await writeChunk(stream, '\uFEFF');
    await writeChunk(stream, `${columns.map((definition) => csvCell(definition.label)).join(',')}\r\n`);
    for (const row of rows) await writeChunk(stream, `${columns.map((definition) => csvCell(row[definition.key])).join(',')}\r\n`);
    stream.end();
    await finished(stream);
  } catch (error) {
    stream.destroy();
    throw error;
  }
}

function fileStamp(receivedAt) {
  return new Date(receivedAt ?? Date.now()).toISOString().replace(/[-:]/g, '').replace('T', '-').slice(0, 15);
}

export async function createGrossMarginReportingExport(pool, {
  requestContext,
  filters,
  warehouseIds,
  selection,
}) {
  if (!selection?.ok || !DIMENSIONS[selection.dimension]) throw new Error('gross_margin_export_selection_required');

  const report = await grossMarginReport(pool, requestContext, filters, warehouseIds);
  const params = [requestContext.installationId, warehouseIds, filters.from, filters.to, filters.warehouseId];
  const result = await pool.query(exportSql(selection.dimension), params);
  const rawRows = Array.isArray(result.rows) ? result.rows : [];
  if (rawRows.length > MAX_EXPORT_ROWS) {
    const error = new Error('gross_margin_export_too_large');
    error.code = 'GROSS_MARGIN_EXPORT_TOO_LARGE';
    throw error;
  }
  if (!reconcileRows(selection.dimension, rawRows, report.summary)) {
    const error = new Error('gross_margin_export_reconciliation_failed');
    error.code = 'GROSS_MARGIN_EXPORT_RECONCILIATION_FAILED';
    throw error;
  }

  const rows = rawRows.map(formatRow);
  const tempDirectory = await mkdtemp(path.join(tmpdir(), 'npp-gross-margin-export-'));
  const extension = selection.format === 'csv' ? 'csv' : 'xlsx';
  const outputPath = path.join(tempDirectory, `gross-margin.${extension}`);
  try {
    if (selection.format === 'csv') {
      await writeCsv(outputPath, selection.columns, rows);
    } else {
      const worksheetPath = path.join(tempDirectory, '00-gross-margin.xml');
      await writeWorksheet(worksheetPath, selection.columns, rows);
      await buildMultiSheetXlsx(outputPath, [{
        key: selection.dimension,
        sheetName: selection.dimensionLabel,
        rowCount: rows.length,
        xlsxSheetPath: worksheetPath,
      }]);
    }
    const fileStat = await stat(outputPath);
    const stamp = fileStamp(requestContext.receivedAt);
    return Object.freeze({
      filePath: outputPath,
      filename: `Bao-cao-lai-gop-${selection.dimensionSlug}-${stamp}.${extension}`,
      contentType: selection.format === 'csv'
        ? 'text/csv; charset=utf-8'
        : 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      size: fileStat.size,
      rowCount: rows.length,
      cleanup: () => rm(tempDirectory, { recursive: true, force: true }),
    });
  } catch (error) {
    await rm(tempDirectory, { recursive: true, force: true });
    throw error;
  }
}

export const grossMarginReportingExportInternals = Object.freeze({
  COLUMN_DEFINITIONS,
  DIMENSIONS,
  EVENT_LABELS,
  EXCEPTION_LABELS,
  MAX_EXPORT_ROWS,
  canonicalDecimal,
  expectedExceptionCount,
  reconcileRows,
  formatRow,
});
