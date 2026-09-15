"use client";

import { useEffect } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { MCPPage } from "@/features/mcp/MCPPage";
import { PageHeader } from "@/ui/layout/PageHeader";
import { AppShell } from "@/ui/shell/AppShell";
import { useMcpShellSnapshot } from "@/lib/local-read/use-mcp-shell";
import { useMcpVisitDay } from "@/lib/local-read/use-mcp-visit-day";

const VN_TIME_ZONE = "Asia/Ho_Chi_Minh";

function cleanDate(value: string | null) {
  const date = String(value || "").slice(0, 10);
  return /^\d{4}-\d{2}-\d{2}$/.test(date) ? date : "";
}

function vnToday() {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: VN_TIME_ZONE,
    year: "numeric",
    month: "2-digit",
    day: "2-digit"
  }).formatToParts(new Date());
  const year = parts.find((item) => item.type === "year")?.value || "";
  const month = parts.find((item) => item.type === "month")?.value || "";
  const day = parts.find((item) => item.type === "day")?.value || "";
  return `${year}-${month}-${day}`;
}

function visitHref(routeId: string, date: string) {
  const query = new URLSearchParams({ routeId, date });
  return `/visits?${query.toString()}`;
}

function LoadingState({ text }: { text: string }) {
  return <AppShell activeHref="/visits">
    <PageHeader eyebrow="MCP" title="Đi tuyến" subtitle="Mở dữ liệu đã lưu trước, số liệu mới được cập nhật phía sau." />
    <section className="dashboard-section" aria-busy="true"><div className="empty-inline">{text}</div></section>
  </AppShell>;
}

export function VisitsLocalPage() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const routeId = String(searchParams.get("routeId") || "").trim();
  const requestedDate = cleanDate(searchParams.get("date"));
  const shell = useMcpShellSnapshot();
  const latestRouteSession = routeId && shell.snapshot
    ? shell.snapshot.recentSessions.sessions.find((session) => session.routeId === routeId)
    : null;
  const date = requestedDate || (routeId ? latestRouteSession?.sessionDate || "" : vnToday());
  const visit = useMcpVisitDay(routeId, date);

  useEffect(() => {
    if (routeId || !shell.snapshot || !date) return;
    const active = shell.snapshot.recentSessions.sessions.filter((session) => (
      session.sessionDate === date && session.status === "active"
    ));
    if (active.length === 1) {
      router.replace(visitHref(active[0].routeId, active[0].sessionDate), { scroll: false });
      return;
    }
    if (active.length > 1) {
      const query = new URLSearchParams({ dateFrom: date, dateTo: date, status: "active" });
      router.replace(`/mcp/sessions?${query.toString()}`, { scroll: false });
      return;
    }
    router.replace("/routes", { scroll: false });
  }, [date, routeId, router, shell.snapshot]);

  if (!routeId) {
    if (!shell.snapshot && !shell.loading) {
      return <AppShell activeHref="/visits">
        <PageHeader eyebrow="MCP" title="Đi tuyến" subtitle="Chưa đọc được dữ liệu tuyến đã lưu." />
        <section className="dashboard-section" role="alert"><div className="empty-inline"><strong>Chưa mở được dữ liệu tuyến</strong><br />Vui lòng thử lại.<div><button className="button" type="button" onClick={() => void shell.refresh()}>Tải lại</button></div></div></section>
      </AppShell>;
    }
    return <LoadingState text="Đang xác định phiên đang hoạt động..." />;
  }

  if (!shell.snapshot || !date) {
    if (shell.loading || !shell.snapshot) return <LoadingState text="Đang mở tuyến từ dữ liệu đã lưu..." />;
    return <AppShell activeHref="/visits">
      <PageHeader eyebrow="MCP" title="Đi tuyến" subtitle="Chưa xác định được phiên gần nhất của tuyến." />
      <section className="dashboard-section" role="alert"><div className="empty-inline"><strong>Chưa có phiên để mở</strong><br />Vui lòng mở phiên từ danh sách tuyến.</div></section>
    </AppShell>;
  }

  if (!visit.data) {
    if (visit.loading) return <LoadingState text="Đang mở phiên đi tuyến..." />;
    return <AppShell activeHref="/visits">
      <PageHeader eyebrow="MCP" title="Đi tuyến" subtitle="Dữ liệu đã lưu chưa có phiên này." />
      <section className="dashboard-section" role="alert"><div className="empty-inline"><strong>Chưa mở được phiên</strong><br />Vui lòng thử cập nhật lại.<div><button className="button" type="button" onClick={() => void visit.refresh()}>Tải lại</button></div></div></section>
    </AppShell>;
  }

  return <MCPPage
    activeHref="/visits"
    routesData={shell.snapshot.routesData}
    mcpDayData={visit.data}
    routeCustomersData={shell.snapshot.routeCustomersData}
  />;
}
