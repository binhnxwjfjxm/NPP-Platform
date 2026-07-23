import { KpiCard } from "@/ui/cards/KpiCard";
import { FilterBar } from "@/ui/layout/FilterBar";
import { PageHeader } from "@/ui/layout/PageHeader";
import { AppShell } from "@/ui/shell/AppShell";
import { DataTable, type DataTableColumn } from "@/ui/table/DataTable";
import { fieldActivitiesMock } from "./field-activities.mock";
import type { ActivityStatus, FieldActivityItem } from "./field-activities.types";

function getStatusLabel(status: ActivityStatus) {
  if (status === "completed") return "Hoan thanh";
  if (status === "follow_up") return "Can theo doi";
  return "Bo lo";
}

function formatDuration(minutes: number) {
  if (minutes === 0) return "-";
  return `${minutes} phut`;
}

const columns: DataTableColumn<FieldActivityItem>[] = [
  { key: "date", header: "Ngay", render: (row) => row.date },
  { key: "routeName", header: "Tuyen", render: (row) => row.routeName },
  { key: "accountName", header: "Diem ban", render: (row) => row.accountName },
  { key: "owner", header: "Phu trach", render: (row) => row.owner },
  { key: "startTime", header: "Gio", render: (row) => row.startTime },
  { key: "durationMinutes", header: "Thoi luong", render: (row) => formatDuration(row.durationMinutes), align: "right" },
  { key: "outcome", header: "Ket qua", render: (row) => row.outcome },
  { key: "hasOrder", header: "Don", render: (row) => (row.hasOrder ? "Co" : "Khong"), align: "center" },
  { key: "status", header: "Trang thai", render: (row) => <span className="badge">{getStatusLabel(row.status)}</span> }
];

export function FieldActivitiesPage() {
  return (
    <AppShell activeHref="/visits">
      <PageHeader
        eyebrow="Visits"
        title="Luot ghe / cham soc diem ban"
        subtitle="Theo doi luot ghe tren tuyen bang mock data. Sau nay thay bang API ma khong sua UI."
      >
        <span className="badge">Mock data</span>
      </PageHeader>

      <FilterBar
        filters={[
          { label: "Ngay", value: "Hom nay" },
          { label: "Tuyen", value: "Tat ca" },
          { label: "Trang thai", value: "Tat ca" }
        ]}
      />

      <section className="grid cards">
        {fieldActivitiesMock.kpis.map((item) => (
          <KpiCard key={item.label} label={item.label} value={item.value} hint={item.hint} />
        ))}
      </section>

      <section className="hero-panel" style={{ marginTop: 18 }}>
        <div className="card">
          <h2 className="panel-title">Danh sach luot ghe</h2>
          <DataTable columns={columns} rows={fieldActivitiesMock.activities} getRowKey={(row) => row.id} />
        </div>

        <div className="card">
          <h2 className="panel-title">Can xu ly</h2>
          <div className="grid">
            <div className="metric-row"><span>Can theo doi</span><strong>2</strong></div>
            <div className="metric-row"><span>Bo lo</span><strong>1</strong></div>
            <div className="metric-row"><span>Co don</span><strong>2</strong></div>
            <div className="metric-row"><span>Trung binh</span><strong>19 phut</strong></div>
          </div>
        </div>
      </section>
    </AppShell>
  );
}
