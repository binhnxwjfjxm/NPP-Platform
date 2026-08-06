"use client";

import type { OrderDto } from "@/lib/api/api.types";
import { OperationalListCard } from "@/ui/cards/OperationalListCard";
import type { OrderAlert, OrderBreakdownRow } from "./order-analytics";
import { buildOrderAnalytics } from "./order-analytics";
import styles from "./OrdersClientPage.module.css";

const money = new Intl.NumberFormat("vi-VN", { style: "currency", currency: "VND", maximumFractionDigits: 0 });

export function getOrderStatusLabel(status: string) {
  if (status === "draft") return "Nháp";
  if (status === "confirmed") return "Đã chốt";
  if (status === "delivered") return "Đã giao";
  if (status === "cancelled") return "Hủy";
  return status || "Chưa xác định";
}

function statusClass(status: string) {
  if (status === "delivered") return `${styles.status} ${styles.delivered}`;
  if (status === "confirmed") return `${styles.status} ${styles.confirmed}`;
  if (status === "draft") return `${styles.status} ${styles.draft}`;
  return `${styles.status} ${styles.cancelled}`;
}

function csvCell(value: unknown) {
  const raw = String(value ?? "");
  return `"${raw.replace(/"/g, '""')}"`;
}

export function downloadOrdersCsv(orders: OrderDto[]) {
  const header = ["Mã đơn", "Ngày", "Khách hàng", "Tuyến", "Nhân viên", "Nguồn", "Trạng thái", "Số SKU", "Số lượng", "Tổng giá trị"];
  const lines = orders.map((order) => [order.code, order.date, order.accountName, order.routeName, order.owner, order.source, getOrderStatusLabel(order.status), order.skuCount, order.quantity, order.totalAmount]);
  const csv = `\uFEFF${[header, ...lines].map((row) => row.map(csvCell).join(",")).join("\r\n")}`;
  const url = URL.createObjectURL(new Blob([csv], { type: "text/csv;charset=utf-8" }));
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = `don-hang-theo-bo-loc-${new Date().toISOString().slice(0, 10)}.csv`;
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 1_000);
}

export function KpiCard({ label, value, hint, tone = "default", onClick }: {
  label: string;
  value: string;
  hint: string;
  tone?: "default" | "strong" | "warning";
  onClick?: () => void;
}) {
  const toneClass = tone === "default" ? "" : styles[`kpi_${tone}`];
  const className = [styles.kpiCard, toneClass].filter(Boolean).join(" ");
  const content = <><span>{label}</span><strong>{value}</strong><small>{hint}</small></>;
  return onClick ? <button className={className} type="button" onClick={onClick}>{content}</button> : <article className={className}>{content}</article>;
}

export function BreakdownPanel({ title, subtitle, rows, onSelect }: {
  title: string;
  subtitle: string;
  rows: OrderBreakdownRow[];
  onSelect: (row: OrderBreakdownRow) => void;
}) {
  const visible = rows.slice(0, 6);
  const max = Math.max(...visible.map((row) => row.amount), 1);
  return (
    <section className={styles.analysisCard}>
      <header className={styles.analysisHead}><div><h3>{title}</h3><p>{subtitle}</p></div><span>{rows.length}</span></header>
      {visible.length ? <div className={styles.breakdownList}>{visible.map((row, index) => (
        <button key={row.key} className={styles.breakdownRow} type="button" onClick={() => onSelect(row)}>
          <span className={styles.rank}>{index + 1}</span>
          <span className={styles.breakdownMain}>
            <span className={styles.breakdownTitle}><b>{row.label}</b><strong>{money.format(row.amount)}</strong></span>
            <span className={styles.barTrack}><span style={{ width: `${Math.max((row.amount / max) * 100, 4)}%` }} /></span>
            <small>{row.orders} đơn · {row.customers} khách · TB {money.format(row.averageOrder)}</small>
          </span>
        </button>
      ))}</div> : <p className={styles.emptyState}>Không có dữ liệu trong bộ lọc.</p>}
    </section>
  );
}

export function DailyTrend({ rows }: { rows: ReturnType<typeof buildOrderAnalytics>["daily"] }) {
  const visible = rows.slice(-14);
  const max = Math.max(...visible.map((row) => row.amount), 1);
  return (
    <section className={`${styles.analysisCard} ${styles.trendCard}`}>
      <header className={styles.analysisHead}><div><h3>Nhịp doanh số theo ngày</h3><p>14 ngày có dữ liệu gần nhất trong bộ lọc</p></div><span>{visible.length} ngày</span></header>
      {visible.length ? <div className={styles.trendList}>{visible.map((row) => (
        <div key={row.date} className={styles.trendRow}>
          <time dateTime={row.date}>{row.date.slice(5)}</time>
          <span className={styles.trendBar}><span style={{ width: `${Math.max((row.amount / max) * 100, 3)}%` }} /></span>
          <strong>{money.format(row.amount)}</strong><small>{row.orders} đơn</small>
        </div>
      ))}</div> : <p className={styles.emptyState}>Không có dữ liệu theo ngày.</p>}
    </section>
  );
}

export function AlertCard({ alert, onSelect }: { alert: OrderAlert; onSelect: (alert: OrderAlert) => void }) {
  return <button className={`${styles.alertCard} ${styles[`alert_${alert.tone}`]}`} type="button" onClick={() => onSelect(alert)}><span className={styles.alertCount}>{alert.count}</span><span><strong>{alert.title}</strong><small>{alert.description}</small></span><b aria-hidden="true">→</b></button>;
}

export function OrderCard({ order, possibleDuplicate, onSelect }: {
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
      badge={<span className={styles.badgeStack}><strong className={statusClass(order.status)}>{getOrderStatusLabel(order.status)}</strong>{possibleDuplicate ? <em>Nghi trùng</em> : null}</span>}
      meta={[`${order.routeName} · ${order.owner}`, `${order.quantity} sản phẩm · ${order.skuCount} SKU`]}
      actions={[{ label: "Xem", tone: "primary", onClick: () => onSelect(order) }, { label: "XLSX mẫu", href: `/api/backend/exports/orders.csv?orderId=${encodeURIComponent(order.id)}` }]}
    />
  );
}
