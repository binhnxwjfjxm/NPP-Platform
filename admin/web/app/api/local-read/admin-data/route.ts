import { createHash } from "node:crypto";
import { NextRequest, NextResponse } from "next/server";
import { loadControlTower } from "../../../../lib/control-tower";
import { CoreApiError } from "../../../../lib/core-api";
import { loadProposals } from "../../../approvals/proposal-data";
import { loadAlertCenter } from "../../../alerts/alert-data";
import { normalizeReportPeriod, resolveReportRange } from "../../../reports/report-data";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Resource = "control-tower" | "proposals" | "alerts";

function resourceName(resource: Resource, period: string) {
  if (resource === "proposals") return "proposals";
  const suffix = period === "Hôm nay" ? "today" : period === "7 ngày" ? "7d" : period === "Quý này" ? "quarter" : "month";
  return `${resource}.${suffix}`;
}

function cursorFor(data: unknown) {
  return createHash("sha256").update(JSON.stringify(data)).digest("hex");
}

function json(body: unknown, status = 200) {
  return NextResponse.json(body, { status, headers: { "Cache-Control": "no-store" } });
}

function parseResource(value: string | null): Resource | null {
  return value === "control-tower" || value === "proposals" || value === "alerts" ? value : null;
}

async function loadResource(resource: Resource, period: string) {
  if (resource === "proposals") return loadProposals();
  if (resource === "control-tower") return loadControlTower(resolveReportRange(normalizeReportPeriod(period)));

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
  const currentCursor = request.nextUrl.searchParams.get("cursor")?.trim() || null;

  try {
    const data = await loadResource(resource, period);
    const nextCursor = cursorFor(data);
    const id = resourceName(resource, period);
    return json({
      cursor: nextCursor,
      full: currentCursor !== nextCursor,
      upserts: currentCursor === nextCursor ? [] : [{ id, data }],
      removeIds: [],
    });
  } catch (error) {
    if (error instanceof CoreApiError) {
      const status = error.statusCode >= 400 && error.statusCode <= 599 ? error.statusCode : 502;
      return json({
        error: {
          code: error.code || "ADMIN_LOCAL_READ_FAILED",
          message: status === 403 ? "Tài khoản hiện tại không có quyền xem dữ liệu này." : "Không thể cập nhật dữ liệu quản trị lúc này.",
          retryable: status !== 401 && status !== 403,
        },
      }, status);
    }
    return json({ error: { code: "ADMIN_LOCAL_READ_FAILED", message: "Không thể cập nhật dữ liệu quản trị lúc này.", retryable: true } }, 502);
  }
}
