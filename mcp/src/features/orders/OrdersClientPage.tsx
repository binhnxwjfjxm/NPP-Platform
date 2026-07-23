"use client";

import { useEffect, useMemo, useRef, useState, type CSSProperties } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { ExportMenu } from "@/features/exports/ExportLinks";
import type { RouteCustomerItem } from "@/features/mcp/route-customers.types";
import type { ApiResult, OrderDto } from "@/lib/api/api.types";
import { OperationalListCard } from "@/ui/cards/OperationalListCard";
import { PageHeader } from "@/ui/layout/PageHeader";
import { AppShell } from "@/ui/shell/AppShell";
import { SourceBadge } from "@/ui/status/SourceBadge";
import { OrderCreateSheet } from "./OrderCreateSheet";
import { OrderDetailDrawer } from "./OrderDetailDrawer";
import {
  buildOrderAnalytics,
  DEFAULT_ORDER_FILTERS,
  filterOrders,
  orderFilterOptions,
  type OrderAlert,
  type OrderAttention,
  type OrderBreakdownRow,
  type OrderFilters,
  type OrderPeriod
} from "./order-analytics";
import type { OrderSessionOption } from "./order-create.types";
import styles from "./OrdersClientPage.module.css";

const money = new Intl.NumberFormat("vi-VN", { style: "currency", currency: "VND", maximumFractionDigits: 0 });
const integer = new Intl.NumberFormat("vi-VN", { maximumFractionDigits: 0 });
const decimal = new Intl.NumberFormat("vi-VN", { minimumFractionDigits: 1, maximumFractionDigits: 1 });
const percent = new Intl.NumberFormat("vi-VN", { style: "percent", maximumFractionDigits: 1 });

const PERIOD_LABELS: Record<OrderPeriod, string> = {
  "7d": "7 ngày",
  "30d": "30 ngày",
  "90d": "90 ngày",
  all: "Tất cả"
};

const ATTENTION_LABELS: Record<OrderAttention, string> = {
  all: "Tất cả",
  pending: "Chờ xử lý",
  stale: "Tồn quá 3 ngày",
  possible_duplicate: "Nghi trùng",
  cancelled: "Đã hủy"
};

type SessionStatusRow = {
  id?: unknown;
  routeId?: unknown;
  routeName?: unknown;
  sessionDate?: unknown;
  status?: unknown;
  plannedCustomers?: unknown;
  visitedCustomers?: unknown;
};

function text(value: unknown) {
  return String(value ?? "").trim();
}

function count(value: unknown) {
  const parsed = Number(value ?? 0);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : 0;
}

function normalizeSession(row: SessionStatusRow): OrderSessionOption | null {
  const id = text(row.id);
  const routeId = text(row.routeId);
  const routeName = text(row.routeName) || routeId;
  const sessionDate = text(row.sessionDate).slice(0, 10);
  const rawStatus = text(row.status).toLowerCase();
  const status = rawStatus === "active" ? "active" : rawStatus === "done" || rawStatus === "completed" ? "done" : null;
  if (!id || !routeId || !sessionDate || !status) return null;
  return {
    id,
    routeId,
    routeName,
    sessionDate,
    status,
    plannedCustomers: count(row.plannedCustomers),
    visitedCustomers: count(row.visitedCustomers)
  };
}

async function loadOrderSessions(customers: RouteCustomerItem[]): Promise<OrderSessionOption[]> {
  const routeIds = Array.from(new Set(customers.map((customer) => customer.routeId).filter(Boolean)));
  const responses = await Promise.all(routeIds.map(async (routeId) => {
    const query = new URLSearchParams({ routeId });
    const response = await fetch(`/api/backend/mcp-settings/session-status?${query.toString()}`, {
      cache: "no-store",
      headers: { Accept: "application/json" }
    });
    const payload = await response.json().catch(() => ({})) as {
      data?: { sessions?: SessionStatusRow[] };
      error?: string | { message?: string };
      detail?: string;
    };
    if (!response.ok) {
      const error = typeof payload.error === "string" ? payload.error : payload.error?.message;
      throw new Error(error || payload.detail || `Không tải được phiên của tuyến ${routeId}`);
    }
    return Array.isArray(payload.data?.sessions) ? payload.data.sessions : [];
  }));

  const sessions = new Map<string, OrderSessionOption>();
  responses.flat().forEach((row) => {
    const session = normalizeSession(row);
    if (session) sessions.set(session.id, session);
  });
  return Array.from(sessions.values()).sort((left, right) => {
    if (left.status !== right.status) return left.status === "active" ? -1 : 1;
    return `${right.sessionDate}-${right.routeName}`.localeCompare(`${left.sessionDate}-${left.routeName}`, "vi");
  });
}

function getStatusLabel(status: string) {
  if (status === "draft") return "Nháp";
  if (status === "confirmed") return "Đã chốt";
  if (status === "delivered") return "Đã giao";
  if (status === "cancelled") return "Hủy";
  return status || "Chưa xác định";
}

function getStatusClass(status: string) {
  if (status === "delivered") return `${styles.status} ${styles.delivered}`;
  if (status === "confirmed") return `${styles.status} ${styles.confirmed}`;
  if (status === "draft") return `${styles.status} ${styles.draft}`;
  return `${styles.status} ${styles.cancelled}`;
}

function orderExportHref(order: OrderDto) {
  return `/api/backend/exports/orders.csv?orderId=${encodeURIComponent(order.id)}`;
}

function csvCell(value: unknown) {
  const raw = String(value ?? "");
  return `"${raw.replace(/"/g, '""')}"`;
}

function downloadOrdersCsv(orders: OrderDto[]) {
  const header = ["Mã đơn", "Ngày", "Khách hàng", "Tuyến", "Nhân viên", "Nguồn", "Trạng thái", "Số SKU", "Số lượng", "Tổng giá trị"];
  const lines = orders.map((order) => [
    order.code,
    order.date,
    order.accountName,
    order.routeName,
    order.owner,
    order.source,
    getStatusLabel(order.status),
    order.skuCount,
    order.quantity,
    order.totalAmount
  ]);
  const csv = `\uFEFF${[header, ...lines].map((row) => row.map(csvCell).join(",")).join("\r\n")}`;
  const blob = new Blob([csv], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = `don-hang-theo-bo-loc-${new Date().toISOString().slice(0, 10)}.csv`;
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 1_000);
}

function KpiCard({
  label,
  value,
  hint,
  tone = "default",
  onClick
}: {
  label: string;
  value: string;
  hint: string;
  tone?: "default" | "strong" | "warning";
  onClick?: () => void;
}) {
  const content = <><span>{label}</span><strong>{value}</strong><small>{hint}</small></>;
  return onClick ? (
    <button className={`${styles.kpiCard} ${styles[`kpi_${tone}`]}`} type="button" onClick={onClick}>{content}</button>
  ) : (
    <article className={`${styles.kpiCard} ${styles[`kpi_${tone}`]}`}>{content}</article>
  );
}

function BreakdownPanel({
  title,
  subtitle,
  rows,
  limit = 6,
  onSelect
}: {
  title: string;
  subtitle: string;
  rows: OrderBreakdownRow[];
  limit?: number;
  onSelect: (row: OrderBreakdownRow) => void;
}) {
  const visibleRows = rows.slice(0, limit);
  const maxAmount = Math.max(...visibleRows.map((row) => row.amount), 1);
  return (
    <section className={styles.analysisCard}>
      <header className={styles.analysisHead}><div><h3>{title}</h3><p>{subtitle}</p></div><span>{rows.length}</span></header>
      {visibleRows.length ? (
        <div className={styles.breakdownList}>
          {visibleRows.map((row, index) => {
            const width = Math.max((row.amount / maxAmount) * 100, 4);
            return (
              <button key={row.key} className={styles.breakdownRow} type="button" onClick={() => onSelect(row)}>
                <span className={styles.rank}>{index + 1}</span>
                <span className={styles.breakdownMain}>
                  <span className={styles.breakdownTitle}><b>{row.label}</b><strong>{money.format(row.amount)}</strong></span>
                  <span className={styles.barTrack}><span style={{ width: `${width}%` }} /></span>
                  <small>{row.orders} đơn · {row.customers} khách · TB {money.format(row.averageOrder)}</small>
                </span>
              </button>
            );
          })}
        </div>
      ) : <p className={styles.emptyState}>Không có dữ liệu trong bộ lọc.</p>}
    </section>
  );
}

function DailyTrend({ rows }: { rows: ReturnType<typeof buildOrderAnalytics>["daily"] }) {
  const visibleRows = rows.slice(-14);
  const maxAmount = Math.max(...visibleRows.map((row) => row.amount), 1);
  return (
    <section className={`${styles.analysisCard} ${styles.trendCard}`}>
      <header className={styles.analysisHead}><div><h3>Nhịp doanh số theo ngày</h3><p>14 ngày có dữ liệu gần nhất trong bộ lọc</p></div><span>{visibleRows.length} ngày</span></header>
      {visibleRows.length ? (
        <div className={styles.trendList}>
          {visibleRows.map((row) => {
            const width = Math.max((row.amount / maxAmount) * 100, 3);
            return (
              <div key={row.date} className={styles.trendRow}>
                <time dateTime={row.date}>{row.date.slice(5)}</time>
                <span className={styles.trendBar}><span style={{ width: `${width}%` }} /></span>
                <strong>{money.format(row.amount)}</strong>
                <small>{row.orders} đơn</small>
              </div>
            );
          })}
        </div>
      ) : <p className={styles.emptyState}>Không có dữ liệu theo ngày.</p>}
    </section>
  );
}

function AlertCard({ alert, onSelect }: { alert: OrderAlert; onSelect: (alert: OrderAlert) => void }) {
  return (
    <button className={`${styles.alertCard} ${styles[`alert_${alert.tone}`]}`} type="button" onClick={() => onSelect(alert)}>
      <span className={styles.alertCount}>{alert.count}</span>
      <span><strong>{alert.title}</strong><small>{alert.description}</small></span>
      <b aria-hidden="true">→</b>
    </button>
  );
}

function OrderCard({
  order,
  possibleDuplicate,
  onSelect
}: {
  order: OrderDto;
  possibleDuplicate: boolean;
  onSelect: (order: OrderDto) => void;
}) {
  return (
    <OperationalListCard
      leading={<span>{order.skuCount}</span>}
      eyebrow={`${order.source} · ${order.date}`}
      title={`${order.code} · ${money.format(order.totalAmount)}`}
      description={order.accountName}
      badge={<span className={styles.badgeStack}><strong className={getStatusClass(order.status)}>{getStatusLabel(order.status)}</strong>{possibleDuplicate ? <em>Nghi trùng</em> : null}</span>}
      meta={[`${order.routeName} · ${order.owner}`, `${order.quantity} sản phẩm · ${order.skuCount} SKU`]}
      actions={[
        { label: "Xem", tone: "primary", onClick: () => onSelect(order) },
        { label: "XLSX mẫu", href: orderExportHref(order) }
      ]}
    />
  );
}

export function OrdersClientPage({
  ordersResult,
  customers
}: {
  ordersResult: ApiResult<OrderDto[]>;
  customers: RouteCustomerItem[];
}) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const detailOrderId = searchParams.get("detail");
  const detailNavigationOwnedRef = useRef(false);
  const detailReturnFocusRef = useRef<HTMLElement | null>(null);
  const previousDetailIdRef = useRef<string | null>(detailOrderId);
  const [createOpen, setCreateOpen] = useState(false);
  const [createLoading, setCreateLoading] = useState(false);
  const [sessions, setSessions] = useState<OrderSessionOption[]>([]);
  const [notice, setNotice] = useState<string | null>(null);
  const [noticeDetail, setNoticeDetail] = useState<string | null>(null);
  const [filters, setFilters] = useState<OrderFilters>(DEFAULT_ORDER_FILTERS);

  const options = useMemo(() => orderFilterOptions(ordersResult.data), [ordersResult.data]);
  const filteredOrders = useMemo(() => filterOrders(ordersResult.data, filters), [filters, ordersResult.data]);
  const analytics = useMemo(() => buildOrderAnalytics(filteredOrders), [filteredOrders]);
  const allAnalytics = useMemo(() => buildOrderAnalytics(ordersResult.data), [ordersResult.data]);
  const detailOrder = useMemo(() => ordersResult.data.find((order) => order.id === detailOrderId) ?? null, [detailOrderId, ordersResult.data]);
  const activeFilterCount = [filters.search, filters.routeName, filters.owner, filters.source, filters.status, filters.customer]
    .filter(Boolean).length + (filters.period === DEFAULT_ORDER_FILTERS.period ? 0 : 1) + (filters.attention === "all" ? 0 : 1);

  useEffect(() => {
    const previousDetailId = previousDetailIdRef.current;
    if (previousDetailId && !detailOrderId) {
      detailNavigationOwnedRef.current = false;
      window.requestAnimationFrame(() => detailReturnFocusRef.current?.focus());
    }
    previousDetailIdRef.current = detailOrderId;
  }, [detailOrderId]);

  function updateFilter<Key extends keyof OrderFilters>(key: Key, value: OrderFilters[Key]) {
    setFilters((current) => ({ ...current, [key]: value }));
  }

  function focusList(next: Partial<OrderFilters>) {
    setFilters((current) => ({ ...current, ...next }));
    window.setTimeout(() => document.getElementById("orders-result-list")?.scrollIntoView({ behavior: "smooth", block: "start" }), 0);
  }

  function selectAlert(alert: OrderAlert) {
    if (alert.customer) return focusList({ customer: alert.customer, attention: "all" });
    if (alert.attention) return focusList({ attention: alert.attention, customer: "" });
  }

  function openOrderDetail(order: OrderDto) {
    detailReturnFocusRef.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    detailNavigationOwnedRef.current = true;
    const params = new URLSearchParams(searchParams.toString());
    params.set("detail", order.id);
    router.push(`${pathname}?${params.toString()}`, { scroll: false });
  }

  function closeOrderDetail() {
    if (detailNavigationOwnedRef.current) {
      router.back();
      return;
    }
    const params = new URLSearchParams(searchParams.toString());
    params.delete("detail");
    const query = params.toString();
    router.replace(query ? `${pathname}?${query}` : pathname, { scroll: false });
  }

  async function openCreateOrder() {
    if (createLoading) return;
    setCreateLoading(true);
    setNotice(null);
    setNoticeDetail(null);
    try {
      const nextSessions = await loadOrderSessions(customers);
      setSessions(nextSessions);
      setCreateOpen(true);
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "Không tải được danh sách phiên.");
      setNoticeDetail("Form chưa được mở để tránh hiển thị sai khách hoặc trộn khách giữa các tuyến.");
    } finally {
      setCreateLoading(false);
    }
  }

  const summary = analytics.summary;
  const allSummary = allAnalytics.summary;
  const dailyMaxStyle = { "--daily-count": Math.max(analytics.daily.length, 1) } as CSSProperties;

  return (
    <AppShell activeHref="/orders">
      <PageHeader eyebrow="Điều hành bán hàng" title="Trung tâm đơn hàng" subtitle="Theo dõi doanh số đặt hàng, khách hàng, tuyến, nguồn đơn và các điểm cần xử lý.">
        <SourceBadge source={ordersResult.source} />
        <ExportMenu
          label="Chọn loại file"
          groups={[
            {
              title: "Dữ liệu đang xem",
              links: [
                {
                  label: "Danh sách theo bộ lọc (CSV)",
                  onClick: () => downloadOrdersCsv(filteredOrders),
                  tone: "primary",
                  hint: `${filteredOrders.length} đơn đang hiển thị, mỗi đơn một dòng`
                }
              ]
            },
            {
              title: "Dữ liệu toàn bộ",
              links: [
                { label: "Danh sách tất cả đơn (CSV)", href: "/api/backend/exports/orders.csv?view=orders", hint: "Một dòng cho mỗi đơn, không lặp khách hàng theo sản phẩm" },
                { label: "Chi tiết sản phẩm (CSV)", href: "/api/backend/exports/orders.csv?view=items", hint: "Một dòng cho mỗi sản phẩm, dùng mã đơn để đối chiếu" }
              ]
            },
            {
              title: "Báo cáo để đọc và in",
              links: [
                { label: "Báo cáo điều hành", href: "/api/pdf/dashboard", hint: "Mở để đọc, in hoặc lưu PDF" },
                { label: "Báo cáo thị trường", href: "/api/pdf/market-report", hint: "Mở để đọc, in hoặc lưu PDF" }
              ]
            }
          ]}
        />
        <button className="button primary" type="button" onClick={() => void openCreateOrder()} disabled={createLoading}>
          {createLoading ? "Đang tải phiên..." : "+ Tạo đơn"}
        </button>
      </PageHeader>

      {notice ? <section className={`card ${styles.notice}`}><strong>{notice}</strong><span>{noticeDetail || "Danh sách đang được làm mới từ dữ liệu live."}</span></section> : null}

      <section className={styles.definitionBanner}>
        <div><strong>Đang đo doanh số đặt hàng</strong><span>Tổng giá trị đơn đã ghi nhận, chưa phải doanh thu giao hàng hoặc tiền đã thu.</span></div>
        <details><summary>Định nghĩa số liệu</summary><div className={styles.definitionGrid}><p><b>Khách phát sinh</b><span>Đếm tên khách duy nhất vì API hiện chưa trả accountId.</span></p><p><b>SKU/đơn</b><span>Tổng số SKU trên đơn chia số đơn, chưa phải độ phủ SKU.</span></p><p><b>Chưa hiển thị</b><span>Giá vốn, lợi nhuận, giao hàng, thu tiền, công nợ và DR cần dữ liệu MVP tiếp theo.</span></p></div></details>
      </section>

      <section className={styles.filterPanel} aria-label="Bộ lọc đơn hàng">
        <div className={styles.periodRow}>
          <span>Khoảng dữ liệu</span>
          <div>{(Object.keys(PERIOD_LABELS) as OrderPeriod[]).map((period) => <button key={period} type="button" aria-pressed={filters.period === period} onClick={() => updateFilter("period", period)}>{PERIOD_LABELS[period]}</button>)}</div>
          <small>Tính lùi từ ngày dữ liệu mới nhất: {allAnalytics.latestDate || "chưa có"}</small>
        </div>
        <div className={styles.filterGrid}>
          <label className={styles.searchField}><span>Tìm nhanh</span><input value={filters.search} onChange={(event) => updateFilter("search", event.target.value)} placeholder="Mã đơn, khách, tuyến, nhân viên..." /></label>
          <label><span>Tuyến</span><select value={filters.routeName} onChange={(event) => updateFilter("routeName", event.target.value)}><option value="">Tất cả tuyến</option>{options.routes.map((route) => <option key={route} value={route}>{route}</option>)}</select></label>
          <label><span>Nhân viên</span><select value={filters.owner} onChange={(event) => updateFilter("owner", event.target.value)}><option value="">Tất cả nhân viên</option>{options.owners.map((owner) => <option key={owner} value={owner}>{owner}</option>)}</select></label>
          <label><span>Trạng thái</span><select value={filters.status} onChange={(event) => updateFilter("status", event.target.value)}><option value="">Tất cả trạng thái</option>{options.statuses.map((status) => <option key={status} value={status}>{getStatusLabel(status)}</option>)}</select></label>
          <label><span>Nguồn đơn</span><select value={filters.source} onChange={(event) => updateFilter("source", event.target.value)}><option value="">Tất cả nguồn</option>{options.sources.map((source) => <option key={source} value={source}>{source}</option>)}</select></label>
          <label><span>Cần chú ý</span><select value={filters.attention} onChange={(event) => updateFilter("attention", event.target.value as OrderAttention)}>{(Object.keys(ATTENTION_LABELS) as OrderAttention[]).map((attention) => <option key={attention} value={attention}>{ATTENTION_LABELS[attention]}</option>)}</select></label>
        </div>
        <div className={styles.filterSummary}>
          <span><strong>{filteredOrders.length}</strong>/{ordersResult.data.length} đơn · {money.format(summary.totalAmount)}</span>
          <div>{filters.customer ? <button type="button" onClick={() => updateFilter("customer", "")}>Khách: {filters.customer} ×</button> : null}{activeFilterCount ? <button type="button" onClick={() => setFilters(DEFAULT_ORDER_FILTERS)}>Xóa {activeFilterCount} bộ lọc</button> : <small>Chưa áp dụng bộ lọc bổ sung</small>}</div>
        </div>
      </section>

      <section className={styles.kpiGrid} aria-label="Chỉ số đơn hàng">
        <KpiCard label="Doanh số đặt hàng" value={money.format(summary.totalAmount)} hint={`${summary.orderCount} đơn trong bộ lọc`} tone="strong" />
        <KpiCard label="Số đơn" value={integer.format(summary.orderCount)} hint={`Toàn dữ liệu: ${integer.format(allSummary.orderCount)}`} />
        <KpiCard label="Khách phát sinh" value={integer.format(summary.customerCount)} hint={`${summary.routeCount} tuyến có đơn`} />
        <KpiCard label="Giá trị TB/đơn" value={money.format(summary.averageOrder)} hint={`${decimal.format(summary.averageQuantityPerOrder)} sản phẩm/đơn`} />
        <KpiCard label="Doanh số/khách" value={money.format(summary.revenuePerCustomer)} hint="Theo khách phát sinh trong kỳ" />
        <KpiCard label="Sản lượng" value={integer.format(summary.totalQuantity)} hint={`${decimal.format(summary.averageQuantityPerOrder)} đơn vị/đơn`} />
        <KpiCard label="SKU/đơn" value={decimal.format(summary.averageSkuPerOrder)} hint={`${integer.format(summary.totalSkuCount)} lượt SKU trên đơn`} />
        <KpiCard label="Chờ xử lý" value={integer.format(summary.openOrders)} hint={`Giao ${percent.format(summary.deliveredRate)} · Hủy ${percent.format(summary.cancelledRate)}`} tone={summary.openOrders ? "warning" : "default"} onClick={() => focusList({ attention: "pending", status: "" })} />
      </section>

      <section className={styles.alertSection}>
        <div className={styles.sectionTitle}><div><h2>Cần chủ doanh nghiệp chú ý</h2><p>Cảnh báo được tính từ chính bộ lọc đang xem.</p></div><span>{analytics.alerts.length}</span></div>
        {analytics.alerts.length ? <div className={styles.alertGrid}>{analytics.alerts.map((alert) => <AlertCard key={alert.key} alert={alert} onSelect={selectAlert} />)}</div> : <div className={styles.healthyState}><strong>Không có cảnh báo nổi bật</strong><span>Bộ lọc hiện tại chưa phát hiện đơn tồn, nghi trùng, hủy hoặc dữ liệu giá trị bằng 0.</span></div>}
      </section>

      <section className={styles.analysisGrid} style={dailyMaxStyle}>
        <DailyTrend rows={analytics.daily} />
        <BreakdownPanel title="Doanh số theo khách" subtitle="Bấm để xem toàn bộ đơn của khách" rows={analytics.customers} onSelect={(row) => focusList({ customer: row.label, attention: "all" })} />
        <BreakdownPanel title="Hiệu quả theo tuyến" subtitle="Doanh số, số đơn và khách phát sinh" rows={analytics.routes} onSelect={(row) => focusList({ routeName: row.label, customer: "", attention: "all" })} />
        <BreakdownPanel title="Theo nhân viên" subtitle="Phân bổ doanh số đặt hàng" rows={analytics.owners} onSelect={(row) => focusList({ owner: row.label, customer: "", attention: "all" })} />
        <BreakdownPanel title="Theo nguồn đơn" subtitle="Kênh nào đang tạo đơn" rows={analytics.sources} onSelect={(row) => focusList({ source: row.label, customer: "", attention: "all" })} />
      </section>

      <section className={styles.section} id="orders-result-list">
        <div className={styles.sectionTitle}><div><h2>Đơn theo bộ lọc</h2><p>Drill-down từ KPI, khách, tuyến, nhân viên và cảnh báo đều về danh sách này.</p></div><span>{filteredOrders.length} đơn</span></div>
        <div className={styles.list}>
          {filteredOrders.length ? filteredOrders.map((order) => <OrderCard key={order.id} order={order} possibleDuplicate={analytics.possibleDuplicateIds.has(order.id)} onSelect={openOrderDetail} />) : <div className={styles.emptyOrders}><strong>Không có đơn phù hợp</strong><span>Thử xóa bớt bộ lọc hoặc đổi khoảng dữ liệu.</span><button className="button" type="button" onClick={() => setFilters(DEFAULT_ORDER_FILTERS)}>Đặt lại bộ lọc</button></div>}
        </div>
      </section>

      <OrderDetailDrawer
        open={Boolean(detailOrderId)}
        order={detailOrder}
        possibleDuplicate={Boolean(detailOrder && allAnalytics.possibleDuplicateIds.has(detailOrder.id))}
        onClose={closeOrderDetail}
      />
      <OrderCreateSheet
        open={createOpen}
        customers={customers}
        sessions={sessions}
        onClose={() => setCreateOpen(false)}
        onCreated={(orderCode) => {
          setCreateOpen(false);
          setNotice(`Đã tạo ${orderCode}.`);
          setNoticeDetail("Danh sách đang được làm mới từ dữ liệu live.");
        }}
      />
    </AppShell>
  );
}
