'use client';

import type { AgingDashboard } from '../../lib/finance-reporting-types';
import type { CodReportingDashboard } from '../../lib/cod-reporting-types';
import type { EmployeeMcpDashboard } from '../../lib/employee-mcp-reporting-types';
import type { LogisticsDashboard } from '../../lib/logistics-reporting-types';
import type { ReportingDashboard } from '../../lib/reporting-dashboard-types';
import OperationalExportActions, { type OperationalExportSheet } from './operational-export-actions';

type Cell = string | number | boolean | null | undefined;

function sheet(
  sheetName: string,
  headers: readonly string[],
  rows: readonly (readonly Cell[])[],
): OperationalExportSheet {
  return { sheetName, headers, rows };
}

const PURCHASE_STATUS_LABELS: Readonly<Record<string, string>> = Object.freeze({
  draft: 'Nháp',
  pending_approval: 'Chờ duyệt',
  approved: 'Đã duyệt',
  confirmed: 'Đã xác nhận',
  partially_received: 'Nhận một phần',
  fully_received: 'Đã nhận đủ',
  posted: 'Đã ghi sổ',
  reversed: 'Đã hoàn tác',
  cancelled: 'Đã hủy',
  closed: 'Đã đóng',
});

const PURCHASE_DIMENSION_LABELS: Readonly<Record<string, string>> = Object.freeze({
  purchase_order: 'Đơn mua hàng',
  goods_receipt: 'Phiếu nhận hàng',
});

const LOGISTICS_STATUS_LABELS: Readonly<Record<string, string>> = Object.freeze({
  draft: 'Nháp',
  planned: 'Đã lập kế hoạch',
  ready: 'Sẵn sàng',
  dispatched: 'Đang giao',
  in_progress: 'Đang thực hiện',
  completed: 'Hoàn tất',
  closed: 'Đã đóng',
  cancelled: 'Đã hủy',
});

const DELIVERY_RESULT_LABELS: Readonly<Record<string, string>> = Object.freeze({
  delivered_full: 'Giao đủ',
  delivered_partial: 'Giao một phần',
  failed: 'Giao thất bại',
  rescheduled: 'Hẹn giao lại',
});

const DELIVERY_REASON_LABELS: Readonly<Record<string, string>> = Object.freeze({
  CUSTOMER_ABSENT: 'Khách vắng mặt',
  CUSTOMER_REFUSED: 'Khách từ chối nhận',
  ADDRESS_NOT_FOUND: 'Không tìm thấy địa chỉ',
  WRONG_ADDRESS: 'Sai địa chỉ',
  DAMAGED_GOODS: 'Hàng bị hư hỏng',
  INSUFFICIENT_STOCK: 'Không đủ hàng giao',
  DELIVERY_WINDOW_MISSED: 'Không kịp khung giờ giao',
  PAYMENT_NOT_READY: 'Khách chưa sẵn sàng thanh toán',
});

const COD_METHOD_LABELS: Readonly<Record<string, string>> = Object.freeze({
  cash: 'Tiền mặt',
  cod: 'Thu khi giao hàng',
  cash_on_delivery: 'Thu khi giao hàng',
  bank_transfer: 'Chuyển khoản',
  transfer: 'Chuyển khoản',
});

const COD_STATUS_LABELS: Readonly<Record<string, string>> = Object.freeze({
  pending: 'Chờ thu',
  promised: 'Đã hẹn thu',
  collected: 'Đã thu',
  partially_collected: 'Thu một phần',
  submitted: 'Chờ xác nhận',
  reconciled: 'Đã khớp',
  discrepancy: 'Có chênh lệch',
  reversed: 'Đã hoàn tác',
  acceptance_reversed: 'Đã hoàn tác xác nhận',
  matched: 'Đã khớp',
  mismatch: 'Cần kiểm tra',
  unresolved: 'Chưa xử lý',
  waived: 'Không thu',
});

const EMPLOYEE_SESSION_STATUS_LABELS: Readonly<Record<string, string>> = Object.freeze({
  open: 'Đang thực hiện',
  active: 'Đang thực hiện',
  in_progress: 'Đang thực hiện',
  completed: 'Hoàn tất',
  closed: 'Hoàn tất',
  cancelled: 'Đã hủy',
});

function officeToken(value: string | null | undefined, labels: Readonly<Record<string, string>> = {}) {
  const normalized = String(value ?? '').trim();
  return labels[normalized] ?? normalized.replace(/[_-]+/g, ' ');
}

function arBucket(value: string) {
  return ({
    AGE_0_30: '0–30 ngày',
    AGE_31_60: '31–60 ngày',
    AGE_61_90: '61–90 ngày',
    AGE_91_PLUS: 'Trên 90 ngày',
  } as Record<string, string>)[value] ?? officeToken(value);
}

function apBucket(value: string) {
  return ({
    NOT_DUE: 'Chưa đến hạn',
    OVERDUE_1_30: 'Quá hạn 1–30 ngày',
    OVERDUE_31_60: 'Quá hạn 31–60 ngày',
    OVERDUE_61_90: 'Quá hạn 61–90 ngày',
    OVERDUE_91_PLUS: 'Quá hạn trên 90 ngày',
  } as Record<string, string>)[value] ?? officeToken(value);
}

function selectedWarehouseLabel(
  warehouseId: string | null,
  warehouses: readonly { warehouseId: string; warehouseCode: string; warehouseName: string }[],
) {
  if (!warehouseId) return 'Tất cả kho được cấp quyền';
  const match = warehouses.find((warehouse) => warehouse.warehouseId === warehouseId);
  return match ? `${match.warehouseCode} — ${match.warehouseName}` : 'Kho đang chọn';
}

function actorLabel(salesLabel: string | null, employeeCode: string | null, employeeName: string | null) {
  if (employeeCode) return `${employeeCode} — ${employeeName ?? salesLabel ?? 'Nhân viên'}`;
  return salesLabel ? `${salesLabel} — chưa liên kết hồ sơ nhân viên` : 'Chưa xác định nhân viên';
}

function logisticsExceptionLabel(code: string) {
  return ({
    MISSING_PLANNED_ARRIVAL: 'Thiếu giờ dự kiến tại điểm giao',
    PENDING_DELIVERY_RESULT: 'Phiếu đã xuất chuyến nhưng chưa có kết quả giao',
  } as Record<string, string>)[code] ?? 'Dữ liệu cần kiểm tra';
}

function employeeExceptionLabel(code: string) {
  return ({
    MISSING_FIELD_ACTOR_CODE: 'Thiếu thông tin nhân viên',
    UNMAPPED_EMPLOYEE_CODE: 'Chưa liên kết hồ sơ nhân viên',
    SESSION_COUNTER_MISMATCH: 'Số liệu phiên cần đối soát',
  } as Record<string, string>)[code] ?? 'Dữ liệu cần kiểm tra';
}

export function PurchasingReportingExportActions({
  report,
  disabled = false,
}: {
  report: ReportingDashboard;
  disabled?: boolean;
}) {
  const sheets: readonly OperationalExportSheet[] = [
    sheet('Tổng hợp', ['Nội dung', 'Giá trị'], [
      ['Từ ngày', report.filters.from],
      ['Đến ngày', report.filters.to],
      ['Tổng đơn mua trong kỳ', report.summary.allOrderCount ?? '0'],
      ['Đơn mua có hiệu lực', report.summary.effectiveOrderCount ?? '0'],
      ['Đã hủy', report.summary.cancelledOrderCount ?? '0'],
      ['Chờ duyệt', report.summary.pendingApprovalCount ?? '0'],
      ['Phiếu nhận đã ghi sổ', report.summary.postedReceiptCount ?? '0'],
      ['Phiếu nhận đã hoàn tác', report.summary.reversedReceiptCount ?? '0'],
    ]),
    sheet('Giá trị theo tiền tệ', ['Loại tiền', 'Số chứng từ', 'Giá trị'], report.currencyTotals.map((row) => [
      row.currencyCode,
      row.documentCount,
      row.totalValue,
    ])),
    sheet('Trạng thái', ['Nhóm nghiệp vụ', 'Trạng thái', 'Số chứng từ'], report.statusBreakdown.map((row) => [
      officeToken(row.dimension, PURCHASE_DIMENSION_LABELS),
      officeToken(row.state, PURCHASE_STATUS_LABELS),
      row.documentCount,
    ])),
    sheet('Xu hướng theo ngày', ['Ngày', 'Loại tiền', 'Số chứng từ', 'Giá trị'], report.dailyTrend.map((row) => [
      row.businessDate,
      row.currencyCode,
      row.documentCount,
      row.totalValue,
    ])),
    sheet('Nhà cung cấp', ['Mã Nhà cung cấp', 'Nhà cung cấp', 'Loại tiền', 'Số chứng từ', 'Giá trị'], report.topEntities.map((row) => [
      row.entityCode,
      row.entityName,
      row.currencyCode,
      row.documentCount,
      row.totalValue,
    ])),
    sheet('Sản phẩm', ['SKU', 'Sản phẩm', 'Số lượng cơ sở', 'Loại tiền', 'Giá trị', 'Chứng từ tham khảo'], report.topSkus.map((row) => [
      row.sku,
      row.itemName,
      row.baseQuantity,
      row.currencyCode,
      row.totalValue,
      row.sampleDocumentNumber,
    ])),
  ];
  return <OperationalExportActions filename="bao-cao-mua-hang.xlsx" sheets={sheets} disabled={disabled} />;
}

export function AgingReportingExportActions({
  report,
  disabled = false,
}: {
  report: AgingDashboard;
  disabled?: boolean;
}) {
  const sheets: readonly OperationalExportSheet[] = [
    sheet('Phải thu tổng hợp', ['Loại tiền', 'Tuổi khoản phải thu', 'Số chứng từ', 'Còn phải thu'], report.receivable.summary.map((row) => [
      row.currencyCode,
      arBucket(row.ageBucket),
      row.documentCount,
      row.remainingAmount,
    ])),
    sheet('Phải thu khách hàng', ['Mã khách hàng', 'Khách hàng', 'Loại tiền', 'Số chứng từ', 'Còn phải thu', 'Chứng từ cũ nhất', 'Tuổi lớn nhất (ngày)'], report.receivable.customers.map((row) => [
      row.customerCode ?? '',
      row.customerName ?? '',
      row.currencyCode,
      row.documentCount,
      row.remainingAmount,
      row.oldestDocumentDate ?? '',
      row.oldestAgeDays ?? '0',
    ])),
    sheet('Phải thu chứng từ', ['Số chứng từ', 'Ngày chứng từ', 'Mã khách hàng', 'Khách hàng', 'Kho', 'Loại tiền', 'Giá trị ban đầu', 'Đã thu', 'Còn phải thu', 'Tuổi nợ (ngày)', 'Nhóm tuổi nợ'], report.receivable.documents.map((row) => [
      row.sourceDocumentNumber,
      row.sourceDocumentDate,
      row.customerCode ?? '',
      row.customerName ?? '',
      row.warehouseCode,
      row.currencyCode,
      row.originalAmount,
      row.allocatedAmount,
      row.remainingAmount,
      row.ageDays ?? '0',
      arBucket(row.ageBucket),
    ])),
    sheet('Phải trả tổng hợp', ['Loại tiền', 'Trạng thái hạn', 'Số chứng từ', 'Còn phải trả'], report.payable.summary.map((row) => [
      row.currencyCode,
      apBucket(row.ageBucket),
      row.documentCount,
      row.remainingAmount,
    ])),
    sheet('Phải trả Nhà cung cấp', ['Mã Nhà cung cấp', 'Nhà cung cấp', 'Loại tiền', 'Số chứng từ', 'Còn phải trả', 'Hạn sớm nhất', 'Quá hạn lớn nhất (ngày)'], report.payable.suppliers.map((row) => [
      row.supplierCode ?? '',
      row.supplierName ?? '',
      row.currencyCode,
      row.documentCount,
      row.remainingAmount,
      row.earliestDueDate ?? '',
      row.maxOverdueDays ?? '0',
    ])),
    sheet('Phải trả chứng từ', ['Số chứng từ', 'Ngày chứng từ', 'Mã Nhà cung cấp', 'Nhà cung cấp', 'Kho', 'Hạn thanh toán', 'Loại tiền', 'Giá trị ban đầu', 'Đã thanh toán', 'Còn phải trả', 'Quá hạn (ngày)', 'Trạng thái hạn'], report.payable.documents.map((row) => [
      row.sourceDocumentNumber,
      row.sourceDocumentDate,
      row.supplierCode ?? '',
      row.supplierName ?? '',
      row.warehouseCode,
      row.dueDate ?? '',
      row.currencyCode,
      row.originalAmount,
      row.allocatedAmount,
      row.remainingAmount,
      row.overdueDays ?? '0',
      apBucket(row.ageBucket),
    ])),
  ];
  return <OperationalExportActions filename="bao-cao-tuoi-no.xlsx" sheets={sheets} disabled={disabled} />;
}

export function CodReportingExportActions({
  report,
  disabled = false,
}: {
  report: CodReportingDashboard;
  disabled?: boolean;
}) {
  const warehouse = selectedWarehouseLabel(report.filters.warehouseId, report.warehouses);
  const exceptionRows: readonly (readonly Cell[])[] = [
    ...report.currentSnapshot.discrepancies.map((row) => [
      'Chênh lệch bàn giao',
      row.tripNumber,
      row.driverCode,
      row.warehouseCode,
      row.currencyCode,
      row.varianceAmount ?? '',
      officeToken(row.projectionStatus, COD_STATUS_LABELS),
    ]),
    ...report.exceptions.lifecycle.map((row) => [
      officeToken(row.anomalyType, COD_STATUS_LABELS),
      row.sourceNumber,
      '',
      selectedWarehouseLabel(row.warehouseId, report.warehouses),
      '',
      '',
      officeToken(row.reconciliationStatus, COD_STATUS_LABELS),
    ]),
    ...report.exceptions.currencyLineage.map((row) => [
      'Bàn giao có nhiều loại tiền',
      row.tripNumber,
      row.driverCode,
      row.warehouseCode,
      `${row.currencyCount} loại tiền`,
      '',
      officeToken(row.projectionStatus, COD_STATUS_LABELS),
    ]),
  ];
  const sheets: readonly OperationalExportSheet[] = [
    sheet('Thông tin báo cáo', ['Nội dung', 'Giá trị'], [
      ['Từ ngày', report.filters.from],
      ['Đến ngày', report.filters.to],
      ['Kho', warehouse],
      ['Ghi chú', 'Tiền tài xế đang giữ là số liệu hiện tại; kỳ báo cáo áp dụng cho hoạt động thu, bàn giao và kế toán tiếp nhận.'],
    ]),
    sheet('Tiền tài xế', ['Tài xế', 'Loại tiền', 'Số khoản thu', 'Số tiền đang giữ', 'Khoản cũ nhất', 'Số ngày giữ lâu nhất'], report.currentSnapshot.custodyByDriver.map((row) => [
      `${row.driverCode} — ${row.driverName}`,
      row.currencyCode,
      row.collectionCount,
      row.custodyRemainingAmount,
      row.oldestCollectedAt,
      row.oldestAgeDays,
    ])),
    sheet('Thu trong kỳ', ['Loại tiền', 'Phương thức', 'Trạng thái', 'Số lượt', 'Phải thu', 'Đã nhận'], report.activity.collections.map((row) => [
      row.currencyCode,
      officeToken(row.collectionMethod, COD_METHOD_LABELS),
      officeToken(row.collectionStatus, COD_STATUS_LABELS),
      row.collectionCount,
      row.expectedAmount,
      row.receivedAmount,
    ])),
    sheet('Bàn giao', ['Loại tiền', 'Số bàn giao', 'Đã khai bàn giao', 'Chênh lệch bàn giao'], report.activity.handovers.map((row) => [
      row.currencyCode,
      row.handoverCount,
      row.claimedAmount,
      row.handoverDifferenceAmount,
    ])),
    sheet('Kế toán tiếp nhận', ['Loại tiền', 'Số lần tiếp nhận', 'Đã tiếp nhận', 'Chênh lệch'], report.activity.acceptances.map((row) => [
      row.currencyCode,
      row.acceptanceCount,
      row.acceptedAmount,
      row.varianceAmount,
    ])),
    sheet('Hẹn thu quá hạn', ['Phiếu giao', 'Chuyến', 'Tài xế', 'Kho', 'Loại tiền', 'Số phải thu', 'Hẹn bởi', 'Hạn thu', 'Quá hạn (ngày)'], report.currentSnapshot.overduePromises.map((row) => [
      row.deliveryOrderNumber ?? 'Chưa có số phiếu',
      row.tripNumber,
      `${row.driverCode} — ${row.driverName}`,
      row.warehouseCode,
      row.currencyCode,
      row.expectedAmount,
      row.promisedBy,
      row.dueAt,
      row.overdueDays,
    ])),
    sheet('Cần kiểm tra', ['Loại', 'Nguồn', 'Tài xế', 'Kho', 'Loại tiền', 'Chênh lệch', 'Trạng thái'], exceptionRows),
  ];
  return <OperationalExportActions filename="bao-cao-cod.xlsx" sheets={sheets} disabled={disabled} />;
}

export function LogisticsReportingExportActions({
  report,
  disabled = false,
}: {
  report: LogisticsDashboard;
  disabled?: boolean;
}) {
  const warehouse = selectedWarehouseLabel(report.filters.warehouseId, report.warehouses);
  const sheets: readonly OperationalExportSheet[] = [
    sheet('Tổng hợp', ['Nội dung', 'Giá trị'], [
      ['Từ ngày', report.filters.from],
      ['Đến ngày', report.filters.to],
      ['Kho', warehouse],
      ['Chuyến trong kỳ', report.summary.tripCount ?? '0'],
      ['Điểm giao', report.summary.stopCount ?? '0'],
      ['Phiếu giao', report.summary.deliveryOrderCount ?? '0'],
      ['Giao đủ', report.summary.deliveredFullCount ?? '0'],
      ['Giao một phần', report.summary.deliveredPartialCount ?? '0'],
      ['Giao thất bại', report.summary.failedCount ?? '0'],
      ['Hẹn giao lại', report.summary.rescheduledCount ?? '0'],
      ['Tỷ lệ giao đủ đúng giờ', report.summary.onTimeFullRatePercent ?? ''],
      ['Tỷ lệ có giờ giao dự kiến', report.summary.slaCoveragePercent ?? ''],
    ]),
    sheet('Tài xế', ['Tài xế', 'Chuyến', 'Điểm giao', 'Phiếu giao', 'Giao đủ', 'Giao một phần', 'Thất bại', 'Hẹn lại', 'Đúng giờ (%)', 'Thời lượng chuyến đóng (phút)'], report.drivers.map((row) => [
      [row.driverCode, row.driverName].filter(Boolean).join(' — ') || 'Chưa gán',
      row.tripCount,
      row.stopCount,
      row.deliveryOrderCount,
      row.deliveredFullCount,
      row.deliveredPartialCount,
      row.failedCount,
      row.rescheduledCount,
      row.onTimeFullRatePercent ?? '',
      row.averageClosedTripDurationMinutes ?? '',
    ])),
    sheet('Phương tiện', ['Phương tiện', 'Biển số', 'Loại xe', 'Chuyến', 'Điểm giao', 'Phiếu giao', 'Giao đủ', 'Giao một phần', 'Thất bại', 'Hẹn lại', 'Đúng giờ (%)'], report.vehicles.map((row) => [
      row.vehicleCode ?? 'Chưa gán',
      row.licensePlate ?? '',
      row.vehicleType ?? '',
      row.tripCount,
      row.stopCount,
      row.deliveryOrderCount,
      row.deliveredFullCount,
      row.deliveredPartialCount,
      row.failedCount,
      row.rescheduledCount,
      row.onTimeFullRatePercent ?? '',
    ])),
    sheet('Kết quả lần giao', ['Chuyến', 'Phiếu giao', 'Khách hàng', 'Tài xế', 'Kết quả', 'Lý do', 'Giờ dự kiến', 'Thời điểm giao', 'Hẹn lại', 'Đúng giờ'], report.attempts.map((row) => [
      row.tripNumber,
      row.deliveryOrderNumber ?? 'Chưa có số phiếu',
      `${row.customerCodeSnapshot} — ${row.customerNameSnapshot}`,
      `${row.driverCode} — ${row.driverName}`,
      officeToken(row.result, DELIVERY_RESULT_LABELS),
      officeToken(row.reasonCode, DELIVERY_REASON_LABELS),
      row.plannedArrivalAt ?? '',
      row.attemptedAt,
      row.rescheduledFor ?? '',
      row.onTime === null ? 'Chưa xác định' : row.onTime ? 'Đúng giờ' : 'Trễ giờ',
    ])),
    sheet('Chuyến giao', ['Chuyến', 'Kho', 'Tuyến', 'Tài xế', 'Phương tiện', 'Bắt đầu dự kiến', 'Xuất chuyến', 'Đóng chuyến', 'Trạng thái', 'Điểm giao', 'Phiếu giao', 'Giao đủ', 'Giao một phần', 'Thất bại', 'Hẹn lại', 'Đúng giờ (%)', 'Chưa có kết quả'], report.trips.map((row) => [
      row.tripNumber,
      `${row.warehouseCode} — ${row.warehouseName}`,
      [row.routeCode, row.routeName].filter(Boolean).join(' — '),
      [row.driverCode, row.driverName].filter(Boolean).join(' — '),
      [row.vehicleCode, row.licensePlate].filter(Boolean).join(' — '),
      row.plannedStartAt,
      row.dispatchedAt ?? '',
      row.closedAt ?? '',
      officeToken(row.status, LOGISTICS_STATUS_LABELS),
      row.stopCount,
      row.deliveryOrderCount,
      row.deliveredFullCount,
      row.deliveredPartialCount,
      row.failedCount,
      row.rescheduledCount,
      row.onTimeFullRatePercent ?? '',
      row.pendingResultCount,
    ])),
    sheet('Cần kiểm tra', ['Nội dung', 'Số trường hợp'], report.dataQuality.exceptions.map((row) => [
      logisticsExceptionLabel(row.exceptionCode),
      row.exceptionCount,
    ])),
  ];
  return <OperationalExportActions filename="bao-cao-giao-van.xlsx" sheets={sheets} disabled={disabled} />;
}

export function EmployeeMcpReportingExportActions({
  report,
  disabled = false,
}: {
  report: EmployeeMcpDashboard;
  disabled?: boolean;
}) {
  const reconciliationRows: readonly (readonly Cell[])[] = [
    ...report.dataQuality.unmappedActors.map((row) => [
      employeeExceptionLabel(row.exceptionCode),
      row.salesLabel ?? 'Chưa xác định nhân viên',
      `${row.firstSessionDate} → ${row.lastSessionDate}`,
      `${row.sessionCount} phiên`,
      '',
    ]),
    ...report.dataQuality.counterMismatches.map((row) => [
      employeeExceptionLabel(row.exceptionCode),
      row.salesLabel ?? 'Chưa xác định nhân viên',
      `${row.sessionDate} · ${row.routeCode ?? row.routeName}`,
      `KH ${row.storedPlannedCustomers} · ghé ${row.storedVisitedCustomers} · nhu cầu ${row.storedOrderCount}`,
      `KH ${row.derivedPlannedOutletCount} · ghé ${row.derivedVisitedOutletCount} · nhu cầu ${row.derivedOrderIntentCount}`,
    ]),
  ];
  const sheets: readonly OperationalExportSheet[] = [
    sheet('Tổng hợp', ['Nội dung', 'Giá trị'], [
      ['Từ ngày', report.filters.from],
      ['Đến ngày', report.filters.to],
      ['Phiên đi thị trường', report.summary.sessionCount ?? '0'],
      ['Tuyến có hoạt động', report.summary.routeCount ?? '0'],
      ['Điểm kế hoạch', report.summary.plannedOutletCount ?? '0'],
      ['Điểm đã ghé', report.summary.visitedOutletCount ?? '0'],
      ['Điểm đã ghi nhận có mặt', report.summary.checkedInOutletCount ?? '0'],
      ['Nhu cầu mua', report.summary.orderIntentCount ?? '0'],
      ['Đề nghị mở mã khách', report.summary.onboardingSubmittedCount ?? '0'],
      ['Mở mã khách thành công', report.summary.onboardingConvertedCount ?? '0'],
      ['Đơn Công Ty chính thức', report.summary.coreSalesOrderCount ?? '0'],
    ]),
    sheet('Nhân viên', ['Nhân viên', 'Phiên', 'Tuyến', 'Điểm kế hoạch', 'Đã ghé', 'Có mặt', 'Lượt ghé', 'Nhu cầu mua', 'Đề nghị mở mã', 'Mở mã thành công', 'Đơn Công Ty', 'Hoàn thành kế hoạch (%)', 'Nhu cầu trên lượt ghé (%)', 'Đơn trên nhu cầu (%)'], report.fieldActors.map((row) => [
      actorLabel(row.salesLabel, row.employeeCode, row.employeeName),
      row.sessionCount,
      row.routeCount,
      row.plannedOutletCount,
      row.visitedOutletCount,
      row.checkedInOutletCount,
      row.visitCount,
      row.orderIntentCount,
      row.onboardingSubmittedCount,
      row.onboardingConvertedCount,
      row.coreSalesOrderCount,
      row.plannedVisitRatePercent ?? '',
      row.orderIntentConversionPercent ?? '',
      row.coreOrderConversionPercent ?? '',
    ])),
    sheet('Tuyến', ['Mã tuyến', 'Tên tuyến', 'Khu vực', 'Nhân viên', 'Phiên', 'Điểm kế hoạch', 'Đã ghé', 'Có mặt', 'Nhu cầu mua', 'Đơn Công Ty', 'Hoàn thành kế hoạch (%)'], report.routes.map((row) => [
      row.routeCode ?? '',
      row.routeName,
      row.area ?? '',
      actorLabel(row.salesLabel, row.employeeCode, row.employeeName),
      row.sessionCount,
      row.plannedOutletCount,
      row.visitedOutletCount,
      row.checkedInOutletCount,
      row.orderIntentCount,
      row.coreSalesOrderCount,
      row.plannedVisitRatePercent ?? '',
    ])),
    sheet('Phiên đi thị trường', ['Ngày', 'Tuyến', 'Khu vực', 'Nhân viên', 'Trạng thái', 'Điểm kế hoạch', 'Đã ghé', 'Có mặt', 'Lượt ghé', 'Nhu cầu mua', 'Đề nghị mở mã', 'Mở mã thành công', 'Đơn Công Ty'], report.sessions.map((row) => [
      row.sessionDate,
      [row.routeCode, row.routeName].filter(Boolean).join(' — '),
      row.area ?? '',
      actorLabel(row.salesLabel, row.employeeCode, row.employeeName),
      officeToken(row.status.toLowerCase(), EMPLOYEE_SESSION_STATUS_LABELS),
      row.plannedOutletCount,
      row.visitedOutletCount,
      row.checkedInOutletCount,
      row.visitCount,
      row.orderIntentCount,
      row.onboardingSubmittedCount,
      row.onboardingConvertedCount,
      row.coreSalesOrderCount,
    ])),
    sheet('Cần đối soát', ['Loại', 'Nhân viên', 'Khoảng ngày / tuyến', 'Số liệu ghi nhận', 'Số liệu đối chiếu'], reconciliationRows),
  ];
  return <OperationalExportActions filename="bao-cao-nhan-vien-mcp.xlsx" sheets={sheets} disabled={disabled} />;
}
