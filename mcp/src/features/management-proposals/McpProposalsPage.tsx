"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import type { FormEvent } from "react";
import { idempotentMutationFetch } from "@/lib/api/idempotent-fetch";
import { useMcpAccess } from "@/lib/use-mcp-access";
import { AppShell } from "@/ui/shell/AppShell";
import styles from "./McpProposalsPage.module.css";

type ProposalState = "pending" | "needs-info" | "approved" | "rejected";
type ProposalPriority = "critical" | "high" | "normal";
type Proposal = {
  id: string;
  source: "mcp";
  domain: "mcp";
  title: string;
  content: string;
  entityType: string;
  entityId: string;
  entityLabel: string;
  impact: string;
  reason: string;
  rule: string;
  evidence: string[];
  priority: ProposalPriority;
  status: ProposalState;
  requesterName: string;
  decisionNote: string | null;
  createdAt: string;
  updatedAt: string;
};

type Envelope = {
  data?: unknown;
  error?: { message?: string };
};

const STATE_LABEL: Record<ProposalState, string> = {
  pending: "Chờ quyết định",
  "needs-info": "Chờ bổ sung",
  approved: "Đã đồng ý",
  rejected: "Đã từ chối",
};
const PRIORITY_LABEL: Record<ProposalPriority, string> = {
  critical: "Ưu tiên cao",
  high: "Cần xử lý sớm",
  normal: "Bình thường",
};
const ENTITY_LABEL: Record<string, string> = {
  customer: "Khách hàng",
  "sales-order": "Đơn bán hàng",
  "purchase-order": "Đơn mua hàng",
  document: "Chứng từ",
  route: "Tuyến",
  employee: "Nhân viên",
  outlet: "Điểm bán",
  other: "Khác",
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function isProposal(value: unknown): value is Proposal {
  if (!isRecord(value)) return false;
  return value.source === "mcp"
    && value.domain === "mcp"
    && typeof value.id === "string"
    && typeof value.title === "string"
    && typeof value.content === "string"
    && typeof value.entityType === "string"
    && typeof value.entityId === "string"
    && typeof value.entityLabel === "string"
    && typeof value.impact === "string"
    && typeof value.reason === "string"
    && typeof value.rule === "string"
    && Array.isArray(value.evidence)
    && value.evidence.every((item) => typeof item === "string")
    && new Set(["critical", "high", "normal"]).has(String(value.priority))
    && new Set(["pending", "needs-info", "approved", "rejected"]).has(String(value.status))
    && typeof value.requesterName === "string"
    && (value.decisionNote === null || typeof value.decisionNote === "string")
    && typeof value.createdAt === "string"
    && typeof value.updatedAt === "string";
}

function formatDateTime(value: string) {
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return "—";
  return new Intl.DateTimeFormat("vi-VN", {
    timeZone: "Asia/Ho_Chi_Minh",
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  }).format(parsed);
}

async function readEnvelope(response: Response): Promise<Envelope> {
  return response.json().catch(() => ({})) as Promise<Envelope>;
}

function publicError(payload: Envelope, fallback: string) {
  const message = String(payload.error?.message || fallback);
  return message === "Đã xảy ra lỗi nội bộ." ? `${fallback} lúc này. Vui lòng thử lại.` : message;
}

export function McpProposalsPage() {
  const access = useMcpAccess();
  const [items, setItems] = useState<Proposal[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [saving, setSaving] = useState(false);
  const canWrite = access.hasPermission("mcp.report.write");

  const load = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const response = await fetch("/api/backend/management-proposals?source=mcp", {
        cache: "no-store",
        headers: { Accept: "application/json" },
      });
      const payload = await readEnvelope(response);
      if (!response.ok) throw new Error(publicError(payload, "Không tải được Đề xuất"));
      const data = isRecord(payload.data) ? payload.data : null;
      const proposals = data?.proposals;
      if (!Array.isArray(proposals) || !proposals.every(isProposal)) throw new Error("Dữ liệu Đề xuất không hợp lệ");
      setItems(proposals);
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : "Không tải được Đề xuất");
      setItems([]);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { void load(); }, [load]);

  const counts = useMemo(() => ({
    pending: items.filter((item) => item.status === "pending").length,
    needsInfo: items.filter((item) => item.status === "needs-info").length,
    completed: items.filter((item) => item.status === "approved" || item.status === "rejected").length,
  }), [items]);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!canWrite || saving) return;
    const form = event.currentTarget;
    const values = new FormData(form);
    const evidence = String(values.get("evidence") || "")
      .split(/\r?\n/)
      .map((entry) => entry.trim())
      .filter(Boolean);
    const body = {
      title: String(values.get("title") || "").trim(),
      content: String(values.get("content") || "").trim(),
      entityType: String(values.get("entityType") || "other").trim() || "other",
      entityId: String(values.get("entityId") || "").trim(),
      entityLabel: String(values.get("entityLabel") || "").trim(),
      impact: String(values.get("impact") || "").trim(),
      reason: String(values.get("reason") || "").trim(),
      rule: String(values.get("rule") || "").trim(),
      evidence,
      priority: String(values.get("priority") || "normal").trim() || "normal",
    };
    setSaving(true);
    setError("");
    setNotice("");
    try {
      const response = await idempotentMutationFetch("/api/backend/management-proposals", {
        method: "POST",
        headers: { "Content-Type": "application/json", Accept: "application/json" },
        body: JSON.stringify(body),
      }, { operation: "mcp-management-proposal", retries: 1 });
      const payload = await readEnvelope(response);
      if (!response.ok) throw new Error(publicError(payload, "Không gửi được Đề xuất"));
      if (!isProposal(payload.data)) throw new Error("Dữ liệu Đề xuất trả về không hợp lệ");
      form.reset();
      setNotice("Đã gửi Đề xuất đến Admin.");
      await load();
    } catch (submitError) {
      setError(submitError instanceof Error ? submitError.message : "Không gửi được Đề xuất");
    } finally {
      setSaving(false);
    }
  }

  async function resubmit(item: Proposal, event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!canWrite || saving) return;
    const values = new FormData(event.currentTarget);
    const content = String(values.get("content") || "").trim();
    const reason = String(values.get("reason") || "").trim();
    const evidence = String(values.get("evidence") || "")
      .split(/\r?\n/)
      .map((entry) => entry.trim())
      .filter(Boolean);
    setSaving(true);
    setError("");
    setNotice("");
    try {
      const response = await idempotentMutationFetch(`/api/backend/management-proposals/${encodeURIComponent(item.id)}/resubmit`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Accept: "application/json" },
        body: JSON.stringify({ content, reason, evidence }),
      }, { operation: "mcp-management-proposal-resubmit", retries: 1 });
      const payload = await readEnvelope(response);
      if (!response.ok) throw new Error(publicError(payload, "Không gửi lại được Đề xuất"));
      if (!isProposal(payload.data)) throw new Error("Dữ liệu Đề xuất trả về không hợp lệ");
      setNotice("Đã gửi nội dung bổ sung đến Admin.");
      await load();
    } catch (submitError) {
      setError(submitError instanceof Error ? submitError.message : "Không gửi lại được Đề xuất");
    } finally {
      setSaving(false);
    }
  }

  return (
    <AppShell activeHref="/reports">
      <div className={styles.page}>
        <header className={styles.header}>
          <div><span className={styles.kicker}>Báo cáo MCP</span><h1>Đề xuất</h1><p>Chỉ cần nêu rõ tiêu đề và nội dung cần Admin quyết định. Thông tin liên quan có thể bổ sung khi cần.</p></div>
          <button type="button" className={styles.secondaryButton} onClick={() => void load()} disabled={loading}>Làm mới</button>
        </header>

        <section className={styles.metrics} aria-label="Tình trạng Đề xuất">
          <article><strong>{counts.pending}</strong><span>Chờ quyết định</span></article>
          <article><strong>{counts.needsInfo}</strong><span>Chờ bổ sung</span></article>
          <article><strong>{counts.completed}</strong><span>Đã có quyết định</span></article>
        </section>

        {error ? <p className={styles.error} role="alert">{error}</p> : null}
        {notice ? <p className={styles.notice} role="status">{notice}</p> : null}

        {access.loaded && !canWrite ? (
          <section className={styles.card} role="alert"><strong>Chưa được cấp quyền gửi Đề xuất.</strong><p>Liên hệ quản trị quyền MCP để được cấp quyền phù hợp.</p></section>
        ) : (
          <form className={styles.card} onSubmit={submit}>
            <div className={styles.sectionHeading}><div><h2>Phiếu Đề xuất mới</h2><p>Chỉ Tiêu đề và Nội dung đề xuất là bắt buộc.</p></div></div>
            <div className={styles.grid}>
              <label className={styles.wide}><span>Tiêu đề</span><input name="title" maxLength={240} required placeholder="Ví dụ: Xin hỗ trợ chính sách cho khách hàng A" /></label>
              <label className={styles.wide}><span>Nội dung đề xuất</span><textarea name="content" rows={5} maxLength={4000} required placeholder="Nêu rõ việc cần Admin xem xét và quyết định." /></label>
              <details className={`${styles.optionalDetails} ${styles.wide}`}>
                <summary>Thêm thông tin liên quan <span>(không bắt buộc)</span></summary>
                <p className={styles.optionalHint}>Chỉ bổ sung khi thông tin này giúp Admin hiểu hoặc kiểm tra đề xuất nhanh hơn.</p>
                <div className={styles.optionalGrid}>
                  <label><span>Liên quan đến</span><select name="entityType" defaultValue="other">{Object.entries(ENTITY_LABEL).map(([value, label]) => <option key={value} value={value}>{value === "other" ? "Khác / chưa xác định" : label}</option>)}</select></label>
                  <label><span>Mức ưu tiên</span><select name="priority" defaultValue="normal"><option value="normal">Bình thường</option><option value="high">Cần xử lý sớm</option><option value="critical">Ưu tiên cao</option></select></label>
                  <label><span>Mã liên quan (nếu có)</span><input name="entityId" maxLength={240} placeholder="Mã tuyến, khách hàng, đơn hoặc chứng từ" /></label>
                  <label><span>Tên khách / tuyến / đơn (nếu có)</span><input name="entityLabel" maxLength={240} placeholder="Tên dễ nhận biết" /></label>
                  <label className={styles.wide}><span>Lý do / bối cảnh</span><textarea name="reason" rows={3} maxLength={4000} /></label>
                  <label className={styles.wide}><span>Tác động dự kiến</span><textarea name="impact" rows={2} maxLength={1000} /></label>
                  <label className={styles.wide}><span>Điều kiện cần lưu ý</span><textarea name="rule" rows={2} maxLength={1000} placeholder="Quy định, điều kiện hoặc giới hạn nếu có" /></label>
                  <label className={styles.wide}><span>Bằng chứng / ghi chú</span><textarea name="evidence" rows={3} maxLength={4000} placeholder="Mỗi dòng một thông tin hoặc nguồn kiểm tra" /></label>
                </div>
              </details>
            </div>
            <div className={styles.actions}><button type="submit" disabled={!access.loaded || !canWrite || saving}>{saving ? "Đang gửi…" : "Gửi Đề xuất"}</button></div>
          </form>
        )}

        <section className={styles.listSection}>
          <div className={styles.sectionHeading}><div><h2>Đề xuất của tôi</h2><p>Quyết định từ Admin được cập nhật về đúng nguồn tạo.</p></div></div>
          {loading ? <p className={styles.empty}>Đang tải Đề xuất…</p> : null}
          {!loading && !items.length ? <p className={styles.empty}>Chưa có Đề xuất nào.</p> : null}
          <div className={styles.list}>
            {items.map((item) => (
              <article className={styles.card} key={item.id}>
                <div className={styles.itemTop}><div><span className={styles.meta}>{item.entityLabel ? `${ENTITY_LABEL[item.entityType] || "Đối tượng"} · ${item.entityLabel}` : "Đề xuất MCP"}</span><h3>{item.title}</h3></div><span className={styles.status}>{STATE_LABEL[item.status]}</span></div>
                <p className={styles.content}>{item.content}</p>
                <dl className={styles.details}><div><dt>Ưu tiên</dt><dd>{PRIORITY_LABEL[item.priority]}</dd></div><div><dt>Gửi lúc</dt><dd>{formatDateTime(item.createdAt)}</dd></div><div><dt>Cập nhật</dt><dd>{formatDateTime(item.updatedAt)}</dd></div></dl>
                {item.decisionNote ? <div className={styles.decision}><strong>Phản hồi từ Admin</strong><p>{item.decisionNote}</p></div> : null}
                {item.status === "needs-info" ? (
                  <form className={styles.resubmit} onSubmit={(event) => void resubmit(item, event)}>
                    <strong>Bổ sung theo yêu cầu</strong>
                    <label><span>Nội dung cập nhật</span><textarea name="content" rows={3} maxLength={4000} defaultValue={item.content} required /></label>
                    <label><span>Lý do / giải trình <small>(nếu cần)</small></span><textarea name="reason" rows={2} maxLength={4000} defaultValue={item.reason} /></label>
                    <label><span>Bằng chứng / ghi chú <small>(nếu có)</small></span><textarea name="evidence" rows={2} maxLength={4000} defaultValue={item.evidence.join("\n")} /></label>
                    <div className={styles.actions}><button type="submit" disabled={saving}>Gửi lại</button></div>
                  </form>
                ) : null}
              </article>
            ))}
          </div>
        </section>
      </div>
    </AppShell>
  );
}
