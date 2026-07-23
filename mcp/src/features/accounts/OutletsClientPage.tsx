"use client";

import { useMemo, useState } from "react";
import { KpiCard } from "@/ui/cards/KpiCard";
import { FilterBar } from "@/ui/layout/FilterBar";
import { PageHeader } from "@/ui/layout/PageHeader";
import { BottomSheet } from "@/ui/overlay/BottomSheet";
import { AppShell } from "@/ui/shell/AppShell";
import { DataTable, type DataTableColumn } from "@/ui/table/DataTable";
import type { AccountItem, AccountKpi, AccountStatus } from "./accounts.types";

function formatMoney(value: number) {
  if (value === 0) return "-";
  return new Intl.NumberFormat("vi-VN", { style: "currency", currency: "VND", maximumFractionDigits: 0 }).format(value);
}

function statusLabel(status: AccountStatus) {
  if (status === "active") return "Đang chăm sóc";
  if (status === "need_visit") return "Cần ghé lại";
  return "Chưa có dữ liệu";
}

function buildColumns(onSelect: (item: AccountItem) => void): DataTableColumn<AccountItem>[] {
  return [
    { key: "name", header: "Điểm bán", render: (row) => row.name },
    { key: "contactName", header: "Liên hệ", render: (row) => row.contactName },
    { key: "area", header: "Khu vực", render: (row) => row.area },
    { key: "routeName", header: "Tuyến", render: (row) => row.routeName },
    { key: "tier", header: "Hạng", render: (row) => <span className="badge">Hạng {row.tier}</span> },
    { key: "lastVisitDate", header: "Ghé gần nhất", render: (row) => row.lastVisitDate },
    { key: "lastOrderDate", header: "Đơn gần nhất", render: (row) => row.lastOrderDate },
    { key: "monthlyRevenue", header: "Doanh số", render: (row) => formatMoney(row.monthlyRevenue), align: "right" },
    { key: "status", header: "Trạng thái", render: (row) => <span className="badge">{statusLabel(row.status)}</span> },
    { key: "detail", header: "", render: (row) => <button className="button compact" type="button" onClick={() => onSelect(row)}>Hồ sơ</button> }
  ];
}

function OutletSheet({ item, onClose }: { item: AccountItem | null; onClose: () => void }) {
  return (
    <BottomSheet
      open={Boolean(item)}
      onClose={onClose}
      title={item ? item.name : "Hồ sơ điểm bán"}
      description={item ? `${item.area} · ${item.routeName}` : undefined}
      footer={<div className="sheet-action-grid"><button className="button" type="button" onClick={onClose}>Đóng</button></div>}
    >
      {item ? (
        <div className="outlet-sheet-content">
          <div className="outlet-focus-card">
            <span>Doanh số tháng</span>
            <strong>{formatMoney(item.monthlyRevenue)}</strong>
            <small>Hạng {item.tier} · {statusLabel(item.status)}</small>
          </div>
          <div className="grid">
            <div className="metric-row"><span>Người liên hệ</span><strong>{item.contactName}</strong></div>
            <div className="metric-row"><span>Tuyến</span><strong>{item.routeName}</strong></div>
            <div className="metric-row"><span>Ghé gần nhất</span><strong>{item.lastVisitDate}</strong></div>
            <div className="metric-row"><span>Đơn gần nhất</span><strong>{item.lastOrderDate}</strong></div>
          </div>
          <div className="sheet-note-card">
            <h3>Hồ sơ điểm bán</h3>
            <p>Dữ liệu được tổng hợp từ tuyến, phiên MCP và đơn hàng. Các thao tác tạo đơn, ghi quan sát hoặc việc theo dõi nên thực hiện trong phiên MCP để giữ đúng ngữ cảnh tuyến/ngày.</p>
          </div>
        </div>
      ) : null}
    </BottomSheet>
  );
}

export function OutletsClientPage({ kpis, items }: { kpis: AccountKpi[]; items: AccountItem[] }) {
  const [selected, setSelected] = useState<AccountItem | null>(null);
  const columns = useMemo(() => buildColumns(setSelected), []);
  const stats = useMemo(() => {
    const needVisit = items.filter((item) => item.status === "need_visit").length;
    const missingContact = items.filter((item) => !item.contactName || item.contactName === "-" || item.contactName === "Chưa cập nhật").length;
    const noOrder = items.filter((item) => !item.lastOrderDate || item.lastOrderDate === "-").length;
    const tierA = items.filter((item) => item.tier === "A").length;
    return { needVisit, missingContact, noOrder, tierA };
  }, [items]);
  const priorityText = stats.needVisit > 0
    ? `Có ${stats.needVisit} điểm bán cần ghé lại. Ưu tiên nhóm có doanh số hoặc chưa có đơn gần đây.`
    : "Danh sách điểm bán đang ổn định. Tiếp tục duy trì lịch ghé và cập nhật quan sát trong phiên MCP.";

  return (
    <AppShell activeHref="/customers">
      <PageHeader eyebrow="Khách hàng" title="Khách hàng / điểm bán" subtitle="Hồ sơ điểm bán nối dữ liệu ghé tuyến, đơn hàng, ghi nhận thị trường và việc cần làm trong một luồng chăm sóc.">
        <span className="badge">Đang chăm sóc</span>
      </PageHeader>

      <FilterBar filters={[{ label: "Khu vực", value: "Tất cả" }, { label: "Hạng điểm bán", value: "A/B/C" }, { label: "Trạng thái", value: "Đang chăm sóc + Cần ghé lại" }]} />

      <section className="grid cards">
        {kpis.map((row) => <KpiCard key={row.label} label={row.label} value={row.value} hint={row.hint} />)}
      </section>

      <section className="hero-panel" style={{ marginTop: 18 }}>
        <div className="card">
          <h2 className="panel-title">Danh sách điểm bán</h2>
          <DataTable columns={columns} rows={items} getRowKey={(row) => row.id} emptyMessage="Chưa có điểm bán" />
        </div>
        <div className="card">
          <h2 className="panel-title">Chất lượng hồ sơ</h2>
          <div className="grid">
            <div className="metric-row"><span>Cần ghé lại</span><strong>{stats.needVisit}</strong></div>
            <div className="metric-row"><span>Thiếu liên hệ</span><strong>{stats.missingContact}</strong></div>
            <div className="metric-row"><span>Chưa có đơn</span><strong>{stats.noOrder}</strong></div>
            <div className="metric-row"><span>Hạng A</span><strong>{stats.tierA}</strong></div>
          </div>
        </div>
      </section>

      <section className="card">
        <h2 className="panel-title">Gợi ý chăm sóc điểm bán</h2>
        <article className="action-card">
          <div>
            <span className="badge">Từ dữ liệu hiện có</span>
            <h3>Ưu tiên ghé lại đúng tuyến và ghi nhận trong phiên MCP</h3>
            <p className="page-subtitle">{priorityText}</p>
          </div>
          <strong>MCP</strong>
        </article>
      </section>

      <OutletSheet item={selected} onClose={() => setSelected(null)} />
    </AppShell>
  );
}
