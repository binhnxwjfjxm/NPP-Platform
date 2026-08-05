"use client";

import { useMemo, useState } from "react";
import { KpiCard } from "@/ui/cards/KpiCard";
import { FilterBar } from "@/ui/layout/FilterBar";
import { PageHeader } from "@/ui/layout/PageHeader";
import { BottomSheet } from "@/ui/overlay/BottomSheet";
import { AppShell } from "@/ui/shell/AppShell";
import { DataTable, type DataTableColumn } from "@/ui/table/DataTable";
import type { ActionItem, ActionKpi, ActionPriority, ActionSource, ActionStatus } from "./actions.types";

function priorityLabel(priority: ActionPriority) {
  if (priority === "high") return "Cao";
  if (priority === "medium") return "Vừa";
  return "Thấp";
}

function priorityClass(priority: ActionPriority) {
  if (priority === "high") return "summary-priority-high";
  if (priority === "medium") return "summary-priority-medium";
  return "summary-priority-low";
}

function statusLabel(status: ActionStatus) {
  if (status === "todo") return "Cần làm";
  if (status === "doing") return "Đang làm";
  if (status === "done") return "Đã xong";
  return "Bị chặn";
}

function statusClass(status: ActionStatus) {
  if (status === "done") return "summary-status-good";
  if (status === "doing") return "summary-status-watch";
  if (status === "blocked") return "summary-status-risk";
  return "summary-status-muted";
}

function sourceLabel(source: ActionSource) {
  if (source === "session") return "Phiên MCP";
  if (source === "field_check") return "Ghi nhận / thử sản phẩm";
  if (source === "order") return "Đơn hàng";
  return "Thủ công";
}

function normalizedDateKey(value: string) {
  const raw = value.trim();
  const iso = raw.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (iso) return `${iso[1]}-${iso[2]}-${iso[3]}`;
  const vi = raw.match(/^(\d{1,2})[\/-](\d{1,2})[\/-](\d{4})/);
  if (!vi) return null;
  return `${vi[3]}-${vi[2].padStart(2, "0")}-${vi[1].padStart(2, "0")}`;
}

function vietnamTodayKey() {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Ho_Chi_Minh",
    year: "numeric",
    month: "2-digit",
    day: "2-digit"
  }).formatToParts(new Date());
  const values = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return `${values.year}-${values.month}-${values.day}`;
}

function isOverdue(item: ActionItem) {
  if (item.status === "done") return false;
  const dueKey = normalizedDateKey(item.dueDate);
  return Boolean(dueKey && dueKey < vietnamTodayKey());
}

function buildColumns(onSelect: (item: ActionItem) => void): DataTableColumn<ActionItem>[] {
  return [
    { key: "title", header: "Việc cần làm", render: (row) => row.title },
    { key: "accountName", header: "Điểm bán", render: (row) => row.accountName },
    { key: "routeName", header: "Tuyến", render: (row) => row.routeName },
    { key: "owner", header: "Phụ trách", render: (row) => row.owner },
    { key: "source", header: "Nguồn", render: (row) => <span className="badge">{sourceLabel(row.source)}</span> },
    { key: "priority", header: "Ưu tiên", render: (row) => <span className="badge">{priorityLabel(row.priority)}</span> },
    { key: "status", header: "Trạng thái", render: (row) => <span className="badge">{statusLabel(row.status)}</span> },
    { key: "dueDate", header: "Hạn", render: (row) => row.dueDate },
    { key: "detail", header: "", render: (row) => <button className="button compact" type="button" onClick={() => onSelect(row)}>Xem</button> }
  ];
}

function ActionMobileCard({ item, onSelect }: { item: ActionItem; onSelect: (item: ActionItem) => void }) {
  const overdue = isOverdue(item);

  return (
    <article className={`mobile-summary-card plan-mobile-summary${overdue ? " is-overdue" : ""}`} data-plan-mobile-card>
      <div className="mobile-summary-chip-row">
        <span className={`mobile-summary-priority ${priorityClass(item.priority)}`}>Ưu tiên {priorityLabel(item.priority)}</span>
        <span className={`mobile-summary-status ${statusClass(item.status)}`}>{statusLabel(item.status)}</span>
      </div>

      <div className="mobile-summary-title plan-mobile-title">
        <span>{item.accountName}</span>
        <h3>{item.title}</h3>
      </div>

      <div className="mobile-summary-decision-row plan-mobile-decision-row">
        <span className={overdue ? "mobile-summary-due is-overdue" : "mobile-summary-due"}>
          <small>{overdue ? "Quá hạn" : "Hạn xử lý"}</small>
          <strong>{item.dueDate || "Chưa đặt hạn"}</strong>
        </span>
        <button
          className="button compact mobile-summary-action"
          type="button"
          aria-label={`Mở chi tiết việc ${item.title}`}
          onClick={() => onSelect(item)}
        >
          Xem chi tiết
        </button>
      </div>
    </article>
  );
}

function ActionDetailSheet({ item, onClose }: { item: ActionItem | null; onClose: () => void }) {
  return (
    <BottomSheet
      open={Boolean(item)}
      onClose={onClose}
      title={item ? item.title : "Chi tiết việc"}
      description={item ? `${item.accountName} · ${item.routeName}` : undefined}
      footer={<div className="sheet-action-grid"><button className="button" type="button" onClick={onClose}>Đóng</button></div>}
    >
      {item ? (
        <div className="plan-sheet-content">
          <div className="plan-focus-card">
            <span>Trạng thái</span>
            <strong>{statusLabel(item.status)}</strong>
            <small>{sourceLabel(item.source)} · Ưu tiên {priorityLabel(item.priority)}</small>
          </div>

          <div className="grid">
            <div className="metric-row"><span>Phụ trách</span><strong>{item.owner}</strong></div>
            <div className="metric-row"><span>Hạn xử lý</span><strong>{item.dueDate}</strong></div>
            <div className="metric-row"><span>Điểm bán</span><strong>{item.accountName}</strong></div>
            <div className="metric-row"><span>Tuyến</span><strong>{item.routeName}</strong></div>
            <div className="metric-row"><span>Nguồn</span><strong>{sourceLabel(item.source)}</strong></div>
          </div>

          <div className="sheet-note-card">
            <h3>Ghi chú xử lý</h3>
            <p>{item.note}</p>
          </div>
        </div>
      ) : null}
    </BottomSheet>
  );
}

export function ActionsClientPage({ kpis, items }: { kpis: ActionKpi[]; items: ActionItem[] }) {
  const [selectedItem, setSelectedItem] = useState<ActionItem | null>(null);
  const columns = useMemo(() => buildColumns(setSelectedItem), []);
  const sourceStats = useMemo(() => {
    return {
      session: items.filter((item) => item.source === "session").length,
      order: items.filter((item) => item.source === "order").length,
      fieldCheck: items.filter((item) => item.source === "field_check").length,
      manual: items.filter((item) => item.source === "manual").length
    };
  }, [items]);

  return (
    <AppShell activeHref="/plans">
      <PageHeader
        eyebrow="MCP-Plan"
        title="Kế hoạch hành động"
        subtitle="Theo dõi việc cần làm theo người phụ trách, ưu tiên, hạn xử lý và nguồn phát sinh."
      >
        <span className="badge">Cần xử lý</span>
      </PageHeader>

      <FilterBar
        filters={[
          { label: "Nguồn", value: "Tất cả" },
          { label: "Ưu tiên", value: "Tất cả" },
          { label: "Trạng thái", value: "Cần xử lý" }
        ]}
      />

      <section className="grid cards route-kpi-grid">
        {kpis.map((item) => (
          <KpiCard key={item.label} label={item.label} value={item.value} hint={item.hint} />
        ))}
      </section>

      <section className="hero-panel route-list-layout">
        <div className="card route-list-card">
          <div className="route-list-heading">
            <h2 className="panel-title">Danh sách việc ưu tiên</h2>
            <span>{items.length} việc</span>
          </div>

          <div className="route-desktop-table">
            <DataTable columns={columns} rows={items} getRowKey={(row) => row.id} />
          </div>

          <div className="route-mobile-list" aria-label="Danh sách kế hoạch trên điện thoại">
            {items.length ? items.map((item) => <ActionMobileCard item={item} key={item.id} onSelect={setSelectedItem} />) : <div className="empty-inline">Chưa có việc cần làm</div>}
          </div>
        </div>

        <div className="card route-secondary-card">
          <h2 className="panel-title">Phân loại công việc</h2>
          <div className="grid route-secondary-grid">
            <div className="metric-row"><span>Phiên MCP</span><strong>{sourceStats.session}</strong></div>
            <div className="metric-row"><span>Đơn hàng</span><strong>{sourceStats.order}</strong></div>
            <div className="metric-row"><span>Ghi nhận / thử sản phẩm</span><strong>{sourceStats.fieldCheck}</strong></div>
            <div className="metric-row"><span>Thủ công</span><strong>{sourceStats.manual}</strong></div>
          </div>
        </div>
      </section>

      <ActionDetailSheet item={selectedItem} onClose={() => setSelectedItem(null)} />
    </AppShell>
  );
}
