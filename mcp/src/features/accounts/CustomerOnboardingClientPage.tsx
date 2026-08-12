"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { idempotentMutationFetch } from "@/lib/api/idempotent-fetch";
import { PageHeader } from "@/ui/layout/PageHeader";
import { AppShell } from "@/ui/shell/AppShell";
import type {
  CustomerOnboardingQueueItem,
  CustomerOnboardingQueueStatus
} from "./customer-onboarding.types";

type QueueFilter = "all" | "not_submitted" | "processing" | "ready" | "attention";
type OnboardingMutation = "submit" | "sync";

type MutationPayload = {
  data?: {
    status?: string | null;
    coreRequestId?: string | null;
  };
  error?: string | { message?: string };
  detail?: string;
  message?: string;
};

const PROCESSING_STATUSES = new Set<CustomerOnboardingQueueStatus>([
  "submitted",
  "under_review",
  "need_more_info"
]);
const READY_STATUSES = new Set<CustomerOnboardingQueueStatus>(["approved", "linked_existing"]);
const ATTENTION_STATUSES = new Set<CustomerOnboardingQueueStatus>(["rejected", "cancelled"]);

function apiErrorMessage(payload: MutationPayload, fallback: string) {
  if (typeof payload.error === "string" && payload.error.trim()) return payload.error;
  if (payload.error && typeof payload.error === "object" && payload.error.message?.trim()) return payload.error.message;
  return payload.detail || payload.message || fallback;
}

function statusLabel(status: CustomerOnboardingQueueStatus) {
  if (status === "not_submitted") return "Chưa gửi Core";
  if (status === "submitted") return "Đã gửi, chờ Core";
  if (status === "under_review") return "Core đang xác minh";
  if (status === "need_more_info") return "Cần bổ sung";
  if (status === "approved") return "Đã mở mã khách";
  if (status === "linked_existing") return "Đã liên kết khách";
  if (status === "rejected") return "Bị từ chối";
  return "Đã hủy";
}

function statusClass(status: CustomerOnboardingQueueStatus) {
  if (READY_STATUSES.has(status)) return "summary-status-good";
  if (status === "not_submitted" || PROCESSING_STATUSES.has(status)) return "summary-status-watch";
  return "summary-status-muted";
}

function matchesFilter(status: CustomerOnboardingQueueStatus, filter: QueueFilter) {
  if (filter === "all") return true;
  if (filter === "not_submitted") return status === "not_submitted";
  if (filter === "processing") return PROCESSING_STATUSES.has(status);
  if (filter === "ready") return READY_STATUSES.has(status);
  return ATTENTION_STATUSES.has(status);
}

function visitHref(item: CustomerOnboardingQueueItem) {
  if (!item.routeId || !item.sessionDate) return null;
  const query = new URLSearchParams({ routeId: item.routeId, date: item.sessionDate });
  return `/visits?${query.toString()}`;
}

function officialOrderHref(item: CustomerOnboardingQueueItem) {
  if (!READY_STATUSES.has(item.status)) return null;
  const returnTo = visitHref(item) || "/visits";
  const query = new URLSearchParams({
    sessionCustomerId: item.sessionCustomerId,
    orderId: item.orderId,
    customerName: item.customerName,
    returnTo
  });
  return `/visits/order-intent?${query.toString()}`;
}

function compactDate(value: string | null) {
  if (!value) return "-";
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return value.slice(0, 10);
  return new Intl.DateTimeFormat("vi-VN", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
    timeZone: "Asia/Ho_Chi_Minh"
  }).format(parsed);
}

export function CustomerOnboardingClientPage({ items }: { items: CustomerOnboardingQueueItem[] }) {
  const [filter, setFilter] = useState<QueueFilter>("all");
  const [busyKey, setBusyKey] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const router = useRouter();

  const counts = useMemo(() => ({
    all: items.length,
    notSubmitted: items.filter((item) => item.status === "not_submitted").length,
    processing: items.filter((item) => PROCESSING_STATUSES.has(item.status)).length,
    ready: items.filter((item) => READY_STATUSES.has(item.status)).length,
    attention: items.filter((item) => ATTENTION_STATUSES.has(item.status)).length
  }), [items]);
  const visibleItems = useMemo(
    () => items.filter((item) => matchesFilter(item.status, filter)),
    [items, filter]
  );

  async function mutate(item: CustomerOnboardingQueueItem, mutation: OnboardingMutation) {
    const key = `${item.orderId}:${mutation}`;
    if (busyKey) return;
    setBusyKey(key);
    setNotice(null);
    try {
      const path = `/api/backend/mcp-day/session-customer/customer-onboarding/${mutation}`;
      const operation = mutation === "submit"
        ? "session-customer.customer-onboarding.submit"
        : "session-customer.customer-onboarding.sync";
      const response = await idempotentMutationFetch(
        path,
        {
          method: "POST",
          cache: "no-store",
          headers: { Accept: "application/json", "Content-Type": "application/json" },
          body: JSON.stringify({ sessionCustomerId: item.sessionCustomerId, orderId: item.orderId })
        },
        { operation }
      );
      const payload = await response.json().catch(() => ({})) as MutationPayload;
      if (!response.ok) {
        throw new Error(apiErrorMessage(payload, mutation === "submit" ? "Không gửi được đề nghị mở mã" : "Không đồng bộ được trạng thái Core"));
      }
      setNotice(`${item.customerName}: ${statusLabel((payload.data?.status || item.status) as CustomerOnboardingQueueStatus)}.`);
      router.refresh();
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "Không xử lý được đề nghị mở / liên kết mã khách");
    } finally {
      setBusyKey(null);
    }
  }

  return (
    <AppShell activeHref="/customers/onboarding">
      <PageHeader
        eyebrow="Khách hàng"
        title="Mở / liên kết mã"
        subtitle="Quản lý tập trung đề nghị từ nhu cầu mua MCP. Dùng nguyên request E3/E4 hiện có, không tạo quy trình khách hàng thứ hai."
      >
        <a className="button compact" href="/customers">Điểm bán</a>
      </PageHeader>

      <div className="mcp-status-chips" role="tablist" aria-label="Trạng thái mở và liên kết mã khách">
        <button className={filter === "all" ? "active" : ""} type="button" onClick={() => setFilter("all")}>Tất cả <b>{counts.all}</b></button>
        <button className={filter === "not_submitted" ? "active" : ""} type="button" onClick={() => setFilter("not_submitted")}>Chưa gửi <b>{counts.notSubmitted}</b></button>
        <button className={filter === "processing" ? "active" : ""} type="button" onClick={() => setFilter("processing")}>Đang xử lý <b>{counts.processing}</b></button>
        <button className={filter === "ready" ? "active" : ""} type="button" onClick={() => setFilter("ready")}>Đã mở / liên kết <b>{counts.ready}</b></button>
        <button className={filter === "attention" ? "active" : ""} type="button" onClick={() => setFilter("attention")}>Cần chú ý <b>{counts.attention}</b></button>
      </div>

      {notice ? <p className="page-subtitle order-message" role="status">{notice}</p> : null}

      <section className="card route-list-card" aria-label="Danh sách đề nghị mở hoặc liên kết mã khách">
        <div className="route-list-heading">
          <div>
            <h2 className="panel-title">Khách có nhu cầu mua</h2>
            <p className="page-subtitle">Chỉ hiện nhu cầu mua đã có trong MCP; gửi/sync tiếp tục dùng đúng sessionCustomerId + orderId hiện hữu.</p>
          </div>
          <span>{visibleItems.length}/{items.length} khách</span>
        </div>

        <div className="grid">
          {visibleItems.map((item) => {
            const actionBusy = busyKey?.startsWith(`${item.orderId}:`) === true;
            const canSubmit = Boolean(item.sessionCustomerId && item.orderId && item.address);
            const officialHref = officialOrderHref(item);
            const sessionHref = visitHref(item);
            const canSync = Boolean(item.coreRequestId);
            return (
              <article className="card" key={item.orderId} data-customer-onboarding-row>
                <div className="mobile-summary-head">
                  <div className="mobile-summary-title">
                    <span>{item.routeName || "Chưa rõ tuyến"} · {item.sessionDate || "Chưa rõ ngày"}</span>
                    <h3>{item.customerName}</h3>
                  </div>
                  <span className={`mobile-summary-status ${statusClass(item.status)}`}>{statusLabel(item.status)}</span>
                </div>

                <div className="grid">
                  <div className="metric-row"><span>Nhu cầu mua</span><strong>{item.orderCode || item.orderId}</strong></div>
                  <div className="metric-row"><span>Địa chỉ</span><strong>{item.address || "Chưa có địa chỉ"}</strong></div>
                  <div className="metric-row"><span>Core request</span><strong>{item.coreRequestId || "Chưa gửi"}</strong></div>
                  <div className="metric-row"><span>Cập nhật Core</span><strong>{compactDate(item.lastSyncedAt || item.submittedAt)}</strong></div>
                  {item.reviewReason ? <div className="metric-row"><span>Phản hồi</span><strong>{item.reviewReason}</strong></div> : null}
                </div>

                <div className="sheet-action-grid">
                  {item.status === "not_submitted" ? (
                    <button
                      className="button primary compact"
                      type="button"
                      onClick={() => void mutate(item, "submit")}
                      disabled={actionBusy || !canSubmit}
                    >
                      {actionBusy ? "Đang gửi..." : "Gửi đề nghị mở / liên kết mã"}
                    </button>
                  ) : canSync && !READY_STATUSES.has(item.status) ? (
                    <button
                      className="button primary compact"
                      type="button"
                      onClick={() => void mutate(item, "sync")}
                      disabled={actionBusy}
                    >
                      {actionBusy ? "Đang đồng bộ..." : "Đồng bộ Core"}
                    </button>
                  ) : null}
                  {officialHref ? <a className="button primary compact" href={officialHref}>Tiếp tục đơn NPP</a> : null}
                  {sessionHref ? <a className="button compact" href={sessionHref}>Mở phiên</a> : null}
                  {!item.address ? <span className="badge">Cần bổ sung địa chỉ trong phiên</span> : null}
                </div>
              </article>
            );
          })}
          {visibleItems.length === 0 ? (
            <div className="empty-inline">
              <strong>Chưa có khách ở trạng thái này</strong>
              <p className="page-subtitle">Đề nghị mở mã chỉ xuất hiện sau khi đã có nhu cầu mua theo đúng contract MCP.</p>
            </div>
          ) : null}
        </div>
      </section>
    </AppShell>
  );
}
