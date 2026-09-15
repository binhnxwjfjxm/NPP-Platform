"use client";

import { useEffect, useMemo, useState } from "react";
import { AppShell } from "@/ui/shell/AppShell";
import { PageHeader } from "@/ui/layout/PageHeader";
import { McpSessionsManagerSafe } from "@/features/mcp/McpSessionsManagerSafe";
import { ExportMenu, buildExportLink } from "@/features/exports/ExportLinks";
import { useMcpShellSnapshot } from "@/lib/local-read/use-mcp-shell";
import type { McpShellSessionRow } from "@/lib/local-read/mcp-shell-types";

type Filters = { dateFrom: string; dateTo: string; routeId: string; status: string };
type SessionData = {
  sessions: McpShellSessionRow[];
  routes: Array<{ id: string; name: string }>;
  kpis: Array<{ label: string; value: string | number; hint: string }>;
};

function normalizeStatus(value: string) {
  return value === "completed" ? "done" : value;
}

function buildKpis(sessions: McpShellSessionRow[]) {
  const active = sessions.filter((item) => normalizeStatus(item.status) === "active").length;
  const done = sessions.filter((item) => normalizeStatus(item.status) === "done").length;
  const cancelled = sessions.filter((item) => normalizeStatus(item.status) === "cancelled").length;
  const planned = sessions.reduce((sum, item) => sum + Number(item.plannedCustomers || 0), 0);
  const visited = sessions.reduce((sum, item) => sum + Number(item.visitedCustomers || 0), 0);
  return [
    { label: "Phiên", value: sessions.length, hint: "Theo bộ lọc" },
    { label: "Đang chạy", value: active, hint: "Chưa chốt" },
    { label: "Đã chốt", value: done, hint: "Hoàn tất" },
    { label: "Đã ghé", value: `${visited}/${planned}`, hint: "Theo điểm bán trong phiên" },
    { label: "Đã hủy", value: cancelled, hint: "Không tiếp tục" }
  ];
}

function filterSessions(sessions: McpShellSessionRow[], filters: Filters) {
  return sessions.filter((item) => {
    if (filters.dateFrom && item.sessionDate < filters.dateFrom) return false;
    if (filters.dateTo && item.sessionDate > filters.dateTo) return false;
    if (filters.routeId && item.routeId !== filters.routeId) return false;
    if (filters.status && normalizeStatus(item.status) !== filters.status) return false;
    return true;
  });
}

function cutoffDate(generatedAt: string, days: number) {
  const date = new Date(generatedAt);
  if (Number.isNaN(date.getTime())) return "";
  date.setUTCDate(date.getUTCDate() - Math.max(1, days));
  return date.toISOString().slice(0, 10);
}

export function McpSessionsLocalPage({ filters }: { filters: Filters }) {
  const { snapshot, loading, error, refresh } = useMcpShellSnapshot();
  const [extendedData, setExtendedData] = useState<SessionData | null>(null);
  const [extendedLoading, setExtendedLoading] = useState(false);
  const [extendedError, setExtendedError] = useState(false);

  const cachedCutoff = snapshot ? cutoffDate(snapshot.generatedAt, snapshot.recentSessions.days) : "";
  const needsExtendedRange = Boolean(snapshot && filters.dateFrom && cachedCutoff && filters.dateFrom < cachedCutoff);

  useEffect(() => {
    if (!needsExtendedRange) {
      setExtendedData(null);
      setExtendedError(false);
      return;
    }
    let active = true;
    const run = async () => {
      setExtendedLoading(true);
      setExtendedError(false);
      const query = new URLSearchParams();
      if (filters.dateFrom) query.set("dateFrom", filters.dateFrom);
      if (filters.dateTo) query.set("dateTo", filters.dateTo);
      if (filters.routeId) query.set("routeId", filters.routeId);
      if (filters.status) query.set("status", filters.status);
      try {
        const response = await fetch(`/api/mcp-sessions?${query.toString()}`, { cache: "no-store", headers: { Accept: "application/json" } });
        const payload = await response.json().catch(() => null) as { data?: SessionData } | null;
        if (!response.ok || !payload?.data) throw new Error("session_range_unavailable");
        if (active) setExtendedData(payload.data);
      } catch {
        if (active) setExtendedError(true);
      } finally {
        if (active) setExtendedLoading(false);
      }
    };
    void run();
    return () => { active = false; };
  }, [filters.dateFrom, filters.dateTo, filters.routeId, filters.status, needsExtendedRange]);

  const cachedData = useMemo<SessionData | null>(() => {
    if (!snapshot) return null;
    const sessions = filterSessions(snapshot.recentSessions.sessions, filters);
    return { sessions, routes: snapshot.recentSessions.routes, kpis: buildKpis(sessions) };
  }, [filters, snapshot]);

  const data = needsExtendedRange ? extendedData : cachedData;
  const query = new URLSearchParams();
  if (filters.routeId) query.set("routeId", filters.routeId);
  if (filters.status) query.set("visitStatus", filters.status);
  const suffix = query.toString() ? `?${query.toString()}` : "";

  if (!snapshot && loading) {
    return <AppShell activeHref="/mcp/sessions"><PageHeader eyebrow="MCP" title="Phiên chạy tuyến" subtitle="Đang mở các phiên gần đây từ dữ liệu đã lưu." /><section className="dashboard-section" aria-busy="true"><div className="empty-inline">Đang tải phiên gần đây...</div></section></AppShell>;
  }
  if (!snapshot) {
    return <AppShell activeHref="/mcp/sessions"><PageHeader eyebrow="MCP" title="Phiên chạy tuyến" subtitle="Chưa tải được dữ liệu phiên." /><section className="dashboard-section" role="alert"><div className="empty-inline"><strong>Chưa tải được dữ liệu</strong><br />Vui lòng thử lại.<div><button className="button" type="button" onClick={() => void refresh()}>Tải lại</button></div></div></section></AppShell>;
  }

  return <AppShell activeHref="/mcp/sessions">
    <div className="mcp-sessions-page">
      <PageHeader eyebrow="MCP" title="Phiên chạy tuyến" subtitle="Tra cứu các phiên đi tuyến theo ngày, tuyến và trạng thái.">
        <span className="badge">{needsExtendedRange ? "Đang đọc khoảng thời gian mở rộng" : "Mở nhanh từ dữ liệu gần đây"}</span>
        <ExportMenu label="Xuất danh sách" primary groups={[{ title: "Excel theo bộ lọc", links: [buildExportLink("Danh sách điểm bán trong phiên", `/api/backend/exports/mcp-sessions.csv${suffix}`, "primary", "Theo tuyến/trạng thái đang lọc"), buildExportLink("Đơn hàng", "/api/backend/exports/orders.csv"), buildExportLink("Báo cáo thị trường", "/api/backend/exports/market-reports.csv"), buildExportLink("Việc cần theo dõi", "/api/backend/exports/followups.csv")] }]} />
      </PageHeader>
      {extendedLoading ? <div className="empty-inline">Đang tải khoảng thời gian cũ hơn...</div> : null}
      {data ? <McpSessionsManagerSafe data={data} filters={filters} /> : null}
      {extendedError ? <div className="empty-inline" role="alert">Chưa tải được khoảng thời gian cũ hơn. Dữ liệu gần đây vẫn được giữ trên thiết bị.</div> : null}
      {error && !needsExtendedRange ? <div className="empty-inline">Đang dùng dữ liệu đã lưu; lần cập nhật gần nhất chưa thành công.</div> : null}
    </div>
  </AppShell>;
}
