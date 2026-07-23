// src/features/mcp/VisitsExportMenu.tsx
"use client";

import { useEffect, useRef, useState } from "react";

import type { McpDayData } from "@/features/mcp-day/mcp-day.types";

type VisitsExportMenuProps = {
  mcpDayData: McpDayData;
  variant?: "fixed" | "inline";
};

export function VisitsExportMenu({ mcpDayData, variant = "fixed" }: VisitsExportMenuProps) {
  const run = mcpDayData.run;
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement | null>(null);
  const params = new URLSearchParams();

  if (run.id) params.set("sessionId", run.id);
  if (run.routeId) params.set("routeId", run.routeId);
  if (run.date) params.set("date", run.date);

  const query = params.toString();
  const checklistHref = `/api/backend/exports/mcp-sessions.csv${query ? `?${query}` : ""}`;
  const pdfHref = `/api/pdf/session-day${query ? `?${query}` : ""}`;

  useEffect(() => {
    function handlePointerDown(event: MouseEvent) {
      if (!rootRef.current?.contains(event.target as Node)) setOpen(false);
    }

    function handleEscape(event: KeyboardEvent) {
      if (event.key === "Escape") setOpen(false);
    }

    document.addEventListener("mousedown", handlePointerDown);
    document.addEventListener("keydown", handleEscape);

    return () => {
      document.removeEventListener("mousedown", handlePointerDown);
      document.removeEventListener("keydown", handleEscape);
    };
  }, []);

  const shellStyle = variant === "fixed" ? {
    position: "fixed",
    right: 14,
    top: 74,
    zIndex: 90
  } as const : {
    position: "relative"
  } as const;

  const triggerStyle = {
    display: "inline-flex",
    alignItems: "center",
    gap: 7,
    minHeight: 34,
    border: "1px solid rgba(22, 163, 74, 0.20)",
    borderRadius: 999,
    background: "rgba(240, 253, 244, 0.96)",
    color: "#166534",
    fontSize: 13,
    fontWeight: 800,
    lineHeight: 1,
    padding: "0 12px",
    boxShadow: open
      ? "0 10px 24px rgba(22, 163, 74, 0.14)"
      : "0 6px 16px rgba(15, 23, 42, 0.08)",
    backdropFilter: "blur(10px)",
    cursor: "pointer"
  } as const;

  const panelStyle = {
    position: "absolute",
    top: 40,
    right: 0,
    width: 188,
    padding: 8,
    border: "1px solid rgba(22, 163, 74, 0.14)",
    borderRadius: 14,
    background: "rgba(255, 255, 255, 0.98)",
    boxShadow: "0 16px 34px rgba(15, 23, 42, 0.14)",
    backdropFilter: "blur(12px)"
  } as const;

  const itemStyle = {
    display: "flex",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 10,
    minHeight: 40,
    borderRadius: 10,
    padding: "0 10px",
    color: "#0f172a",
    textDecoration: "none",
    fontSize: 13,
    fontWeight: 700,
    background: "#f8fafc",
    border: "1px solid rgba(148, 163, 184, 0.16)"
  } as const;

  const hintStyle = {
    display: "block",
    color: "#64748b",
    fontSize: 11,
    fontWeight: 600,
    marginTop: 2
  } as const;

  return (
    <div ref={rootRef} style={shellStyle}>
      <button
        aria-expanded={open}
        aria-haspopup="menu"
        aria-label="Xuất dữ liệu phiên MCP"
        onClick={() => setOpen((value) => !value)}
        style={triggerStyle}
        type="button"
      >
        <span>⇩ Xuất</span>
        <span style={{ fontSize: 11 }}>{open ? "▲" : "▼"}</span>
      </button>

      {open ? (
        <div role="menu" style={panelStyle}>
          <a
            href={pdfHref}
            onClick={() => setOpen(false)}
            role="menuitem"
            style={itemStyle}
          >
            <span>
              PDF
              <span style={hintStyle}>Báo cáo phiên</span>
            </span>
            <span style={{ color: "#16a34a", fontSize: 12 }}>↗</span>
          </a>

          <a
            href={checklistHref}
            onClick={() => setOpen(false)}
            role="menuitem"
            style={{ ...itemStyle, marginTop: 6 }}
          >
            <span>
              Excel
              <span style={hintStyle}>Checklist khách</span>
            </span>
            <span style={{ color: "#16a34a", fontSize: 12 }}>↗</span>
          </a>
        </div>
      ) : null}
    </div>
  );
}
