import type { McpDayData, McpDayLine } from "@/features/mcp-day/mcp-day.types";
import { PageHeader } from "@/ui/layout/PageHeader";
import { AppShell } from "@/ui/shell/AppShell";

function sessionStatusLabel(status: string) {
  if (status === "done" || status === "completed") return "Đã chốt phiên";
  if (status === "cancelled") return "Đã hủy phiên";
  return "Đang chạy";
}

function lineStatusLabel(status: McpDayLine["status"]) {
  if (status === "pending") return "Chờ ghé";
  if (status === "visited") return "Đã ghé";
  if (status === "skipped") return "Bỏ qua / không mua";
  return "Hủy";
}

function sourceLabel(source: McpDayLine["source"]) {
  if (source === "added") return "Phát sinh";
  if (source === "synced") return "Đồng bộ";
  return "Tuyến gốc";
}

function resultSummary(line: McpDayLine) {
  const values = [
    line.hasOrder ? "Có đơn" : null,
    line.hasTest ? "Có thử sản phẩm" : null,
    line.hasReport ? "Có báo cáo" : null,
    Number(line.followupCount || 0) > 0 ? `${line.followupCount} việc theo dõi` : null
  ].filter(Boolean);

  return values.length > 0 ? values.join(" · ") : line.result || line.note || "Chưa ghi kết quả";
}

export function McpSessionReadonlyView({ activeHref = "/visits", mcpDayData }: { activeHref?: string; mcpDayData: McpDayData }) {
  const run = mcpDayData.run;
  const lockedLabel = sessionStatusLabel(run.status);
  const visitedCount = mcpDayData.lines.filter((line) => line.status === "visited").length;
  const pendingCount = mcpDayData.lines.filter((line) => line.status === "pending").length;
  const skippedCount = mcpDayData.lines.filter((line) => line.status === "skipped").length;
  const addedCount = mcpDayData.lines.filter((line) => line.source === "added").length;
  const followupCount = mcpDayData.lines.filter((line) => Number(line.followupCount || 0) > 0).length;

  return (
    <AppShell activeHref={activeHref}>
      <PageHeader eyebrow="Phiên đi tuyến" title="Phiên đi tuyến" subtitle={`Tuyến: ${run.routeName} · Ngày: ${run.date} · Phụ trách: ${run.owner}`} />

      <section className="mcp-gate-banner mcp-session-compact-head">
        <strong>{lockedLabel}</strong>
        <span>Phiên chỉ xem · {visitedCount} đã ghé · {pendingCount} chờ ghé · {skippedCount} bỏ qua · mở lúc {run.openedAt}</span>
      </section>

      <div className="mcp-status-chips" role="tablist" aria-label="Phiên đi tuyến chỉ xem">
        <button className="active" type="button">Tất cả khách <b>{mcpDayData.lines.length}</b></button>
        <button type="button">Chờ ghé <b>{pendingCount}</b></button>
        <button type="button">Đã ghé <b>{visitedCount}</b></button>
        <button type="button">Bỏ qua <b>{skippedCount}</b></button>
        <button type="button">Phát sinh <b>{addedCount}</b></button>
        <button type="button">Có việc theo dõi <b>{followupCount}</b></button>
      </div>

      <div className="mcp-line-list">
        {mcpDayData.lines.length === 0 ? <div className="empty-inline">Phiên này chưa có khách trong checklist.</div> : mcpDayData.lines.map((line) => (
          <article className="action-card" key={line.id}>
            <div>
              <span className="badge">{lineStatusLabel(line.status)}</span>
              <h3>{line.accountName}</h3>
              <p>{line.area} · {sourceLabel(line.source)} · {resultSummary(line)}</p>
            </div>
          </article>
        ))}
      </div>
    </AppShell>
  );
}
