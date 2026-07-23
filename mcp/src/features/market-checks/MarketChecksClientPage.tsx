"use client";

import { useEffect, useMemo, useState, type FormEvent } from "react";
import Link from "next/link";
import { CompactKpiStrip } from "@/ui/cards/CompactKpiStrip";
import { OperationalListCard } from "@/ui/cards/OperationalListCard";
import { FilterBar } from "@/ui/layout/FilterBar";
import { PageHeader } from "@/ui/layout/PageHeader";
import { BottomSheet } from "@/ui/overlay/BottomSheet";
import { AppShell } from "@/ui/shell/AppShell";
import { idempotentMutationFetch } from "@/lib/api/idempotent-fetch";
import { userFacingError } from "@/lib/ui/user-facing-error";
import type { MarketCheckItem, MarketCheckSessionGroup, MarketCheckStatus } from "./market-checks.types";
import styles from "./MarketChecksClientPage.module.css";

function getStatusLabel(status: MarketCheckStatus) {
  if (status === "opportunity") return "Cơ hội";
  if (status === "risk") return "Rủi ro";
  return "Bình thường";
}

function getStatusClass(status: MarketCheckStatus) {
  if (status === "opportunity") return `${styles.status} ${styles.opportunity}`;
  if (status === "risk") return `${styles.status} ${styles.risk}`;
  return `${styles.status} ${styles.normal}`;
}

function flatten(groups: MarketCheckSessionGroup[]) {
  return groups.flatMap((group) => group.items);
}

function buildSetupMetrics(groups: MarketCheckSessionGroup[]) {
  const rows = flatten(groups);
  const routes = new Set(groups.map((group) => group.routeId).filter(Boolean)).size;
  const customers = new Set(rows.map((check) => check.sessionCustomerId || check.customerId).filter(Boolean)).size;
  const pending = rows.filter((check) => !check.resultId || check.stockStatus === "pending").length;
  return { routes, sessions: groups.length, customers, pending };
}

function buildKpis(groups: MarketCheckSessionGroup[]) {
  const rows = flatten(groups);
  const done = rows.filter((check) => Boolean(check.resultId)).length;
  const opportunities = rows.filter((check) => check.status === "opportunity").length;
  const risks = rows.filter((check) => check.status === "risk").length;
  return [
    { label: "Phiên có thử sản phẩm", value: groups.length, hint: "Theo từng phiên đi tuyến" },
    { label: "Kết quả thử", value: rows.length, hint: "Trong các phiên đi tuyến" },
    { label: "Đã nhập", value: done, hint: "Có kết quả" },
    { label: "Cơ hội / Rủi ro", value: `${opportunities}/${risks}`, hint: "Từ kết quả thử sản phẩm" }
  ];
}

function sessionStatusLabel(status: string) {
  if (status === "done" || status === "completed") return "Đã chốt";
  if (status === "cancelled") return "Đã hủy";
  return "Đang chạy";
}

function TestSessionCard({ group, onOpen }: { group: MarketCheckSessionGroup; onOpen: (group: MarketCheckSessionGroup) => void }) {
  return (
    <OperationalListCard
      leading={<span>{group.resultCount}</span>}
      eyebrow={`${group.sessionDate || "-"} · ${group.routeName}`}
      title="Kết quả thử sản phẩm"
      description={`${group.customerCount} điểm bán có thử · ${group.resultCount} kết quả · ${sessionStatusLabel(group.status)}`}
      badge={<strong className={styles.status}>{group.riskCount > 0 ? `${group.riskCount} rủi ro` : `${group.opportunityCount} cơ hội`}</strong>}
      meta={[`Tuyến: ${group.routeName}`, sessionStatusLabel(group.status), `${group.visitedCustomers}/${group.plannedCustomers} điểm bán đã ghé`]}
      actions={[{ label: "Xem kết quả", tone: "primary", onClick: () => onOpen(group) }]}
    />
  );
}

function InlineTestRow({ check, onSelect }: { check: MarketCheckItem; onSelect: (check: MarketCheckItem) => void }) {
  return (
    <article className={styles.testRow}>
      <div>
        <strong>{check.accountName}</strong>
        <small>{check.productName} · {check.area || check.phone || "Chưa có khu vực"}</small>
        <span>{check.note}</span>
      </div>
      <strong className={getStatusClass(check.status)}>{getStatusLabel(check.status)}</strong>
      <button className="button primary" type="button" onClick={() => onSelect(check)}>Cập nhật</button>
    </article>
  );
}

type SavePayload = {
  resultId: string;
  fileId: string;
  customerId: string;
  productId?: string;
  productName: string;
  status: MarketCheckStatus;
  note: string;
  sessionId?: string;
  sessionCustomerId?: string;
  routeId?: string;
  sessionDate?: string;
};

function FieldCheckSheet({ check, onClose, onSaved }: { check: MarketCheckItem | null; onClose: () => void; onSaved: (check: MarketCheckItem) => void }) {
  const [productName, setProductName] = useState("");
  const [status, setStatus] = useState<MarketCheckStatus>("normal");
  const [note, setNote] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setProductName(check?.productName || "");
    setStatus(check?.status || "normal");
    setNote(check?.note || "");
    setError(null);
  }, [check]);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!check) return;
    setSaving(true);
    setError(null);

    try {
      if (!check.resultId) throw new Error("Không tìm thấy kết quả thử cần cập nhật.");

      const payload: SavePayload = {
        resultId: check.resultId,
        fileId: check.fileId,
        customerId: check.customerId,
        productId: check.productId,
        productName,
        status,
        note,
        sessionId: check.sessionId,
        sessionCustomerId: check.sessionCustomerId,
        routeId: check.routeId,
        sessionDate: check.sessionDate
      };

      const response = await idempotentMutationFetch(
        "/api/field-checks/result",
        {
          method: "POST",
          headers: { Accept: "application/json", "Content-Type": "application/json" },
          body: JSON.stringify(payload)
        },
        { operation: "field-check.result.update" }
      );
      const json = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(json.error?.message || json.error || `request_failed_${response.status}`);
      const saved = json.data || {};
      onSaved({
        ...check,
        resultId: String(saved.id || check.resultId || ""),
        productId: String(saved.product_id || check.productId || "") || undefined,
        productName: String(saved.product_name || productName),
        stockStatus: String(saved.status || status),
        status,
        note: String(saved.note || note)
      });
      onClose();
    } catch (err) {
      setError(userFacingError(err, "Không lưu được kết quả. Vui lòng thử lại."));
    } finally {
      setSaving(false);
    }
  }

  return (
    <BottomSheet
      open={Boolean(check)}
      onClose={onClose}
      title={check ? check.productName : "Chi tiết kết quả thử"}
      description={check ? `${check.accountName} · ${check.routeName} · ${check.sessionDate || check.date}` : undefined}
      footer={
        <div className="sheet-action-grid">
          <button className="button primary" disabled={saving || !check?.resultId} form="field-check-save-form" type="submit">{saving ? "Đang lưu..." : "Lưu kết quả"}</button>
          <button className="button" type="button" onClick={onClose}>Đóng</button>
        </div>
      }
    >
      {check ? (
        <form className="field-sheet-content" id="field-check-save-form" onSubmit={submit}>
          <div className="field-focus-card"><span>Điểm bán trong phiên</span><strong>{check.accountName}</strong><small>{check.routeName} · {check.sessionDate || check.date}</small></div>
          <div className="grid">
            <label className="metric-row"><span>Sản phẩm</span><input value={productName} onChange={(event) => setProductName(event.target.value)} required /></label>
            <label className="metric-row"><span>Kết quả</span><select value={status} onChange={(event) => setStatus(event.target.value as MarketCheckStatus)}><option value="normal">Bình thường</option><option value="opportunity">Cơ hội</option><option value="risk">Rủi ro</option></select></label>
            <div className="metric-row"><span>Phiên đi tuyến</span><strong>{check.routeName}</strong></div>
            <div className="metric-row"><span>Ngày</span><strong>{check.sessionDate || check.date || "-"}</strong></div>
          </div>
          <label className="sheet-note-card"><h3>Ghi chú kết quả</h3><textarea value={note} onChange={(event) => setNote(event.target.value)} rows={4} placeholder="Nhập nhận xét, tồn kho, phản hồi điểm bán và việc cần xử lý..." /></label>
          {!check.resultId ? <p className={styles.errorText}>Chưa có kết quả để cập nhật</p> : null}
          {error ? <p className={styles.errorText}>{error}</p> : null}
        </form>
      ) : null}
    </BottomSheet>
  );
}

function SessionBranchSheet({ group, onClose, onSelect }: { group: MarketCheckSessionGroup | null; onClose: () => void; onSelect: (check: MarketCheckItem) => void }) {
  return (
    <BottomSheet
      open={Boolean(group)}
      onClose={onClose}
      title={group ? `Kết quả thử sản phẩm · ${group.routeName}` : "Kết quả thử sản phẩm"}
      description={group ? `${group.sessionDate} · ${sessionStatusLabel(group.status)}` : undefined}
      footer={<div className="sheet-action-grid"><Link className="button primary" href={group ? `/visits?routeId=${encodeURIComponent(group.routeId)}&date=${encodeURIComponent(group.sessionDate)}` : "/visits"}>Mở phiên đi tuyến</Link><button className="button" type="button" onClick={onClose}>Đóng</button></div>}
    >
      {group ? (
        <div className={styles.branchSheet}>
          <div className={styles.branchMetrics}>
            <strong><b>{group.customerCount}</b><small>Điểm bán có thử</small></strong>
            <strong><b>{group.resultCount}</b><small>Kết quả</small></strong>
            <strong><b>{group.pendingCount}</b><small>Chờ nhập</small></strong>
            <strong><b>{group.riskCount}</b><small>Rủi ro</small></strong>
          </div>
          <div className={styles.detailList}>{group.items.map((check) => <InlineTestRow check={check} key={check.id} onSelect={onSelect} />)}</div>
        </div>
      ) : null}
    </BottomSheet>
  );
}

export function MarketChecksClientPage({ groups }: { groups: MarketCheckSessionGroup[] }) {
  const [sessionGroups, setSessionGroups] = useState(groups);
  const [selectedGroup, setSelectedGroup] = useState<MarketCheckSessionGroup | null>(null);
  const [selectedCheck, setSelectedCheck] = useState<MarketCheckItem | null>(null);
  const setup = useMemo(() => buildSetupMetrics(sessionGroups), [sessionGroups]);
  const liveKpis = useMemo(() => buildKpis(sessionGroups), [sessionGroups]);
  const needAction = setup.pending + sessionGroups.reduce((sum, group) => sum + group.riskCount, 0);

  function handleSaved(next: MarketCheckItem) {
    setSessionGroups((current) => current.map((group) => {
      if (group.sessionId !== next.sessionId) return group;
      const items = group.items.map((item) => item.id === next.id ? next : item);
      const pendingCount = items.filter((item) => !item.resultId || item.stockStatus === "pending").length;
      const opportunityCount = items.filter((item) => item.status === "opportunity").length;
      const riskCount = items.filter((item) => item.status === "risk").length;
      return { ...group, items, pendingCount, opportunityCount, riskCount, resultCount: items.filter((item) => item.resultId).length };
    }));
    setSelectedGroup((current) => {
      if (!current || current.sessionId !== next.sessionId) return current;
      return { ...current, items: current.items.map((item) => item.id === next.id ? next : item) };
    });
  }

  return (
    <AppShell activeHref="/mcp">
      <PageHeader eyebrow="MCP" title="Kết quả thử sản phẩm" subtitle="Tổng hợp kết quả thử sản phẩm theo từng phiên đi tuyến và điểm bán."><span className="badge">{needAction} cần xử lý</span></PageHeader>
      <FilterBar filters={[{ label: "Phạm vi", value: "Theo phiên đi tuyến" }, { label: "Trạng thái", value: needAction ? `${needAction} cần xử lý` : "Đã cập nhật" }, { label: "Sắp xếp", value: "Mới nhất trước" }]} />

      <section className={styles.setupGrid}>
        <div className={styles.setupCard}>
          <span>Theo phiên đi tuyến</span>
          <h2>Kết quả thử sản phẩm theo phiên</h2>
          <p>Mỗi phiên hiển thị các điểm bán, sản phẩm đã thử và kết quả cần cập nhật.</p>
          <div className={styles.setupMetrics}>
            <strong><b>{setup.sessions}</b><small>Phiên</small></strong>
            <strong><b>{setup.routes}</b><small>Tuyến</small></strong>
            <strong><b>{setup.customers}</b><small>Điểm bán</small></strong>
          </div>
        </div>

        <div className={styles.setupCard}>
          <span>Cập nhật kết quả</span>
          <h2>{needAction} cần xử lý</h2>
          <p>Mở từng phiên để xem điểm bán, sản phẩm đã thử và cập nhật kết quả.</p>
        </div>
      </section>

      <CompactKpiStrip items={liveKpis} />

      <section className={styles.section}>
        <div className="dashboard-section-head"><h2>Phiên có nhánh test</h2><span>{sessionGroups.length} phiên</span></div>
        <div className={styles.list}>{sessionGroups.length ? sessionGroups.map((group) => <TestSessionCard key={group.sessionId} group={group} onOpen={setSelectedGroup} />) : <div className="empty-inline">Chưa có kết quả thử sản phẩm trong các phiên đi tuyến.</div>}</div>
      </section>

      <section className={`card ${styles.nextCard}`}><h2 className="panel-title">Thông tin tổng hợp</h2><div className="grid"><div className="metric-row"><span>Nguồn dữ liệu</span><strong>Phiên đi tuyến</strong></div><div className="metric-row"><span>Phạm vi</span><strong>Theo từng phiên</strong></div><div className="metric-row"><span>Sắp xếp</span><strong>Mới nhất trước</strong></div></div></section>

      <SessionBranchSheet group={selectedGroup} onClose={() => setSelectedGroup(null)} onSelect={setSelectedCheck} />
      <FieldCheckSheet check={selectedCheck} onClose={() => setSelectedCheck(null)} onSaved={handleSaved} />
    </AppShell>
  );
}
