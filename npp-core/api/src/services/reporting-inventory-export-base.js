import { createWriteStream } from 'node:fs';
import { mkdtemp, rm, stat } from 'node:fs/promises';
import { once } from 'node:events';
import { finished } from 'node:stream/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { buildMultiSheetXlsx } from '../backup/artifacts.js';
import { reportingInternals } from '../routes/reporting-common.js';
import { compactReportingQueryBindings } from '../routes/reporting-inventory-safe.js';

const FORMATS = new Set(['xlsx', 'csv']);
const MAX_EXPORT_ROWS = 100_000;

function column(key, label) {
  return Object.freeze({ key, label });
}

const COLUMN_DEFINITIONS = Object.freeze({
  warehouseCode: column('warehouseCode', 'Mã kho'),
  warehouseName: column('warehouseName', 'Tên kho'),
  productCode: column('productCode', 'Mã sản phẩm'),
  productName: column('productName', 'Tên sản phẩm'),
  sku: column('sku', 'SKU'),
  unitName: column('unitName', 'Đơn vị tính'),
  stockedSkuCount: column('stockedSkuCount', 'Mã hàng có tồn'),
  reservedSkuCount: column('reservedSkuCount', 'Mã hàng có giữ'),
  inventoryValueVnd: column('inventoryValueVnd', 'Giá trị tồn (VND)'),
  costingExceptionCount: column('costingExceptionCount', 'Cần kiểm tra giá vốn'),
  quantityProjectedThrough: column('quantityProjectedThrough', 'Cập nhật tồn đến'),
  onHandQuantity: column('onHandQuantity', 'Tồn kho'),
  reservedQuantity: column('reservedQuantity', 'Đã giữ cho đơn'),
  availableQuantity: column('availableQuantity', 'Có thể xuất'),
  inventoryValue: column('inventoryValue', 'Giá trị tồn'),
  averageUnitCost: column('averageUnitCost', 'Giá bình quân'),
  costingStatus: column('costingStatus', 'Tình trạng giá vốn'),
  projectedThrough: column('projectedThrough', 'Dữ liệu tồn đến'),
  openingQuantity: column('openingQuantity', 'Đầu kỳ'),
  inboundQuantity: column('inboundQuantity', 'Nhập'),
  outboundQuantity: column('outboundQuantity', 'Xuất'),
  closingQuantity: column('closingQuantity', 'Cuối kỳ'),
  movementLineCount: column('movementLineCount', 'Dòng nghiệp vụ'),
  lastPostedAt: column('lastPostedAt', 'Phát sinh gần nhất'),
  lastOutDate: column('lastOutDate', 'Lần xuất cuối'),
  daysSinceOutbound: column('daysSinceOutbound', 'Số ngày chưa xuất'),
  lotCode: column('lotCode', 'Mã lô'),
  manufacturedDate: column('manufacturedDate', 'Ngày sản xuất'),
  expiryDate: column('expiryDate', 'Hạn sử dụng'),
  manufacturedAgeDays: column('manufacturedAgeDays', 'Tuổi lô (ngày)'),
  daysToExpiry: column('daysToExpiry', 'Còn lại đến hạn (ngày)'),
  expiryStatus: column('expiryStatus', 'Trạng thái hạn dùng'),
  ledgerQuantity: column('ledgerQuantity', 'Số lượng sổ kho'),
  costingQuantity: column('costingQuantity', 'Số lượng tính giá'),
  quantityDifference: column('quantityDifference', 'Chênh lệch'),
  anomalyCount: column('anomalyCount', 'Số cảnh báo'),
  reconciliationStatus: column('reconciliationStatus', 'Trạng thái đối soát'),
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
  overview: dimension(
    'Tổng quan theo kho',
    'Tong-quan',
    ['warehouseCode', 'warehouseName', 'stockedSkuCount', 'reservedSkuCount', 'inventoryValueVnd', 'costingExceptionCount', 'quantityProjectedThrough'],
    ['warehouseCode', 'warehouseName', 'stockedSkuCount', 'reservedSkuCount', 'inventoryValueVnd', 'costingExceptionCount', 'quantityProjectedThrough'],
  ),
  positions: dimension(
    'Tồn hiện tại',
    'Ton-hien-tai',
    ['warehouseCode', 'warehouseName', 'productCode', 'productName', 'sku', 'unitName', 'onHandQuantity', 'reservedQuantity', 'availableQuantity', 'inventoryValue', 'averageUnitCost', 'costingStatus', 'projectedThrough'],
    ['warehouseCode', 'productCode', 'productName', 'sku', 'unitName', 'onHandQuantity', 'reservedQuantity', 'availableQuantity', 'inventoryValue', 'averageUnitCost', 'costingStatus'],
  ),
  movement: dimension(
    'Nhập – xuất – tồn theo kỳ',
    'Nhap-xuat-ton',
    ['warehouseCode', 'warehouseName', 'productCode', 'productName', 'sku', 'unitName', 'openingQuantity', 'inboundQuantity', 'outboundQuantity', 'closingQuantity', 'movementLineCount', 'lastPostedAt'],
    ['warehouseCode', 'productCode', 'productName', 'sku', 'unitName', 'openingQuantity', 'inboundQuantity', 'outboundQuantity', 'closingQuantity', 'movementLineCount'],
  ),
  'slow-moving': dimension(
    'Hàng chậm luân chuyển',
    'Cham-luan-chuyen',
    ['warehouseCode', 'warehouseName', 'productCode', 'productName', 'sku', 'unitName', 'onHandQuantity', 'reservedQuantity', 'availableQuantity', 'lastOutDate', 'daysSinceOutbound', 'inventoryValueVnd'],
    ['warehouseCode', 'productCode', 'productName', 'sku', 'unitName', 'onHandQuantity', 'availableQuantity', 'lastOutDate', 'daysSinceOutbound', 'inventoryValueVnd'],
  ),
  lots: dimension(
    'Lô & hạn dùng',
    'Lo-han-dung',
    ['warehouseCode', 'warehouseName', 'productCode', 'productName', 'sku', 'unitName', 'lotCode', 'manufacturedDate', 'expiryDate', 'onHandQuantity', 'reservedQuantity', 'availableQuantity', 'manufacturedAgeDays', 'daysToExpiry', 'expiryStatus'],
    ['warehouseCode', 'productCode', 'productName', 'sku', 'unitName', 'lotCode', 'manufacturedDate', 'expiryDate', 'onHandQuantity', 'availableQuantity', 'expiryStatus'],
  ),
  exceptions: dimension(
    'Cần kiểm tra',
    'Can-kiem-tra',
    ['warehouseCode', 'warehouseName', 'productCode', 'productName', 'sku', 'unitName', 'ledgerQuantity', 'costingQuantity', 'quantityDifference', 'inventoryValueVnd', 'averageUnitCost', 'costingStatus', 'anomalyCount', 'reconciliationStatus'],
    ['warehouseCode', 'productCode', 'productName', 'sku', 'unitName', 'ledgerQuantity', 'costingQuantity', 'quantityDifference', 'costingStatus', 'anomalyCount', 'reconciliationStatus'],
  ),
});

const COSTING_STATUS_LABELS = Object.freeze({
  COSTED: 'Đã tính giá vốn',
  PENDING: 'Chờ tính giá vốn',
  ANOMALY: 'Cần kiểm tra giá vốn',
});
const RECONCILIATION_LABELS = Object.freeze({
  OK: 'Khớp',
  QUANTITY_MISMATCH: 'Lệch số lượng',
  COSTING_NOT_READY: 'Chưa đủ dữ liệu giá vốn',
  MISSING_COST: 'Thiếu giá vốn',
  ANOMALY: 'Cần kiểm tra',
});
const EXPIRY_LABELS = Object.freeze({
  EXPIRED: 'Đã hết hạn',
  EXPIRING_30_DAYS: 'Hết hạn trong 30 ngày',
  EXPIRING_90_DAYS: 'Hết hạn trong 90 ngày',
  ACTIVE: 'Còn hạn',
  NO_EXPIRY: 'Không có hạn',
});

function invalid(code, message, details = {}) {
  return Object.freeze({ ok: false, code, message, details, statusCode: 400 });
}

export function normalizeInventoryReportingExportSelection({ dimension: rawDimension, format: rawFormat, columns: rawColumns }) {
  const dimensionKey = String(rawDimension ?? '').trim();
  const definition = DIMENSIONS[dimensionKey];
  if (!definition) return invalid('INVALID_INVENTORY_EXPORT_DIMENSION', 'Nội dung cần xuất không hợp lệ');

  const format = String(rawFormat ?? 'xlsx').trim().toLowerCase();
  if (!FORMATS.has(format)) return invalid('INVALID_INVENTORY_EXPORT_FORMAT', 'Định dạng xuất chỉ hỗ trợ Excel hoặc CSV');

  const supplied = Array.isArray(rawColumns)
    ? rawColumns.map((value) => String(value ?? '').trim()).filter(Boolean)
    : [];
  if (supplied.length > 40) return invalid('INVALID_INVENTORY_EXPORT_COLUMNS', 'Danh sách cột xuất vượt giới hạn cho phép');

  const selected = supplied.length ? [...new Set(supplied)] : [...definition.defaultColumns];
  const allowed = new Set(definition.allowedColumns);
  const rejected = selected.filter((key) => !allowed.has(key) || !Object.prototype.hasOwnProperty.call(COLUMN_DEFINITIONS, key));
  if (!selected.length || rejected.length) {
    return invalid('INVALID_INVENTORY_EXPORT_COLUMNS', rejected.length ? 'Có cột không hợp lệ cho nội dung đang chọn' : 'Cần chọn ít nhất một cột để xuất', rejected.length ? { rejected } : {});
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

const STOCK_CTE = `WITH stock AS (
  SELECT balance.warehouse_id,
         balance.base_variant_id,
         sum(balance.on_hand_quantity) AS on_hand_quantity,
         sum(balance.reserved_quantity) AS reserved_quantity,
         sum(balance.available_quantity) AS available_quantity,
         max(balance.projected_through) AS projected_through
    FROM inventory.inventory_balances balance
   WHERE balance.installation_id = $1
     AND balance.warehouse_id = ANY($2::uuid[])
     AND ($5::uuid IS NULL OR balance.warehouse_id = $5::uuid)
   GROUP BY balance.warehouse_id, balance.base_variant_id
), cost AS (
  SELECT balance.warehouse_id,
         balance.base_variant_id,
         balance.quantity AS costing_quantity,
         balance.inventory_value,
         balance.average_unit_cost,
         balance.status AS costing_status,
         balance.anomaly_count,
         balance.updated_at AS costing_updated_at
    FROM inventory.inventory_cost_balances balance
   WHERE balance.installation_id = $1
     AND balance.warehouse_id = ANY($2::uuid[])
     AND ($5::uuid IS NULL OR balance.warehouse_id = $5::uuid)
)`;

const PERIOD_SCOPE = `
  FROM inventory.inventory_movements movement
  JOIN inventory.inventory_movement_lines line
    ON line.installation_id = movement.installation_id
   AND line.movement_id = movement.id
  JOIN shared.warehouses warehouse
    ON warehouse.installation_id = line.installation_id
   AND warehouse.id = line.warehouse_id
  JOIN shared.product_variants variant
    ON variant.installation_id = line.installation_id
   AND variant.id = line.base_variant_id
  JOIN shared.products product
    ON product.installation_id = variant.installation_id
   AND product.id = variant.product_id
  LEFT JOIN shared.units_of_measure unit
    ON unit.installation_id = variant.installation_id
   AND unit.id = variant.unit_id
 WHERE movement.installation_id = $1
   AND line.warehouse_id = ANY($2::uuid[])
   AND movement.document_date <= $4::date
   AND ($5::uuid IS NULL OR line.warehouse_id = $5::uuid)`;

function exportSql(dimensionKey) {
  const limit = MAX_EXPORT_ROWS + 1;

  if (dimensionKey === 'overview') return `${STOCK_CTE}
    SELECT warehouse.code AS "warehouseCode",
           warehouse.name AS "warehouseName",
           count(*) FILTER (WHERE stock.on_hand_quantity > 0)::text AS "stockedSkuCount",
           count(*) FILTER (WHERE stock.reserved_quantity > 0)::text AS "reservedSkuCount",
           COALESCE(sum(cost.inventory_value) FILTER (WHERE cost.costing_status = 'COSTED'), 0::numeric)::text AS "inventoryValueVnd",
           count(*) FILTER (WHERE cost.costing_status IS DISTINCT FROM 'COSTED' OR round(COALESCE(cost.costing_quantity, 0::numeric) - stock.on_hand_quantity, 12) <> 0)::text AS "costingExceptionCount",
           max(stock.projected_through) AS "quantityProjectedThrough"
      FROM stock
      JOIN shared.warehouses warehouse ON warehouse.installation_id = $1 AND warehouse.id = stock.warehouse_id
      LEFT JOIN cost ON cost.warehouse_id = stock.warehouse_id AND cost.base_variant_id = stock.base_variant_id
     GROUP BY stock.warehouse_id, warehouse.code, warehouse.name
     ORDER BY warehouse.code
     LIMIT ${limit}`;

  if (dimensionKey === 'positions') return `${STOCK_CTE}
    SELECT warehouse.code AS "warehouseCode", warehouse.name AS "warehouseName",
           product.code AS "productCode", product.name AS "productName", variant.sku AS "sku",
           COALESCE(unit.name, unit.symbol, unit.code, '') AS "unitName",
           stock.on_hand_quantity::text AS "onHandQuantity", stock.reserved_quantity::text AS "reservedQuantity",
           stock.available_quantity::text AS "availableQuantity", cost.inventory_value::text AS "inventoryValue",
           cost.average_unit_cost::text AS "averageUnitCost", COALESCE(cost.costing_status, 'ANOMALY') AS "costingStatus",
           stock.projected_through AS "projectedThrough"
      FROM stock
      JOIN shared.warehouses warehouse ON warehouse.installation_id = $1 AND warehouse.id = stock.warehouse_id
      JOIN shared.product_variants variant ON variant.installation_id = $1 AND variant.id = stock.base_variant_id
      JOIN shared.products product ON product.installation_id = variant.installation_id AND product.id = variant.product_id
      LEFT JOIN shared.units_of_measure unit ON unit.installation_id = variant.installation_id AND unit.id = variant.unit_id
      LEFT JOIN cost ON cost.warehouse_id = stock.warehouse_id AND cost.base_variant_id = stock.base_variant_id
     WHERE stock.on_hand_quantity <> 0 OR stock.reserved_quantity <> 0
     ORDER BY cost.inventory_value DESC NULLS LAST, abs(stock.available_quantity) DESC, warehouse.code, variant.sku
     LIMIT ${limit}`;

  if (dimensionKey === 'movement') return `SELECT warehouse.code AS "warehouseCode", warehouse.name AS "warehouseName",
           product.code AS "productCode", product.name AS "productName", variant.sku AS "sku",
           COALESCE(unit.name, unit.symbol, unit.code, '') AS "unitName",
           COALESCE(sum(line.base_quantity_delta) FILTER (WHERE movement.document_date < $3::date), 0::numeric)::text AS "openingQuantity",
           COALESCE(sum(line.base_quantity_delta) FILTER (WHERE movement.document_date BETWEEN $3::date AND $4::date AND line.direction = 'IN'), 0::numeric)::text AS "inboundQuantity",
           COALESCE(-sum(line.base_quantity_delta) FILTER (WHERE movement.document_date BETWEEN $3::date AND $4::date AND line.direction = 'OUT'), 0::numeric)::text AS "outboundQuantity",
           COALESCE(sum(line.base_quantity_delta), 0::numeric)::text AS "closingQuantity",
           count(*) FILTER (WHERE movement.document_date BETWEEN $3::date AND $4::date)::text AS "movementLineCount",
           max(movement.posted_at) FILTER (WHERE movement.document_date BETWEEN $3::date AND $4::date) AS "lastPostedAt"
      ${PERIOD_SCOPE}
     GROUP BY line.warehouse_id, warehouse.code, warehouse.name, line.base_variant_id, variant.sku,
              product.code, product.name, unit.name, unit.symbol, unit.code
    HAVING COALESCE(sum(line.base_quantity_delta), 0::numeric) <> 0
        OR count(*) FILTER (WHERE movement.document_date BETWEEN $3::date AND $4::date) > 0
     ORDER BY greatest(
       abs(COALESCE(sum(line.base_quantity_delta) FILTER (WHERE movement.document_date BETWEEN $3::date AND $4::date AND line.direction = 'IN'), 0::numeric)),
       abs(COALESCE(sum(line.base_quantity_delta) FILTER (WHERE movement.document_date BETWEEN $3::date AND $4::date AND line.direction = 'OUT'), 0::numeric)),
       abs(COALESCE(sum(line.base_quantity_delta), 0::numeric))
     ) DESC, warehouse.code, variant.sku
     LIMIT ${limit}`;

  if (dimensionKey === 'slow-moving') return `${STOCK_CTE}, last_out AS (
    SELECT line.warehouse_id, line.base_variant_id, max(movement.document_date) AS last_out_date
      FROM inventory.inventory_movements movement
      JOIN inventory.inventory_movement_lines line ON line.installation_id = movement.installation_id AND line.movement_id = movement.id
     WHERE movement.installation_id = $1
       AND line.warehouse_id = ANY($2::uuid[])
       AND ($5::uuid IS NULL OR line.warehouse_id = $5::uuid)
       AND line.direction = 'OUT'
     GROUP BY line.warehouse_id, line.base_variant_id
  )
    SELECT warehouse.code AS "warehouseCode", warehouse.name AS "warehouseName",
           product.code AS "productCode", product.name AS "productName", variant.sku AS "sku",
           COALESCE(unit.name, unit.symbol, unit.code, '') AS "unitName",
           stock.on_hand_quantity::text AS "onHandQuantity", stock.reserved_quantity::text AS "reservedQuantity",
           stock.available_quantity::text AS "availableQuantity", last_out.last_out_date::text AS "lastOutDate",
           CASE WHEN last_out.last_out_date IS NULL THEN NULL ELSE ($6::date - last_out.last_out_date)::text END AS "daysSinceOutbound",
           cost.inventory_value::text AS "inventoryValueVnd"
      FROM stock
      JOIN shared.warehouses warehouse ON warehouse.installation_id = $1 AND warehouse.id = stock.warehouse_id
      JOIN shared.product_variants variant ON variant.installation_id = $1 AND variant.id = stock.base_variant_id
      JOIN shared.products product ON product.installation_id = variant.installation_id AND product.id = variant.product_id
      LEFT JOIN shared.units_of_measure unit ON unit.installation_id = variant.installation_id AND unit.id = variant.unit_id
      LEFT JOIN last_out ON last_out.warehouse_id = stock.warehouse_id AND last_out.base_variant_id = stock.base_variant_id
      LEFT JOIN cost ON cost.warehouse_id = stock.warehouse_id AND cost.base_variant_id = stock.base_variant_id
     WHERE stock.on_hand_quantity > 0
       AND (last_out.last_out_date IS NULL OR last_out.last_out_date < ($6::date - $7::int))
     ORDER BY cost.inventory_value DESC NULLS LAST, last_out.last_out_date ASC NULLS FIRST, warehouse.code, variant.sku
     LIMIT ${limit}`;

  if (dimensionKey === 'lots') return `SELECT warehouse.code AS "warehouseCode", warehouse.name AS "warehouseName",
           product.code AS "productCode", product.name AS "productName", variant.sku AS "sku",
           COALESCE(unit.name, unit.symbol, unit.code, '') AS "unitName", lot.lot_code AS "lotCode",
           lot.manufactured_date::text AS "manufacturedDate", lot.expiry_date::text AS "expiryDate",
           sum(balance.on_hand_quantity)::text AS "onHandQuantity", sum(balance.reserved_quantity)::text AS "reservedQuantity",
           sum(balance.available_quantity)::text AS "availableQuantity",
           CASE WHEN lot.manufactured_date IS NULL THEN NULL ELSE ($6::date - lot.manufactured_date)::text END AS "manufacturedAgeDays",
           CASE WHEN lot.expiry_date IS NULL THEN NULL ELSE (lot.expiry_date - $6::date)::text END AS "daysToExpiry",
           CASE WHEN lot.expiry_date IS NULL THEN 'NO_EXPIRY'
                WHEN lot.expiry_date < $6::date THEN 'EXPIRED'
                WHEN lot.expiry_date <= ($6::date + 30) THEN 'EXPIRING_30_DAYS'
                WHEN lot.expiry_date <= ($6::date + 90) THEN 'EXPIRING_90_DAYS'
                ELSE 'ACTIVE' END AS "expiryStatus"
      FROM inventory.inventory_balances balance
      JOIN shared.warehouses warehouse ON warehouse.installation_id = balance.installation_id AND warehouse.id = balance.warehouse_id
      JOIN shared.product_variants variant ON variant.installation_id = balance.installation_id AND variant.id = balance.base_variant_id
      JOIN shared.products product ON product.installation_id = variant.installation_id AND product.id = variant.product_id
      LEFT JOIN shared.units_of_measure unit ON unit.installation_id = variant.installation_id AND unit.id = variant.unit_id
      JOIN inventory.inventory_lots lot ON lot.installation_id = balance.installation_id AND lot.id = balance.lot_id
     WHERE balance.installation_id = $1
       AND balance.warehouse_id = ANY($2::uuid[])
       AND ($5::uuid IS NULL OR balance.warehouse_id = $5::uuid)
       AND balance.lot_id IS NOT NULL
       AND balance.on_hand_quantity > 0
     GROUP BY balance.warehouse_id, warehouse.code, warehouse.name, balance.base_variant_id, variant.sku,
              product.code, product.name, unit.name, unit.symbol, unit.code, balance.lot_id, lot.lot_code,
              lot.manufactured_date, lot.expiry_date
     ORDER BY lot.expiry_date ASC NULLS LAST, warehouse.code, variant.sku, lot.lot_code
     LIMIT ${limit}`;

  return `SELECT reconciliation.warehouse_code AS "warehouseCode", reconciliation.warehouse_name AS "warehouseName",
           product.code AS "productCode", product.name AS "productName", reconciliation.base_sku AS "sku",
           COALESCE(unit.name, unit.symbol, unit.code, '') AS "unitName",
           reconciliation.ledger_quantity::text AS "ledgerQuantity", reconciliation.costing_quantity::text AS "costingQuantity",
           reconciliation.quantity_difference::text AS "quantityDifference", reconciliation.inventory_value::text AS "inventoryValueVnd",
           reconciliation.average_unit_cost::text AS "averageUnitCost", reconciliation.costing_status AS "costingStatus",
           reconciliation.anomaly_count::text AS "anomalyCount", reconciliation.reconciliation_status AS "reconciliationStatus"
      FROM inventory.inventory_cost_reconciliation reconciliation
      JOIN shared.product_variants variant ON variant.installation_id = reconciliation.installation_id AND variant.id = reconciliation.base_variant_id
      JOIN shared.products product ON product.installation_id = variant.installation_id AND product.id = variant.product_id
      LEFT JOIN shared.units_of_measure unit ON unit.installation_id = variant.installation_id AND unit.id = variant.unit_id
     WHERE reconciliation.installation_id = $1
       AND reconciliation.warehouse_id = ANY($2::uuid[])
       AND ($5::uuid IS NULL OR reconciliation.warehouse_id = $5::uuid)
       AND reconciliation.reconciliation_status <> 'OK'
     ORDER BY reconciliation.warehouse_code, reconciliation.base_sku
     LIMIT ${limit}`;
}

function valueText(value) {
  if (value === null || value === undefined) return '';
  if (value instanceof Date) return value.toISOString();
  if (typeof value === 'boolean') return value ? 'Có' : 'Không';
  return String(value);
}

function formatRow(row) {
  return Object.freeze({
    ...row,
    costingStatus: COSTING_STATUS_LABELS[row.costingStatus] ?? row.costingStatus ?? '',
    reconciliationStatus: RECONCILIATION_LABELS[row.reconciliationStatus] ?? row.reconciliationStatus ?? '',
    expiryStatus: EXPIRY_LABELS[row.expiryStatus] ?? row.expiryStatus ?? '',
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

export async function createInventoryReportingExport(pool, {
  requestContext,
  filters,
  warehouseIds,
  slowDays,
  selection,
}) {
  if (!selection?.ok || !DIMENSIONS[selection.dimension]) throw new Error('inventory_reporting_export_selection_required');
  const currentDate = reportingInternals.businessDateNow(new Date(requestContext.receivedAt));
  const params = [requestContext.installationId, warehouseIds, filters.from, filters.to, filters.warehouseId, currentDate, slowDays];
  const query = compactReportingQueryBindings(exportSql(selection.dimension), params);
  const result = await pool.query(query.sql, [...query.values]);
  const rawRows = Array.isArray(result.rows) ? result.rows : [];
  if (rawRows.length > MAX_EXPORT_ROWS) {
    const error = new Error('inventory_reporting_export_too_large');
    error.code = 'INVENTORY_REPORT_EXPORT_TOO_LARGE';
    throw error;
  }
  const rows = rawRows.map(formatRow);
  const tempDirectory = await mkdtemp(path.join(tmpdir(), 'npp-inventory-report-export-'));
  const extension = selection.format === 'csv' ? 'csv' : 'xlsx';
  const outputPath = path.join(tempDirectory, `inventory-report.${extension}`);
  try {
    if (selection.format === 'csv') {
      await writeCsv(outputPath, selection.columns, rows);
    } else {
      const worksheetPath = path.join(tempDirectory, '00-inventory-report.xml');
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
      filename: `Bao-cao-ton-kho-${selection.dimensionSlug}-${stamp}.${extension}`,
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

export const inventoryReportingExportInternals = Object.freeze({
  COLUMN_DEFINITIONS,
  DIMENSIONS,
  MAX_EXPORT_ROWS,
  COSTING_STATUS_LABELS,
  RECONCILIATION_LABELS,
  EXPIRY_LABELS,
  exportSql,
  formatRow,
});
