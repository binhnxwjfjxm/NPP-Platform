"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { BottomSheet } from "@/ui/overlay/BottomSheet";
import { useRegisterMobileAppMenu } from "@/ui/shell/MobileAppMenu";
import { idempotentMutationFetch } from "@/lib/api/idempotent-fetch";
import type { McpDayData } from "@/features/mcp-day/mcp-day.types";
import styles from "./VisitsSessionActionMenu.module.css";

type CountItem = { label: string; count: number };
type Summary = {
  session: { id: string; routeName: string; sessionDate: string; status: string };
  kpis: Array<{ label: string; value: string | number; hint: string }>;
  sections: {
    overview: Record<string, number>;
    competitors: CountItem[];
    usedProducts: CountItem[];
    opportunities: string[];
    risks: string[];
    nextActions: string[];
    observations: Array<{ id: string; customerName: string; note: string; competitors?: string[]; usedProducts?: string[] }>;
    orders: Array<{ id: string; code: string; customerName: string; status: string; total: number; note: string }>;
    tests: Array<{ id: string; customerName: string; productName: string; status: string; note: string }>;
    followups: Array<{ id: string; customerName: string; title: string; dueDate: string; status: string; priority: string; note: string }>;
    skipped: Array<{ id: string; customerName: string; reason: string }>;
  };
};

type ApiPayload = { data?: Summary; error?: string | { message?: string }; message?: string; detail?: string };
type PanelMode = "report" | "export" | null;
type ExportKind = "pdf" | "excel";

function money(value: number) {
  return `${Math.round(value || 0).toLocaleString("vi-VN")}đ`;
}

function buildQuery(mcpDayData: McpDayData) {
  const params = new URLSearchParams();
  if (mcpDayData.run.id) params.set("sessionId", mcpDayData.run.id);
  if (mcpDayData.run.routeId) params.set("routeId", mcpDayData.run.routeId);
  if (mcpDayData.run.date) params.set("date", mcpDayData.run.date);
  return params.toString();
}

function apiErrorMessage(payload: unknown, fallback: string) {
  if (!payload || typeof payload !== "object") return fallback;
  const value = payload as ApiPayload;
  if (typeof value.error === "string" && value.error.trim()) return value.error;
  if (value.error && typeof value.error === "object" && value.error.message?.trim()) return value.error.message;
  return value.detail || value.message || fallback;
}

function exportFilename(disposition: string | null, fallback: string) {
  if (!disposition) return fallback;
  const utf8 = disposition.match(/filename\*=UTF-8''([^;]+)/i)?.[1];
  if (utf8) {
    try {
      return decodeURIComponent(utf8.replace(/^"|"$/g, ""));
    } catch {
      return utf8.replace(/^"|"$/g, "");
    }
  }
  return disposition.match(/filename="([^"]+)"/i)?.[1] || disposition.match(/filename=([^;]+)/i)?.[1]?.trim() || fallback;
}

async function downloadSessionExport(url: string, fallbackFilename: string) {
  const response = await fetch(url, {
    cache: "no-store",
    headers: { Accept: "application/pdf,text/csv,application/json;q=0.8,*/*;q=0.5" }
  });
  if (!response.ok) {
    const payload = await response.json().catch(() => ({}));
    throw new Error(apiErrorMessage(payload, `Không tải được file (${response.status})`));
  }

  const blob = await response.blob();
  if (!blob.size) throw new Error("File xuất trống. Vui lòng tải lại.");

  const objectUrl = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = objectUrl;
  anchor.download = exportFilename(response.headers.get("content-disposition"), fallbackFilename);
  anchor.rel = "noopener";
  anchor.style.display = "none";
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  window.setTimeout(() => URL.revokeObjectURL(objectUrl), 1_000);
}

function CountList({ items, empty }: { items: CountItem[]; empty: string }) {
  if (!items.length) return <p className="page-subtitle">{empty}</p>;
  return <div className="grid">{items.map((item) => <div className="metric-row" key={item.label}><span>{item.label}</span><strong>{item.count}</strong></div>)}</div>;
}

function TextList({ items, empty }: { items: string[]; empty: string }) {
  if (!items.length) return <p className="page-subtitle">{empty}</p>;
  return <div className="grid">{items.map((item, index) => <div className="metric-row" key={`${item}-${index}`}><span>{item}</span></div>)}</div>;
}

function ObservationList({ items }: { items: Summary["sections"]["observations"] }) {
  if (!items.length) return <p className="page-subtitle">Chưa có quan sát khách trong phiên.</p>;
  return <div className="grid">{items.map((item) => <article className="action-card" key={item.id}><div><span className="badge">Quan sát</span><h3>{item.customerName}</h3><p className="page-subtitle">{item.note || [...(item.competitors || []), ...(item.usedProducts || [])].join(", ") || "Đã ghi quan sát"}</p></div></article>)}</div>;
}

function OrderList({ items }: { items: Summary["sections"]["orders"] }) {
  if (!items.length) return <p className="page-subtitle">Chưa có đơn trong phiên.</p>;
  return <div className="grid">{items.map((item) => <div className="metric-row" key={item.id}><span>{item.code} · {item.customerName}</span><strong>{money(item.total)}</strong></div>)}</div>;
}

function TestList({ items }: { items: Summary["sections"]["tests"] }) {
  if (!items.length) return <p className="page-subtitle">Chưa có test trong phiên.</p>;
  return <div className="grid">{items.map((item) => <div className="metric-row" key={item.id}><span>{item.customerName} · {item.productName || "Sản phẩm test"}</span><strong>{item.status || "tested"}</strong></div>)}</div>;
}

function FollowupList({ items }: { items: Summary["sections"]["followups"] }) {
  if (!items?.length) return <p className="page-subtitle">Chưa có follow-up trong phiên.</p>;
  return <div className="grid">{items.map((item) => <div className="metric-row" key={item.id}><span>{item.customerName} · {item.title}</span><strong>{item.dueDate || item.priority || item.status}</strong></div>)}</div>;
}

export function VisitsSessionReportPanel({ mcpDayData }: { mcpDayData: McpDayData }) {
  const router = useRouter();
  const closeInFlight = useRef(false);
  const [mode, setMode] = useState<PanelMode>(null);
  const [summary, setSummary] = useState<Summary | null>(null);
  const [loading, setLoading] = useState(false);
  const [closing, setClosing] = useState(false);
  const [exporting, setExporting] = useState<ExportKind | null>(null);
  const [reportError, setReportError] = useState<string | null>(null);
  const [closeError, setCloseError] = useState<string | null>(null);
  const [exportError, setExportError] = useState<string | null>(null);
  const query = useMemo(() => buildQuery(mcpDayData), [mcpDayData]);
  const reportUrl = `/api/mcp-session-report${query ? `?${query}` : ""}`;
  const checklistHref = `/api/backend/exports/mcp-sessions.csv${query ? `?${query}` : ""}`;
  const pdfHref = `/api/pdf/session-day${query ? `?${query}` : ""}`;
  const description = `${mcpDayData.run.routeName} · ${mcpDayData.run.date}`;

  useEffect(() => {
    if (mode !== "report" || summary || loading) return;
    let active = true;
    setLoading(true);
    fetch(reportUrl, { cache: "no-store", headers: { Accept: "application/json" } })
      .then(async (response) => {
        const payload = await response.json().catch(() => ({})) as ApiPayload;
        if (!response.ok) throw new Error(apiErrorMessage(payload, `report_summary_${response.status}`));
        if (active) {
          setSummary(payload.data || null);
          setReportError(null);
        }
      })
      .catch((err) => {
        if (active) setReportError(err instanceof Error ? err.message : "Không tải được BC phiên");
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, [loading, mode, reportUrl, summary]);

  const openReport = useCallback(() => {
    setSummary(null);
    setReportError(null);
    setMode("report");
  }, []);

  const openExport = useCallback(() => {
    setExportError(null);
    setMode("export");
  }, []);

  const runExport = useCallback(async (kind: ExportKind) => {
    if (exporting) return;
    setExporting(kind);
    setExportError(null);
    try {
      const routePart = mcpDayData.run.routeName.replace(/[^a-zA-Z0-9]+/g, "-").replace(/^-+|-+$/g, "").toLowerCase() || "mcp";
      const fallback = kind === "pdf"
        ? `mcp-session-report-${routePart}-${mcpDayData.run.date}.pdf`
        : `bc-phien-${routePart}-${mcpDayData.run.date}.csv`;
      await downloadSessionExport(kind === "pdf" ? pdfHref : checklistHref, fallback);
      setMode(null);
    } catch (error) {
      setExportError(error instanceof Error ? error.message : "Không tải được file báo cáo");
    } finally {
      setExporting(null);
    }
  }, [checklistHref, exporting, mcpDayData.run.date, mcpDayData.run.routeName, pdfHref]);

  const closeSession = useCallback(async () => {
    if (!mcpDayData.run.id || closing || closeInFlight.current) return false;
    if (!window.confirm("Chốt phiên và lưu BC phiên chính thức?")) return false;
    closeInFlight.current = true;
    setClosing(true);
    setCloseError(null);
    try {
      const response = await idempotentMutationFetch(
        `/api/backend/mcp-session-actions/${encodeURIComponent(mcpDayData.run.id)}`,
        {
          method: "PATCH",
          cache: "no-store",
          headers: { Accept: "application/json", "Content-Type": "application/json" },
          body: JSON.stringify({ status: "done", sessionDate: mcpDayData.run.date })
        },
        { operation: "route-session.update" }
      );
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(apiErrorMessage(payload, `Không chốt được phiên (${response.status})`));
      setSummary(null);
      setMode(null);
      router.refresh();
      return true;
    } catch (err) {
      setCloseError(err instanceof Error ? err.message : "Không chốt được phiên");
      return false;
    } finally {
      closeInFlight.current = false;
      setClosing(false);
    }
  }, [closing, mcpDayData.run.date, mcpDayData.run.id, router]);

  const menuRegistration = useMemo(() => ({
    title: "Menu phiên",
    description,
    message: closeError,
    items: [
      {
        id: "session-report",
        label: "Xem báo cáo phiên",
        description: "Tổng hợp lượt ghé, đơn hàng, test và follow-up.",
        icon: "▥",
        onSelect: openReport
      },
      {
        id: "session-export",
        label: "Xuất dữ liệu",
        description: "Tải báo cáo PDF hoặc checklist Excel.",
        icon: "⇩",
        onSelect: openExport
      },
      {
        id: "session-close",
        label: closing ? "Đang chốt phiên..." : "Chốt phiên",
        description: "Khóa phiên và lưu báo cáo chính thức.",
        icon: "✓",
        tone: "danger" as const,
        disabled: closing,
        keepOpen: true,
        onSelect: closeSession
      }
    ]
  }), [closeError, closeSession, closing, description, openExport, openReport]);

  useRegisterMobileAppMenu(menuRegistration);

  return <>
    <BottomSheet open={mode === "export"} onClose={() => { if (!exporting) setMode(null); }} title="Xuất dữ liệu phiên" description={description} footer={<div className="sheet-action-grid"><button className="button" type="button" onClick={() => setMode(null)} disabled={Boolean(exporting)}>Đóng</button></div>}>
      <div className={styles.menuList}>
        <button className={styles.exportItem} type="button" data-export-kind="pdf" onClick={() => void runExport("pdf")} disabled={Boolean(exporting)}>
          <span className={styles.menuIcon} aria-hidden="true">PDF</span>
          <span className={styles.menuCopy}><strong>{exporting === "pdf" ? "Đang tải báo cáo PDF..." : "Báo cáo phiên PDF"}</strong><small>Bản trình bày để xem, lưu hoặc gửi.</small></span>
          <span className={styles.menuChevron} aria-hidden="true">⇩</span>
        </button>
        <button className={styles.exportItem} type="button" data-export-kind="excel" onClick={() => void runExport("excel")} disabled={Boolean(exporting)}>
          <span className={styles.menuIcon} aria-hidden="true">CSV</span>
          <span className={styles.menuCopy}><strong>{exporting === "excel" ? "Đang tải checklist..." : "Checklist khách Excel (CSV)"}</strong><small>Dữ liệu chi tiết để đối soát và xử lý tiếp.</small></span>
          <span className={styles.menuChevron} aria-hidden="true">⇩</span>
        </button>
        {exportError ? <p className="page-subtitle order-message" role="alert">{exportError}</p> : null}
      </div>
    </BottomSheet>

    <BottomSheet open={mode === "report"} onClose={() => setMode(null)} title="BC phiên" description={description} footer={<div className="sheet-action-grid"><button className="button primary" type="button" onClick={() => { setSummary(null); setReportError(null); }}>Tải lại</button><button className="button" type="button" onClick={() => setMode(null)}>Đóng</button></div>}>
      {loading ? <p className="page-subtitle">Đang tổng hợp dữ liệu phiên...</p> : null}
      {reportError ? <p className="page-subtitle order-message">{reportError}</p> : null}
      {summary ? <div className="grid">
        <section className="grid cards">{summary.kpis.map((item) => <article className="card" key={item.label}><div className="card-label">{item.label}</div><div className="card-value">{item.value}</div><p className="card-hint">{item.hint}</p></article>)}</section>
        <section className="card"><h2 className="panel-title">Tổng quan phiên</h2><div className="grid"><div className="metric-row"><span>Khách kế hoạch</span><strong>{summary.sections.overview.planned}</strong></div><div className="metric-row"><span>Đã ghé / Chờ / Bỏ qua</span><strong>{summary.sections.overview.visited}/{summary.sections.overview.pending}/{summary.sections.overview.skipped}</strong></div><div className="metric-row"><span>Quan sát / Đơn / Test / Follow-up</span><strong>{summary.sections.overview.observations}/{summary.sections.overview.orders}/{summary.sections.overview.tests}/{summary.sections.overview.followups}</strong></div></div></section>
        <section className="card"><h2 className="panel-title">Đối thủ</h2><CountList items={summary.sections.competitors} empty="Chưa có dữ liệu đối thủ trong phiên." /></section>
        <section className="card"><h2 className="panel-title">Sản phẩm khách đang dùng</h2><CountList items={summary.sections.usedProducts} empty="Chưa có dữ liệu sản phẩm khách đang dùng." /></section>
        <section className="card"><h2 className="panel-title">Test</h2><TestList items={summary.sections.tests} /></section>
        <section className="card"><h2 className="panel-title">Đơn hàng</h2><OrderList items={summary.sections.orders} /></section>
        <section className="card"><h2 className="panel-title">Follow-up</h2><FollowupList items={summary.sections.followups || []} /></section>
        <section className="card"><h2 className="panel-title">Quan sát chi tiết</h2><ObservationList items={summary.sections.observations} /></section>
        <section className="card"><h2 className="panel-title">Cơ hội</h2><TextList items={summary.sections.opportunities} empty="Chưa ghi cơ hội." /></section>
        <section className="card"><h2 className="panel-title">Rủi ro</h2><TextList items={summary.sections.risks} empty="Chưa ghi rủi ro." /></section>
        <section className="card"><h2 className="panel-title">Next action</h2><TextList items={summary.sections.nextActions} empty="Chưa có next action." /></section>
      </div> : null}
    </BottomSheet>
  </>;
}
