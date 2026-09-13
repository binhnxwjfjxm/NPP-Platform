import { createWriteStream } from 'node:fs';
import { mkdtemp, rm, stat } from 'node:fs/promises';
import { once } from 'node:events';
import { finished } from 'node:stream/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { buildMultiSheetXlsx } from '../backup/artifacts.js';
import { salesReport } from '../routes/reporting-sales.js';

const FORMATS = new Set(['xlsx', 'csv']);

function column(key, label) {
  return Object.freeze({ key, label });
}

const COLUMN_DEFINITIONS = Object.freeze({
  code: column('code', 'Mã'),
  name: column('name', 'Tên'),
  currencyCode: column('currencyCode', 'Tiền tệ'),
  unitCode: column('unitCode', 'Mã ĐVT'),
  unitName: column('unitName', 'ĐVT'),
  revenue: column('revenue', 'Doanh thu'),
  quantity: column('quantity', 'Sản lượng'),
  documentCount: column('documentCount', 'Số đơn'),
  customerCount: column('customerCount', 'Số khách'),
  productCount: column('productCount', 'Số sản phẩm'),
  sharePercent: column('sharePercent', 'Tỷ trọng (%)'),
  previousRevenue: column('previousRevenue', 'Doanh thu kỳ trước'),
  previousQuantity: column('previousQuantity', 'Sản lượng kỳ trước'),
  changePercent: column('changePercent', 'Thay đổi doanh thu (%)'),
  source: column('source', 'Nguồn dữ liệu'),
});

function dimension(label, slug, allowedColumns, defaultColumns) {
  return Object.freeze({ label, slug, allowedColumns: Object.freeze(allowedColumns), defaultColumns: Object.freeze(defaultColumns) });
}

const DIMENSIONS = Object.freeze({
  customers: dimension(
    'Khách hàng',
    'Khach-hang',
    ['code', 'name', 'currencyCode', 'revenue', 'documentCount', 'sharePercent', 'previousRevenue', 'changePercent', 'source'],
    ['code', 'name', 'currencyCode', 'revenue', 'documentCount', 'sharePercent', 'previousRevenue', 'changePercent'],
  ),
  customerGroups: dimension(
    'Loại khách',
    'Loai-khach',
    ['code', 'name', 'currencyCode', 'revenue', 'customerCount', 'documentCount', 'sharePercent', 'previousRevenue', 'changePercent', 'source'],
    ['code', 'name', 'currencyCode', 'revenue', 'customerCount', 'documentCount', 'sharePercent', 'previousRevenue', 'changePercent'],
  ),
  channels: dimension(
    'Kênh bán',
    'Kenh-ban',
    ['code', 'name', 'currencyCode', 'revenue', 'documentCount', 'customerCount', 'sharePercent', 'previousRevenue', 'changePercent', 'source'],
    ['code', 'name', 'currencyCode', 'revenue', 'documentCount', 'customerCount', 'sharePercent', 'previousRevenue', 'changePercent'],
  ),
  products: dimension(
    'Sản phẩm',
    'San-pham',
    ['code', 'name', 'currencyCode', 'unitCode', 'unitName', 'revenue', 'quantity', 'sharePercent', 'previousRevenue', 'previousQuantity', 'changePercent', 'source'],
    ['code', 'name', 'currencyCode', 'unitName', 'quantity', 'revenue', 'sharePercent', 'previousRevenue', 'previousQuantity', 'changePercent'],
  ),
  productGroups: dimension(
    'Nhóm hàng',
    'Nhom-hang',
    ['code', 'name', 'currencyCode', 'revenue', 'productCount', 'sharePercent', 'previousRevenue', 'changePercent', 'source'],
    ['code', 'name', 'currencyCode', 'revenue', 'productCount', 'sharePercent', 'previousRevenue', 'changePercent'],
  ),
  employees: dimension(
    'Nhân viên bán hàng',
    'Nhan-vien-ban-hang',
    ['code', 'name', 'currencyCode', 'revenue', 'documentCount', 'customerCount', 'sharePercent', 'previousRevenue', 'changePercent', 'source'],
    ['code', 'name', 'currencyCode', 'revenue', 'documentCount', 'customerCount', 'sharePercent', 'previousRevenue', 'changePercent'],
  ),
});

const SOURCE_LABELS = Object.freeze({
  'order-snapshot': 'Ảnh chụp trên đơn',
  'order-line-snapshot': 'Ảnh chụp dòng đơn',
  snapshot: 'Ảnh chụp khi xác nhận',
  'legacy-current-master': 'Danh mục hiện tại cho dữ liệu cũ',
  'legacy-unavailable': 'Dữ liệu cũ chưa có nguồn thay thế',
  'order-source': 'Nhân viên trên đơn',
  'creator-user': 'Nhân viên của người tạo đơn',
  unavailable: 'Chưa xác định',
  'current-master-zero': 'Danh mục hiện tại · Không phát sinh',
  total: 'Tổng',
});

function invalid(code, message, details = {}) {
  return Object.freeze({ ok: false, code, message, details, statusCode: 400 });
}

export function normalizeSalesReportingExportSelection({ dimension: rawDimension, format: rawFormat, columns: rawColumns }) {
  const dimensionKey = String(rawDimension ?? '').trim();
  const definition = DIMENSIONS[dimensionKey];
  if (!definition) return invalid('INVALID_SALES_EXPORT_DIMENSION', 'Chiều phân tích cần xuất không hợp lệ');

  const format = String(rawFormat ?? 'xlsx').trim().toLowerCase();
  if (!FORMATS.has(format)) return invalid('INVALID_SALES_EXPORT_FORMAT', 'Định dạng xuất chỉ hỗ trợ Excel hoặc CSV');

  const supplied = Array.isArray(rawColumns)
    ? rawColumns.map((value) => String(value ?? '').trim()).filter(Boolean)
    : [];
  if (supplied.length > 32) return invalid('INVALID_SALES_EXPORT_COLUMNS', 'Danh sách cột xuất vượt giới hạn cho phép');

  const selected = supplied.length ? [...new Set(supplied)] : [...definition.defaultColumns];
  if (!selected.length) return invalid('INVALID_SALES_EXPORT_COLUMNS', 'Cần chọn ít nhất một cột để xuất');

  const allowed = new Set(definition.allowedColumns);
  const rejected = selected.filter((key) => !allowed.has(key) || !Object.prototype.hasOwnProperty.call(COLUMN_DEFINITIONS, key));
  if (rejected.length) return invalid('INVALID_SALES_EXPORT_COLUMNS', 'Có cột không hợp lệ cho chiều phân tích đang chọn', { rejected });

  return Object.freeze({
    ok: true,
    dimension: dimensionKey,
    dimensionLabel: definition.label,
    dimensionSlug: definition.slug,
    format,
    columns: Object.freeze(selected.map((key) => COLUMN_DEFINITIONS[key])),
  });
}

function valueText(value) {
  if (value === null || value === undefined) return '';
  if (value instanceof Date) return value.toISOString();
  if (typeof value === 'boolean') return value ? 'Có' : 'Không';
  if (typeof value === 'object') return JSON.stringify(value);
  return String(value);
}

function sourceLabel(value) {
  const normalized = valueText(value).trim();
  return SOURCE_LABELS[normalized] ?? normalized;
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

function formatMoneyValue(value) {
  return formatGroupedDecimal(value, 2);
}

function formatPercentValue(value) {
  const formatted = formatGroupedDecimal(value, 2);
  return formatted ? `${formatted}%` : '';
}

function flattenRow(row) {
  return Object.freeze({
    code: row?.code ?? '',
    name: row?.name ?? '',
    currencyCode: row?.currencyCode ?? '',
    unitCode: row?.unit?.code ?? '',
    unitName: row?.unit?.name ?? '',
    revenue: formatMoneyValue(row?.revenue),
    quantity: row?.quantity ?? '',
    documentCount: row?.documentCount ?? '',
    customerCount: row?.customerCount ?? '',
    productCount: row?.productCount ?? '',
    sharePercent: formatPercentValue(row?.sharePercent),
    previousRevenue: formatMoneyValue(row?.previousRevenue),
    previousQuantity: row?.previousQuantity ?? '',
    changePercent: formatPercentValue(row?.changePercent),
    source: sourceLabel(row?.source),
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
    const header = columns.map((definition, index) => xlsxCell(`${columnName(index)}1`, definition.label, true)).join('');
    await writeChunk(stream, `<row r="1">${header}</row>`);
    let rowNumber = 1;
    for (const row of rows) {
      rowNumber += 1;
      const cells = columns.map((definition, index) => xlsxCell(`${columnName(index)}${rowNumber}`, valueText(row[definition.key]))).join('');
      await writeChunk(stream, `<row r="${rowNumber}">${cells}</row>`);
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
  const text = safe.replaceAll('"', '""');
  return `"${text}"`;
}

async function writeCsv(filePath, columns, rows) {
  const stream = createWriteStream(filePath);
  try {
    await writeChunk(stream, '\uFEFF');
    await writeChunk(stream, `${columns.map((definition) => csvCell(definition.label)).join(',')}\r\n`);
    for (const row of rows) {
      await writeChunk(stream, `${columns.map((definition) => csvCell(row[definition.key])).join(',')}\r\n`);
    }
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

export async function createSalesReportingExport(pool, {
  requestContext,
  filters,
  warehouseIds,
  selection,
}) {
  if (!selection?.ok || !DIMENSIONS[selection.dimension]) throw new Error('sales_reporting_export_selection_required');
  const report = await salesReport(pool, requestContext, filters, warehouseIds);
  if (report.reconciliation?.ok !== true) {
    const error = new Error('sales_report_reconciliation_failed');
    error.code = 'SALES_REPORT_RECONCILIATION_FAILED';
    throw error;
  }

  const columns = selection.columns;
  const rows = [
    ...(report.breakdowns?.[selection.dimension] ?? []),
    ...(report.breakdownTotals?.[selection.dimension] ?? []),
  ].map(flattenRow);
  const tempDirectory = await mkdtemp(path.join(tmpdir(), 'npp-sales-report-export-'));
  const extension = selection.format === 'csv' ? 'csv' : 'xlsx';
  const outputPath = path.join(tempDirectory, `sales-report.${extension}`);
  try {
    if (selection.format === 'csv') {
      await writeCsv(outputPath, columns, rows);
    } else {
      const worksheetPath = path.join(tempDirectory, '00-sales-report.xml');
      await writeWorksheet(worksheetPath, columns, rows);
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
      filename: `Bao-cao-ban-hang-${selection.dimensionSlug}-${stamp}.${extension}`,
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

export const salesReportingExportInternals = Object.freeze({
  COLUMN_DEFINITIONS,
  DIMENSIONS,
  SOURCE_LABELS,
  flattenRow,
});
