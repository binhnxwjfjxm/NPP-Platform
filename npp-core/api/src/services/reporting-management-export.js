import { createWriteStream } from 'node:fs';
import { mkdtemp, rm, stat } from 'node:fs/promises';
import { once } from 'node:events';
import { finished } from 'node:stream/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { buildMultiSheetXlsx } from '../backup/artifacts.js';
import { salesReport } from '../routes/reporting-sales.js';
import { inventoryReport } from '../routes/reporting-inventory-safe.js';
import { agingReport, grossMarginReport } from '../routes/reporting-finance.js';
import { logisticsReport } from '../routes/reporting-logistics.js';
import { codReport } from '../routes/reporting-cod.js';
import { employeeMcpReport } from '../routes/reporting-employee-mcp.js';
import { mcpSupervisionReport } from '../routes/reporting-mcp-alerts.js';
import { controlTowerReport } from '../routes/reporting-operations.js';

const REPORT_LABELS = Object.freeze({
  executive: 'Điều hành',
  'sales-profit': 'Kinh doanh & lợi nhuận',
  debt: 'Công nợ',
  inventory: 'Kho',
  'delivery-cod': 'Giao vận & COD',
  mcp: 'MCP / thị trường',
  people: 'Nhân sự / hiệu suất',
  decisions: 'Đề xuất & cảnh báo',
});

const DISPLAY_VALUES = Object.freeze({
  confirmed: 'Đã chốt',
  closed: 'Đã hoàn tất',
  cancelled: 'Đã hủy',
  open: 'Còn mở',
  partially_allocated: 'Đã phân bổ một phần',
  COSTED: 'Đã tính giá vốn',
  ANOMALY: 'Cần đối soát',
  OK: 'Khớp',
  delivered_full: 'Giao đủ',
  delivered_partial: 'Giao một phần',
  failed: 'Giao không thành công',
  rescheduled: 'Hẹn giao lại',
  dispatched: 'Đang giao',
  submitted: 'Chờ tiếp nhận',
  reconciled: 'Đã đối soát',
  discrepancy: 'Có chênh lệch',
  pending: 'Chờ xử lý',
  'needs-info': 'Chờ bổ sung',
  approved: 'Đã đồng ý',
  rejected: 'Đã từ chối',
  new: 'Mới',
  seen: 'Đã xem',
  handling: 'Đang xử lý',
  resolved: 'Đã giải quyết',
  MISSING_INVENTORY_LINEAGE: 'Thiếu liên kết xuất kho',
  MISSING_COST_FACT: 'Thiếu dữ liệu giá vốn',
  COST_ANOMALY: 'Giá vốn cần đối soát',
  MISSING_PLANNED_ARRIVAL: 'Thiếu giờ đến kế hoạch',
  PENDING_DELIVERY_RESULT: 'Chưa có kết quả giao',
});

function valueText(value) {
  if (value === null || value === undefined) return '';
  if (value instanceof Date) return value.toISOString();
  if (typeof value === 'boolean') return value ? 'Có' : 'Không';
  if (typeof value === 'object') return JSON.stringify(value);
  const raw = String(value);
  return DISPLAY_VALUES[raw] ?? raw;
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
    const header = columns.map((column, index) => xlsxCell(`${columnName(index)}1`, column.label, true)).join('');
    await writeChunk(stream, `<row r="1">${header}</row>`);
    let rowNumber = 1;
    for (const row of rows) {
      rowNumber += 1;
      const cells = columns.map((column, index) => xlsxCell(
        `${columnName(index)}${rowNumber}`,
        valueText(row?.[column.key]),
      )).join('');
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

function column(key, label) { return Object.freeze({ key, label }); }

const COLUMNS = Object.freeze({
  salesDocuments: Object.freeze([
    column('orderNumber', 'Số đơn'), column('status', 'Trạng thái'), column('confirmedAt', 'Thời điểm chốt'),
    column('customerCode', 'Mã khách hàng'), column('customerName', 'Khách hàng'), column('currencyCode', 'Tiền tệ'),
    column('totalValue', 'Giá trị'), column('warehouseId', 'Mã kho'),
  ]),
  marginLines: Object.freeze([
    column('documentNumber', 'Chứng từ'), column('documentDate', 'Ngày chứng từ'), column('customerCode', 'Mã khách hàng'),
    column('customerName', 'Khách hàng'), column('sku', 'SKU'), column('warehouseCode', 'Kho'),
    column('netRevenue', 'Doanh thu thuần'), column('cogs', 'Giá vốn'), column('grossMargin', 'Lãi gộp'), column('currencyCode', 'Tiền tệ'),
  ]),
  marginExceptions: Object.freeze([
    column('documentNumber', 'Chứng từ'), column('documentDate', 'Ngày chứng từ'), column('customerCode', 'Mã khách hàng'),
    column('customerName', 'Khách hàng'), column('sku', 'SKU'), column('warehouseCode', 'Kho'),
    column('netRevenue', 'Doanh thu thuần'), column('currencyCode', 'Tiền tệ'), column('exceptionCode', 'Điểm cần đối soát'),
  ]),
  receivables: Object.freeze([
    column('sourceDocumentNumber', 'Chứng từ'), column('sourceDocumentDate', 'Ngày chứng từ'), column('customerCode', 'Mã khách hàng'),
    column('customerName', 'Khách hàng'), column('warehouseCode', 'Kho'), column('currencyCode', 'Tiền tệ'),
    column('originalAmount', 'Giá trị ban đầu'), column('allocatedAmount', 'Đã phân bổ'), column('remainingAmount', 'Còn lại'), column('ageDays', 'Số ngày tồn tại'),
  ]),
  payables: Object.freeze([
    column('sourceDocumentNumber', 'Chứng từ'), column('sourceDocumentDate', 'Ngày chứng từ'), column('supplierCode', 'Mã nhà cung cấp'),
    column('supplierName', 'Nhà cung cấp'), column('warehouseCode', 'Kho'), column('dueDate', 'Ngày đến hạn'),
    column('currencyCode', 'Tiền tệ'), column('originalAmount', 'Giá trị ban đầu'), column('allocatedAmount', 'Đã phân bổ'),
    column('remainingAmount', 'Còn lại'), column('overdueDays', 'Số ngày quá hạn'),
  ]),
  inventoryPositions: Object.freeze([
    column('warehouseCode', 'Kho'), column('sku', 'SKU'), column('onHandQuantity', 'Tồn thực tế'),
    column('reservedQuantity', 'Đang giữ'), column('availableQuantity', 'Khả dụng'), column('inventoryValue', 'Giá trị tồn'),
    column('averageUnitCost', 'Giá vốn bình quân'), column('costingStatus', 'Trạng thái giá vốn'), column('anomalyCount', 'Số điểm cần đối soát'),
  ]),
  slowMoving: Object.freeze([
    column('warehouseCode', 'Kho'), column('sku', 'SKU'), column('onHandQuantity', 'Tồn thực tế'),
    column('availableQuantity', 'Khả dụng'), column('lastOutDate', 'Lần xuất gần nhất'), column('daysSinceOutbound', 'Số ngày chưa xuất'),
    column('inventoryValueVnd', 'Giá trị tồn'),
  ]),
  expiryLots: Object.freeze([
    column('warehouseCode', 'Kho'), column('sku', 'SKU'), column('lotCode', 'Mã lô'), column('expiryDate', 'Hạn sử dụng'),
    column('onHandQuantity', 'Tồn thực tế'), column('availableQuantity', 'Khả dụng'), column('daysToExpiry', 'Số ngày đến HSD'), column('expiryBucket', 'Tình trạng HSD'),
  ]),
  inventoryExceptions: Object.freeze([
    column('warehouseCode', 'Kho'), column('sku', 'SKU'), column('ledgerQuantity', 'Lượng theo sổ'),
    column('costingQuantity', 'Lượng theo giá vốn'), column('quantityDifference', 'Chênh lệch'), column('inventoryValueVnd', 'Giá trị tồn'),
    column('costingStatus', 'Trạng thái giá vốn'), column('anomalyCount', 'Số điểm bất thường'), column('reconciliationStatus', 'Kết quả đối soát'),
  ]),
  trips: Object.freeze([
    column('tripNumber', 'Chuyến'), column('warehouseCode', 'Kho'), column('routeName', 'Tuyến'), column('driverName', 'Tài xế'),
    column('licensePlate', 'Biển số xe'), column('plannedStartAt', 'Kế hoạch xuất phát'), column('dispatchedAt', 'Thời điểm xuất phát'),
    column('closedAt', 'Thời điểm hoàn tất'), column('status', 'Trạng thái'), column('deliveryOrderCount', 'Số phiếu giao'),
    column('deliveredFullCount', 'Giao đủ'), column('failedCount', 'Giao không thành công'), column('rescheduledCount', 'Hẹn giao lại'),
  ]),
  attempts: Object.freeze([
    column('tripNumber', 'Chuyến'), column('deliveryOrderNumber', 'Phiếu giao'), column('customerCodeSnapshot', 'Mã khách hàng'),
    column('customerNameSnapshot', 'Khách hàng'), column('driverName', 'Tài xế'), column('result', 'Kết quả'),
    column('reasonCode', 'Lý do'), column('attemptedAt', 'Thời điểm giao'), column('rescheduledFor', 'Hẹn giao lại'), column('onTime', 'Đúng kế hoạch'),
  ]),
  codOverdue: Object.freeze([
    column('deliveryOrderNumber', 'Phiếu giao'), column('driverName', 'Tài xế'), column('warehouseCode', 'Kho'),
    column('currencyCode', 'Tiền tệ'), column('expectedAmount', 'Số tiền dự kiến'), column('dueAt', 'Hạn thu'), column('overdueDays', 'Số ngày quá hạn'),
  ]),
  codPending: Object.freeze([
    column('tripNumber', 'Chuyến'), column('driverName', 'Tài xế'), column('warehouseCode', 'Kho'), column('currencyCode', 'Tiền tệ'),
    column('claimedAmount', 'Số tiền bàn giao'), column('pendingAcceptanceAmount', 'Chờ tiếp nhận'), column('handedOverAt', 'Thời điểm bàn giao'), column('projectionStatus', 'Trạng thái'),
  ]),
  codDiscrepancies: Object.freeze([
    column('tripNumber', 'Chuyến'), column('driverName', 'Tài xế'), column('warehouseCode', 'Kho'), column('currencyCode', 'Tiền tệ'),
    column('claimedAmount', 'Số tiền bàn giao'), column('acceptedAmount', 'Số tiền tiếp nhận'), column('handoverDifferenceAmount', 'Chênh lệch bàn giao'),
    column('varianceAmount', 'Chênh lệch đối soát'), column('handedOverAt', 'Thời điểm bàn giao'), column('acceptedAt', 'Thời điểm tiếp nhận'),
  ]),
  mcpOutlets: Object.freeze([
    column('sessionDate', 'Ngày đi tuyến'), column('employeeCode', 'Mã nhân viên'), column('employeeName', 'Nhân viên'),
    column('routeName', 'Tuyến'), column('customerName', 'Điểm bán'), column('address', 'Địa chỉ'), column('visitStatus', 'Trạng thái ghé'),
    column('checkedIn', 'Đã check-in'), column('checkinAt', 'Thời điểm check-in'), column('distanceMeters', 'Khoảng cách GPS (m)'), column('locationStatus', 'Kết luận vị trí'),
  ]),
  mcpAlerts: Object.freeze([
    column('domainLabel', 'Nhóm'), column('title', 'Cảnh báo'), column('entity', 'Đối tượng'), column('context', 'Bối cảnh'),
    column('severity', 'Mức độ'), column('status', 'Trạng thái'), column('threshold', 'Điều kiện'), column('actual', 'Dữ liệu ghi nhận'), column('detectedAt', 'Thời điểm phát hiện'),
  ]),
  employees: Object.freeze([
    column('employeeCode', 'Mã nhân viên'), column('employeeName', 'Nhân viên'), column('sessionCount', 'Số phiên'),
    column('plannedOutletCount', 'Điểm kế hoạch'), column('visitedOutletCount', 'Điểm đã ghé'), column('plannedVisitRatePercent', 'Tỷ lệ ghé kế hoạch (%)'),
    column('orderIntentCount', 'Nhu cầu đặt hàng'), column('coreSalesOrderCount', 'Đơn Công Ty'),
  ]),
  routes: Object.freeze([
    column('routeName', 'Tuyến'), column('employeeCode', 'Mã nhân viên'), column('employeeName', 'Nhân viên'),
    column('sessionCount', 'Số phiên'), column('plannedOutletCount', 'Điểm kế hoạch'), column('visitedOutletCount', 'Điểm đã ghé'),
  ]),
  proposals: Object.freeze([
    column('source', 'Nguồn'), column('domain', 'Nhóm'), column('title', 'Đề xuất'), column('entityLabel', 'Đối tượng'),
    column('priority', 'Mức ưu tiên'), column('status', 'Trạng thái'), column('requesterName', 'Người gửi'),
    column('impact', 'Tác động mong muốn'), column('reason', 'Lý do'), column('createdAt', 'Thời điểm gửi'), column('updatedAt', 'Cập nhật gần nhất'),
  ]),
});

function safeRows(value) { return Array.isArray(value) ? value : []; }

function pickSheet(key, sheetName, columns, rows) {
  return Object.freeze({ key, sheetName, columns, rows: safeRows(rows) });
}

function executiveRows(report) {
  const management = report?.management ?? {};
  const rows = [];
  const push = (group, metric, value) => rows.push({ group, metric, value });
  if (management.sales?.summary) {
    push('Kinh doanh', 'Đơn hiệu lực', management.sales.summary.effectiveOrderCount);
    push('Kinh doanh', 'Đơn đã hủy', management.sales.summary.cancelledOrderCount);
  }
  if (management.inventory?.summary) {
    push('Kho', 'Vị trí đang có tồn', management.inventory.summary.stockPositionCount);
    push('Kho', 'Giá trị tồn VND', management.inventory.summary.inventoryValueVnd);
    push('Kho', 'Điểm cần đối soát giá vốn', management.inventory.summary.costingExceptionCount);
  }
  if (management.grossMargin?.summary) {
    push('Lãi gộp', 'Doanh thu thuần VND', management.grossMargin.summary.netRevenueVnd);
    push('Lãi gộp', 'Lãi gộp VND', management.grossMargin.summary.grossMarginVnd);
    push('Lãi gộp', 'Tỷ lệ lãi gộp (%)', management.grossMargin.summary.grossMarginPercent);
  }
  if (management.employeeMcp?.summary) {
    push('MCP', 'Điểm đã ghé', management.employeeMcp.summary.visitedOutletCount);
    push('MCP', 'Tỷ lệ ghé kế hoạch (%)', management.employeeMcp.summary.plannedVisitRatePercent);
  }
  if (management.logistics?.summary) {
    push('Giao vận', 'Số chuyến', management.logistics.summary.tripCount);
    push('Giao vận', 'Giao đủ', management.logistics.summary.deliveredFullCount);
    push('Giao vận', 'Giao không thành công', management.logistics.summary.failedCount);
  }
  return rows;
}

async function warehouseScopeLabel(pool, requestContext, warehouseIds, warehouseId) {
  if (!warehouseId) return 'Toàn bộ kho được cấp quyền';
  const result = await pool.query(
    `SELECT code, name FROM shared.warehouses
      WHERE installation_id = $1 AND id = $2::uuid AND id = ANY($3::uuid[])
      LIMIT 1`,
    [requestContext.installationId, warehouseId, warehouseIds],
  );
  const row = result.rows?.[0];
  return row ? `${row.code} · ${row.name}` : 'Kho trong phạm vi được cấp quyền';
}

function sourceLabel(reportKey) {
  return reportKey === 'mcp' || reportKey === 'people' ? 'MCP đã đồng bộ về Công Ty' : 'Công Ty';
}

function filenameFor(reportKey, snapshotAt) {
  const stamp = new Date(snapshotAt).toISOString().replace(/[-:]/g, '').replace('T', '-').slice(0, 15);
  return `Bao-cao-quan-tri-${reportKey}-${stamp}.xlsx`;
}

export async function createManagementReportExport(pool, {
  requestContext,
  reportKey,
  filters,
  warehouseIds,
  fieldScope = null,
  decisionData = null,
}) {
  if (!Object.prototype.hasOwnProperty.call(REPORT_LABELS, reportKey)) {
    const error = new Error('management_report_export_invalid_report');
    error.code = 'MANAGEMENT_REPORT_EXPORT_INVALID_REPORT';
    throw error;
  }

  const tempDirectory = await mkdtemp(path.join(tmpdir(), 'npp-management-report-'));
  const outputPath = path.join(tempDirectory, 'management-report.xlsx');
  const snapshotAt = requestContext.receivedAt ?? new Date().toISOString();
  const sheets = [];

  try {
    if (reportKey === 'executive') {
      const report = await controlTowerReport(pool, requestContext, filters, warehouseIds);
      sheets.push(pickSheet('executive', 'Điều hành', [column('group', 'Nhóm'), column('metric', 'Chỉ số'), column('value', 'Giá trị')], executiveRows(report)));
      sheets.push(pickSheet('warnings', 'Dữ liệu chưa đầy đủ', [column('family', 'Nguồn'), column('code', 'Trạng thái')], report.warnings));
    } else if (reportKey === 'sales-profit') {
      const [sales, margin] = await Promise.all([
        salesReport(pool, requestContext, filters, warehouseIds),
        grossMarginReport(pool, requestContext, filters, warehouseIds),
      ]);
      sheets.push(pickSheet('sales-documents', 'Đơn bán hàng', COLUMNS.salesDocuments, sales.documents));
      sheets.push(pickSheet('margin-lines', 'Lãi gộp', COLUMNS.marginLines, margin.lines));
      sheets.push(pickSheet('margin-exceptions', 'Điểm cần đối soát', COLUMNS.marginExceptions, margin.exceptions));
    } else if (reportKey === 'debt') {
      const aging = await agingReport(pool, requestContext, filters, warehouseIds);
      sheets.push(pickSheet('receivables', 'Phải thu khách hàng', COLUMNS.receivables, aging.receivable?.documents));
      sheets.push(pickSheet('payables', 'Phải trả nhà cung cấp', COLUMNS.payables, aging.payable?.documents));
    } else if (reportKey === 'inventory') {
      const inventory = await inventoryReport(pool, requestContext, filters, warehouseIds);
      sheets.push(pickSheet('inventory', 'Tồn kho', COLUMNS.inventoryPositions, inventory.currentPositions));
      sheets.push(pickSheet('slow-moving', 'Hàng chậm luân chuyển', COLUMNS.slowMoving, inventory.slowMoving));
      sheets.push(pickSheet('expiry-lots', 'Lô và HSD', COLUMNS.expiryLots, inventory.expiryLots));
      sheets.push(pickSheet('inventory-exceptions', 'Đối soát giá vốn', COLUMNS.inventoryExceptions, inventory.exceptions));
    } else if (reportKey === 'delivery-cod') {
      const [logistics, cod] = await Promise.all([
        logisticsReport(pool, requestContext, filters, warehouseIds),
        codReport(pool, requestContext, filters, warehouseIds),
      ]);
      sheets.push(pickSheet('trips', 'Chuyến giao', COLUMNS.trips, logistics.trips));
      sheets.push(pickSheet('attempts', 'Kết quả giao', COLUMNS.attempts, logistics.attempts));
      sheets.push(pickSheet('cod-overdue', 'COD quá hạn', COLUMNS.codOverdue, cod.currentSnapshot?.overduePromises));
      sheets.push(pickSheet('cod-pending', 'COD chờ tiếp nhận', COLUMNS.codPending, cod.currentSnapshot?.pendingHandovers));
      sheets.push(pickSheet('cod-discrepancy', 'COD chênh lệch', COLUMNS.codDiscrepancies, cod.currentSnapshot?.discrepancies));
    } else if (reportKey === 'mcp') {
      const report = await mcpSupervisionReport(pool, requestContext, filters, fieldScope);
      sheets.push(pickSheet('mcp-outlets', 'Điểm bán đã ghi nhận', COLUMNS.mcpOutlets, report.outlets));
      sheets.push(pickSheet('mcp-anomalies', 'Điểm cần chú ý MCP', COLUMNS.mcpAlerts, (report.anomalies ?? []).map((row) => ({ ...row, domainLabel: 'MCP', context: `${row.employeeName ?? ''}${row.routeName ? ` · ${row.routeName}` : ''}`.trim() }))));
    } else if (reportKey === 'people') {
      const report = await employeeMcpReport(pool, requestContext, filters, fieldScope);
      sheets.push(pickSheet('employees', 'Nhân viên thị trường', COLUMNS.employees, report.fieldActors));
      sheets.push(pickSheet('routes', 'Tuyến thị trường', COLUMNS.routes, report.routes));
    } else if (reportKey === 'decisions') {
      sheets.push(pickSheet('proposals', 'Đề xuất', COLUMNS.proposals, decisionData?.proposals));
      sheets.push(pickSheet('alerts', 'Cảnh báo', COLUMNS.mcpAlerts, decisionData?.alerts));
    }

    const warehouseLabel = await warehouseScopeLabel(pool, requestContext, warehouseIds, filters.warehouseId);
    const metadataRows = [
      { item: 'Nhóm báo cáo', value: REPORT_LABELS[reportKey] },
      { item: 'Phạm vi thời gian', value: reportKey === 'debt' ? 'Số dư hiện tại' : `${filters.from} đến ${filters.to}` },
      { item: 'Kho', value: reportKey === 'mcp' || reportKey === 'people' || reportKey === 'decisions' ? 'Không áp dụng bộ lọc kho' : warehouseLabel },
      { item: 'Nguồn số liệu', value: sourceLabel(reportKey) },
      { item: 'Thời điểm xuất', value: snapshotAt },
      { item: 'Phạm vi quyền', value: 'Chỉ dữ liệu người dùng được cấp quyền xem tại thời điểm xuất' },
      { item: 'Đối chiếu', value: 'Cùng nguồn báo cáo và cùng bộ lọc với màn hình quản trị' },
    ];
    const metadata = pickSheet('overview', 'Thông tin báo cáo', [column('item', 'Nội dung'), column('value', 'Giá trị')], metadataRows);
    const allSheets = [metadata, ...sheets];
    const descriptors = [];
    for (let index = 0; index < allSheets.length; index += 1) {
      const sheet = allSheets[index];
      const worksheetPath = path.join(tempDirectory, `${String(index).padStart(2, '0')}-${sheet.key}.xml`);
      await writeWorksheet(worksheetPath, sheet.columns, sheet.rows);
      descriptors.push({ key: sheet.key, sheetName: sheet.sheetName, rowCount: sheet.rows.length, xlsxSheetPath: worksheetPath });
    }
    await buildMultiSheetXlsx(outputPath, descriptors);
    const metadataStat = await stat(outputPath);
    return Object.freeze({
      filePath: outputPath,
      filename: filenameFor(reportKey, snapshotAt),
      contentType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      size: metadataStat.size,
      cleanup: () => rm(tempDirectory, { recursive: true, force: true }),
    });
  } catch (error) {
    await rm(tempDirectory, { recursive: true, force: true });
    throw error;
  }
}
