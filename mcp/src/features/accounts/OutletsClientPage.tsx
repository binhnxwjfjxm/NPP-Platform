"use client";

import { useMemo, useState } from "react";
import {
  McpButton,
  McpCard,
  McpFilterChip,
  McpFilterRow,
  McpInput,
  McpPageHeader,
  McpSelect,
  McpStatePanel,
  McpStatusPill
} from "@/ui/foundation";
import { McpSheet } from "@/ui/foundation";
import { AppShell } from "@/ui/shell/AppShell";
import { DataTable, type DataTableColumn } from "@/ui/table/DataTable";
import type { AccountKpi, OutletItem, OutletStatus } from "./accounts.types";
import styles from "./OutletDirectoryScreen.module.css";

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

function statusTone(status: OutletStatus): "success" | "warning" | "neutral" {
  if (status === "active") return "success";
  if (status === "needs_gps") return "warning";
  return "neutral";
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
    { key: "status", header: "Trạng thái", render: (row) => <McpStatusPill tone={statusTone(row.status)}>{statusLabel(row.status)}</McpStatusPill> },
    { key: "detail", header: "", render: (row) => <McpButton className={styles.tableAction} variant="secondary" onClick={() => onSelect(row)}>Hồ sơ</McpButton> }
  ];
}

function OutletMobileCard({ item, onSelect }: { item: OutletItem; onSelect: (item: OutletItem) => void }) {
  return (
    <McpCard className={styles.outletCard} data-outlet-mobile-card>
      <div className={styles.outletHead}>
        <div>
          <span>{item.routeName} · {item.area}</span>
          <h3>{item.name}</h3>
        </div>
        <McpStatusPill tone={statusTone(item.status)}>{statusLabel(item.status)}</McpStatusPill>
      </div>
      <div className={styles.outletDecision}>
        <span>
          <small>{hasContact(item.contactName) ? "Liên hệ" : "Vị trí"}</small>
          <strong>{hasContact(item.contactName) ? item.contactName : gpsLabel(item)}</strong>
        </span>
        <McpButton
          className={styles.mobileAction}
          variant="secondary"
          aria-label={`Mở hồ sơ ${item.name}`}
          onClick={() => onSelect(item)}
        >
          Mở hồ sơ
        </McpButton>
      </div>
    </McpCard>
  );
}

function OutletSheet({ item, onClose }: { item: OutletItem | null; onClose: () => void }) {
  return (
    <McpSheet
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
          <div className="sheet-note-card">
            <h3>Dữ liệu đang hiển thị</h3>
            <p>Hồ sơ này chỉ dùng dữ liệu điểm bán trong tuyến: tên, liên hệ, khu vực, thứ tự, trạng thái và GPS. Chưa ghép doanh số hoặc lịch sử đơn theo tên điểm bán.</p>
          </div>
        </div>
      ) : null}
    </McpSheet>
  );
}

function CompanyCustomers({ customers }: { customers: CompanyCustomer[] }) {
  return (
    <McpCard className={styles.listCard} aria-label="Khách Công Ty đã mở hoặc liên kết mã">
      <div className={styles.cardHead}>
        <div><span>Khách Công Ty</span><h2>Danh sách khách đã liên kết</h2></div>
        <McpStatusPill tone="primary">{customers.length} khách</McpStatusPill>
      </div>
      {customers.length ? (
        <div className={styles.companyList}>
          {customers.map((customer) => (
            <article className={styles.companyCard} key={customer.id} data-company-customer-card>
              <div className={styles.companyHead}>
                <div><span>{customer.customerCode || "Đã liên kết"}</span><h3>{customer.name}</h3></div>
                <McpStatusPill tone="success">Đang hoạt động</McpStatusPill>
              </div>
              <div className={styles.companyMeta}>
                <span><small>Điện thoại</small><strong>{customer.phone || "-"}</strong></span>
                <span><small>Email</small><strong>{customer.email || "-"}</strong></span>
              </div>
            </article>
          ))}
        </div>
      ) : (
        <McpStatePanel title="Chưa có khách Công Ty" description="Mở hoặc liên kết mã từ tab Điểm bán trước." icon="◇" />
      )}
    </McpCard>
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
      <div className={styles.page} data-primary-screen="customers">
        <McpPageHeader
          eyebrow="MCP Field"
          title="Điểm bán"
          description="Điểm bán trong tuyến và Khách Công Ty được tách rõ để không làm mất dữ liệu tác nghiệp."
          actions={<McpStatusPill tone="primary">{items.length} điểm bán · {coreCustomers.length} Khách Công Ty</McpStatusPill>}
        />

        <div role="tablist" aria-label="Nhóm khách hàng">
          <McpFilterRow>
            <McpFilterChip active={activeTab === "outlets"} role="tab" aria-selected={activeTab === "outlets"} onClick={() => setActiveTab("outlets")}>
              Điểm bán <b className={styles.tabCount}>{items.length}</b>
            </McpFilterChip>
            <McpFilterChip active={activeTab === "company"} role="tab" aria-selected={activeTab === "company"} onClick={() => setActiveTab("company")}>
              Khách Công Ty <b className={styles.tabCount}>{coreCustomers.length}</b>
            </McpFilterChip>
          </McpFilterRow>
        </div>

        {activeTab === "outlets" ? (
          <>
            <McpCard className={styles.filterCard} aria-label="Tìm kiếm và lọc điểm bán">
              <div className={styles.filterGrid}>
                <McpInput label="Tìm điểm bán" value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Tên, liên hệ, khu vực hoặc tuyến" type="search" />
                <McpSelect label="Tuyến" value={route} onChange={(event) => setRoute(event.target.value)}>
                  <option value="all">Tất cả tuyến</option>
                  {routes.map((routeName) => <option key={routeName} value={routeName}>{routeName}</option>)}
                </McpSelect>
                <McpSelect label="Trạng thái" value={status} onChange={(event) => setStatus(event.target.value as StatusFilter)}>
                  <option value="all">Tất cả trạng thái</option>
                  <option value="active">Đang trong tuyến</option>
                  <option value="needs_gps">Cần cập nhật GPS</option>
                  <option value="hidden">Đang ẩn</option>
                </McpSelect>
              </div>
            </McpCard>

            <section className={styles.kpiGrid} aria-label="Chỉ số điểm bán">
              {kpis.map((row) => (
                <McpCard className={styles.kpiCard} key={row.label}>
                  <span>{row.label}</span><strong>{row.value}</strong><small>{row.hint}</small>
                </McpCard>
              ))}
            </section>

            <section className={styles.contentGrid}>
              <McpCard className={styles.listCard}>
                <div className={styles.cardHead}>
                  <div><span>Điểm bán</span><h2>Danh sách điểm bán</h2></div>
                  <McpStatusPill tone="primary">{filteredItems.length}/{items.length} điểm bán</McpStatusPill>
                </div>

                <div className={styles.desktopTable}>
                  <DataTable columns={columns} rows={filteredItems} getRowKey={(row) => row.id} emptyMessage="Không có điểm bán phù hợp" />
                </div>

                <div className={styles.mobileList} aria-label="Danh sách điểm bán trên điện thoại">
                  {filteredItems.length
                    ? filteredItems.map((item) => <OutletMobileCard item={item} key={item.id} onSelect={setSelected} />)
                    : <McpStatePanel title="Không có điểm bán phù hợp" description="Thử thay đổi từ khóa, tuyến hoặc trạng thái." icon="□" />}
                </div>
              </McpCard>

              <McpCard className={styles.qualityCard}>
                <div className={styles.cardHead}><div><span>Hồ sơ</span><h2>Chất lượng dữ liệu</h2></div></div>
                <div className={styles.qualityGrid}>
                  <span><small>Cần cập nhật GPS</small><strong>{stats.needsGps}</strong></span>
                  <span><small>Thiếu liên hệ</small><strong>{stats.missingContact}</strong></span>
                  <span><small>Đang ẩn</small><strong>{stats.hidden}</strong></span>
                  <span><small>Số tuyến</small><strong>{stats.routes}</strong></span>
                </div>
              </McpCard>
            </section>
          </>
        ) : <CompanyCustomers customers={coreCustomers} />}
      </div>

      <OutletSheet item={selected} onClose={() => setSelected(null)} />
    </AppShell>
  );
}
