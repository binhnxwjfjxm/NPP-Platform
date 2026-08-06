"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { ExportMenu } from "@/features/exports/ExportLinks";
import type { RouteCustomerItem } from "@/features/mcp/route-customers.types";
import type { ApiResult, OrderDto } from "@/lib/api/api.types";
import { PageHeader } from "@/ui/layout/PageHeader";
import { AppShell } from "@/ui/shell/AppShell";
import { SourceBadge } from "@/ui/status/SourceBadge";
import { OrderCreateSheet } from "./OrderCreateSheet";
import { OrderDetailDrawer } from "./OrderDetailDrawer";
import { OrdersFilters } from "./OrdersFilters";
import {
  buildOrderAnalytics,
  DEFAULT_ORDER_FILTERS,
  filterOrders,
  orderFilterOptions,
  type OrderAlert,
  type OrderAttention,
  type OrderFilters
} from "./order-analytics";
import type { OrderSessionOption } from "./order-create.types";
import { loadOrderSessions } from "./orders-page-session";
import {
  AlertCard,
  BreakdownPanel,
  DailyTrend,
  KpiCard,
  OrderCard,
  downloadOrdersCsv
} from "./orders-page-ui";
import styles from "./OrdersClientPage.module.css";
import tabs from "./OrdersTabs.module.css";

const money = new Intl.NumberFormat("vi-VN", {
  style: "currency",
  currency: "VND",
  maximumFractionDigits: 0
});
const integer = new Intl.NumberFormat("vi-VN", { maximumFractionDigits: 0 });
const decimal = new Intl.NumberFormat("vi-VN", { minimumFractionDigits: 1, maximumFractionDigits: 1 });

type OrderView = "orders" | "attention" | "sales" | "overview";
type AttentionView = Exclude<OrderAttention, "all"> | "zero_value";

const ORDER_VIEWS: Array<{ id: OrderView; label: string; hint: string }> = [
  { id: "orders", label: "Đơn hàng", hint: "Tìm, tạo và xem chi tiết" },
  { id: "attention", label: "Cần xử lý", hint: "Nháp, tồn, trùng và bất thường" },
  { id: "sales", label: "Doanh số đặt hàng", hint: "Ngày, khách, tuyến và nguồn đơn" },
  { id: "overview", label: "Tổng quan", hint: "4 chỉ số để quyết định nhanh" }
];

const ATTENTION_VIEWS: Array<{ id: AttentionView; label: string }> = [
  { id: "pending", label: "Chờ xử lý" },
  { id: "stale", label: "Tồn quá 3 ngày" },
  { id: "possible_duplicate", label: "Nghi trùng" },
  { id: "cancelled", label: "Đã hủy" },
  { id: "zero_value", label: "Giá trị bằng 0" }
];

function isOrderView(value: string | null): value is OrderView {
  return ORDER_VIEWS.some((view) => view.id === value);
}

function ordersForAttention(orders: OrderDto[], attention: AttentionView) {
  if (attention === "zero_value") {
    return orders.filter((order) => Number(order.totalAmount || 0) <= 0);
  }
  return filterOrders(orders, {
    ...DEFAULT_ORDER_FILTERS,
    period: "all",
    attention
  });
}

function ExportActions({ orders }: { orders: OrderDto[] }) {
  return (
    <ExportMenu
      label="Chọn loại file"
      groups={[
        {
          title: "Dữ liệu đang xem",
          links: [
            {
              label: "Danh sách theo bộ lọc (CSV)",
              onClick: () => downloadOrdersCsv(orders),
              tone: "primary",
              hint: `${orders.length} đơn đang hiển thị, mỗi đơn một dòng`
            }
          ]
        },
        {
          title: "Dữ liệu toàn bộ",
          links: [
            {
              label: "Danh sách tất cả đơn (CSV)",
              href: "/api/backend/exports/orders.csv?view=orders",
              hint: "Một dòng cho mỗi đơn, không lặp khách hàng theo sản phẩm"
            },
            {
              label: "Chi tiết sản phẩm (CSV)",
              href: "/api/backend/exports/orders.csv?view=items",
              hint: "Một dòng cho mỗi sản phẩm, dùng mã đơn để đối chiếu"
            }
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
  const requestedView = searchParams.get("view");
  const activeView: OrderView = isOrderView(requestedView) ? requestedView : "orders";
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
  const [attentionView, setAttentionView] = useState<AttentionView>("pending");

  const options = useMemo(() => orderFilterOptions(ordersResult.data), [ordersResult.data]);
  const filteredOrders = useMemo(
    () => filterOrders(ordersResult.data, { ...filters, attention: "all" }),
    [filters, ordersResult.data]
  );
  const analytics = useMemo(() => buildOrderAnalytics(filteredOrders), [filteredOrders]);
  const allAnalytics = useMemo(() => buildOrderAnalytics(ordersResult.data), [ordersResult.data]);
  const attentionOrders = useMemo(
    () => ordersForAttention(filteredOrders, attentionView),
    [attentionView, filteredOrders]
  );
  const attentionOrderIds = useMemo(() => {
    const ids = new Set<string>();
    for (const view of ATTENTION_VIEWS) {
      ordersForAttention(ordersResult.data, view.id).forEach((order) => ids.add(order.id));
    }
    return ids;
  }, [ordersResult.data]);
  const detailOrder = useMemo(
    () => ordersResult.data.find((order) => order.id === detailOrderId) ?? null,
    [detailOrderId, ordersResult.data]
  );

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

  function setView(view: OrderView) {
    const params = new URLSearchParams(searchParams.toString());
    params.delete("detail");
    if (view === "orders") params.delete("view");
    else params.set("view", view);
    const query = params.toString();
    router.push(query ? `${pathname}?${query}` : pathname, { scroll: false });
  }

  function goToOrders(next: Partial<OrderFilters> = {}) {
    setFilters((current) => ({ ...current, ...next, attention: "all" }));
    setView("orders");
    window.setTimeout(
      () => document.getElementById("orders-result-list")?.scrollIntoView({ behavior: "smooth", block: "start" }),
      0
    );
  }

  function selectAlert(alert: OrderAlert) {
    if (alert.key === "zero_value") setAttentionView("zero_value");
    else if (alert.attention && alert.attention !== "all") setAttentionView(alert.attention);
    else if (alert.customer) {
      goToOrders({ customer: alert.customer });
      return;
    }
    setView("attention");
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
      setSessions(await loadOrderSessions(customers));
      setCreateOpen(true);
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "Không tải được danh sách phiên.");
      setNoticeDetail("Form chưa được mở để tránh hiển thị sai khách hoặc trộn khách giữa các tuyến.");
    } finally {
      setCreateLoading(false);
    }
  }

  const filtersPanel = (search = true) => (
    <OrdersFilters
      filters={filters}
      options={options}
      filteredOrders={filteredOrders}
      totalOrders={ordersResult.data.length}
      totalAmount={analytics.summary.totalAmount}
      latestDate={allAnalytics.latestDate}
      search={search}
      period
      onChange={updateFilter}
      onReset={() => setFilters(DEFAULT_ORDER_FILTERS)}
    />
  );

  return (
    <AppShell activeHref="/orders">
      <PageHeader
        eyebrow="Điều hành bán hàng"
        title="Trung tâm đơn hàng"
        subtitle="Tạo và tìm đơn, xử lý ngoại lệ, xem doanh số đặt hàng hoặc nhìn nhanh tổng quan."
      >
        <SourceBadge source={ordersResult.source} />
        {activeView === "orders" || activeView === "sales" ? <ExportActions orders={filteredOrders} /> : null}
        {activeView === "orders" ? (
          <button className="button primary" type="button" onClick={() => void openCreateOrder()} disabled={createLoading}>
            {createLoading ? "Đang tải phiên..." : "+ Tạo đơn"}
          </button>
        ) : null}
      </PageHeader>

      <nav className={tabs.tabRail} role="tablist" aria-label="Phân tích và xử lý đơn hàng">
        {ORDER_VIEWS.map((view) => (
          <button
            key={view.id}
            className={activeView === view.id ? tabs.tabActive : tabs.tab}
            type="button"
            role="tab"
            aria-selected={activeView === view.id}
            onClick={() => setView(view.id)}
          >
            <strong>{view.label}</strong>
            <small>{view.hint}</small>
          </button>
        ))}
      </nav>

      {notice ? (
        <section className={`card ${styles.notice}`}>
          <strong>{notice}</strong>
          <span>{noticeDetail || "Danh sách đang được làm mới từ dữ liệu live."}</span>
        </section>
      ) : null}

      {activeView === "orders" ? (
        <div className={tabs.viewPanel} role="tabpanel" aria-label="Đơn hàng">
          {filtersPanel(true)}
          <section className={styles.section} id="orders-result-list">
            <div className={styles.sectionTitle}>
              <div><h2>Đơn hàng</h2><p>Tìm nhanh, mở chi tiết hoặc tạo đơn mới ngay tại tab này.</p></div>
              <span>{filteredOrders.length} đơn</span>
            </div>
            <div className={styles.list}>
              {filteredOrders.length ? filteredOrders.map((order) => (
                <OrderCard
                  key={order.id}
                  order={order}
                  possibleDuplicate={allAnalytics.possibleDuplicateIds.has(order.id)}
                  onSelect={openOrderDetail}
                />
              )) : (
                <div className={styles.emptyOrders}>
                  <strong>Không có đơn phù hợp</strong>
                  <span>Thử xóa bớt bộ lọc hoặc đổi từ khóa.</span>
                  <button className="button" type="button" onClick={() => setFilters(DEFAULT_ORDER_FILTERS)}>Đặt lại bộ lọc</button>
                </div>
              )}
            </div>
          </section>
        </div>
      ) : null}

      {activeView === "attention" ? (
        <div className={tabs.viewPanel} role="tabpanel" aria-label="Cần xử lý">
          <section className={styles.alertSection}>
            <div className={styles.sectionTitle}>
              <div><h2>Cần xử lý</h2><p>Chỉ hiển thị đơn cần xem lại; không tự đổi lifecycle.</p></div>
              <span>{attentionOrderIds.size} đơn</span>
            </div>
            {allAnalytics.alerts.length ? (
              <div className={styles.alertGrid}>
                {allAnalytics.alerts.map((alert) => <AlertCard key={alert.key} alert={alert} onSelect={selectAlert} />)}
              </div>
            ) : (
              <div className={styles.healthyState}>
                <strong>Không có cảnh báo nổi bật</strong>
                <span>Dữ liệu chưa phát hiện đơn nháp, tồn, trùng, hủy hoặc giá trị bằng 0.</span>
              </div>
            )}
          </section>

          <div className={tabs.attentionRail} role="tablist" aria-label="Loại đơn cần xử lý">
            {ATTENTION_VIEWS.map((view) => (
              <button
                key={view.id}
                type="button"
                aria-pressed={attentionView === view.id}
                onClick={() => setAttentionView(view.id)}
              >
                {view.label}<b>{ordersForAttention(filteredOrders, view.id).length}</b>
              </button>
            ))}
          </div>

          {filtersPanel(true)}
          <section className={styles.section}>
            <div className={styles.sectionTitle}>
              <div>
                <h2>{ATTENTION_VIEWS.find((view) => view.id === attentionView)?.label}</h2>
                <p>Danh sách theo loại cần xử lý đang chọn.</p>
              </div>
              <span>{attentionOrders.length} đơn</span>
            </div>
            <div className={styles.list}>
              {attentionOrders.length ? attentionOrders.map((order) => (
                <OrderCard
                  key={order.id}
                  order={order}
                  possibleDuplicate={allAnalytics.possibleDuplicateIds.has(order.id)}
                  onSelect={openOrderDetail}
                />
              )) : (
                <div className={styles.healthyState}>
                  <strong>Không có đơn trong nhóm này</strong>
                  <span>Không cần thao tác thêm với bộ lọc hiện tại.</span>
                </div>
              )}
            </div>
          </section>
        </div>
      ) : null}

      {activeView === "sales" ? (
        <div className={tabs.viewPanel} role="tabpanel" aria-label="Doanh số đặt hàng">
          <section className={styles.definitionBanner}>
            <div>
              <strong>Đang đo doanh số đặt hàng</strong>
              <span>Tổng giá trị đơn đã ghi nhận, chưa phải doanh thu giao hàng hoặc tiền đã thu.</span>
            </div>
            <details>
              <summary>Định nghĩa số liệu</summary>
              <div className={styles.definitionGrid}>
                <p><b>Khách phát sinh</b><span>Đếm tên khách duy nhất vì API hiện chưa trả accountId.</span></p>
                <p><b>SKU/đơn</b><span>Tổng số SKU trên đơn chia số đơn, chưa phải độ phủ SKU.</span></p>
                <p><b>Chưa hiển thị</b><span>Giá vốn, lợi nhuận, giao hàng, thu tiền và công nợ.</span></p>
              </div>
            </details>
          </section>
          {filtersPanel(false)}
          <section className={styles.kpiGrid} aria-label="Chỉ số doanh số đặt hàng">
            <KpiCard label="Doanh số đặt hàng" value={money.format(analytics.summary.totalAmount)} hint={`${analytics.summary.orderCount} đơn trong bộ lọc`} tone="strong" />
            <KpiCard label="Giá trị TB/đơn" value={money.format(analytics.summary.averageOrder)} hint={`${decimal.format(analytics.summary.averageQuantityPerOrder)} sản phẩm/đơn`} />
            <KpiCard label="Khách phát sinh" value={integer.format(analytics.summary.customerCount)} hint={`${analytics.summary.routeCount} tuyến có đơn`} />
            <KpiCard label="Sản lượng" value={integer.format(analytics.summary.totalQuantity)} hint={`${decimal.format(analytics.summary.averageSkuPerOrder)} SKU/đơn`} />
          </section>
          <section className={styles.analysisGrid}>
            <DailyTrend rows={analytics.daily} />
            <BreakdownPanel title="Doanh số theo khách" subtitle="Bấm để xem đơn của khách" rows={analytics.customers} onSelect={(row) => goToOrders({ customer: row.label })} />
            <BreakdownPanel title="Hiệu quả theo tuyến" subtitle="Doanh số, số đơn và khách" rows={analytics.routes} onSelect={(row) => goToOrders({ routeName: row.label, customer: "" })} />
            <BreakdownPanel title="Theo nhân viên" subtitle="Phân bổ doanh số đặt hàng" rows={analytics.owners} onSelect={(row) => goToOrders({ owner: row.label, customer: "" })} />
            <BreakdownPanel title="Theo nguồn đơn" subtitle="Kênh nào đang tạo đơn" rows={analytics.sources} onSelect={(row) => goToOrders({ source: row.label, customer: "" })} />
          </section>
        </div>
      ) : null}

      {activeView === "overview" ? (
        <div className={tabs.viewPanel} role="tabpanel" aria-label="Tổng quan đơn hàng">
          <section className={tabs.overviewIntro}>
            <strong>Nhìn nhanh để chọn bước tiếp theo</strong>
            <span>Không lặp toàn bộ báo cáo. Bấm chỉ số để đi đúng tab chi tiết.</span>
          </section>
          <section className={`${styles.kpiGrid} ${tabs.overviewGrid}`} aria-label="Tổng quan đơn hàng">
            <KpiCard label="Doanh số đặt hàng" value={money.format(allAnalytics.summary.totalAmount)} hint="Mở phân tích theo ngày, khách và tuyến" tone="strong" onClick={() => setView("sales")} />
            <KpiCard label="Số đơn" value={integer.format(allAnalytics.summary.orderCount)} hint="Mở danh sách và chi tiết đơn" onClick={() => setView("orders")} />
            <KpiCard label="Khách phát sinh" value={integer.format(allAnalytics.summary.customerCount)} hint={`${allAnalytics.summary.routeCount} tuyến có đơn`} onClick={() => setView("sales")} />
            <KpiCard label="Cần xử lý" value={integer.format(attentionOrderIds.size)} hint="Nháp, tồn, trùng, hủy hoặc bất thường" tone={attentionOrderIds.size ? "warning" : "default"} onClick={() => setView("attention")} />
          </section>
        </div>
      ) : null}

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
