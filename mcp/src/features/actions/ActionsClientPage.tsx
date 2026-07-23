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

function statusLabel(status: ActionStatus) {
  if (status === "todo") return "Cần làm";
  if (status === "doing") return "Đang làm";
  if (status === "done") return "Đã xong";
  return "Bị chặn";
}

function sourceLabel(source: ActionSource) {
  if (source === "session") return "Phiên MCP";
  if (source === "field_check") return "Ghi nhận / thử sản phẩm";
  if (source === "order") return "Đơn hàng";
  return "Thủ công";
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

      <section className="grid cards">
        {kpis.map((item) => (
          <KpiCard key={item.label} label={item.label} value={item.value} hint={item.hint} />
        ))}
      </section>

      <section className="hero-panel" style={{ marginTop: 18 }}>
        <div className="card">
          <h2 className="panel-title">Danh sách việc ưu tiên</h2>
          <DataTable columns={columns} rows={items} getRowKey={(row) => row.id} />
        </div>

        <div className="card">
          <h2 className="panel-title">Phân loại công việc</h2>
          <div className="grid">
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
