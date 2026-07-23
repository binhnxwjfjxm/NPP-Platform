"use client";

import { useState } from "react";
import { CompactKpiStrip } from "@/ui/cards/CompactKpiStrip";
import { OperationalListCard } from "@/ui/cards/OperationalListCard";
import { FilterBar } from "@/ui/layout/FilterBar";
import { PageHeader } from "@/ui/layout/PageHeader";
import { BottomSheet } from "@/ui/overlay/BottomSheet";
import { AppShell } from "@/ui/shell/AppShell";
import type { RouteItem, RouteKpi, RouteStatus } from "./routes.types";

function getStatusLabel(status: RouteStatus) {
  if (status === "active") return "Đang chạy";
  if (status === "watch") return "Cần theo dõi";
  return "Tạm dừng";
}

function getStatusClass(status: RouteStatus) {
  if (status === "active") return "dashboard-status status-good";
  if (status === "watch") return "dashboard-status status-watch";
  return "dashboard-status status-risk";
}

function getCompletion(row: RouteItem) {
  if (row.plannedCustomers === 0) return "-";
  return `${Math.round((row.visitedCustomers / row.plannedCustomers) * 100)}%`;
}

function RouteCard({ route, onSelect }: { route: RouteItem; onSelect: (route: RouteItem) => void }) {
  return (
    <OperationalListCard
      leading={<span>{getCompletion(route)}</span>}
      eyebrow={`${route.area} · ${route.salesOwner}`}
      title={route.name}
      description={`${route.visitedCustomers}/${route.plannedCustomers} điểm đã ghé · ${route.orderCount} đơn`}
      badge={<span className={getStatusClass(route.status)}>{getStatusLabel(route.status)}</span>}
      meta={[`Lần ghé cuối ${route.lastVisitDate}`, `${route.plannedCustomers} điểm bán`]}
      actions={[
        { label: "Mở", tone: "primary", onClick: () => onSelect(route) },
        { label: "Việc" }
      ]}
    />
  );
}

function RouteSheet({ route, onClose }: { route: RouteItem | null; onClose: () => void }) {
  return (
    <BottomSheet
      open={Boolean(route)}
      onClose={onClose}
      title={route ? route.name : "Chi tiết tuyến"}
      description={route ? `${route.area} · ${route.salesOwner}` : undefined}
      footer={
        <div className="sheet-action-grid">
          <button className="button primary" type="button">Mở phiên đi tuyến</button>
          <button className="button" type="button">Xem điểm bán trong tuyến</button>
          <button className="button" type="button">Tạo việc theo dõi</button>
          <button className="button" type="button" onClick={onClose}>Đóng</button>
        </div>
      }
    >
      {route ? (
        <div className="route-sheet-content">
          <div className="route-focus-card">
            <span>Tiến độ hôm nay</span>
            <strong>{getCompletion(route)}</strong>
            <small>{route.visitedCustomers}/{route.plannedCustomers} điểm bán · {route.orderCount} đơn</small>
          </div>

          <div className="grid">
            <div className="metric-row"><span>Trạng thái</span><strong>{getStatusLabel(route.status)}</strong></div>
            <div className="metric-row"><span>Lần ghé cuối</span><strong>{route.lastVisitDate}</strong></div>
            <div className="metric-row"><span>Điểm bán</span><strong>{route.plannedCustomers}</strong></div>
            <div className="metric-row"><span>Đơn hàng</span><strong>{route.orderCount}</strong></div>
          </div>

          <div className="sheet-note-card">
            <h3>Mở phiên đi tuyến</h3>
            <p>Mỗi phiên lưu danh sách điểm bán tại thời điểm bắt đầu. Các thay đổi sau đó của tuyến không làm thay đổi phiên đã mở.</p>
          </div>
        </div>
      ) : null}
    </BottomSheet>
  );
}

export function RoutesClientPage({ kpis, routes }: { kpis: RouteKpi[]; routes: RouteItem[] }) {
  const [selectedRoute, setSelectedRoute] = useState<RouteItem | null>(null);

  return (
    <AppShell activeHref="/routes">
      <PageHeader
        eyebrow="Tuyến bán hàng"
        title="Tuyến bán hàng"
        subtitle="Theo dõi tuyến, điểm bán và tiến độ đi thị trường theo ngày."
      >
        <span className="badge">Theo dõi tuyến</span>
      </PageHeader>

      <FilterBar
        filters={[
          { label: "Khu vực", value: "Tất cả" },
          { label: "Phụ trách", value: "Tất cả nhân viên" },
          { label: "Trạng thái", value: "Đang chạy hoặc cần theo dõi" }
        ]}
      />

      <CompactKpiStrip items={kpis} />

      <section className="dashboard-section">
        <div className="dashboard-section-head">
          <h2>Danh sách tuyến</h2>
          <span>{routes.length} tuyến</span>
        </div>
        <div className="mcp-line-list">
          {routes.map((route) => (
            <RouteCard key={route.id} route={route} onSelect={setSelectedRoute} />
          ))}
        </div>
      </section>

      <section className="card">
        <h2 className="panel-title">Cần xử lý</h2>
        <div className="grid">
          <div className="metric-row"><span>Tuyến cần theo dõi</span><strong>2</strong></div>
          <div className="metric-row"><span>Điểm bán chưa ghé</span><strong>9</strong></div>
          <div className="metric-row"><span>Tuyến chưa có đơn</span><strong>2</strong></div>
        </div>
      </section>

      <RouteSheet route={selectedRoute} onClose={() => setSelectedRoute(null)} />
    </AppShell>
  );
}
