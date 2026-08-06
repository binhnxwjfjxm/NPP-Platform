"use client";

import type { OrderDto } from "@/lib/api/api.types";
import { DEFAULT_ORDER_FILTERS, type OrderFilters, type OrderPeriod } from "./order-analytics";
import { getOrderStatusLabel } from "./orders-page-ui";
import styles from "./OrdersClientPage.module.css";

const money = new Intl.NumberFormat("vi-VN", { style: "currency", currency: "VND", maximumFractionDigits: 0 });
const PERIOD_LABELS: Record<OrderPeriod, string> = { "7d": "7 ngày", "30d": "30 ngày", "90d": "90 ngày", all: "Tất cả" };

type Options = { routes: string[]; owners: string[]; sources: string[]; statuses: string[] };

export function OrdersFilters({ filters, options, filteredOrders, totalOrders, totalAmount, latestDate, search = true, period = true, onChange, onReset }: {
  filters: OrderFilters;
  options: Options;
  filteredOrders: OrderDto[];
  totalOrders: number;
  totalAmount: number;
  latestDate: string | null;
  search?: boolean;
  period?: boolean;
  onChange: <Key extends keyof OrderFilters>(key: Key, value: OrderFilters[Key]) => void;
  onReset: () => void;
}) {
  const activeFilterCount = [filters.search, filters.routeName, filters.owner, filters.source, filters.status, filters.customer].filter(Boolean).length + (filters.period === DEFAULT_ORDER_FILTERS.period ? 0 : 1);
  return (
    <section className={styles.filterPanel} aria-label="Bộ lọc đơn hàng">
      {period ? <div className={styles.periodRow}><span>Khoảng dữ liệu</span><div>{(Object.keys(PERIOD_LABELS) as OrderPeriod[]).map((key) => <button key={key} type="button" aria-pressed={filters.period === key} onClick={() => onChange("period", key)}>{PERIOD_LABELS[key]}</button>)}</div><small>Tính lùi từ ngày dữ liệu mới nhất: {latestDate || "chưa có"}</small></div> : null}
      <div className={styles.filterGrid}>
        {search ? <label className={styles.searchField}><span>Tìm nhanh</span><input value={filters.search} onChange={(event) => onChange("search", event.target.value)} placeholder="Mã đơn, khách, tuyến, nhân viên..." /></label> : null}
        <label><span>Tuyến</span><select value={filters.routeName} onChange={(event) => onChange("routeName", event.target.value)}><option value="">Tất cả tuyến</option>{options.routes.map((value) => <option key={value} value={value}>{value}</option>)}</select></label>
        <label><span>Nhân viên</span><select value={filters.owner} onChange={(event) => onChange("owner", event.target.value)}><option value="">Tất cả nhân viên</option>{options.owners.map((value) => <option key={value} value={value}>{value}</option>)}</select></label>
        <label><span>Trạng thái</span><select value={filters.status} onChange={(event) => onChange("status", event.target.value)}><option value="">Tất cả trạng thái</option>{options.statuses.map((value) => <option key={value} value={value}>{getOrderStatusLabel(value)}</option>)}</select></label>
        <label><span>Nguồn đơn</span><select value={filters.source} onChange={(event) => onChange("source", event.target.value)}><option value="">Tất cả nguồn</option>{options.sources.map((value) => <option key={value} value={value}>{value}</option>)}</select></label>
      </div>
      <div className={styles.filterSummary}>
        <span><strong>{filteredOrders.length}</strong>/{totalOrders} đơn · {money.format(totalAmount)}</span>
        <div>
          {!search && filters.search ? <button type="button" onClick={() => onChange("search", "")}>Tìm: {filters.search} ×</button> : null}
          {filters.customer ? <button type="button" onClick={() => onChange("customer", "")}>Khách: {filters.customer} ×</button> : null}
          {activeFilterCount ? <button type="button" onClick={onReset}>Xóa {activeFilterCount} bộ lọc</button> : <small>Chưa áp dụng bộ lọc bổ sung</small>}
        </div>
      </div>
    </section>
  );
}
