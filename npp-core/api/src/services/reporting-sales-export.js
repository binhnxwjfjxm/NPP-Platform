import { createWriteStream } from 'node:fs';
import { mkdtemp, rm, stat } from 'node:fs/promises';
import { once } from 'node:events';
import { finished } from 'node:stream/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { sanitizeSheetName, writeStoredZip } from '../backup/artifacts.js';
import { reportingSalesInternals, salesReport } from '../routes/reporting-sales.js';
import {
  createSalesReportingExport as createBaseSalesReportingExport,
  normalizeSalesReportingExportSelection as normalizeBaseSalesReportingExportSelection,
  salesReportingExportInternals as baseSalesReportingExportInternals,
} from './reporting-sales-export-base.js';

const QUANTITY_DISPLAY = new Set(['sold', 'carton', 'base']);
const ANALYSIS_SORT = new Set(['name-asc', 'revenue-desc', 'revenue-asc', 'quantity-desc', 'quantity-asc']);
const SCALE = 1_000_000n;

function invalid(code, message, details = {}) {
  return Object.freeze({ ok: false, code, message, details, statusCode: 400 });
}

function text(value, fallback = '') {
  const normalized = String(value ?? '').trim();
  return normalized || fallback;
}

function identityPart(value, fallback = '__none__') {
  return encodeURIComponent(text(value, fallback));
}

export function normalizeSalesReportingExportSelection({
  dimension,
  format,
  columns,
  quantityDisplay: rawQuantityDisplay,
  sort: rawSort,
}) {
  const base = normalizeBaseSalesReportingExportSelection({ dimension, format, columns });
  if (!base.ok || !base.analysis) return base;

  const quantityDisplay = text(rawQuantityDisplay, 'sold').toLowerCase();
  if (!QUANTITY_DISPLAY.has(quantityDisplay)) {
    return invalid(
      'INVALID_SALES_ANALYSIS_QUANTITY_DISPLAY',
      'Cách hiển thị sản lượng không hợp lệ',
      { allowed: [...QUANTITY_DISPLAY] },
    );
  }

  const sort = text(rawSort, 'name-asc').toLowerCase();
  if (!ANALYSIS_SORT.has(sort)
    || (sort.startsWith('quantity-') && !base.metrics.includes('quantity'))
    || (sort.startsWith('revenue-') && !base.metrics.includes('revenue'))) {
    return invalid(
      'INVALID_SALES_ANALYSIS_SORT',
      'Cách sắp xếp báo cáo không hợp lệ',
      { allowed: [...ANALYSIS_SORT] },
    );
  }

  return Object.freeze({
    ...base,
    quantityDisplay: base.metrics.includes('quantity') ? quantityDisplay : 'sold',
    sort,
  });
}

function dimensionValue(row, key) {
  if (key === 'products') {
    const code = text(row.productCode);
    const name = text(row.productName, 'Sản phẩm chưa xác định');
    const id = text(row.productId, text(row.variantId, `${code}|${name}`));
    return Object.freeze({ id, key: `products:${identityPart(id)}`, code, name });
  }
  if (key === 'customerGroups') {
    const code = text(row.customerGroupCode);
    const name = row.customerGroupId ? text(row.customerGroupName, 'Chưa phân loại') : 'Chưa phân loại';
    const id = text(row.customerGroupId, `${code}|${name}`);
    return Object.freeze({ id, key: `customerGroups:${identityPart(id)}`, code, name });
  }
  if (key === 'channels') {
    const code = text(row.channelCode);
    const name = row.channelId ? text(row.channelName, 'Chưa xác định kênh bán') : 'Chưa xác định kênh bán';
    const id = text(row.channelId, `${code}|${name}`);
    return Object.freeze({ id, key: `channels:${identityPart(id)}`, code, name });
  }
  const code = text(row.productGroupCode);
  const name = row.productGroupId ? text(row.productGroupName, 'Chưa phân loại') : 'Chưa phân loại';
  const id = text(row.productGroupId, `${code}|${name}`);
  return Object.freeze({ id, key: `productGroups:${identityPart(id)}`, code, name });
}

function compareLabel(left, right) {
  return `${left.code}|${left.name}`.localeCompare(`${right.code}|${right.name}`, 'vi');
}

function metricBucket() {
  return { revenueByCurrency: new Map(), quantityByUnit: new Map() };
}

function addRevenue(bucket, currencyCode, value) {
  bucket.revenueByCurrency.set(currencyCode, (bucket.revenueByCurrency.get(currencyCode) ?? 0n) + value);
}

function addQuantity(bucket, presentation) {
  const current = bucket.quantityByUnit.get(presentation.unitKey) ?? {
    unitKey: presentation.unitKey,
    unitCode: presentation.unitCode,
    unitName: presentation.unitName,
    value: 0n,
  };
  current.value += presentation.value;
  bucket.quantityByUnit.set(presentation.unitKey, current);
}

function divideScaled(numerator, denominator) {
  if (denominator === 0n) return 0n;
  const negative = (numerator < 0n) !== (denominator < 0n);
  const left = numerator < 0n ? -numerator : numerator;
  const right = denominator < 0n ? -denominator : denominator;
  const rounded = ((left * SCALE) + (right / 2n)) / right;
  return negative ? -rounded : rounded;
}

function quantityPresentation(fact, mode, decimal6) {
  const soldUnitCode = text(fact.unitCode, 'Không xác định');
  const soldUnitName = text(fact.unitName, soldUnitCode);
  const soldUnitKey = text(fact.unitId, soldUnitCode);
  if (mode === 'sold') {
    return Object.freeze({
      unitKey: soldUnitKey,
      unitCode: soldUnitCode,
      unitName: soldUnitName,
      value: decimal6(fact.orderedQuantity ?? fact.quantity),
    });
  }

  const baseValue = decimal6(fact.baseQuantity ?? fact.quantity);
  const baseUnitCode = text(fact.baseUnitCode, soldUnitCode);
  const baseUnitName = text(fact.baseUnitName, baseUnitCode);
  const baseUnitKey = text(fact.baseUnitId, baseUnitCode);

  if (mode === 'carton') {
    const cartonFactor = decimal6(fact.cartonConversionToBase);
    if (fact.cartonUnitId && cartonFactor > 0n) {
      const cartonCode = text(fact.cartonUnitCode, 'Thùng');
      const cartonName = text(fact.cartonUnitName, cartonCode);
      return Object.freeze({
        unitKey: text(fact.cartonUnitId, cartonCode),
        unitCode: cartonCode,
        unitName: cartonName,
        value: divideScaled(baseValue, cartonFactor),
      });
    }
  }

  return Object.freeze({ unitKey: baseUnitKey, unitCode: baseUnitCode, unitName: baseUnitName, value: baseValue });
}

function quantityEntries(bucket) {
  return [...bucket.quantityByUnit.values()].sort((left, right) => `${left.unitName}|${left.unitCode}`.localeCompare(`${right.unitName}|${right.unitCode}`, 'vi'));
}

function quantityCell(bucket, decimalText) {
  const entries = quantityEntries(bucket);
  if (!entries.length) return Object.freeze({ text: '0', numeric: true });
  if (entries.length === 1) return Object.freeze({ text: decimalText(entries[0].value), numeric: true });
  return Object.freeze({ text: entries.map((entry) => `${decimalText(entry.value)} ${entry.unitName}`).join('; '), numeric: false });
}

function rowUnitLabel(bucket) {
  return quantityEntries(bucket).map((entry) => entry.unitName).join('; ');
}

function analysisSortValue(row, sort, currencies) {
  if (sort.startsWith('quantity-')) {
    const entries = quantityEntries(row.totals);
    return entries.length === 1 ? entries[0].value : null;
  }
  if (sort.startsWith('revenue-')) {
    if (currencies.length !== 1) return null;
    return row.totals.revenueByCurrency.get(currencies[0]) ?? 0n;
  }
  return null;
}

function compareAnalysisRows(left, right, selection, currencies) {
  const sort = selection.sort ?? 'name-asc';
  if (sort === 'name-asc') return compareLabel(left, right);
  const leftValue = analysisSortValue(left, sort, currencies);
  const rightValue = analysisSortValue(right, sort, currencies);
  if (leftValue === null && rightValue === null) return compareLabel(left, right);
  if (leftValue === null) return 1;
  if (rightValue === null) return -1;
  if (leftValue === rightValue) return compareLabel(left, right);
  const direction = sort.endsWith('-desc') ? -1 : 1;
  return leftValue > rightValue ? direction : -direction;
}
function formatReportDate(value) {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(value ?? ''));
  return match ? `${match[3]}/${match[2]}/${match[1].slice(2)}` : String(value ?? '');
}

export function buildAnalysisSheet(rows, selection, filters) {
  const { decimal6, decimalText } = reportingSalesInternals;
  const metrics = new Set(selection.metrics);
  const selectedTokens = selection.columns?.length ? new Set(selection.columns) : null;
  const categories = new Map();
  const resultRows = new Map();
  const currencies = new Set();
  const grand = { ...metricBucket(), values: new Map() };

  for (const fact of rows) {
    const rowDimension = dimensionValue(fact, selection.rowDimension);
    const columnDimension = dimensionValue(fact, selection.columnDimension);
    const currencyCode = text(fact.currencyCode, 'VND');
    const revenue = decimal6(fact.revenue);
    const quantity = quantityPresentation(fact, selection.quantityDisplay ?? 'sold', decimal6);

    currencies.add(currencyCode);
    categories.set(columnDimension.key, columnDimension);

    const rowKey = selection.rowDimension === 'products'
      ? rowDimension.key
      : selection.quantityDisplay === 'sold' && metrics.has('quantity')
        ? `${rowDimension.key}|unit:${identityPart(quantity.unitKey)}`
        : rowDimension.key;

    const reportRow = resultRows.get(rowKey) ?? { ...rowDimension, totals: metricBucket(), values: new Map() };
    const valueBucket = reportRow.values.get(columnDimension.key) ?? metricBucket();
    const grandValueBucket = grand.values.get(columnDimension.key) ?? metricBucket();

    if (metrics.has('revenue')) {
      addRevenue(reportRow.totals, currencyCode, revenue);
      addRevenue(valueBucket, currencyCode, revenue);
      addRevenue(grand, currencyCode, revenue);
      addRevenue(grandValueBucket, currencyCode, revenue);
    }
    if (metrics.has('quantity')) {
      addQuantity(reportRow.totals, quantity);
      addQuantity(valueBucket, quantity);
      addQuantity(grand, quantity);
      addQuantity(grandValueBucket, quantity);
    }

    reportRow.values.set(columnDimension.key, valueBucket);
    grand.values.set(columnDimension.key, grandValueBucket);
    resultRows.set(rowKey, reportRow);
  }

  const sortedCategories = [...categories.values()].sort(compareLabel);
  const sortedCurrencies = metrics.has('revenue') ? [...currencies].sort((left, right) => left.localeCompare(right, 'vi')) : [];
  if (metrics.has('revenue') && sortedCurrencies.length === 0) sortedCurrencies.push('VND');

  const allColumns = [
    Object.freeze({ token: 'meta:code', kind: 'meta', field: 'code', label: selection.rowDimension === 'products' ? 'Mã sản phẩm' : 'Mã' }),
    Object.freeze({ token: 'meta:name', kind: 'meta', field: 'name', label: selection.rowLabel }),
  ];
  if (selection.rowDimension === 'products' || metrics.has('quantity')) {
    allColumns.push(Object.freeze({ token: 'meta:unit', kind: 'meta', field: 'unitName', label: 'ĐVT' }));
  }

  for (const category of sortedCategories) {
    if (metrics.has('revenue')) {
      for (const currencyCode of sortedCurrencies) {
        const suffix = sortedCurrencies.length > 1 ? ` (${currencyCode})` : '';
        allColumns.push(Object.freeze({
          token: `cat:${category.key}|revenue|${identityPart(currencyCode)}`,
          kind: 'category', groupLabel: category.name, metricLabel: `Doanh thu${suffix}`,
          metric: 'revenue', categoryKey: category.key, currencyCode,
          label: `${category.name} - Doanh thu${suffix}`,
        }));
      }
    }
    if (metrics.has('quantity')) {
      allColumns.push(Object.freeze({
        token: `cat:${category.key}|quantity`, kind: 'category', groupLabel: category.name,
        metricLabel: 'Sản lượng', metric: 'quantity', categoryKey: category.key,
        label: `${category.name} - Sản lượng`,
      }));
    }
  }

  if (metrics.has('revenue')) {
    for (const currencyCode of sortedCurrencies) {
      const suffix = sortedCurrencies.length > 1 ? ` (${currencyCode})` : '';
      allColumns.push(Object.freeze({
        token: `total:revenue:${identityPart(currencyCode)}`, kind: 'total', groupLabel: 'Tổng',
        metricLabel: `Doanh thu${suffix}`, metric: 'revenue', currencyCode, label: `Tổng doanh thu${suffix}`,
      }));
    }
  }
  if (metrics.has('quantity')) {
    allColumns.push(Object.freeze({ token: 'total:quantity', kind: 'total', groupLabel: 'Tổng', metricLabel: 'Sản lượng', metric: 'quantity', label: 'Tổng sản lượng' }));
  }

  const columns = selectedTokens ? allColumns.filter((item) => selectedTokens.has(item.token)) : allColumns;
  const reportRows = [...resultRows.values()]
    .sort((left, right) => compareAnalysisRows(left, right, selection, sortedCurrencies))
    .map((row) => Object.freeze({
      ...row,
      unitName: metrics.has('quantity') ? rowUnitLabel(row.totals) : '',
    }));

  return Object.freeze({
    title: `BÁO CÁO ${selection.rowLabel.toUpperCase()} THEO ${selection.columnLabel.toUpperCase()} TỪ NGÀY ${formatReportDate(filters.from)} - ${formatReportDate(filters.to)}`,
    sheetName: 'Tổng hợp',
    rowDimension: selection.rowDimension,
    rowLabel: selection.rowLabel,
    columnLabel: selection.columnLabel,
    metrics: selection.metrics,
    quantityDisplay: selection.quantityDisplay,
    sort: selection.sort,
    currencies: Object.freeze(sortedCurrencies),
    categories: Object.freeze(sortedCategories),
    columns: Object.freeze(columns),
    rows: Object.freeze(reportRows),
    grand,
    quantityGrandValid: grand.quantityByUnit.size <= 1,
    decimalText,
  });
}


function detailMetricColumns(summary) {
  const columns = summary.columns.filter((definition) => definition.kind === 'meta');
  const includeRevenue = summary.columns.some((definition) => definition.metric === 'revenue');
  const includeQuantity = summary.columns.some((definition) => definition.metric === 'quantity');

  if (includeRevenue) {
    for (const currencyCode of summary.currencies) {
      const suffix = summary.currencies.length > 1 ? ` (${currencyCode})` : '';
      columns.push(Object.freeze({
        token: `detail:revenue:${identityPart(currencyCode)}`,
        kind: 'total',
        groupLabel: 'Kết quả',
        metricLabel: `Doanh thu${suffix}`,
        metric: 'revenue',
        currencyCode,
        label: `Doanh thu${suffix}`,
      }));
    }
  }
  if (includeQuantity) {
    columns.push(Object.freeze({
      token: 'detail:quantity',
      kind: 'total',
      groupLabel: 'Kết quả',
      metricLabel: 'Sản lượng',
      metric: 'quantity',
      label: 'Sản lượng',
    }));
  }
  return Object.freeze(columns);
}

function buildAnalysisDetailSheet(summary, category, selection, filters, usedSheetNames) {
  const bucket = summary.grand.values.get(category.key) ?? metricBucket();
  const columns = detailMetricColumns(summary);
  const metrics = [...new Set(columns.map((definition) => definition.metric).filter(Boolean))];
  const rows = summary.rows
    .filter((row) => row.values.has(category.key))
    .map((row) => {
      const rowBucket = row.values.get(category.key);
      return Object.freeze({
        ...row,
        totals: rowBucket,
        values: new Map(),
        unitName: metrics.includes('quantity') ? rowUnitLabel(rowBucket) : '',
      });
    })
    .sort((left, right) => compareAnalysisRows(left, right, selection, summary.currencies));

  return Object.freeze({
    title: `BÁO CÁO ${selection.rowLabel.toUpperCase()} - ${category.name.toUpperCase()} TỪ NGÀY ${formatReportDate(filters.from)} - ${formatReportDate(filters.to)}`,
    sheetName: sanitizeSheetName(category.name, usedSheetNames),
    rowDimension: selection.rowDimension,
    rowLabel: selection.rowLabel,
    columnLabel: category.name,
    metrics: Object.freeze(metrics),
    quantityDisplay: selection.quantityDisplay,
    sort: selection.sort,
    currencies: summary.currencies,
    categories: Object.freeze([category]),
    columns,
    rows: Object.freeze(rows),
    grand: { ...bucket, values: new Map() },
    quantityGrandValid: bucket.quantityByUnit.size <= 1,
    decimalText: summary.decimalText,
  });
}

export function buildAnalysisSheets(rows, selection, filters) {
  const usedSheetNames = new Set();
  const summaryBase = buildAnalysisSheet(rows, selection, filters);
  const summary = Object.freeze({
    ...summaryBase,
    sheetName: sanitizeSheetName('Tổng hợp', usedSheetNames),
  });
  const details = summary.categories
    .map((category) => buildAnalysisDetailSheet(summary, category, selection, filters, usedSheetNames))
    .filter((sheet) => sheet.rows.length > 0);
  return Object.freeze([summary, ...details]);
}

function xmlEscape(value) {
  return String(value).replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, ' ').replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll('"', '&quot;');
}
function valueText(value) { return value === null || value === undefined ? '' : String(value); }
function columnName(index) {
  let value = index + 1; let result = '';
  while (value > 0) { const remainder = (value - 1) % 26; result = String.fromCharCode(65 + remainder) + result; value = Math.floor((value - 1) / 26); }
  return result;
}
function styledTextCell(reference, value, styleId) { return `<c r="${reference}" t="inlineStr" s="${styleId}"><is><t xml:space="preserve">${xmlEscape(value)}</t></is></c>`; }
function styledNumberCell(reference, value, styleId) {
  const normalized = valueText(value).trim();
  return normalized ? `<c r="${reference}" s="${styleId}"><v>${xmlEscape(normalized)}</v></c>` : `<c r="${reference}" s="${styleId}"/>`;
}
function numberCellStyle(value, integerStyle, decimalStyle) {
  return valueText(value).trim().includes('.') ? decimalStyle : integerStyle;
}
async function writeChunk(stream, chunk) { if (!stream.write(chunk)) await once(stream, 'drain'); }

function workbookStyles() {
  return '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
    + '<styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">'
    + '<numFmts count="2"><numFmt numFmtId="164" formatCode="#,##0"/><numFmt numFmtId="165" formatCode="#,##0.######"/></numFmts>'
    + '<fonts count="3"><font><sz val="11"/><name val="Calibri"/></font><font><b/><sz val="11"/><name val="Calibri"/></font><font><b/><sz val="14"/><name val="Calibri"/></font></fonts>'
    + '<fills count="4"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill><fill><patternFill patternType="solid"><fgColor rgb="FFD9E2F3"/><bgColor indexed="64"/></patternFill></fill><fill><patternFill patternType="solid"><fgColor rgb="FFE2F0D9"/><bgColor indexed="64"/></patternFill></fill></fills>'
    + '<borders count="2"><border><left/><right/><top/><bottom/><diagonal/></border><border><left style="thin"><color rgb="FF404040"/></left><right style="thin"><color rgb="FF404040"/></right><top style="thin"><color rgb="FF404040"/></top><bottom style="thin"><color rgb="FF404040"/></bottom><diagonal/></border></borders>'
    + '<cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs>'
    + '<cellXfs count="9"><xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/><xf numFmtId="0" fontId="2" fillId="0" borderId="0" xfId="0" applyFont="1" applyAlignment="1"><alignment horizontal="center" vertical="center"/></xf><xf numFmtId="0" fontId="1" fillId="2" borderId="1" xfId="0" applyFont="1" applyFill="1" applyBorder="1" applyAlignment="1"><alignment horizontal="center" vertical="center" wrapText="1"/></xf><xf numFmtId="0" fontId="0" fillId="0" borderId="1" xfId="0" applyBorder="1" applyAlignment="1"><alignment vertical="center"/></xf><xf numFmtId="164" fontId="0" fillId="0" borderId="1" xfId="0" applyNumberFormat="1" applyBorder="1" applyAlignment="1"><alignment horizontal="right" vertical="center"/></xf><xf numFmtId="0" fontId="1" fillId="3" borderId="1" xfId="0" applyFont="1" applyFill="1" applyBorder="1" applyAlignment="1"><alignment vertical="center"/></xf><xf numFmtId="164" fontId="1" fillId="3" borderId="1" xfId="0" applyFont="1" applyFill="1" applyNumberFormat="1" applyBorder="1" applyAlignment="1"><alignment horizontal="right" vertical="center"/></xf><xf numFmtId="165" fontId="0" fillId="0" borderId="1" xfId="0" applyNumberFormat="1" applyBorder="1" applyAlignment="1"><alignment horizontal="right" vertical="center"/></xf><xf numFmtId="165" fontId="1" fillId="3" borderId="1" xfId="0" applyFont="1" applyFill="1" applyNumberFormat="1" applyBorder="1" applyAlignment="1"><alignment horizontal="right" vertical="center"/></xf></cellXfs>'
    + '<cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles></styleSheet>';
}

function analysisCellValue(row, definition, sheet) {
  if (definition.kind === 'meta') return Object.freeze({ text: row[definition.field] ?? '', numeric: false });
  const bucket = definition.kind === 'category' ? row.values.get(definition.categoryKey) : row.totals;
  if (!bucket) return Object.freeze({ text: '0', numeric: true });
  if (definition.metric === 'quantity') return quantityCell(bucket, sheet.decimalText);
  return Object.freeze({ text: sheet.decimalText(bucket.revenueByCurrency.get(definition.currencyCode) ?? 0n), numeric: true });
}

function analysisGrandValue(definition, sheet) {
  if (definition.kind === 'meta') return Object.freeze({ text: '', numeric: false });
  const bucket = definition.kind === 'category' ? sheet.grand.values.get(definition.categoryKey) : sheet.grand;
  if (!bucket) return Object.freeze({ text: '0', numeric: true });
  if (definition.metric === 'quantity') {
    if (!sheet.quantityGrandValid) return Object.freeze({ text: '', numeric: false });
    return quantityCell(bucket, sheet.decimalText);
  }
  return Object.freeze({ text: sheet.decimalText(bucket.revenueByCurrency.get(definition.currencyCode) ?? 0n), numeric: true });
}

async function writeAnalysisWorksheet(filePath, sheet) {
  const stream = createWriteStream(filePath);
  const headers = ['STT', ...sheet.columns.map((item) => item.label)];
  const lastColumn = columnName(headers.length - 1);
  const twoLevels = sheet.metrics.length === 2;
  const headerRows = twoLevels ? 2 : 1;
  const dataStart = 1 + headerRows;
  const mergeRefs = [`A1:${lastColumn}1`];
  try {
    await writeChunk(stream, '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">');
    await writeChunk(stream, `<sheetViews><sheetView workbookViewId="0"><pane ySplit="${1 + headerRows}" topLeftCell="A${dataStart + 1}" activePane="bottomLeft" state="frozen"/></sheetView></sheetViews><cols>`);
    headers.forEach((header, index) => {
      const width = index === 0 ? 7 : /Sản phẩm|Nhóm hàng|Loại khách|Kênh bán/.test(header) ? 30 : /Doanh thu|Sản lượng|Tổng/.test(header) ? 18 : 16;
      stream.write(`<col min="${index + 1}" max="${index + 1}" width="${width}" customWidth="1"/>`);
    });
    await writeChunk(stream, `</cols><sheetData><row r="1" ht="28" customHeight="1">${styledTextCell('A1', sheet.title, 1)}</row>`);

    if (!twoLevels) {
      await writeChunk(stream, `<row r="2" ht="34" customHeight="1">${headers.map((header, index) => styledTextCell(`${columnName(index)}2`, header, 2)).join('')}</row>`);
    } else {
      const topCells = [styledTextCell('A2', 'STT', 2)];
      const bottomCells = [styledTextCell('A3', '', 2)];
      mergeRefs.push('A2:A3');
      let columnIndex = 1;
      for (let index = 0; index < sheet.columns.length;) {
        const definition = sheet.columns[index];
        if (definition.kind === 'meta') {
          const col = columnName(columnIndex);
          topCells.push(styledTextCell(`${col}2`, definition.label, 2));
          bottomCells.push(styledTextCell(`${col}3`, '', 2));
          mergeRefs.push(`${col}2:${col}3`);
          index += 1; columnIndex += 1; continue;
        }
        const groupLabel = definition.groupLabel ?? definition.label;
        let count = 1;
        while (index + count < sheet.columns.length) {
          const next = sheet.columns[index + count];
          if (next.kind === 'meta' || (next.groupLabel ?? next.label) !== groupLabel) break;
          count += 1;
        }
        topCells.push(styledTextCell(`${columnName(columnIndex)}2`, groupLabel, 2));
        for (let offset = 1; offset < count; offset += 1) topCells.push(styledTextCell(`${columnName(columnIndex + offset)}2`, '', 2));
        for (let offset = 0; offset < count; offset += 1) {
          const item = sheet.columns[index + offset];
          bottomCells.push(styledTextCell(`${columnName(columnIndex + offset)}3`, item.metricLabel ?? item.label, 2));
        }
        if (count > 1) mergeRefs.push(`${columnName(columnIndex)}2:${columnName(columnIndex + count - 1)}2`);
        index += count; columnIndex += count;
      }
      await writeChunk(stream, `<row r="2" ht="30" customHeight="1">${topCells.join('')}</row><row r="3" ht="30" customHeight="1">${bottomCells.join('')}</row>`);
    }

    let rowNumber = dataStart;
    for (let index = 0; index < sheet.rows.length; index += 1) {
      rowNumber += 1;
      const row = sheet.rows[index];
      const cells = [styledNumberCell(`A${rowNumber}`, String(index + 1), 4)];
      sheet.columns.forEach((definition, columnIndex) => {
        const value = analysisCellValue(row, definition, sheet);
        const ref = `${columnName(columnIndex + 1)}${rowNumber}`;
        cells.push(value.numeric
          ? styledNumberCell(ref, value.text, numberCellStyle(value.text, 4, 7))
          : styledTextCell(ref, value.text, 3));
      });
      await writeChunk(stream, `<row r="${rowNumber}" ht="21" customHeight="1">${cells.join('')}</row>`);
    }
    rowNumber += 1;
    const totalCells = [styledTextCell(`A${rowNumber}`, 'TỔNG', 5)];
    sheet.columns.forEach((definition, columnIndex) => {
      const ref = `${columnName(columnIndex + 1)}${rowNumber}`;
      const value = analysisGrandValue(definition, sheet);
      totalCells.push(definition.kind === 'meta' || !value.numeric
        ? styledTextCell(ref, value.text, 5)
        : styledNumberCell(ref, value.text, numberCellStyle(value.text, 6, 8)));
    });
    await writeChunk(stream, `<row r="${rowNumber}" ht="22" customHeight="1">${totalCells.join('')}</row></sheetData>`);
    await writeChunk(stream, `<mergeCells count="${mergeRefs.length}">${mergeRefs.map((ref) => `<mergeCell ref="${ref}"/>`).join('')}</mergeCells><pageMargins left="0.3" right="0.3" top="0.5" bottom="0.5" header="0.2" footer="0.2"/><pageSetup orientation="landscape" fitToWidth="1" fitToHeight="0"/></worksheet>`);
    stream.end(); await finished(stream);
  } catch (error) { stream.destroy(); throw error; }
}

async function buildAnalysisXlsx(outputPath, sheets, tempDirectory) {
  const worksheetEntries = [];
  for (let index = 0; index < sheets.length; index += 1) {
    const worksheetPath = path.join(tempDirectory, `analysis-${index + 1}.xml`);
    await writeAnalysisWorksheet(worksheetPath, sheets[index]);
    worksheetEntries.push({
      name: `xl/worksheets/sheet${index + 1}.xml`,
      filePath: worksheetPath,
    });
  }

  const worksheetOverrides = sheets
    .map((_, index) => `<Override PartName="/xl/worksheets/sheet${index + 1}.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>`)
    .join('');
  const workbookSheets = sheets
    .map((sheet, index) => `<sheet name="${xmlEscape(sheet.sheetName)}" sheetId="${index + 1}" r:id="rId${index + 1}"/>`)
    .join('');
  const worksheetRelationships = sheets
    .map((_, index) => `<Relationship Id="rId${index + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet${index + 1}.xml"/>`)
    .join('');
  const stylesRelationshipId = sheets.length + 1;

  await writeStoredZip(outputPath, [
    {
      name: '[Content_Types].xml',
      content: '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>' + worksheetOverrides + '</Types>',
    },
    {
      name: '_rels/.rels',
      content: '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>',
    },
    {
      name: 'xl/workbook.xml',
      content: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets>${workbookSheets}</sheets></workbook>`,
    },
    {
      name: 'xl/_rels/workbook.xml.rels',
      content: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">${worksheetRelationships}<Relationship Id="rId${stylesRelationshipId}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/></Relationships>`,
    },
    { name: 'xl/styles.xml', content: workbookStyles() },
    ...worksheetEntries,
  ]);
}

async function loadSalesAnalysisFacts(pool, requestContext, filters, warehouseIds) {
  const result = await pool.query(`SELECT
      sov.currency_code AS "currencyCode",
      product.id AS "productId",
      product.code AS "productCode",
      COALESCE(NULLIF(product.catalog_name, ''), product.name, line.item_name_snapshot) AS "productName",
      variant.id AS "variantId",
      line.sku_snapshot AS sku,
      line.unit_id AS "unitId",
      line.unit_code_snapshot AS "unitCode",
      CASE WHEN line.reporting_dimension_snapshot_captured THEN line.unit_name_snapshot ELSE unit.name END AS "unitName",
      line.conversion_to_base::text AS "conversionToBase",
      line.ordered_quantity::text AS "orderedQuantity",
      line.base_quantity::text AS "baseQuantity",
      base_variant.unit_id AS "baseUnitId", base_unit.code AS "baseUnitCode", base_unit.name AS "baseUnitName",
      carton_variant.unit_id AS "cartonUnitId", carton_unit.code AS "cartonUnitCode", carton_unit.name AS "cartonUnitName",
      carton_variant.conversion_to_base::text AS "cartonConversionToBase",
      customer.group_id AS "customerGroupId", customer_group.code AS "customerGroupCode", customer_group.name AS "customerGroupName",
      sov.sales_channel_id AS "channelId", sov.sales_channel_code_snapshot AS "channelCode", sov.sales_channel_name_snapshot AS "channelName",
      product.category_id AS "productGroupId",
      product_category.code AS "productGroupCode",
      product_category.name AS "productGroupName",
      line.line_total::text AS revenue
    FROM sales.sales_orders so
    JOIN LATERAL (SELECT version.* FROM sales.sales_order_versions version WHERE version.installation_id = so.installation_id AND version.sales_order_id = so.id AND version.version_status IN ('confirmed','superseded') ORDER BY version.version_number DESC LIMIT 1) sov ON true
    JOIN sales.sales_order_version_lines line ON line.installation_id = sov.installation_id AND line.sales_order_version_id = sov.id
    LEFT JOIN shared.customers customer ON customer.installation_id = sov.installation_id AND customer.id = sov.customer_id
    LEFT JOIN shared.customer_groups customer_group ON customer_group.installation_id = customer.installation_id AND customer_group.id = customer.group_id
    LEFT JOIN shared.product_variants variant ON variant.installation_id = line.installation_id AND variant.id = line.variant_id
    LEFT JOIN shared.products product ON product.installation_id = variant.installation_id AND product.id = variant.product_id
    LEFT JOIN shared.product_categories product_category ON product_category.installation_id = product.installation_id AND product_category.id = product.category_id
    LEFT JOIN shared.units_of_measure unit ON unit.installation_id = line.installation_id AND unit.id = line.unit_id
    LEFT JOIN LATERAL (
      SELECT pv.unit_id, pv.conversion_to_base FROM shared.product_variants pv
       WHERE pv.installation_id = line.installation_id AND pv.product_id = product.id AND pv.is_active = true AND pv.is_inventory_base = true
       ORDER BY pv.is_sellable DESC, pv.id LIMIT 1
    ) base_variant ON true
    LEFT JOIN shared.units_of_measure base_unit ON base_unit.installation_id = line.installation_id AND base_unit.id = base_variant.unit_id
    LEFT JOIN LATERAL (
      SELECT pv.unit_id, pv.conversion_to_base FROM shared.product_variants pv
       WHERE pv.installation_id = line.installation_id AND pv.product_id = product.id AND pv.is_active = true AND pv.variant_kind = 'CARTON' AND pv.conversion_to_base > 0
       ORDER BY pv.is_sellable DESC, pv.conversion_to_base DESC, pv.id LIMIT 1
    ) carton_variant ON true
    LEFT JOIN shared.units_of_measure carton_unit ON carton_unit.installation_id = line.installation_id AND carton_unit.id = carton_variant.unit_id
   WHERE so.installation_id = $1 AND so.warehouse_id = ANY($2::uuid[])
     AND so.confirmed_at >= $3::timestamptz AND so.confirmed_at < $4::timestamptz
     AND ($5::uuid IS NULL OR so.warehouse_id = $5::uuid) AND so.status IN ('confirmed','closed')
     AND ($6::uuid IS NULL OR product.category_id = $6::uuid)
     AND ($7::uuid IS NULL OR product.brand_id = $7::uuid)
     AND ($8::uuid IS NULL OR customer.group_id = $8::uuid)
   ORDER BY product.name, line.sku_snapshot, so.id, line.line_number`, [
    requestContext.installationId, warehouseIds, filters.fromInstant, filters.toExclusiveInstant, filters.warehouseId,
    filters.productGroupId ?? null, filters.brandId ?? null, filters.customerGroupId ?? null,
  ]);
  return result.rows ?? [];
}

function fileStamp(receivedAt) { return new Date(receivedAt ?? Date.now()).toISOString().replace(/[-:]/g, '').replace('T', '-').slice(0, 15); }

async function createAnalysisExport(pool, { requestContext, filters, warehouseIds, selection, report }) {
  const facts = await loadSalesAnalysisFacts(pool, requestContext, filters, warehouseIds);
  const sheets = buildAnalysisSheets(facts, selection, filters);
  const tempDirectory = await mkdtemp(path.join(tmpdir(), 'npp-sales-analysis-export-'));
  const outputPath = path.join(tempDirectory, 'sales-analysis.xlsx');
  try {
    await buildAnalysisXlsx(outputPath, sheets, tempDirectory);
    const fileStat = await stat(outputPath);
    return Object.freeze({
      filePath: outputPath,
      filename: `Bao-cao-ban-hang-${selection.dimensionSlug}-${fileStamp(requestContext.receivedAt)}.xlsx`,
      contentType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      size: fileStat.size,
      rowCount: sheets[0].rows.length,
      reconciliation: report.reconciliation,
      cleanup: () => rm(tempDirectory, { recursive: true, force: true }),
    });
  } catch (error) { await rm(tempDirectory, { recursive: true, force: true }); throw error; }
}

export async function createSalesReportingExport(pool, args) {
  if (!args.selection?.analysis) return createBaseSalesReportingExport(pool, args);
  const report = await salesReport(pool, args.requestContext, args.filters, args.warehouseIds);
  if (report.reconciliation?.ok !== true) {
    const error = new Error('sales_report_reconciliation_failed'); error.code = 'SALES_REPORT_RECONCILIATION_FAILED'; throw error;
  }
  return createAnalysisExport(pool, { ...args, report });
}

export const salesReportingExportInternals = Object.freeze({
  ...baseSalesReportingExportInternals,
  buildAnalysisSheet,
  buildAnalysisSheets,
  divideScaled,
  quantityPresentation,
  numberCellStyle,
});