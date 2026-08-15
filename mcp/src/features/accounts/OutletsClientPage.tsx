"use client";

import { useMemo, useState } from "react";
import { KpiCard } from "@/ui/cards/KpiCard";
import { PageHeader } from "@/ui/layout/PageHeader";
import { BottomSheet } from "@/ui/overlay/BottomSheet";
import { AppShell } from "@/ui/shell/AppShell";
import { DataTable, type DataTableColumn } from "@/ui/table/DataTable";
import type { AccountKpi, OutletItem, OutletStatus } from "./accounts.types";

type StatusFilter = "all" | OutletStatus;
type CustomerTab = "outlets" | "company";
type CompanyCustomer = {
  id: string;
  customerCode: string;
  name: string;
  phone: string | null;
  email: string | null;
  status: string;
  updatedAt: string | null;
};

function normalized(value: string) {
  return value.trim().toLocaleLowerCase("vi-VN");
}

function hasContact(value: string) {
  const contact = normalized(value || "");
  return Boolean(contact) && contact !== "-" && contact !== "chưa cập nhật" && contact !== "chưa có sđt";
}

function statusLabel(status: OutletStatus) {
  if (status === "active") return "Đang trong tuyến";
  if (status === "needs_gps") return "Cần cập nhật GPS";
  return "Đang ẩn";
}

function statusClass(status: OutletStatus) {
  if (status === "active") return "summary-status-good";
  if (status === "needs_gps") return "summary-status-watch";
  return "summary-status-muted";
}

function gpsLabel(item: OutletItem) {
  if (!item.gps) return "Chưa có GPS";
  return `${item.gps.lat.toFixed(5)}, ${item.gps.lng.toFixed(5)}`;
}

function buildColumns(onSelect: (item: OutletItem) => void): DataTableColumn<OutletItem>[] {
  return [
    { key: "sortOrder", header: "STT", render: (row) => row.sortOrder || "-", align: "right" },
    { key: "name", header: "Điểm bán", render: (row) => row.name },
    { key: "contactName", header: "Liên hệ", render: (row) => hasContact(row.contactName) ? row.contactName : "Chưa cập nhật" },
    { key: "area", header: "Khu vực", render: (row) => row.area },
    { key: "routeName", header: "Tuyến", render: (row) => row.routeName },
    { key: "gps", header: "Vị trí", render: (row) => row.gps ? "Đã có GPS" : "Chưa có GPS" },
    { key: "status", header: "Trạng thái", render: (row) => <span className="badge">{statusLabel(row.status)}</span> },
    { key: "detail", header: "", render: (row) => <button className="button compact" type="button" onClick={() => onSelect(row)}>Hồ sơ</button> }
  ];
}

function OutletMobileCard({ item, onSelect }: { item: OutletItem; onSelect: (item: OutletItem) => void }) {
  return (
    <article className="mobile-summary-card outlet-mobile-summary" data-outlet-mobile-card>
      <div className="mobile-summary-head">
        <div className="mobile-summary-title">
          <span>{item.routeName} · {item.area}</span>
          <h3>{item.name}</h3>
        </div>
        <span className={`mobile-summary-status ${statusClass(item.status)}`}>{statusLabel(item.status)}</span>
      </div>

      <div className="mobile-summary-decision-row">
        <span>
          <small>{hasContact(item.contactName) ? "Liên hệ" : "Vị trí"}</small>
          <strong>{hasContact(item.contactName) ? item.contactName : gpsLabel(item)}</strong>
        </span>
        <button
          className="button compact mobile-summary-action"
          type="button"
          aria-label={`Mở hồ sơ ${item.name}`}
          onClick={() => onSelect(item)}
        >
          Mở hồ sơ
        </button>
      </div>
    </article>
  );
}

function OutletSheet({ item, onClose }: { item: OutletItem | null; onClose: () => void }) {
  return (
    <BottomSheet
      open={Boolean(item)}
      onClose={onClose}
      title={item ? item.name : "Hồ sơ điểm bán"}
      description={item ? `${item.routeName} · ${item.area}` : undefined}
      footer={
        <div className="sheet-action-grid">
          {item ? <a className="button primary" href={`/customers/onboarding/${encodeURIComponent(item.routeCustomerId)}`}>Mở / liên kết mã</a> : null}
          {item ? <a className="button" href={item.mapsUrl}>Di chuyển</a> : null}
          <button className="button" type="button" onClick={onClose}>Đóng</button>
        </div>
      }
    >
      {item ? (
        <div className="outlet-sheet-content">
          <div className="outlet-focus-card">
            <span>Trạng thái hồ sơ</span>
            <strong>{statusLabel(item.status)}</strong>
            <small>{gpsLabel(item)}</small>
          </div>
          <div className="grid">
            <div className="metric-row"><span>Người liên hệ</span><strong>{hasContact(item.contactName) ? item.contactName : "Chưa cập nhật"}</strong></div>
            <div className="metric-row"><span>Tuyến</span><strong>{item.routeName}</strong></div>
            <div className="metric-row"><span>Khu vực</span><strong>{item.area}</strong></div>
            <div className="metric-row"><span>Thứ tự ghé</span><strong>{item.sortOrder || "Chưa xếp"}</strong></div>
            <div className="metric-row"><span>Cập nhật GPS</span><strong>{item.gps?.updatedAt || "Chưa có"}</strong></div>
            <div className="metric-row"><span>Mã nguồn</span><strong>{item.accountId || item.routeCustomerId}</strong></div>
          </div>
          {item.note ? <div className="sheet-note-card"><h3>Ghi chú tuyến</h3><p>{item.note}</p></div> : null}
        </div>
      ) : null}
    </BottomSheet>
  );
}

function CompanyCustomers({ customers }: { customers: CompanyCustomer[] }) {
  return (
    <section className="card route-list-card" aria-label="Khách công ty đã mở hoặc liên kết mã">
      <div className="route-list-heading">
        <div>
          <h2 className="panel-title">Khách công ty</h2>
          <p className="page-subtitle">Chỉ gồm khách đã có mã công ty và thuộc nhân viên đang đăng nhập phụ trách.</p>
        </div>
        <span>{customers.length} khách</span>
      </div>
      <div className="grid">
        {customers.map((customer) => (
          <article className="card" key={customer.id} data-company-customer-card>
            <div className="mobile-summary-head">
              <div className="mobile-summary-title">
                <span>{customer.customerCode || "Đã liên kết"}</span>
                <h3>{customer.name}</h3>
              </div>
              <span className="mobile-summary-status summary-status-good">Đang hoạt động</span>
            </div>
            <div className="grid">
              <div className="metric-row"><span>Điện thoại</span><strong>{customer.phone || "-"}</strong></div>
              <div className="metric-row"><span>Email</span><strong>{customer.email || "-"}</strong></div>
            </div>
          </article>
        ))}
        {customers.length === 0 ? (
          <div className="empty-inline">
            <strong>Chưa có khách công ty</strong>
            <p className="page-subtitle">Mở hoặc liên kết mã từ tab Điểm bán trước.</p>
          </div>
        ) : null}
      </div>
    </section>
  );
}

export function OutletsClientPage({
  kpis,
  items,
  coreCustomers
}: {
  kpis: AccountKpi[];
  items: OutletItem[];
  coreCustomers: CompanyCustomer[];
}) {
  const [activeTab, setActiveTab] = useState<CustomerTab>("outlets");
  const [selected, setSelected] = useState<OutletItem | null>(null);
  const [query, setQuery] = useState("");
  const [route, setRoute] = useState("all");
  const [status, setStatus] = useState<StatusFilter>("all");
  const columns = useMemo(() => buildColumns(setSelected), []);
  const routes = useMemo(() => Array.from(new Set(items.map((item) => item.routeName))).sort((a, b) => a.localeCompare(b, "vi")), [items]);
  const filteredItems = useMemo(() => {
    const term = normalized(query);
    return items.filter((item) => {
      const matchesQuery = !term || [item.name, item.contactName, item.area, item.routeName]
        .some((value) => normalized(value || "").includes(term));
      const matchesRoute = route === "all" || item.routeName === route;
      const matchesStatus = status === "all"
        || (status === "needs_gps" ? item.status === "needs_gps" || !item.gps : item.status === status);
      return matchesQuery && matchesRoute && matchesStatus;
    });
  }, [items, query, route, status]);
  const stats = useMemo(() => ({
    needsGps: items.filter((item) => item.status === "needs_gps" || !item.gps).length,
    missingContact: items.filter((item) => !hasContact(item.contactName)).length,
    hidden: items.filter((item) => item.status === "hidden").length,
    routes: new Set(items.map((item) => item.routeName)).size
  }), [items]);

  return (
    <AppShell activeHref="/customers">
      <PageHeader eyebrow="Khách" title="Khách hàng" subtitle="Điểm bán MCP và khách công ty được tách rõ, không dùng khách công ty để thay mất dữ liệu tuyến.">
        <span className="badge">{items.length} điểm bán · {coreCustomers.length} khách công ty</span>
      </PageHeader>

      <div className="mcp-status-chips" role="tablist" aria-label="Nhóm khách hàng">
        <button className={activeTab === "outlets" ? "active" : ""} type="button" role="tab" aria-selected={activeTab === "outlets"} onClick={() => setActiveTab("outlets")}>Điểm bán <b>{items.length}</b></button>
        <button className={activeTab === "company" ? "active" : ""} type="button" role="tab" aria-selected={activeTab === "company"} onClick={() => setActiveTab("company")}>Khách công ty <b>{coreCustomers.length}</b></button>
      </div>

      {activeTab === "outlets" ? (
        <>
          <section className="card route-guidance-card" aria-label="Tìm kiếm và lọc điểm bán">
            <div className="grid route-secondary-grid">
              <label className="form-field">
                <small>Tìm điểm bán</small>
                <input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Tên, liên hệ, khu vực hoặc tuyến" type="search" />
              </label>
              <label className="form-field">
                <small>Tuyến</small>
                <select value={route} onChange={(event) => setRoute(event.target.value)}>
                  <option value="all">Tất cả tuyến</option>
                  {routes.map((routeName) => <option key={routeName} value={routeName}>{routeName}</option>)}
                </select>
              </label>
              <label className="form-field">
                <small>Trạng thái</small>
                <select value={status} onChange={(event) => setStatus(event.target.value as StatusFilter)}>
                  <option value="all">Tất cả trạng thái</option>
                  <option value="active">Đang trong tuyến</option>
                  <option value="needs_gps">Cần cập nhật GPS</option>
                  <option value="hidden">Đang ẩn</option>
                </select>
              </label>
            </div>
          </section>

          <section className="grid cards route-kpi-grid">
            {kpis.map((row) => <KpiCard key={row.label} label={row.label} value={row.value} hint={row.hint} />)}
          </section>

          <section className="hero-panel route-list-layout">
            <div className="card route-list-card">
              <div className="route-list-heading">
                <h2 className="panel-title">Danh sách điểm bán</h2>
                <span>{filteredItems.length}/{items.length} điểm bán</span>
              </div>

              <div className="route-desktop-table">
                <DataTable columns={columns} rows={filteredItems} getRowKey={(row) => row.id} emptyMessage="Không có điểm bán phù hợp" />
              </div>

              <div className="route-mobile-list" aria-label="Danh sách điểm bán trên điện thoại">
                {filteredItems.length
                  ? filteredItems.map((item) => <OutletMobileCard item={item} key={item.id} onSelect={setSelected} />)
                  : <div className="empty-inline">Không có điểm bán phù hợp</div>}
              </div>
            </div>

            <div className="card route-secondary-card">
              <h2 className="panel-title">Chất lượng hồ sơ</h2>
              <div className="grid route-secondary-grid">
                <div className="metric-row"><span>Cần cập nhật GPS</span><strong>{stats.needsGps}</strong></div>
                <div className="metric-row"><span>Thiếu liên hệ</span><strong>{stats.missingContact}</strong></div>
                <div className="metric-row"><span>Đang ẩn</span><strong>{stats.hidden}</strong></div>
                <div className="metric-row"><span>Số tuyến</span><strong>{stats.routes}</strong></div>
              </div>
            </div>
          </section>
        </>
      ) : <CompanyCustomers customers={coreCustomers} />}

      <OutletSheet item={selected} onClose={() => setSelected(null)} />
    </AppShell>
  );
}
