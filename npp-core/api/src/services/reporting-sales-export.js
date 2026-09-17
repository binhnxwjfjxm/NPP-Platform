import { createWriteStream } from 'node:fs';
import { mkdtemp, rm, stat } from 'node:fs/promises';
import { once } from 'node:events';
import { finished } from 'node:stream/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import {
  buildMultiSheetXlsx,
  sanitizeSheetName,
  writeStoredZip,
} from '../backup/artifacts.js';
import { reportingSalesInternals, salesReport } from '../routes/reporting-sales.js';

const FORMATS = new Set(['xlsx', 'csv']);
const MATRIX_DIMENSION_KEYS = Object.freeze(['products', 'customerGroups', 'channels', 'productGroups']);
const MATRIX_COLUMN_KEYS = MATRIX_DIMENSION_KEYS;
const MATRIX_METRICS = new Set(['revenue', 'quantity']);

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

const MATRIX_DIMENSIONS = Object.freeze({
  products: Object.freeze({ label: 'Sản phẩm', slug: 'San-pham' }),
  customerGroups: Object.freeze({ label: 'Loại khách', slug: 'Loai-khach' }),
  channels: Object.freeze({ label: 'Kênh bán', slug: 'Kenh-ban' }),
  productGroups: Object.freeze({ label: 'Nhóm hàng', slug: 'Nhom-hang' }),
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

function normalizeMatrixSelection(dimensionKey, format) {
  const parts = dimensionKey.split('.');
  if (parts.length !== 4 || parts[0] !== 'matrix') return null;
  const [, rowDimension, columnDimension, metric] = parts;
  if (!MATRIX_DIMENSION_KEYS.includes(rowDimension)) {
    return invalid('INVALID_SALES_MATRIX_ROW', 'Tiêu chí dòng của báo cáo ma trận không hợp lệ');
  }
  if (!MATRIX_COLUMN_KEYS.includes(columnDimension) || rowDimension === columnDimension) {
    return invalid('INVALID_SALES_MATRIX_COLUMN', 'Tiêu chí cột của báo cáo ma trận không hợp lệ');
  }
  if (!MATRIX_METRICS.has(metric)) {
    return invalid('INVALID_SALES_MATRIX_METRIC', 'Chỉ tiêu của báo cáo ma trận không hợp lệ');
  }
  if (format !== 'xlsx') {
    return invalid('INVALID_SALES_MATRIX_FORMAT', 'Báo cáo ma trận chỉ xuất Excel để giữ nguyên khung và bố cục');
  }
  return Object.freeze({
    ok: true,
    matrix: true,
    dimension: dimensionKey,
    format: 'xlsx',
    rowDimension,
    columnDimension,
    metric,
    rowLabel: MATRIX_DIMENSIONS[rowDimension].label,
    columnLabel: MATRIX_DIMENSIONS[columnDimension].label,
    dimensionSlug: `Ma-tran-${MATRIX_DIMENSIONS[rowDimension].slug}-${MATRIX_DIMENSIONS[columnDimension].slug}-${metric === 'quantity' ? 'San-luong' : 'Doanh-thu'}`,
    columns: Object.freeze([]),
  });
}

export function normalizeSalesReportingExportSelection({ dimension: rawDimension, format: rawFormat, columns: rawColumns }) {
  const dimensionKey = String(rawDimension ?? '').trim();
  const format = String(rawFormat ?? 'xlsx').trim().toLowerCase();
  if (!FORMATS.has(format)) return invalid('INVALID_SALES_EXPORT_FORMAT', 'Định dạng xuất chỉ hỗ trợ Excel hoặc CSV');

  if (dimensionKey.startsWith('matrix.')) {
    return normalizeMatrixSelection(dimensionKey, format);
  }

  const definition = DIMENSIONS[dimensionKey];
  if (!definition) return invalid('INVALID_SALES_EXPORT_DIMENSION', 'Chiều phân tích cần xuất không hợp lệ');

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
    matrix: false,
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

function styledTextCell(reference, value, styleId) {
  return `<c r="${reference}" t="inlineStr" s="${styleId}"><is><t xml:space="preserve">${xmlEscape(value)}</t></is></c>`;
}

function styledNumberCell(reference, value, styleId) {
  const normalized = valueText(value).trim();
  if (!normalized) return `<c r="${reference}" s="${styleId}"/>`;
  return `<c r="${reference}" s="${styleId}"><v>${xmlEscape(normalized)}</v></c>`;
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

function text(value, fallback = '') {
  const normalized = String(value ?? '').trim();
  return normalized || fallback;
}

function matrixIdentity(value, fallback) {
  return text(value) || fallback;
}

function matrixDimensionValue(row, key) {
  if (key === 'products') {
    const code = text(row.productCode);
    const name = text(row.productName, 'Sản phẩm chưa xác định');
    const unitCode = text(row.unitCode, 'Không xác định');
    const unitName = text(row.unitName, unitCode);
    return Object.freeze({
      id: `${matrixIdentity(row.productId, `${code}|${name}`)}|${matrixIdentity(row.unitId, unitCode)}`,
      code,
      name,
      unitCode,
      unitName,
    });
  }
  if (key === 'customerGroups') {
    const code = text(row.customerGroupCode);
    const name = row.customerGroupId ? text(row.customerGroupName, 'Chưa phân loại') : 'Chưa phân loại';
    return Object.freeze({ id: matrixIdentity(row.customerGroupId, `${code}|${name}`), code, name });
  }
  if (key === 'channels') {
    const code = text(row.channelCode);
    const name = row.channelId ? text(row.channelName, 'Chưa xác định kênh bán') : 'Chưa xác định kênh bán';
    return Object.freeze({ id: matrixIdentity(row.channelId, `${code}|${name}`), code, name });
  }
  const code = text(row.productGroupCode);
  const name = row.productGroupId ? text(row.productGroupName, 'Chưa phân loại') : 'Chưa phân loại';
  return Object.freeze({ id: matrixIdentity(row.productGroupId, `${code}|${name}`), code, name });
}

function compareMatrixLabel(left, right) {
  return `${left.code}|${left.name}`.localeCompare(`${right.code}|${right.name}`, 'vi');
}

function percentRatioText(numerator, denominator) {
  if (denominator === 0n) return '0';
  const scale = 1_000_000n;
  const rounded = ((numerator * scale) + (denominator / 2n)) / denominator;
  const whole = rounded / scale;
  const fraction = String(rounded % scale).padStart(6, '0').replace(/0+$/, '');
  return `${whole}${fraction ? `.${fraction}` : ''}`;
}

function buildMatrixSheets(rows, selection, filters) {
  const { decimal6, decimalText } = reportingSalesInternals;
  const scopes = new Map();

  for (const fact of rows) {
    const rowDimension = matrixDimensionValue(fact, selection.rowDimension);
    const columnDimension = matrixDimensionValue(fact, selection.columnDimension);
    const value = decimal6(selection.metric === 'quantity' ? fact.quantity : fact.revenue);
    const scopeKey = selection.metric === 'quantity'
      ? matrixIdentity(fact.unitId, text(fact.unitCode, 'Không xác định'))
      : text(fact.currencyCode, 'VND');
    const scopeLabel = selection.metric === 'quantity'
      ? text(fact.unitName, text(fact.unitCode, 'Không xác định'))
      : text(fact.currencyCode, 'VND');

    const scope = scopes.get(scopeKey) ?? {
      key: scopeKey,
      label: scopeLabel,
      columns: new Map(),
      rows: new Map(),
      columnTotals: new Map(),
      grandTotal: 0n,
    };
    scope.columns.set(columnDimension.id, columnDimension);
    const matrixRow = scope.rows.get(rowDimension.id) ?? {
      ...rowDimension,
      total: 0n,
      values: new Map(),
    };
    matrixRow.total += value;
    matrixRow.values.set(columnDimension.id, (matrixRow.values.get(columnDimension.id) ?? 0n) + value);
    scope.columnTotals.set(columnDimension.id, (scope.columnTotals.get(columnDimension.id) ?? 0n) + value);
    scope.grandTotal += value;
    scope.rows.set(rowDimension.id, matrixRow);
    scopes.set(scopeKey, scope);
  }

  const usedNames = new Set();
  return Object.freeze([...scopes.values()].sort((a, b) => a.label.localeCompare(b.label, 'vi')).map((scope) => {
    const columns = [...scope.columns.values()].sort(compareMatrixLabel);
    const matrixRows = [...scope.rows.values()].sort((a, b) => {
      if (a.total !== b.total) return a.total > b.total ? -1 : 1;
      return compareMatrixLabel(a, b);
    });
    const metricLabel = selection.metric === 'quantity' ? 'SẢN LƯỢNG' : 'DOANH THU';
    const scopeText = selection.metric === 'quantity' ? scope.label.toUpperCase() : scope.label;
    const title = `BÁO CÁO MA TRẬN ${metricLabel} ${scopeText} TỪ NGÀY ${formatReportDate(filters.from)} - ${formatReportDate(filters.to)}`;
    const sheetName = sanitizeSheetName(`${selection.rowLabel}-${selection.columnLabel}-${scope.label}`, usedNames);
    return Object.freeze({
      title,
      sheetName,
      rowDimension: selection.rowDimension,
      rowLabel: selection.rowLabel,
      columnLabel: selection.columnLabel,
      metric: selection.metric,
      scopeLabel: scope.label,
      columns: Object.freeze(columns),
      rows: Object.freeze(matrixRows.map((row) => Object.freeze({
        ...row,
        totalText: decimalText(row.total),
      }))),
      columnTotals: scope.columnTotals,
      grandTotal: scope.grandTotal,
      grandTotalText: decimalText(scope.grandTotal),
      decimalText,
    });
  }));
}

function formatReportDate(value) {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(value ?? ''));
  return match ? `${match[3]}/${match[2]}/${match[1].slice(2)}` : String(value ?? '');
}

function matrixWorkbookStyles() {
  return '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
    + '<styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">'
    + '<numFmts count="2"><numFmt numFmtId="164" formatCode="#,##0.##"/><numFmt numFmtId="165" formatCode="0.0%"/></numFmts>'
    + '<fonts count="3"><font><sz val="11"/><name val="Calibri"/></font><font><b/><sz val="11"/><name val="Calibri"/></font><font><b/><sz val="14"/><name val="Calibri"/></font></fonts>'
    + '<fills count="4"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill><fill><patternFill patternType="solid"><fgColor rgb="FFD9E2F3"/><bgColor indexed="64"/></patternFill></fill><fill><patternFill patternType="solid"><fgColor rgb="FFE2F0D9"/><bgColor indexed="64"/></patternFill></fill></fills>'
    + '<borders count="2"><border><left/><right/><top/><bottom/><diagonal/></border><border><left style="thin"><color rgb="FF404040"/></left><right style="thin"><color rgb="FF404040"/></right><top style="thin"><color rgb="FF404040"/></top><bottom style="thin"><color rgb="FF404040"/></bottom><diagonal/></border></borders>'
    + '<cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs>'
    + '<cellXfs count="9">'
    + '<xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/>'
    + '<xf numFmtId="0" fontId="2" fillId="0" borderId="0" xfId="0" applyFont="1" applyAlignment="1"><alignment horizontal="center" vertical="center"/></xf>'
    + '<xf numFmtId="0" fontId="1" fillId="2" borderId="1" xfId="0" applyFont="1" applyFill="1" applyBorder="1" applyAlignment="1"><alignment horizontal="center" vertical="center" wrapText="1"/></xf>'
    + '<xf numFmtId="0" fontId="0" fillId="0" borderId="1" xfId="0" applyBorder="1" applyAlignment="1"><alignment vertical="center"/></xf>'
    + '<xf numFmtId="164" fontId="0" fillId="0" borderId="1" xfId="0" applyNumberFormat="1" applyBorder="1" applyAlignment="1"><alignment horizontal="right" vertical="center"/></xf>'
    + '<xf numFmtId="0" fontId="1" fillId="3" borderId="1" xfId="0" applyFont="1" applyFill="1" applyBorder="1" applyAlignment="1"><alignment vertical="center"/></xf>'
    + '<xf numFmtId="164" fontId="1" fillId="3" borderId="1" xfId="0" applyFont="1" applyFill="1" applyNumberFormat="1" applyBorder="1" applyAlignment="1"><alignment horizontal="right" vertical="center"/></xf>'
    + '<xf numFmtId="165" fontId="1" fillId="0" borderId="1" xfId="0" applyFont="1" applyNumberFormat="1" applyBorder="1" applyAlignment="1"><alignment horizontal="right" vertical="center"/></xf>'
    + '<xf numFmtId="0" fontId="1" fillId="0" borderId="1" xfId="0" applyFont="1" applyBorder="1" applyAlignment="1"><alignment vertical="center"/></xf>'
    + '</cellXfs><cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles></styleSheet>';
}

async function writeMatrixWorksheet(filePath, sheet) {
  const stream = createWriteStream(filePath);
  const productRows = sheet.rowDimension === 'products';
  const metadataHeaders = productRows
    ? ['STT', 'Mã sản phẩm', 'Tên sản phẩm', 'ĐVT']
    : ['STT', 'Mã', sheet.rowLabel];
  const headers = [...metadataHeaders, 'TỔNG', ...sheet.columns.map((item) => item.name)];
  const lastColumn = columnName(headers.length - 1);
  const metadataEnd = columnName(metadataHeaders.length - 1);
  const totalIndex = metadataHeaders.length;
  const totalColumn = columnName(totalIndex);

  try {
    await writeChunk(stream, '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>');
    await writeChunk(stream, '<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">');
    await writeChunk(stream, '<sheetViews><sheetView workbookViewId="0"><pane ySplit="4" topLeftCell="A5" activePane="bottomLeft" state="frozen"/></sheetView></sheetViews>');
    await writeChunk(stream, '<cols>');
    headers.forEach((_, index) => {
      const width = index === 0 ? 7 : index === 1 ? 18 : index === 2 ? 34 : index === 3 && productRows ? 14 : 16;
      stream.write(`<col min="${index + 1}" max="${index + 1}" width="${width}" customWidth="1"/>`);
    });
    await writeChunk(stream, '</cols><sheetData>');
    await writeChunk(stream, `<row r="1" ht="28" customHeight="1">${styledTextCell('A1', sheet.title, 1)}</row>`);
    await writeChunk(stream, `<row r="2" ht="30" customHeight="1">${headers.map((header, index) => styledTextCell(`${columnName(index)}2`, header, 2)).join('')}</row>`);

    const totalCells = [];
    totalCells.push(styledTextCell('A3', 'TỔNG', 5));
    totalCells.push(styledNumberCell(`${totalColumn}3`, sheet.grandTotalText, 6));
    sheet.columns.forEach((item, index) => {
      totalCells.push(styledNumberCell(`${columnName(totalIndex + 1 + index)}3`, sheet.decimalText(sheet.columnTotals.get(item.id) ?? 0n), 6));
    });
    await writeChunk(stream, `<row r="3" ht="22" customHeight="1">${totalCells.join('')}</row>`);

    const percentCells = [];
    percentCells.push(styledTextCell('A4', 'TỶ LỆ', 8));
    percentCells.push(styledNumberCell(`${totalColumn}4`, sheet.grandTotal === 0n ? '0' : '1', 7));
    sheet.columns.forEach((item, index) => {
      percentCells.push(styledNumberCell(`${columnName(totalIndex + 1 + index)}4`, percentRatioText(sheet.columnTotals.get(item.id) ?? 0n, sheet.grandTotal), 7));
    });
    await writeChunk(stream, `<row r="4" ht="22" customHeight="1">${percentCells.join('')}</row>`);

    let rowNumber = 4;
    for (let index = 0; index < sheet.rows.length; index += 1) {
      rowNumber += 1;
      const row = sheet.rows[index];
      const cells = [
        styledNumberCell(`A${rowNumber}`, String(index + 1), 4),
        styledTextCell(`B${rowNumber}`, row.code, 3),
        styledTextCell(`C${rowNumber}`, row.name, 3),
      ];
      let valueStartIndex = 3;
      if (productRows) {
        cells.push(styledTextCell(`D${rowNumber}`, row.unitName, 3));
        valueStartIndex = 4;
      }
      cells.push(styledNumberCell(`${columnName(valueStartIndex)}${rowNumber}`, row.totalText, 4));
      sheet.columns.forEach((item, columnIndex) => {
        const value = row.values.get(item.id) ?? 0n;
        cells.push(styledNumberCell(`${columnName(valueStartIndex + 1 + columnIndex)}${rowNumber}`, sheet.decimalText(value), 4));
      });
      await writeChunk(stream, `<row r="${rowNumber}" ht="21" customHeight="1">${cells.join('')}</row>`);
    }

    await writeChunk(stream, '</sheetData>');
    await writeChunk(stream, `<mergeCells count="3"><mergeCell ref="A1:${lastColumn}1"/><mergeCell ref="A3:${metadataEnd}3"/><mergeCell ref="A4:${metadataEnd}4"/></mergeCells>`);
    await writeChunk(stream, `<pageMargins left="0.3" right="0.3" top="0.5" bottom="0.5" header="0.2" footer="0.2"/><pageSetup orientation="landscape" fitToWidth="1" fitToHeight="0"/>`);
    await writeChunk(stream, '</worksheet>');
    stream.end();
    await finished(stream);
  } catch (error) {
    stream.destroy();
    throw error;
  }
}

async function buildMatrixXlsx(outputPath, matrixSheets, tempDirectory) {
  const worksheetFiles = [];
  for (let index = 0; index < matrixSheets.length; index += 1) {
    const worksheetPath = path.join(tempDirectory, `matrix-${String(index + 1).padStart(2, '0')}.xml`);
    await writeMatrixWorksheet(worksheetPath, matrixSheets[index]);
    worksheetFiles.push(worksheetPath);
  }

  const contentTypes = matrixSheets.map((_, index) => `<Override PartName="/xl/worksheets/sheet${index + 1}.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>`).join('');
  const workbookSheets = matrixSheets.map((sheet, index) => `<sheet name="${xmlEscape(sheet.sheetName)}" sheetId="${index + 1}" r:id="rId${index + 1}"/>`).join('');
  const relationships = matrixSheets.map((_, index) => `<Relationship Id="rId${index + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet${index + 1}.xml"/>`).join('');
  const entries = [
    { name: '[Content_Types].xml', content: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>${contentTypes}</Types>` },
    { name: '_rels/.rels', content: '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>' },
    { name: 'xl/workbook.xml', content: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets>${workbookSheets}</sheets></workbook>` },
    { name: 'xl/_rels/workbook.xml.rels', content: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">${relationships}<Relationship Id="rId${matrixSheets.length + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/></Relationships>` },
    { name: 'xl/styles.xml', content: matrixWorkbookStyles() },
    ...worksheetFiles.map((filePath, index) => ({ name: `xl/worksheets/sheet${index + 1}.xml`, filePath })),
  ];
  await writeStoredZip(outputPath, entries);
}

async function loadSalesMatrixFacts(pool, requestContext, filters, warehouseIds) {
  const result = await pool.query(`SELECT
      sov.currency_code AS "currencyCode",
      line.variant_id AS "productId",
      line.sku_snapshot AS "productCode",
      line.item_name_snapshot AS "productName",
      line.unit_id AS "unitId",
      line.unit_code_snapshot AS "unitCode",
      CASE WHEN line.reporting_dimension_snapshot_captured THEN line.unit_name_snapshot ELSE unit.name END AS "unitName",
      customer.group_id AS "customerGroupId",
      customer_group.code AS "customerGroupCode",
      customer_group.name AS "customerGroupName",
      sov.sales_channel_id AS "channelId",
      sov.sales_channel_code_snapshot AS "channelCode",
      sov.sales_channel_name_snapshot AS "channelName",
      CASE WHEN line.reporting_dimension_snapshot_captured THEN line.product_category_id_snapshot ELSE product.category_id END AS "productGroupId",
      CASE WHEN line.reporting_dimension_snapshot_captured THEN line.product_category_code_snapshot ELSE product_category.code END AS "productGroupCode",
      CASE WHEN line.reporting_dimension_snapshot_captured THEN line.product_category_name_snapshot ELSE product_category.name END AS "productGroupName",
      line.ordered_quantity::text AS quantity,
      line.line_total::text AS revenue
    FROM sales.sales_orders so
    JOIN LATERAL (
      SELECT version.*
        FROM sales.sales_order_versions version
       WHERE version.installation_id = so.installation_id
         AND version.sales_order_id = so.id
         AND version.version_status IN ('confirmed','superseded')
       ORDER BY version.version_number DESC
       LIMIT 1
    ) sov ON true
    JOIN sales.sales_order_version_lines line
      ON line.installation_id = sov.installation_id
     AND line.sales_order_version_id = sov.id
    LEFT JOIN shared.customers customer
      ON customer.installation_id = sov.installation_id
     AND customer.id = sov.customer_id
    LEFT JOIN shared.customer_groups customer_group
      ON customer_group.installation_id = customer.installation_id
     AND customer_group.id = customer.group_id
    LEFT JOIN shared.product_variants variant
      ON variant.installation_id = line.installation_id
     AND variant.id = line.variant_id
    LEFT JOIN shared.products product
      ON product.installation_id = variant.installation_id
     AND product.id = variant.product_id
    LEFT JOIN shared.product_categories product_category
      ON product_category.installation_id = product.installation_id
     AND product_category.id = product.category_id
    LEFT JOIN shared.units_of_measure unit
      ON unit.installation_id = line.installation_id
     AND unit.id = line.unit_id
   WHERE so.installation_id = $1
     AND so.warehouse_id = ANY($2::uuid[])
     AND so.confirmed_at >= $3::timestamptz
     AND so.confirmed_at < $4::timestamptz
     AND ($5::uuid IS NULL OR so.warehouse_id = $5::uuid)
     AND so.status IN ('confirmed','closed')
     AND ($6::uuid IS NULL OR (CASE WHEN line.reporting_dimension_snapshot_captured THEN line.product_category_id_snapshot ELSE product.category_id END) = $6::uuid)
     AND ($7::uuid IS NULL OR customer.group_id = $7::uuid)
   ORDER BY line.item_name_snapshot, line.sku_snapshot, so.id, line.line_number`, [
    requestContext.installationId,
    warehouseIds,
    filters.fromInstant,
    filters.toExclusiveInstant,
    filters.warehouseId,
    filters.productGroupId ?? null,
    filters.customerGroupId ?? null,
  ]);
  return result.rows ?? [];
}

function fileStamp(receivedAt) {
  return new Date(receivedAt ?? Date.now()).toISOString().replace(/[-:]/g, '').replace('T', '-').slice(0, 15);
}

async function createSalesMatrixReportingExport(pool, {
  requestContext,
  filters,
  warehouseIds,
  selection,
  report,
}) {
  const facts = await loadSalesMatrixFacts(pool, requestContext, filters, warehouseIds);
  const matrixSheets = buildMatrixSheets(facts, selection, filters);
  const tempDirectory = await mkdtemp(path.join(tmpdir(), 'npp-sales-matrix-export-'));
  const outputPath = path.join(tempDirectory, 'sales-matrix.xlsx');
  try {
    const sheets = matrixSheets.length
      ? matrixSheets
      : [Object.freeze({
          title: `BÁO CÁO MA TRẬN ${selection.metric === 'quantity' ? 'SẢN LƯỢNG' : 'DOANH THU'} TỪ NGÀY ${formatReportDate(filters.from)} - ${formatReportDate(filters.to)}`,
          sheetName: 'Ma trận',
          rowDimension: selection.rowDimension,
          rowLabel: selection.rowLabel,
          columnLabel: selection.columnLabel,
          metric: selection.metric,
          scopeLabel: '',
          columns: Object.freeze([]),
          rows: Object.freeze([]),
          columnTotals: new Map(),
          grandTotal: 0n,
          grandTotalText: '0',
          decimalText: reportingSalesInternals.decimalText,
        })];
    await buildMatrixXlsx(outputPath, sheets, tempDirectory);
    const fileStat = await stat(outputPath);
    const stamp = fileStamp(requestContext.receivedAt);
    return Object.freeze({
      filePath: outputPath,
      filename: `Bao-cao-ban-hang-${selection.dimensionSlug}-${stamp}.xlsx`,
      contentType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      size: fileStat.size,
      rowCount: facts.length,
      reconciliation: report.reconciliation,
      cleanup: () => rm(tempDirectory, { recursive: true, force: true }),
    });
  } catch (error) {
    await rm(tempDirectory, { recursive: true, force: true });
    throw error;
  }
}

export async function createSalesReportingExport(pool, {
  requestContext,
  filters,
  warehouseIds,
  selection,
}) {
  if (!selection?.ok || (!selection.matrix && !DIMENSIONS[selection.dimension])) {
    throw new Error('sales_reporting_export_selection_required');
  }
  const report = await salesReport(pool, requestContext, filters, warehouseIds);
  if (report.reconciliation?.ok !== true) {
    const error = new Error('sales_report_reconciliation_failed');
    error.code = 'SALES_REPORT_RECONCILIATION_FAILED';
    throw error;
  }

  if (selection.matrix) {
    return createSalesMatrixReportingExport(pool, {
      requestContext,
      filters,
      warehouseIds,
      selection,
      report,
    });
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
  MATRIX_DIMENSIONS,
  SOURCE_LABELS,
  buildMatrixSheets,
  flattenRow,
});
