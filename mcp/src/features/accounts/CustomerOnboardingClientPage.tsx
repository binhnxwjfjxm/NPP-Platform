"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { idempotentMutationFetch } from "@/lib/api/idempotent-fetch";
import { PageHeader } from "@/ui/layout/PageHeader";
import { AppShell } from "@/ui/shell/AppShell";
import type { CustomerOnboardingQueueItem, CustomerOnboardingQueueStatus } from "./customer-onboarding.types";

type QueueFilter = "all" | "not_submitted" | "processing" | "ready" | "attention";
type OnboardingMutation = "submit" | "sync";

type MutationPayload = {
  data?: { status?: string | null; coreRequestId?: string | null };
  error?: string | { message?: string };
  detail?: string;
  message?: string;
};

const PROCESSING_STATUSES = new Set<CustomerOnboardingQueueStatus>(["submitted", "under_review", "need_more_info"]);
const READY_STATUSES = new Set<CustomerOnboardingQueueStatus>(["approved", "linked_existing"]);
const ATTENTION_STATUSES = new Set<CustomerOnboardingQueueStatus>(["rejected", "cancelled"]);

function apiErrorMessage(payload: MutationPayload, fallback: string) {
  if (typeof payload.error === "string" && payload.error.trim()) return payload.error;
  if (payload.error && typeof payload.error === "object" && payload.error.message?.trim()) return payload.error.message;
  return payload.detail || payload.message || fallback;
}

function statusLabel(status: CustomerOnboardingQueueStatus) {
  if (status === "not_submitted") return "Chưa gửi";
  if (status === "submitted") return "Đã gửi Core";
  if (status === "under_review") return "Core đang xác minh";
  if (status === "need_more_info") return "Cần bổ sung";
  if (status === "approved") return "Đã mở mã";
  if (status === "linked_existing") return "Đã liên kết";
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

function compactDate(value: string | null) {
  if (!value) return "-";
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return value.slice(0, 10);
  return new Intl.DateTimeFormat("vi-VN", {
    day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit", hour12: false,
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
  const visibleItems = useMemo(() => items.filter((item) => matchesFilter(item.status, filter)), [items, filter]);

  async function mutate(item: CustomerOnboardingQueueItem, mutation: OnboardingMutation) {
    const key = `${item.routeCustomerId}:${mutation}`;
    if (busyKey) return;
    setBusyKey(key);
    setNotice(null);
    try {
      const response = await idempotentMutationFetch(
        `/api/backend/customer-verifications/${mutation}`,
        {
          method: "POST",
          cache: "no-store",
          headers: { Accept: "application/json", "Content-Type": "application/json" },
          body: JSON.stringify({ routeCustomerId: item.routeCustomerId })
        },
        { operation: `customer-verification.${mutation}` }
      );
      const payload = await response.json().catch(() => ({})) as MutationPayload;
      if (!response.ok) throw new Error(apiErrorMessage(payload, mutation === "submit" ? "Không gửi được đề nghị mở / liên kết mã" : "Không đồng bộ được trạng thái Core"));
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
        subtitle="Xác minh điểm bán độc lập với đơn hàng. Chỉ gửi hồ sơ khách sang Core khi nhân viên chủ động yêu cầu."
      >
        <a className="button compact" href="/customers">Khách hệ thống</a>
      </PageHeader>

      <div className="mcp-status-chips" role="tablist" aria-label="Trạng thái mở và liên kết mã khách">
        <button className={filter === "all" ? "active" : ""} type="button" onClick={() => setFilter("all")}>Tất cả <b>{counts.all}</b></button>
        <button className={filter === "not_submitted" ? "active" : ""} type="button" onClick={() => setFilter("not_submitted")}>Chưa gửi <b>{counts.notSubmitted}</b></button>
        <button className={filter === "processing" ? "active" : ""} type="button" onClick={() => setFilter("processing")}>Đang xử lý <b>{counts.processing}</b></button>
        <button className={filter === "ready" ? "active" : ""} type="button" onClick={() => setFilter("ready")}>Đã mở / liên kết <b>{counts.ready}</b></button>
        <button className={filter === "attention" ? "active" : ""} type="button" onClick={() => setFilter("attention")}>Cần chú ý <b>{counts.attention}</b></button>
      </div>

      {notice ? <p className="page-subtitle order-message" role="status">{notice}</p> : null}

      <section className="card route-list-card" aria-label="Danh sách điểm bán cần mở hoặc liên kết mã khách">
        <div className="route-list-heading">
          <div>
            <h2 className="panel-title">Điểm bán của tôi</h2>
            <p className="page-subtitle">Không cần có nhu cầu mua hoặc order intent để gửi xác minh.</p>
          </div>
          <span>{visibleItems.length}/{items.length} điểm bán</span>
        </div>

        <div className="grid">
          {visibleItems.map((item) => {
            const actionBusy = busyKey?.startsWith(`${item.routeCustomerId}:`) === true;
            const canSubmit = Boolean(item.address);
            return (
              <article className="card" key={item.routeCustomerId} data-customer-onboarding-row>
                <div className="mobile-summary-head">
                  <div className="mobile-summary-title">
                    <span>{item.routeName || "Chưa rõ tuyến"}</span>
                    <h3>{item.customerName}</h3>
                  </div>
                  <span className={`mobile-summary-status ${statusClass(item.status)}`}>{statusLabel(item.status)}</span>
                </div>

                <div className="grid">
                  <div className="metric-row"><span>Điện thoại</span><strong>{item.phone || "-"}</strong></div>
                  <div className="metric-row"><span>Địa chỉ</span><strong>{item.address || "Chưa có địa chỉ"}</strong></div>
                  <div className="metric-row"><span>Mã Core</span><strong>{item.coreCustomerCode || item.coreCustomerId || "Chưa có"}</strong></div>
                  <div className="metric-row"><span>Core request</span><strong>{item.coreRequestId || "Chưa gửi"}</strong></div>
                  <div className="metric-row"><span>Cập nhật Core</span><strong>{compactDate(item.lastSyncedAt || item.submittedAt)}</strong></div>
                  {item.reviewReason ? <div className="metric-row"><span>Phản hồi</span><strong>{item.reviewReason}</strong></div> : null}
                </div>

                <div className="sheet-action-grid">
                  {item.status === "not_submitted" ? (
                    <button className="button primary compact" type="button" onClick={() => void mutate(item, "submit")} disabled={actionBusy || !canSubmit}>
                      {actionBusy ? "Đang gửi..." : "Gửi xác minh / mở mã"}
                    </button>
                  ) : item.coreRequestId ? (
                    <button className="button primary compact" type="button" onClick={() => void mutate(item, "sync")} disabled={actionBusy}>
                      {actionBusy ? "Đang đồng bộ..." : "Đồng bộ Core"}
                    </button>
                  ) : null}
                  {!item.address ? <span className="badge">Cần bổ sung địa chỉ điểm bán</span> : null}
                </div>
              </article>
            );
          })}
          {visibleItems.length === 0 ? (
            <div className="empty-inline">
              <strong>Chưa có điểm bán ở trạng thái này</strong>
              <p className="page-subtitle">Danh sách chỉ hiển thị điểm bán thuộc nhân viên đang đăng nhập.</p>
            </div>
          ) : null}
        </div>
      </section>
    </AppShell>
  );
}
