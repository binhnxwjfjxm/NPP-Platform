"use client";

import { useEffect, type ReactNode } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { MCPPage } from "@/features/mcp/MCPPage";
import { McpButton, McpPageHeader, McpStatePanel } from "@/ui/foundation";
import { AppShell } from "@/ui/shell/AppShell";
import { useMcpShellSnapshot } from "@/lib/local-read/use-mcp-shell";
import { useMcpVisitDay } from "@/lib/local-read/use-mcp-visit-day";
import styles from "./RouteWorkScreen.module.css";

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

function StateScreen({ title, description, action, busy = false }: {
  title: string;
  description: string;
  action?: ReactNode;
  busy?: boolean;
}) {
  return (
    <AppShell activeHref="/visits">
      <div className={styles.page} data-primary-screen="visits">
        <McpPageHeader eyebrow="MCP Field" title="Đi tuyến" description="Mở phiên đang hoạt động và tiếp tục tác nghiệp tại điểm bán." />
        <div aria-busy={busy || undefined}>
          <McpStatePanel title={title} description={description} icon={busy ? "↻" : "◎"} action={action} />
        </div>
      </div>
    </AppShell>
  );
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
      return <StateScreen
        title="Chưa mở được dữ liệu tuyến"
        description="Vui lòng thử lại. Ứng dụng chưa thay đổi phiên hoặc tuyến khi dữ liệu chưa sẵn sàng."
        action={<McpButton variant="secondary" onClick={() => void shell.refresh()}>Tải lại</McpButton>}
      />;
    }
    return <StateScreen busy title="Đang xác định phiên đang hoạt động" description="Nếu hôm nay chỉ có một phiên đang mở, ứng dụng sẽ vào thẳng phiên đó." />;
  }

  if (!shell.snapshot || !date) {
    if (shell.loading || !shell.snapshot) {
      return <StateScreen busy title="Đang mở tuyến từ dữ liệu đã lưu" description="Đang xác định phiên gần nhất của tuyến." />;
    }
    return <StateScreen title="Chưa có phiên để mở" description="Vui lòng mở phiên từ Tuyến cố định trước khi đi tuyến." />;
  }

  if (!visit.data) {
    if (visit.loading) return <StateScreen busy title="Đang mở phiên đi tuyến" description="Đang tải danh sách điểm bán và trạng thái phiên." />;
    return <StateScreen
      title="Chưa mở được phiên"
      description="Dữ liệu đã lưu chưa có phiên này. Vui lòng thử cập nhật lại."
      action={<McpButton variant="secondary" onClick={() => void visit.refresh()}>Tải lại</McpButton>}
    />;
  }

  return <MCPPage
    activeHref="/visits"
    routesData={shell.snapshot.routesData}
    mcpDayData={visit.data}
    routeCustomersData={shell.snapshot.routeCustomersData}
  />;
}
