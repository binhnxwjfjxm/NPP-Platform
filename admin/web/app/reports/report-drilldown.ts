import 'server-only';

import { CoreApiError, requestCore } from '../../lib/core-api';
import { resolveReportRange, type ReportDomain, type ReportPeriod } from './report-data';

type JsonRecord = Record<string, unknown>;

export type DrilldownFact = { label: string; value: string };
export type DrilldownNode = {
  id: string;
  label: string;
  summary: string;
  facts: DrilldownFact[];
  children: DrilldownNode[];
};

export type ReportDrilldown = {
  title: string;
  description: string;
  nodes: DrilldownNode[];
  message: string | null;
};

function isRecord(value: unknown): value is JsonRecord {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function record(value: unknown): JsonRecord {
  return isRecord(value) ? value : {};
}

function rows(value: unknown): JsonRecord[] {
  return Array.isArray(value) ? value.filter(isRecord) : [];
}

function text(row: JsonRecord, key: string, fallback = 'Chưa có dữ liệu'): string {
  const value = row[key];
  if (typeof value === 'string' && value.trim()) return value.trim();
  if (typeof value === 'number' && Number.isFinite(value)) return String(value);
  return fallback;
}

function optionalText(row: JsonRecord, key: string): string | null {
  const value = row[key];
  if (typeof value === 'string' && value.trim()) return value.trim();
  if (typeof value === 'number' && Number.isFinite(value)) return String(value);
  return null;
}

function bool(row: JsonRecord, key: string): boolean {
  return row[key] === true;
}

function money(row: JsonRecord, amountKey: string, currencyKey = 'currencyCode'): string {
  const raw = optionalText(row, amountKey);
  if (raw === null) return 'Chưa có dữ liệu';
  const amount = Number(raw);
  const formatted = Number.isFinite(amount)
    ? new Intl.NumberFormat('vi-VN', { maximumFractionDigits: 2 }).format(amount)
    : raw;
  return `${formatted} ${text(row, currencyKey, '')}`.trim();
}

function dateTime(value: string | null): string {
  if (!value) return 'Chưa có dữ liệu';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return new Intl.DateTimeFormat('vi-VN', {
    dateStyle: 'short',
    timeStyle: 'short',
    timeZone: 'Asia/Ho_Chi_Minh',
  }).format(date);
}

function withRange(path: string, period: ReportPeriod): string {
  const range = resolveReportRange(period);
  return `${path}?${new URLSearchParams({ from: range.from, to: range.to }).toString()}`;
}

async function source(path: string): Promise<{ data: JsonRecord | null; message: string | null }> {
  try {
    const data = await requestCore<unknown>(path);
    return isRecord(data)
      ? { data, message: null }
      : { data: null, message: 'Dữ liệu chi tiết chưa sẵn sàng.' };
  } catch (error) {
    if (error instanceof CoreApiError && error.statusCode === 403) {
      return { data: null, message: 'Tài khoản hiện tại không có quyền xem phần chi tiết này.' };
    }
    return { data: null, message: 'Không thể tải dữ liệu chi tiết ở thời điểm hiện tại.' };
  }
}

function stateLabel(value: string): string {
  const labels: Record<string, string> = {
    confirmed: 'Đã chốt',
    closed: 'Đã hoàn tất',
    active: 'Đang thực hiện',
    completed: 'Đã hoàn tất',
    visited: 'Đã ghé',
    pending: 'Chưa thực hiện',
    skipped: 'Bỏ qua',
    delivered_full: 'Giao đủ',
    delivered_partial: 'Giao một phần',
    failed: 'Giao không thành công',
    rescheduled: 'Hẹn giao lại',
    dispatched: 'Đang giao',
  };
  return labels[value] ?? 'Đang xử lý';
}

function actorKey(row: JsonRecord): string {
  return optionalText(row, 'employeeId') ?? optionalText(row, 'salesLabel') ?? 'unmapped';
}

function salesDrilldown(data: JsonRecord): ReportDrilldown {
  const documents = rows(data.documents);
  const customers = rows(data.customers);
  const nodes = customers.map((customer, index) => {
    const customerId = optionalText(customer, 'customerId');
    const currency = text(customer, 'currencyCode', '');
    const customerDocuments = documents.filter((document) =>
      optionalText(document, 'customerId') === customerId
      && text(document, 'currencyCode', '') === currency);
    return {
      id: `sales-customer-${customerId ?? index}-${currency}`,
      label: `${text(customer, 'customerCode', 'Khách hàng')} · ${text(customer, 'customerName', 'Chưa có tên')}`,
      summary: `${text(customer, 'documentCount', '0')} đơn · ${money(customer, 'totalValue')}`,
      facts: [
        { label: 'Số đơn', value: text(customer, 'documentCount', '0') },
        { label: 'Doanh thu', value: money(customer, 'totalValue') },
      ],
      children: customerDocuments.map((document, documentIndex) => ({
        id: `sales-order-${optionalText(document, 'salesOrderId') ?? documentIndex}`,
        label: text(document, 'orderNumber', 'Đơn chưa cấp số'),
        summary: money(document, 'totalValue'),
        facts: [
          { label: 'Trạng thái', value: stateLabel(text(document, 'status', '')) },
          { label: 'Chốt lúc', value: dateTime(optionalText(document, 'confirmedAt')) },
          { label: 'Giá trị', value: money(document, 'totalValue') },
        ],
        children: [],
      })),
    } satisfies DrilldownNode;
  });
  return {
    title: 'Khách hàng → đơn bán',
    description: 'Mở từng khách hàng để xem các đơn đã chốt trong kỳ đang xem.',
    nodes,
    message: nodes.length ? null : 'Không có khách hàng hoặc đơn bán trong phạm vi đang xem.',
  };
}

function debtPartyNodes(parties: JsonRecord[], documents: JsonRecord[], kind: 'receivable' | 'payable'): DrilldownNode[] {
  const partyIdKey = kind === 'receivable' ? 'customerId' : 'supplierId';
  const codeKey = kind === 'receivable' ? 'customerCode' : 'supplierCode';
  const nameKey = kind === 'receivable' ? 'customerName' : 'supplierName';
  const dateKey = kind === 'receivable' ? 'oldestDocumentDate' : 'earliestDueDate';
  return parties.map((party, index) => {
    const partyId = optionalText(party, partyIdKey);
    const currency = text(party, 'currencyCode', '');
    const partyDocuments = documents.filter((document) =>
      optionalText(document, partyIdKey) === partyId
      && text(document, 'currencyCode', '') === currency);
    return {
      id: `${kind}-${partyId ?? index}-${currency}`,
      label: `${text(party, codeKey, kind === 'receivable' ? 'Khách hàng' : 'Nhà cung cấp')} · ${text(party, nameKey, 'Chưa có tên')}`,
      summary: `${text(party, 'documentCount', '0')} chứng từ · ${money(party, 'remainingAmount')}`,
      facts: [
        { label: 'Còn lại', value: money(party, 'remainingAmount') },
        { label: kind === 'receivable' ? 'Chứng từ cũ nhất' : 'Hạn gần nhất', value: text(party, dateKey) },
      ],
      children: partyDocuments.map((document, documentIndex) => ({
        id: `${kind}-document-${optionalText(document, kind === 'receivable' ? 'receivableDocumentId' : 'payableDocumentId') ?? documentIndex}`,
        label: text(document, 'sourceDocumentNumber', 'Chứng từ chưa cấp số'),
        summary: money(document, 'remainingAmount'),
        facts: [
          { label: 'Ngày chứng từ', value: text(document, 'sourceDocumentDate') },
          { label: 'Giá trị ban đầu', value: money(document, 'originalAmount') },
          { label: 'Đã phân bổ', value: money(document, 'allocatedAmount') },
          { label: 'Còn lại', value: money(document, 'remainingAmount') },
        ],
        children: [],
      })),
    };
  });
}

function debtDrilldown(data: JsonRecord): ReportDrilldown {
  const receivable = record(data.receivable);
  const payable = record(data.payable);
  const receivableNodes = debtPartyNodes(rows(receivable.customers), rows(receivable.documents), 'receivable');
  const payableNodes = debtPartyNodes(rows(payable.suppliers), rows(payable.documents), 'payable');
  const nodes: DrilldownNode[] = [
    {
      id: 'receivable',
      label: 'Phải thu khách hàng',
      summary: `${receivableNodes.length} khách hàng`,
      facts: [],
      children: receivableNodes,
    },
    {
      id: 'payable',
      label: 'Phải trả nhà cung cấp',
      summary: `${payableNodes.length} nhà cung cấp`,
      facts: [],
      children: payableNodes,
    },
  ].filter((node) => node.children.length > 0);
  return {
    title: 'Đối tượng → chứng từ công nợ',
    description: 'Mở khách hàng hoặc nhà cung cấp để xem từng chứng từ còn số dư.',
    nodes,
    message: nodes.length ? null : 'Không có chứng từ công nợ còn số dư trong phạm vi hiện tại.',
  };
}

function mcpDrilldown(data: JsonRecord): ReportDrilldown {
  const actors = rows(data.fieldActors);
  const routes = rows(data.routes);
  const sessions = rows(data.sessions);
  const sessionCustomers = rows(data.sessionCustomers);
  const visits = rows(data.visits);
  const nodes = actors.map((actor, actorIndex) => {
    const key = actorKey(actor);
    const actorRoutes = routes.filter((route) => actorKey(route) === key);
    return {
      id: `actor-${key}-${actorIndex}`,
      label: text(actor, 'employeeName', text(actor, 'salesLabel', 'Nhân viên chưa khớp hồ sơ')),
      summary: `${text(actor, 'sessionCount', '0')} phiên · ${text(actor, 'visitedOutletCount', '0')} điểm đã ghé`,
      facts: [
        { label: 'Mã nhân viên', value: text(actor, 'employeeCode', text(actor, 'salesLabel', 'Chưa khớp')) },
        { label: 'Tỷ lệ ghé kế hoạch', value: `${text(actor, 'plannedVisitRatePercent', '—')}%` },
      ],
      children: actorRoutes.map((route, routeIndex) => {
        const routeId = optionalText(route, 'routeId');
        const routeSessions = sessions.filter((session) => optionalText(session, 'routeId') === routeId && actorKey(session) === key);
        return {
          id: `route-${routeId ?? routeIndex}-${key}`,
          label: `${text(route, 'routeCode', 'Tuyến')} · ${text(route, 'routeName', 'Chưa có tên')}`,
          summary: `${text(route, 'sessionCount', '0')} phiên · ${text(route, 'visitedOutletCount', '0')} điểm đã ghé`,
          facts: [{ label: 'Khu vực', value: text(route, 'area') }],
          children: routeSessions.map((session, sessionIndex) => {
            const sessionId = optionalText(session, 'sessionId');
            const outlets = sessionCustomers.filter((customer) => optionalText(customer, 'sessionId') === sessionId);
            return {
              id: `session-${sessionId ?? sessionIndex}`,
              label: `Phiên ${text(session, 'sessionDate')}`,
              summary: `${text(session, 'visitedOutletCount', '0')}/${text(session, 'plannedOutletCount', '0')} điểm đã ghé`,
              facts: [
                { label: 'Trạng thái', value: stateLabel(text(session, 'status', '')) },
                { label: 'Bắt đầu', value: dateTime(optionalText(session, 'openedAt')) },
                { label: 'Kết thúc', value: dateTime(optionalText(session, 'closedAt')) },
              ],
              children: outlets.map((outlet, outletIndex) => {
                const sessionCustomerId = optionalText(outlet, 'sessionCustomerId');
                const outletVisits = visits.filter((visit) => optionalText(visit, 'sessionCustomerId') === sessionCustomerId);
                const activities = [
                  optionalText(outlet, 'orderIntentId') ? 'Có nhu cầu đặt hàng' : null,
                  optionalText(outlet, 'testId') ? 'Có ghi nhận dùng thử' : null,
                  optionalText(outlet, 'reportId') ? 'Có báo cáo tại điểm bán' : null,
                  Number(optionalText(outlet, 'followupCount') ?? 0) > 0 ? `${text(outlet, 'followupCount', '0')} việc cần theo dõi` : null,
                ].filter((value): value is string => Boolean(value));
                return {
                  id: `outlet-${sessionCustomerId ?? outletIndex}`,
                  label: text(outlet, 'customerName', 'Điểm bán chưa có tên'),
                  summary: `${stateLabel(text(outlet, 'visitStatus', ''))}${bool(outlet, 'checkedIn') ? ' · Đã check-in' : ''}`,
                  facts: [
                    { label: 'Khu vực', value: text(outlet, 'area') },
                    { label: 'Địa chỉ', value: text(outlet, 'address') },
                    { label: 'Hoạt động', value: activities.length ? activities.join(' · ') : 'Chưa ghi nhận hoạt động tiếp theo' },
                    { label: 'Check-in', value: bool(outlet, 'checkedIn') ? dateTime(optionalText(outlet, 'checkinAt')) : 'Chưa check-in' },
                  ],
                  children: outletVisits.map((visit, visitIndex) => ({
                    id: `visit-${optionalText(visit, 'visitId') ?? visitIndex}`,
                    label: 'Lượt ghé thực địa',
                    summary: stateLabel(text(visit, 'status', '')),
                    facts: [
                      { label: 'Check-in', value: dateTime(optionalText(visit, 'checkinAt')) },
                      { label: 'Rời điểm', value: dateTime(optionalText(visit, 'checkoutAt')) },
                      { label: 'Ghi chú', value: text(visit, 'note', 'Không có ghi chú') },
                    ],
                    children: [],
                  })),
                };
              }),
            };
          }),
        };
      }),
    } satisfies DrilldownNode;
  });
  return {
    title: 'Nhân viên → tuyến → phiên → điểm bán',
    description: 'Mở từng cấp để xem điểm bán đã ghé và hoạt động được ghi nhận trong phiên.',
    nodes,
    message: nodes.length ? null : 'Không có dữ liệu nhân viên thị trường trong kỳ đang xem.',
  };
}

function logisticsDrilldown(data: JsonRecord): ReportDrilldown {
  const drivers = rows(data.drivers);
  const trips = rows(data.trips);
  const attempts = rows(data.attempts);
  const nodes = drivers.map((driver, driverIndex) => {
    const driverId = optionalText(driver, 'driverProfileId');
    const driverTrips = trips.filter((trip) => optionalText(trip, 'driverProfileId') === driverId);
    return {
      id: `driver-${driverId ?? driverIndex}`,
      label: text(driver, 'driverName', 'Chưa gán tài xế'),
      summary: `${text(driver, 'tripCount', '0')} chuyến · ${text(driver, 'deliveredFullCount', '0')} giao đủ`,
      facts: [
        { label: 'Mã tài xế', value: text(driver, 'driverCode') },
        { label: 'Tỷ lệ giao đủ đúng hẹn', value: `${text(driver, 'onTimeFullRatePercent', '—')}%` },
      ],
      children: driverTrips.map((trip, tripIndex) => {
        const tripId = optionalText(trip, 'tripId');
        const tripAttempts = attempts.filter((attempt) => optionalText(attempt, 'tripId') === tripId);
        return {
          id: `trip-${tripId ?? tripIndex}`,
          label: text(trip, 'tripNumber', 'Chuyến chưa cấp số'),
          summary: `${text(trip, 'deliveryOrderCount', '0')} phiếu giao · ${text(trip, 'attemptCount', '0')} lần giao`,
          facts: [
            { label: 'Tuyến', value: `${text(trip, 'routeCode', '')} ${text(trip, 'routeName', '')}`.trim() || 'Chưa có dữ liệu' },
            { label: 'Trạng thái', value: stateLabel(text(trip, 'status', '')) },
            { label: 'Khởi hành', value: dateTime(optionalText(trip, 'dispatchedAt')) },
          ],
          children: tripAttempts.map((attempt, attemptIndex) => ({
            id: `attempt-${optionalText(attempt, 'attemptId') ?? attemptIndex}`,
            label: `${text(attempt, 'deliveryOrderNumber', 'Phiếu giao')} · ${text(attempt, 'customerName', 'Khách hàng')}`,
            summary: stateLabel(text(attempt, 'result', '')),
            facts: [
              { label: 'Khách hàng', value: `${text(attempt, 'customerCode', '')} ${text(attempt, 'customerName', '')}`.trim() || 'Chưa có dữ liệu' },
              { label: 'Kết quả', value: stateLabel(text(attempt, 'result', '')) },
              { label: 'Thời điểm', value: dateTime(optionalText(attempt, 'attemptedAt')) },
              { label: 'Lý do', value: text(attempt, 'reasonCode', 'Không có') },
            ],
            children: [],
          })),
        };
      }),
    } satisfies DrilldownNode;
  });
  return {
    title: 'Tài xế → chuyến → lần giao',
    description: 'Mở từng tài xế và chuyến để xem khách hàng, phiếu giao và kết quả thực tế.',
    nodes,
    message: nodes.length ? null : 'Không có chuyến giao trong kỳ đang xem.',
  };
}

export async function loadReportDrilldown(domain: ReportDomain, period: ReportPeriod): Promise<ReportDrilldown | null> {
  if (domain === 'sales-profit') {
    const result = await source(withRange('/api/reporting/sales', period));
    return result.data ? salesDrilldown(result.data) : { title: 'Khách hàng → đơn bán', description: '', nodes: [], message: result.message };
  }
  if (domain === 'debt') {
    const result = await source('/api/reporting/aging');
    return result.data ? debtDrilldown(result.data) : { title: 'Đối tượng → chứng từ công nợ', description: '', nodes: [], message: result.message };
  }
  if (domain === 'mcp' || domain === 'people') {
    const result = await source(withRange('/api/reporting/employee-mcp', period));
    return result.data ? mcpDrilldown(result.data) : { title: 'Nhân viên → tuyến → phiên → điểm bán', description: '', nodes: [], message: result.message };
  }
  if (domain === 'delivery-cod') {
    const result = await source(withRange('/api/reporting/logistics', period));
    return result.data ? logisticsDrilldown(result.data) : { title: 'Tài xế → chuyến → lần giao', description: '', nodes: [], message: result.message };
  }
  return null;
}
