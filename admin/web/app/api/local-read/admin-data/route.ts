import { createHash } from "node:crypto";
import { NextRequest, NextResponse } from "next/server";
import { loadControlTower } from "../../../../lib/control-tower";
import { CoreApiError } from "../../../../lib/core-api";
import { loadProposals } from "../../../approvals/proposal-data";
import { loadAlertCenter } from "../../../alerts/alert-data";
import { loadLotCPresentation } from "../../../reports/report-lot-c-data";
import { normalizeReportPeriod, resolveReportRange, type ReportDomain } from "../../../reports/report-data";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Resource = "control-tower" | "proposals" | "alerts" | "reports";

const REPORT_DOMAINS = new Set<ReportDomain>(["executive", "debt", "inventory", "delivery-cod", "mcp", "people", "decisions"]);

function safePart(value: string) {
  return value.replace(/[^A-Za-z0-9._-]/g, "_") || "all";
}

function resourceName(resource: Resource, period: string, tab: ReportDomain, warehouseId: string | null) {
  const suffix = period === "Hôm nay" ? "today" : period === "7 ngày" ? "7d" : period === "Quý này" ? "quarter" : "month";
  if (resource === "proposals") return "proposals";
  if (resource === "reports") return `reports.${safePart(tab)}.${safePart(warehouseId || "all")}.${suffix}`;
  return `${resource}.${suffix}`;
}

function cursorFor(data: unknown) {
  return createHash("sha256").update(JSON.stringify(data)).digest("hex");
}

function json(body: unknown, status = 200) {
  return NextResponse.json(body, { status, headers: { "Cache-Control": "no-store" } });
}

function parseResource(value: string | null): Resource | null {
  return value === "control-tower" || value === "proposals" || value === "alerts" || value === "reports" ? value : null;
}

function parseReportDomain(value: string | null): ReportDomain {
  return REPORT_DOMAINS.has(value as ReportDomain) ? value as ReportDomain : "executive";
}

async function loadResource(resource: Resource, period: string, tab: ReportDomain, warehouseId: string | null) {
  if (resource === "proposals") return loadProposals();
  if (resource === "control-tower") return loadControlTower(resolveReportRange(normalizeReportPeriod(period)));
  if (resource === "reports") return loadLotCPresentation(tab, period, warehouseId);
  const alerts = await loadAlertCenter(period);
  if (alerts.message) {
    const forbidden = alerts.message.includes("không có quyền");
    throw new CoreApiError(
      forbidden ? "ADMIN_ALERTS_FORBIDDEN" : "ADMIN_ALERTS_UNAVAILABLE",
      alerts.message,
      forbidden ? 403 : 503,
      !forbidden,
    );
  }
  return alerts;
}

export async function GET(request: NextRequest) {
  const resource = parseResource(request.nextUrl.searchParams.get("resource"));
  if (!resource) {
    return json({ error: { code: "ADMIN_LOCAL_READ_RESOURCE_INVALID", message: "Nguồn dữ liệu không hợp lệ", retryable: false } }, 400);
  }
  const period = normalizeReportPeriod(request.nextUrl.searchParams.get("period") ?? undefined);
  const tab = parseReportDomain(request.nextUrl.searchParams.get("tab"));
  const warehouseId = request.nextUrl.searchParams.get("warehouseId")?.trim() || null;
  const currentCursor = request.nextUrl.searchParams.get("cursor")?.trim() || null;
  try {
    const data = await loadResource(resource, period, tab, warehouseId);
    const nextCursor = cursorFor(data);
    const id = resourceName(resource, period, tab, warehouseId);
    return json({ cursor: nextCursor, full: currentCursor !== nextCursor, upserts: currentCursor === nextCursor ? [] : [{ id, data }], removeIds: [] });
  } catch (error) {
    if (error instanceof CoreApiError) {
      const status = error.statusCode >= 400 && error.statusCode <= 599 ? error.statusCode : 502;
      return json({ error: { code: error.code || "ADMIN_LOCAL_READ_FAILED", message: status === 403 ? "Tài khoản hiện tại không có quyền xem dữ liệu này." : "Không thể cập nhật dữ liệu quản trị lúc này.", retryable: status !== 401 && status !== 403 } }, status);
    }
    return json({ error: { code: "ADMIN_LOCAL_READ_FAILED", message: "Không thể cập nhật dữ liệu quản trị lúc này.", retryable: true } }, 502);
  }
}
