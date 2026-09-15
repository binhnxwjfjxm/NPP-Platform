"use client";

import { MCPPage } from "@/features/mcp/MCPPage";
import { AppShell } from "@/ui/shell/AppShell";
import { PageHeader } from "@/ui/layout/PageHeader";
import { useMcpShellSnapshot } from "@/lib/local-read/use-mcp-shell";

export function McpRoutesLocalPage() {
  const { snapshot, loading, error, refresh } = useMcpShellSnapshot();
  if (!snapshot && loading) {
    return <AppShell activeHref="/routes">
      <PageHeader eyebrow="Tuyến bán hàng" title="Tuyến và điểm bán" subtitle="Đang mở dữ liệu đã lưu và cập nhật số liệu mới." />
      <section className="dashboard-section" aria-busy="true"><div className="empty-inline">Đang tải tuyến và điểm bán...</div></section>
    </AppShell>;
  }
  if (!snapshot) {
    return <AppShell activeHref="/routes">
      <PageHeader eyebrow="Tuyến bán hàng" title="Tuyến và điểm bán" subtitle="Chưa tải được dữ liệu." />
      <section className="dashboard-section" role="alert"><div className="empty-inline"><strong>Chưa tải được tuyến và điểm bán</strong><br />Vui lòng thử lại.<div><button className="button" type="button" onClick={() => void refresh()}>Tải lại</button></div></div></section>
    </AppShell>;
  }

  return <>
    <MCPPage activeHref="/routes" routesData={snapshot.routesData} routeCustomersData={snapshot.routeCustomersData} />
    {error ? <div className="empty-inline">Đang dùng dữ liệu đã lưu; lần cập nhật gần nhất chưa thành công.</div> : null}
  </>;
}
