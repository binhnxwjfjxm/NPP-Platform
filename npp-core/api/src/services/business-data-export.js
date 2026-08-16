import { createWriteStream } from 'node:fs';
import { mkdtemp, rm, stat } from 'node:fs/promises';
import { once } from 'node:events';
import { finished } from 'node:stream/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { buildMultiSheetXlsx } from '../backup/artifacts.js';
import { BUSINESS_EXPORT_DEFINITIONS } from '../business-export/definitions.js';

const FETCH_BATCH_SIZE = 500;

const OFFICE_VALUE_COLUMNS = new Set([
  'status', 'source_type', 'delivery_mode', 'collection_policy', 'document_type',
  'movement_type', 'source_document_type', 'direction', 'payment_method',
  'latest_result', 'sync_status', 'adjustment_type',
]);

const OFFICE_VALUE_LABELS = Object.freeze({
  draft: 'Nháp',
  active: 'Đang hoạt động',
  inactive: 'Ngừng hoạt động',
  pending: 'Chờ xử lý',
  submitted: 'Đã gửi duyệt',
  approved: 'Đã duyệt',
  rejected: 'Đã từ chối',
  confirmed: 'Đã xác nhận',
  cancelled: 'Đã hủy',
  canceled: 'Đã hủy',
  open: 'Còn mở',
  partially_allocated: 'Đã phân bổ một phần',
  fully_allocated: 'Đã phân bổ đủ',
  allocated: 'Đã phân bổ',
  reversed: 'Đã đảo',
  posted: 'Đã ghi sổ',
  closed: 'Đã đóng',
  partially_received: 'Đã nhận một phần',
  fully_received: 'Đã nhận đủ',
  ready_to_dispatch: 'Sẵn sàng giao',
  dispatched: 'Đã xuất phát',
  handed_over: 'Đã bàn giao',
  delivered_full: 'Giao đủ',
  delivered_partial: 'Giao một phần',
  failed: 'Giao không thành công',
  rescheduled: 'Hẹn giao lại',
  synced: 'Đã đồng bộ',
  syncing: 'Đang đồng bộ',
  error: 'Có lỗi',
  manual: 'Nhập thủ công',
  import: 'Nhập từ file',
  api: 'Kết nối hệ thống',
  mcp: 'MCP',
  core: 'Công Ty',
  npp: 'Công Ty',
  delivery: 'Giao tận nơi',
  pickup: 'Khách đến lấy',
  cod: 'Thu khi giao hàng',
  credit: 'Công nợ',
  prepaid: 'Đã thanh toán trước',
  collect_on_delivery: 'Thu khi giao hàng',
  collect_after_delivery: 'Thu sau giao hàng',
  credit_terms: 'Theo hạn công nợ',
  cash: 'Tiền mặt',
  bank_transfer: 'Chuyển khoản',
  transfer: 'Chuyển khoản',
  in: 'Nhập kho',
  out: 'Xuất kho',
  fixed_price: 'Giá cố định',
  percent_discount: 'Giảm theo tỷ lệ',
  amount_discount: 'Giảm theo số tiền',
  percent_markup: 'Tăng theo tỷ lệ',
  amount_markup: 'Tăng theo số tiền',
  customer_payment: 'Thu tiền khách hàng',
  sale_delivery: 'Công nợ từ giao hàng',
  sale_pickup: 'Công nợ từ khách đến lấy',
  supplier_payment: 'Thanh toán nhà cung cấp',
  purchase_receipt: 'Công nợ từ nhập hàng',
  opening_balance: 'Số dư đầu kỳ',
  goods_receipt: 'Nhập hàng',
  inventory_transfer: 'Chuyển kho',
  inventory_adjustment: 'Điều chỉnh kho',
  inventory_stocktake: 'Kiểm kê kho',
  delivery_order: 'Phiếu giao hàng',
  sales_order: 'Đơn bán hàng',
  purchase_order: 'Đơn mua hàng',
});

function officeValue(columnKey, value) {
  if (!OFFICE_VALUE_COLUMNS.has(columnKey) || value === null || value === undefined) return value;
  const normalized = String(value).trim().toLowerCase();
  return OFFICE_VALUE_LABELS[normalized] ?? value;
}

function quoteIdentifier(value) {
  return `"${String(value).replaceAll('"', '""')}"`;
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

function displayValue(value) {
  if (value === null || value === undefined) return '';
  if (value instanceof Date) return value.toISOString();
  if (typeof value === 'boolean') return value ? 'Có' : 'Không';
  if (Buffer.isBuffer(value)) return '';
  if (typeof value === 'object') return JSON.stringify(value);
  return String(value);
}

function xlsxCell(reference, value, header = false) {
  return `<c r="${reference}" t="inlineStr"${header ? ' s="1"' : ''}><is><t xml:space="preserve">${xmlEscape(value)}</t></is></c>`;
}

async function writeChunk(stream, chunk) {
  if (stream.write(chunk)) return;
  await once(stream, 'drain');
}

async function closeStream(stream) {
  stream.end();
  await finished(stream);
}

async function writeStaticWorksheet(filePath, columns, rows) {
  const stream = createWriteStream(filePath);
  try {
    await writeChunk(stream, '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetData>');
    const header = columns.map((column, index) => xlsxCell(`${columnName(index)}1`, column[1], true)).join('');
    await writeChunk(stream, `<row r="1">${header}</row>`);
    let rowNumber = 1;
    for (const row of rows) {
      rowNumber += 1;
      const cells = columns.map((column, index) => xlsxCell(
        `${columnName(index)}${rowNumber}`,
        displayValue(officeValue(column[0], row[column[0]])),
      )).join('');
      await writeChunk(stream, `<row r="${rowNumber}">${cells}</row>`);
    }
    await writeChunk(stream, '</sheetData></worksheet>');
    await closeStream(stream);
  } catch (error) {
    stream.destroy();
    throw error;
  }
}

async function exportDefinition(client, definition, tempDirectory, definitionIndex, installationId, warehouseIds, mcpEmployeeCode) {
  const worksheetPath = path.join(tempDirectory, `${String(definitionIndex + 1).padStart(2, '0')}-${definition.key}.xml`);
  const stream = createWriteStream(worksheetPath);
  const cursorName = `business_export_${definitionIndex + 1}`;
  const cursorIdentifier = quoteIdentifier(cursorName);
  let rowCount = 0;
  let cursorOpen = false;

  try {
    await writeChunk(stream, '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetData>');
    const header = definition.columns.map((column, index) => xlsxCell(`${columnName(index)}1`, column[1], true)).join('');
    await writeChunk(stream, `<row r="1">${header}</row>`);

    const parameters = definition.warehouseScoped
      ? [installationId, warehouseIds]
      : definition.mcpScoped
        ? [installationId, mcpEmployeeCode]
        : [installationId];
    await client.query(`DECLARE ${cursorIdentifier} NO SCROLL CURSOR FOR ${definition.sql}`, parameters);
    cursorOpen = true;

    while (true) {
      const batch = await client.query(`FETCH FORWARD ${FETCH_BATCH_SIZE} FROM ${cursorIdentifier}`);
      if (!batch.rows?.length) break;
      for (const row of batch.rows) {
        rowCount += 1;
        const excelRow = rowCount + 1;
        const cells = definition.columns.map((column, index) => xlsxCell(
          `${columnName(index)}${excelRow}`,
          displayValue(officeValue(column[0], row[column[0]])),
        )).join('');
        await writeChunk(stream, `<row r="${excelRow}">${cells}</row>`);
      }
    }

    await client.query(`CLOSE ${cursorIdentifier}`);
    cursorOpen = false;
    await writeChunk(stream, '</sheetData></worksheet>');
    await closeStream(stream);
    return {
      key: definition.key,
      sheetName: definition.sheetName,
      rowCount,
      xlsxSheetPath: worksheetPath,
    };
  } catch (error) {
    stream.destroy();
    if (cursorOpen) {
      try { await client.query(`CLOSE ${cursorIdentifier}`); } catch {}
    }
    throw error;
  }
}

function normalizedWarehouseIds(requestContext, warehouseIds) {
  const source = Array.isArray(warehouseIds)
    ? warehouseIds
    : requestContext?.scopes?.warehouseIds;
  return [...new Set(
    (Array.isArray(source) ? source : [])
      .filter((value) => typeof value === 'string' && value.trim())
      .map((value) => value.trim().toLowerCase()),
  )];
}

function filenameFor(snapshotAt) {
  const stamp = new Date(snapshotAt).toISOString().replace(/[-:]/g, '').replace('T', '-').slice(0, 15);
  return `So-lieu-doanh-nghiep-${stamp}.xlsx`;
}

export async function createBusinessDataExport(pool, {
  requestContext,
  warehouseIds = null,
  canReadPermission,
  mcpEmployeeCode = null,
}) {
  if (!requestContext?.installationId) throw new Error('business_export_request_context_required');
  if (typeof canReadPermission !== 'function') throw new Error('business_export_permission_resolver_required');

  const tempDirectory = await mkdtemp(path.join(tmpdir(), 'npp-business-export-'));
  const outputPath = path.join(tempDirectory, 'business-data.xlsx');
  const scopedWarehouseIds = normalizedWarehouseIds(requestContext, warehouseIds);
  const client = await pool.connect();
  const exportedSheets = [];
  let snapshotAt = new Date().toISOString();
  let transactionOpen = false;

  try {
    await client.query('BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY');
    transactionOpen = true;
    const snapshot = await client.query('SELECT transaction_timestamp() AS snapshot_at');
    snapshotAt = snapshot.rows?.[0]?.snapshot_at?.toISOString?.() ?? String(snapshot.rows?.[0]?.snapshot_at ?? snapshotAt);

    let definitionIndex = 0;
    for (const definition of BUSINESS_EXPORT_DEFINITIONS) {
      const allowed = definition.permissions.every((permissionName) => canReadPermission(permissionName));
      if (!allowed) continue;
      if (definition.warehouseScoped && scopedWarehouseIds.length === 0) continue;
      const exported = await exportDefinition(
        client,
        definition,
        tempDirectory,
        definitionIndex,
        requestContext.installationId,
        scopedWarehouseIds,
        mcpEmployeeCode,
      );
      definitionIndex += 1;
      if (exported.rowCount > 0) exportedSheets.push(exported);
    }

    await client.query('COMMIT');
    transactionOpen = false;
  } catch (error) {
    if (transactionOpen) {
      try { await client.query('ROLLBACK'); } catch {}
    }
    await rm(tempDirectory, { recursive: true, force: true });
    throw error;
  } finally {
    client.release();
  }

  try {
    const overviewPath = path.join(tempDirectory, '00-overview.xml');
    const overviewColumns = Object.freeze([
      Object.freeze(['item', 'Nội dung']),
      Object.freeze(['value', 'Giá trị']),
    ]);
    const overviewRows = [
      { item: 'Thời điểm xuất', value: snapshotAt },
      { item: 'Định dạng', value: 'Excel (.xlsx)' },
      { item: 'Phạm vi', value: 'Chỉ dữ liệu nghiệp vụ người dùng được cấp quyền xem' },
      { item: 'Ghi chú', value: 'Không chứa dữ liệu kỹ thuật, xác thực, phân quyền, chống trùng, migration hoặc nhật ký hệ thống' },
      ...exportedSheets.map((sheet) => ({
        item: sheet.sheetName,
        value: `${sheet.rowCount.toLocaleString('vi-VN')} dòng`,
      })),
    ];
    await writeStaticWorksheet(overviewPath, overviewColumns, overviewRows);

    const overview = {
      key: 'overview',
      sheetName: 'Tổng quan số liệu',
      rowCount: overviewRows.length,
      xlsxSheetPath: overviewPath,
    };
    await buildMultiSheetXlsx(outputPath, [overview, ...exportedSheets]);
    const metadata = await stat(outputPath);
    return Object.freeze({
      filePath: outputPath,
      filename: filenameFor(snapshotAt),
      contentType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      snapshotAt,
      sheetCount: exportedSheets.length + 1,
      businessSheetCount: exportedSheets.length,
      totalBusinessRowCount: exportedSheets.reduce((total, sheet) => total + sheet.rowCount, 0),
      size: metadata.size,
      sheets: Object.freeze(exportedSheets.map((sheet) => Object.freeze({
        key: sheet.key,
        name: sheet.sheetName,
        rowCount: sheet.rowCount,
      }))),
      cleanup: () => rm(tempDirectory, { recursive: true, force: true }),
    });
  } catch (error) {
    await rm(tempDirectory, { recursive: true, force: true });
    throw error;
  }
}
