"use client";

import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import type { RoutesData } from "@/features/routes/routes.types";

export function RouteCustomerExportMenu({ routesData }: { routesData: RoutesData }) {
  const [routeId, setRouteId] = useState(routesData.routes[0]?.id || "");
  const [host, setHost] = useState<HTMLElement | null>(null);
  const param = encodeURIComponent(routeId);

  useEffect(() => {
    setHost(document.querySelector<HTMLElement>("[data-app-top-bar-tools]"));
  }, []);

  if (!host) return null;

  return createPortal(
    <details style={{ position: "relative" }}>
      <summary
        aria-label="Mở xuất dữ liệu tuyến"
        title="Xuất dữ liệu tuyến"
        style={{
          display: "grid",
          placeItems: "center",
          width: 40,
          height: 40,
          border: "1px solid rgba(255,255,255,.24)",
          borderRadius: 13,
          background: "rgba(255,255,255,.12)",
          color: "var(--npp-color-on-header)",
          cursor: "pointer",
          fontSize: 20,
          listStyle: "none",
          WebkitTapHighlightColor: "transparent"
        }}
      >
        <span aria-hidden="true">⇩</span>
      </summary>
      <div
        style={{
          position: "absolute",
          top: "calc(100% + 10px)",
          right: 0,
          zIndex: 90,
          display: "grid",
          gap: 10,
          width: "min(320px, calc(100vw - 24px))",
          padding: 12,
          border: "1px solid var(--line)",
          borderRadius: 16,
          background: "var(--panel)",
          color: "var(--text)",
          boxShadow: "var(--npp-shadow-raised)"
        }}
      >
        <label className="form-field">
          <small>Chọn tuyến</small>
          <select value={routeId} onChange={(event) => setRouteId(event.target.value)}>
            {routesData.routes.map((route) => <option key={route.id} value={route.id}>{route.name}</option>)}
          </select>
        </label>
        <a className="button primary" href={`/api/backend/exports/route-customers.csv?routeId=${param}&active=true`} target="_blank" rel="noreferrer">Xuất khách tuyến</a>
        <a className="button" href={`/api/backend/exports/route-customers-needs-gps.csv?routeId=${param}`} target="_blank" rel="noreferrer">Xuất khách cần GPS</a>
      </div>
    </details>,
    host
  );
}
