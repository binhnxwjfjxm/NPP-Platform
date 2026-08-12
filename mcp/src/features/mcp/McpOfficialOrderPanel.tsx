"use client";

import { useEffect, useRef, useState } from "react";
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

type CustomerOnboardingLoadResult = {
  projection: CustomerOnboardingProjection;
  syncError: string | null;
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

async function loadCustomerOnboarding(sessionCustomerId: string, orderId: string): Promise<CustomerOnboardingLoadResult> {
  const projection = await getCustomerOnboarding(sessionCustomerId, orderId);
  if (!projection.coreRequestId) return { projection, syncError: null };
  try {
    return {
      projection: await syncCustomerOnboarding(sessionCustomerId, orderId),
      syncError: null
    };
  } catch (error) {
    return {
      projection,
      syncError: error instanceof Error ? error.message : "Không đồng bộ được trạng thái khách"
    };
  }
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

function stepClass(done: boolean, current: boolean) {
  if (done) return "order-intent-step is-done";
  if (current) return "order-intent-step is-current";
  return "order-intent-step is-waiting";
}

export function McpOfficialOrderPanel({
  sessionCustomerId,
  orderId,
  customerName,
  returnTo
}: {
  sessionCustomerId: string;
  orderId: string;
  customerName?: string;
  returnTo: string;
}) {
  const router = useRouter();
  const [onboarding, setOnboarding] = useState<CustomerOnboardingProjection | null>(null);
  const [salesOrder, setSalesOrder] = useState<CoreSalesOrderProjection | null>(null);
  const [loading, setLoading] = useState(true);
  const [message, setMessage] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const autoSalesOrderAttempt = useRef<string | null>(null);

  useEffect(() => {
    let active = true;
    setLoading(true);
    Promise.allSettled([
      loadCustomerOnboarding(sessionCustomerId, orderId),
      getCoreSalesOrderProjection(sessionCustomerId, orderId)
    ])
      .then(([onboardingResult, orderResult]) => {
        if (!active) return;
        if (onboardingResult.status === "fulfilled") setOnboarding(onboardingResult.value.projection);
        if (orderResult.status === "fulfilled") setSalesOrder(orderResult.value);
        const onboardingSyncError = onboardingResult.status === "fulfilled" ? onboardingResult.value.syncError : null;
        setMessage(onboardingSyncError || settledError([onboardingResult, orderResult]));
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
  const canSyncCustomer = Boolean(onboarding?.coreRequestId) && !officialCustomerReady;
  const customerCurrent = !loading && !officialCustomerReady;
  const eligibilityCurrent = !loading && officialCustomerReady && !hasSalesOrder;
  const salesOrderCurrent = !loading && hasSalesOrder;

  useEffect(() => {
    if (loading || busy || !officialCustomerReady || hasSalesOrder) return;
    const attemptKey = `${sessionCustomerId}:${orderId}:${onboarding?.coreCustomerId || "approved"}`;
    if (autoSalesOrderAttempt.current === attemptKey) return;
    autoSalesOrderAttempt.current = attemptKey;
    setBusy(true);
    setMessage(null);
    void submitCoreSalesOrder(sessionCustomerId, orderId)
      .then((projection) => {
        if (!projection.coreSalesOrderId) throw new Error("Core chưa trả về mã đơn bán hàng");
        setSalesOrder(projection);
        router.push(returnTo);
      })
      .catch((error) => {
        setMessage(error instanceof Error ? error.message : "Không tự tạo được đơn NPP");
      })
      .finally(() => setBusy(false));
  }, [loading, busy, officialCustomerReady, hasSalesOrder, sessionCustomerId, orderId, onboarding?.coreCustomerId, returnTo, router]);

  return (
    <main className="page-stack mcp-official-order-page">
      <div className="order-intent-back-row">
        <button className="button order-intent-back" type="button" onClick={() => router.push(returnTo)}>
          ← Quay lại phiên
        </button>
      </div>

      <section className="page-card order-intent-heading">
        <span className="page-eyebrow">Nhu cầu mua MCP</span>
        <h1>Đơn bán hàng NPP</h1>
        <p className="page-subtitle">{customerName || "Điểm bán"} · {onboarding?.orderCode || orderId}</p>
      </section>

      <ol className="order-intent-progress" aria-label="Tiến trình tạo đơn NPP">
        <li className={stepClass(true, false)} data-order-step="intent">
          <span className="order-intent-step-index" aria-hidden="true">1</span>
          <div>
            <small>Nhu cầu mua</small>
            <strong>Đã ghi trong MCP</strong>
          </div>
          <b>Đã xong</b>
        </li>
        <li className={stepClass(officialCustomerReady, customerCurrent || loading)} data-order-step="customer">
          <span className="order-intent-step-index" aria-hidden="true">2</span>
          <div>
            <small>Xác minh khách</small>
            <strong>{loading ? "Đang tải..." : onboardingStatusLabel(onboarding?.status)}</strong>
            {onboarding?.reviewReason ? <em>Ghi chú Core: {onboarding.reviewReason}</em> : null}
          </div>
          <b>{officialCustomerReady ? "Đã xong" : loading ? "Đang tải" : "Hiện tại"}</b>
        </li>
        <li className={stepClass(hasSalesOrder, eligibilityCurrent)} data-order-step="eligibility">
          <span className="order-intent-step-index" aria-hidden="true">3</span>
          <div>
            <small>Điều kiện tạo đơn</small>
            <strong>{officialCustomerReady ? "Đủ điều kiện" : "Chưa đủ điều kiện"}</strong>
          </div>
          <b>{hasSalesOrder ? "Đã xong" : eligibilityCurrent ? "Hiện tại" : "Chờ"}</b>
        </li>
        <li className={stepClass(false, salesOrderCurrent)} data-order-step="sales-order">
          <span className="order-intent-step-index" aria-hidden="true">4</span>
          <div>
            <small>Đơn NPP</small>
            <strong>{loading ? "Đang tải..." : coreSalesOrderStatusLabel(salesOrder?.status)}</strong>
          </div>
          <b>{salesOrderCurrent ? "Hiện tại" : "Chờ"}</b>
        </li>
      </ol>

      {hasSalesOrder ? (
        <section className="page-card order-intent-order-summary" aria-label="Thông tin đơn NPP">
          <div><span>Mã đơn</span><strong>{salesOrder?.number || salesOrder?.coreSalesOrderId}</strong></div>
          <div><span>Phiên bản</span><strong>{salesOrder?.currentVersionNumber || 1}</strong></div>
          <div><span>Tổng chính thức</span><strong>{money(salesOrder?.total)}</strong></div>
          <div><span>Tiền tệ</span><strong>{salesOrder?.currency || "VND"}</strong></div>
        </section>
      ) : null}

      <section className="page-card order-intent-next-action" aria-label="Bước xử lý tiếp theo">
        <span className="page-eyebrow">Bước tiếp theo</span>
        {loading ? <h2>Đang tải trạng thái...</h2> : null}

        {!loading && canSyncCustomer ? (
          <>
            <h2>Kiểm tra kết quả xác minh khách</h2>
            <button
              className="button primary"
              type="button"
              data-order-primary-action
              disabled={busy}
              onClick={() => run(async () => {
                const projection = await syncCustomerOnboarding(sessionCustomerId, orderId);
                setOnboarding(projection);
                setMessage(onboardingStatusLabel(projection.status));
              })}
            >
              {busy ? "Đang đồng bộ..." : "Đồng bộ trạng thái khách"}
            </button>
          </>
        ) : null}

        {!loading && !officialCustomerReady && !canSyncCustomer ? (
          <>
            <h2>Chờ xác minh khách</h2>
            <p className="page-subtitle">Gửi đề nghị xác minh từ nhu cầu mua trong phiên.</p>
          </>
        ) : null}

        {!loading && officialCustomerReady && !hasSalesOrder ? (
          <>
            <h2>{busy ? "Đang tự tạo đơn nháp NPP" : "Tạo đơn nháp NPP"}</h2>
            <button
              className="button primary"
              type="button"
              data-order-primary-action
              disabled={busy}
              onClick={() => run(async () => {
                const projection = await submitCoreSalesOrder(sessionCustomerId, orderId);
                if (!projection.coreSalesOrderId) throw new Error("Core chưa trả về mã đơn bán hàng");
                setSalesOrder(projection);
                router.push(returnTo);
              })}
            >
              {busy ? "Đang tạo..." : "Thử tạo lại đơn NPP"}
            </button>
          </>
        ) : null}

        {!loading && hasSalesOrder ? (
          <>
            <h2>{coreSalesOrderStatusLabel(salesOrder?.status)}</h2>
            <button
              className="button primary"
              type="button"
              data-order-primary-action
              disabled={busy}
              onClick={() => run(async () => {
                const projection = await syncCoreSalesOrder(sessionCustomerId, orderId);
                setSalesOrder(projection);
                setMessage(coreSalesOrderStatusLabel(projection.status));
              })}
            >
              {busy ? "Đang đồng bộ..." : "Đồng bộ đơn NPP"}
            </button>
          </>
        ) : null}
      </section>

      {message ? <p className="page-card page-subtitle order-intent-message" role="status">{message}</p> : null}
    </main>
  );
}
