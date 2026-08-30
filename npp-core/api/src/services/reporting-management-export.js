import { createWriteStream } from 'node:fs';
import { mkdtemp, rm, stat } from 'node:fs/promises';
import { once } from 'node:events';
import { finished } from 'node:stream/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { buildMultiSheetXlsx } from '../backup/artifacts.js';
import { salesReport } from '../routes/reporting-sales.js';
import { createManagementReportExport as createBaseExport } from './reporting-management-export-base.js';

function valueText(value) {
  if (value === null || value === undefined) return '';
  if (value instanceof Date) return value.toISOString();
  if (typeof value === 'boolean') return value ? 'Có' : 'Không';
  if (typeof value === 'object') return JSON.stringify(value);
  return String(value);
}
function xmlEscape(value) { return String(value).replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, ' ').replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll('"', '&quot;'); }
function columnName(index) { let value = index + 1; let result = ''; while (value > 0) { const remainder = (value - 1) % 26; result = String.fromCharCode(65 + remainder) + result; value = Math.floor((value - 1) / 26); } return result; }
function cell(reference, value, header = false) { return `<c r="${reference}" t="inlineStr"${header ? ' s="1"' : ''}><is><t xml:space="preserve">${xmlEscape(value)}</t></is></c>`; }
async function writeChunk(stream, chunk) { if (stream.write(chunk)) return; await once(stream, 'drain'); }
async function writeWorksheet(filePath, columns, rows) {
  const stream = createWriteStream(filePath);
  try {
    await writeChunk(stream, '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetData>');
    await writeChunk(stream, `<row r="1">${columns.map((column, index) => cell(`${columnName(index)}1`, column.label, true)).join('')}</row>`);
    let rowNumber = 1;
    for (const row of rows) { rowNumber += 1; await writeChunk(stream, `<row r="${rowNumber}">${columns.map((column, index) => cell(`${columnName(index)}${rowNumber}`, valueText(row?.[column.key]))).join('')}</row>`); }
    await writeChunk(stream, '</sheetData></worksheet>'); stream.end(); await finished(stream);
  } catch (error) { stream.destroy(); throw error; }
}
function column(key, label) { return Object.freeze({ key, label }); }
function safeRows(value) { return Array.isArray(value) ? value : []; }
function flatten(rows) { return safeRows(rows).map((row) => ({ code: row.code, name: row.name, currencyCode: row.currencyCode, unitCode: row.unit?.code, unitName: row.unit?.name, revenue: row.revenue, quantity: row.quantity, sharePercent: row.sharePercent, previousRevenue: row.previousRevenue, previousQuantity: row.previousQuantity, changePercent: row.changePercent, source: row.source })); }
const BREAKDOWN_COLUMNS = Object.freeze([column('code','Mã'),column('name','Tên'),column('currencyCode','Tiền tệ'),column('unitCode','Mã ĐVT'),column('unitName','ĐVT'),column('revenue','Doanh thu'),column('quantity','Sản lượng'),column('sharePercent','Tỷ trọng (%)'),column('previousRevenue','Doanh thu kỳ trước'),column('previousQuantity','Sản lượng kỳ trước'),column('changePercent','Thay đổi doanh thu (%)'),column('source','Nguồn chiều phân tích')]);
const DOC_COLUMNS = Object.freeze([column('orderNumber','Số đơn'),column('status','Trạng thái'),column('confirmedAt','Thời điểm chốt'),column('customerCode','Mã khách hàng'),column('customerName','Khách hàng'),column('currencyCode','Tiền tệ'),column('totalValue','Giá trị'),column('warehouseId','Mã kho')]);
const TREND_COLUMNS = Object.freeze([column('businessDate','Ngày'),column('currencyCode','Tiền tệ'),column('revenue','Doanh thu'),column('previousRevenue','Doanh thu ngày tương ứng kỳ trước'),column('changePercent','Thay đổi (%)')]);

async function createSalesExport(pool, { requestContext, filters, warehouseIds }) {
  const report = await salesReport(pool, requestContext, filters, warehouseIds);
  if (report.reconciliation?.ok !== true) { const error = new Error('sales_report_reconciliation_failed'); error.code = 'SALES_REPORT_RECONCILIATION_FAILED'; throw error; }
  const tempDirectory = await mkdtemp(path.join(tmpdir(), 'npp-business-report-'));
  const outputPath = path.join(tempDirectory, 'business-report.xlsx');
  try {
    const dimensions = [
      ['customerGroups','Loại khách'], ['customers','Khách hàng'], ['products','SKU'], ['productGroups','Nhóm hàng'], ['channels','Kênh bán'], ['employees','Nhân viên'],
    ];
    const metadata = [
      { item: 'Nhóm báo cáo', value: 'Kinh doanh' },
      { item: 'Phạm vi thời gian', value: `${filters.from} đến ${filters.to}` },
      { item: 'Nguồn số liệu', value: 'Cùng contract canonical với màn hình Báo cáo Kinh doanh' },
      { item: 'Đối soát', value: `Khớp ${report.reconciliation.checkedOrderCount ?? '0'} đơn; chênh lệch ${report.reconciliation.mismatchCount ?? '0'}` },
      { item: 'Nguyên tắc ĐVT', value: 'Không cộng gộp sản lượng giữa các ĐVT khác nhau' },
      { item: 'Nguyên tắc tiền tệ', value: 'Không cộng gộp doanh thu giữa các loại tiền khác nhau' },
      { item: 'Thời điểm xuất', value: requestContext.receivedAt ?? new Date().toISOString() },
    ];
    const sheets = [{ key: 'overview', sheetName: 'Tổng quan Kinh doanh', columns: [column('item','Nội dung'), column('value','Giá trị')], rows: metadata }];
    for (const [key, name] of dimensions) sheets.push({ key, sheetName: name, columns: BREAKDOWN_COLUMNS, rows: flatten(report.breakdowns?.[key]) });
    sheets.push({ key: 'trend', sheetName: 'Xu hướng doanh thu', columns: TREND_COLUMNS, rows: safeRows(report.dailyTrend) });
    sheets.push({ key: 'documents', sheetName: 'Đối soát chứng từ', columns: DOC_COLUMNS, rows: safeRows(report.documents) });
    const descriptors = [];
    for (let index = 0; index < sheets.length; index += 1) { const sheet = sheets[index]; const worksheetPath = path.join(tempDirectory, `${String(index).padStart(2, '0')}-${sheet.key}.xml`); await writeWorksheet(worksheetPath, sheet.columns, sheet.rows); descriptors.push({ key: sheet.key, sheetName: sheet.sheetName, rowCount: sheet.rows.length, xlsxSheetPath: worksheetPath }); }
    await buildMultiSheetXlsx(outputPath, descriptors);
    const fileStat = await stat(outputPath);
    const stamp = new Date(requestContext.receivedAt ?? Date.now()).toISOString().replace(/[-:]/g, '').replace('T', '-').slice(0, 15);
    return Object.freeze({ filePath: outputPath, filename: `Bao-cao-Kinh-doanh-${stamp}.xlsx`, contentType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', size: fileStat.size, cleanup: () => rm(tempDirectory, { recursive: true, force: true }) });
  } catch (error) { await rm(tempDirectory, { recursive: true, force: true }); throw error; }
}

export async function createManagementReportExport(pool, options) {
  if (options.reportKey === 'sales-profit') return createSalesExport(pool, options);
  return createBaseExport(pool, options);
}
