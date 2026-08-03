"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { idempotentMutationFetch } from "@/lib/api/idempotent-fetch";
import {
  apiErrorMessage,
  coreSalesOrderStatusLabel,
  getCoreSalesOrderProjection,
  submitCoreSalesOrder,
  syncCoreSalesOrder,
  type CoreSalesOrderProjection
} from "./mcp-core-sales-order";

type CustomerOnboardingStatus =
  | "submitted"
  | "under_review"
  | "need_more_info"
  | "approved"
  | "linked_existing"
  | "rejected"
  | "cancelled";

type CustomerOnboardingProjection = {
  orderId: string;
  orderCode?: string | null;
  coreRequestId?: string | null;
  status?: CustomerOnboardingStatus | null;
  coreCustomerId?: string | null;
  coreCustomerAddressId?: string | null;
  reviewReason?: string | null;
  officialOrderAllowed: boolean;
};

function onboardingFromPayload(payload: unknown): CustomerOnboardingProjection {
  const data = payload && typeof payload === "object" ? (payload as { data?: unknown }).data : null;
  if (!data || typeof data !== "object") throw new Error("Core trả về trạng thái khách không hợp lệ");
  const value = data as Partial<CustomerOnboardingProjection>;
  if (!value.orderId) throw new Error("Thiếu mã nhu cầu mua");
  return { ...value, orderId: value.orderId, officialOrderAllowed: value.officialOrderAllowed === true };
}

function onboardingStatusLabel(status?: CustomerOnboardingStatus | null) {
  if (!status) return "Chưa gửi đề nghị xác minh";
  if (status === "submitted") return "Đã gửi, chờ Core tiếp nhận";
  if (status === "under_review") return "Core đang xác minh";
  if (status === "need_more_info") return "Cần bổ sung thông tin";
  if (status === "approved") return "Đã mở mã khách";
  if (status === "linked_existing") return "Đã nối với khách hiện có";
  if (status === "rejected") return "Đề nghị bị từ chối";
  return "Đề nghị đã hủy";
}

async function getCustomerOnboarding(sessionCustomerId: string, orderId: string) {
  const params = new URLSearchParams({ sessionCustomerId, orderId });
  const response = await fetch(`/api/backend/mcp-day/session-customer/customer-onboarding?${params.toString()}`, {
    cache: "no-store",
    headers: { Accept: "application/json" }
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(apiErrorMessage(payload, "Không tải được trạng thái xác minh khách"));
  return onboardingFromPayload(payload);
}

async function syncCustomerOnboarding(sessionCustomerId: string, orderId: string) {
  const response = await idempotentMutationFetch(
    "/api/backend/mcp-day/session-customer/customer-onboarding/sync",
    {
      method: "POST",
      cache: "no-store",
      headers: { Accept: "application/json", "Content-Type": "application/json" },
      body: JSON.stringify({ sessionCustomerId, orderId })
    },
    { operation: "session-customer.customer-onboarding.sync" }
  );
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(apiErrorMessage(payload, "Không đồng bộ được trạng thái khách"));
  return onboardingFromPayload(payload);
}

function money(value?: string | null) {
  const amount = Number(value || 0);
  return Number.isFinite(amount) ? `${Math.round(amount).toLocaleString("vi-VN")}đ` : "—";
}

function settledError(results: PromiseSettledResult<unknown>[]) {
  const rejected = results.find((result) => result.status === "rejected");
  if (!rejected || rejected.status !== "rejected") return null;
  return rejected.reason instanceof Error ? rejected.reason.message : "Không tải được một phần dữ liệu đơn NPP";
}

export function McpOfficialOrderPanel({
  sessionCustomerId,
  orderId,
  customerName
}: {
  sessionCustomerId: string;
  orderId: string;
  customerName?: string;
}) {
  const router = useRouter();
  const [onboarding, setOnboarding] = useState<CustomerOnboardingProjection | null>(null);
  const [salesOrder, setSalesOrder] = useState<CoreSalesOrderProjection | null>(null);
  const [loading, setLoading] = useState(true);
  const [message, setMessage] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let active = true;
    setLoading(true);
    Promise.allSettled([
      getCustomerOnboarding(sessionCustomerId, orderId),
      getCoreSalesOrderProjection(sessionCustomerId, orderId)
    ])
      .then(([onboardingResult, orderResult]) => {
        if (!active) return;
        if (onboardingResult.status === "fulfilled") setOnboarding(onboardingResult.value);
        if (orderResult.status === "fulfilled") setSalesOrder(orderResult.value);
        setMessage(settledError([onboardingResult, orderResult]));
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => { active = false; };
  }, [sessionCustomerId, orderId]);

  function run(action: () => Promise<void>) {
    if (busy) return;
    setBusy(true);
    setMessage(null);
    void action()
      .catch((error) => setMessage(error instanceof Error ? error.message : "Không xử lý được đơn NPP"))
      .finally(() => setBusy(false));
  }

  const officialCustomerReady = onboarding?.officialOrderAllowed === true;
  const hasSalesOrder = Boolean(salesOrder?.coreSalesOrderId);

  return (
    <main className="page-stack mcp-official-order-page">
      <button className="button" type="button" onClick={() => router.back()}>← Quay lại phiên</button>

      <section className="page-card">
        <span className="page-eyebrow">Nhu cầu mua MCP</span>
        <h1>Đơn bán hàng NPP</h1>
        <p className="page-subtitle">
          {customerName || "Điểm bán"} · {onboarding?.orderCode || orderId}
        </p>
        <p className="page-subtitle">
          Sản phẩm và giá chính thức do NPP Core kiểm tra. MCP không dùng danh mục sản phẩm cũ để tạo đơn này.
        </p>
      </section>

      <section className="page-card" data-onboarding-status={onboarding?.status || "not_submitted"}>
        <span className="page-eyebrow">Khách hàng chính thức</span>
        <h2>{loading ? "Đang tải..." : onboardingStatusLabel(onboarding?.status)}</h2>
        <p className="page-subtitle">
          {officialCustomerReady
            ? "Khách và địa chỉ đã được Core duyệt; đủ điều kiện tạo đơn nháp NPP."
            : "Chưa đủ điều kiện tạo đơn. Nhu cầu mua vẫn được giữ nguyên trong MCP."}
        </p>
        {onboarding?.reviewReason ? <p className="page-subtitle">Ghi chú Core: {onboarding.reviewReason}</p> : null}
        {onboarding?.coreRequestId && !officialCustomerReady ? (
          <button
            className="button primary"
            type="button"
            disabled={busy || loading}
            onClick={() => run(async () => {
              const projection = await syncCustomerOnboarding(sessionCustomerId, orderId);
              setOnboarding(projection);
              setMessage(onboardingStatusLabel(projection.status));
            })}
          >
            {busy ? "Đang đồng bộ..." : "Đồng bộ trạng thái khách"}
          </button>
        ) : null}
      </section>

      <section className="page-card" data-core-sales-order-status={salesOrder?.status || "not_created"}>
        <span className="page-eyebrow">Sales Order trong NPP</span>
        <h2>{loading ? "Đang tải..." : coreSalesOrderStatusLabel(salesOrder?.status)}</h2>
        {hasSalesOrder ? (
          <div className="summary-grid">
            <div><span>Mã đơn</span><strong>{salesOrder?.number || salesOrder?.coreSalesOrderId}</strong></div>
            <div><span>Phiên bản</span><strong>{salesOrder?.currentVersionNumber || 1}</strong></div>
            <div><span>Tổng chính thức</span><strong>{money(salesOrder?.total)}</strong></div>
            <div><span>Tiền tệ</span><strong>{salesOrder?.currency || "VND"}</strong></div>
          </div>
        ) : (
          <p className="page-subtitle">Chưa tạo đơn chính thức. Không có tác động tự động khi chỉ mở màn hình này.</p>
        )}

        {officialCustomerReady && !hasSalesOrder ? (
          <button
            className="button primary"
            type="button"
            disabled={busy || loading}
            onClick={() => run(async () => {
              const projection = await submitCoreSalesOrder(sessionCustomerId, orderId);
              setSalesOrder(projection);
              setMessage(coreSalesOrderStatusLabel(projection.status));
            })}
          >
            {busy ? "Đang tạo..." : "Tạo đơn nháp NPP"}
          </button>
        ) : null}

        {hasSalesOrder ? (
          <button
            className="button primary"
            type="button"
            disabled={busy || loading}
            onClick={() => run(async () => {
              const projection = await syncCoreSalesOrder(sessionCustomerId, orderId);
              setSalesOrder(projection);
              setMessage(coreSalesOrderStatusLabel(projection.status));
            })}
          >
            {busy ? "Đang đồng bộ..." : "Đồng bộ đơn NPP"}
          </button>
        ) : null}
      </section>

      {message ? <p className="page-card page-subtitle" role="status">{message}</p> : null}
    </main>
  );
}
