"use client";

import { useEffect, useId, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import type { McpDayLine } from "@/features/mcp-day/mcp-day.types";
import { createIdempotencyKey, idempotentMutationFetch } from "@/lib/api/idempotent-fetch";
import { type McpCustomerAction } from "./mcp-customer-actions";
import { requestMcpCustomerProfile } from "./mcp-customer-profile-events";
import { useMcpCustomerDirections } from "./McpRouteDirectionsContext";
import styles from "./McpLineCard.module.css";

function sourceLabel(source: McpDayLine["source"]) {
  if (source === "planned") return "Tuyến gốc";
  if (source === "added") return "Phát sinh";
  return "Đồng bộ";
}

function statusLabel(status: McpDayLine["status"]) {
  if (status === "pending") return "Chờ ghé";
  if (status === "visited") return "Đã ghé";
  if (status === "skipped") return "Bỏ qua / không mua";
  return "Hủy";
}

function statusClass(status: McpDayLine["status"]) {
  if (status === "visited") return styles.visited;
  if (status === "pending") return styles.pending;
  if (status === "skipped") return styles.skipped;
  return styles.cancelled;
}

function resultSummary(line: McpDayLine) {
  const done = [
    line.hasOrder ? "Có đơn" : null,
    line.hasTest ? "Có test" : null,
    line.hasReport ? "Có quan sát" : null,
    Number(line.followupCount || 0) > 0 ? `${line.followupCount} theo dõi` : null
  ].filter(Boolean);
  return done.length > 0 ? done.join(" · ") : line.result || line.note || "Chưa ghi kết quả";
}

function checkinTime(value?: string) {
  if (!value) return "đã lưu GPS";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "đã lưu GPS";
  return date.toLocaleTimeString("vi-VN", { hour: "2-digit", minute: "2-digit" });
}

function actionItems(line: McpDayLine): Array<{ label: string; action: McpCustomerAction; icon: "cart" | "flask" | "eye" | "clock" | "skip" }> {
  return [
    { label: line.hasOrder ? "Đã có đơn" : "Có đơn", action: "order", icon: "cart" },
    { label: "Test", action: "test", icon: "flask" },
    { label: "Quan sát", action: "market_report", icon: "eye" },
    { label: "Theo dõi", action: "follow_up", icon: "clock" },
    { label: "Bỏ qua", action: "skip", icon: "skip" }
  ];
}

type ActionIconName = "map" | "photo" | "cart" | "flask" | "eye" | "clock" | "skip" | "checkin" | "menu";

function ActionIcon({ name }: { name: ActionIconName }) {
  const common = { width: 18, height: 18, viewBox: "0 0 24 24", fill: "none", stroke: "currentColor", strokeWidth: 1.8, strokeLinecap: "round" as const, strokeLinejoin: "round" as const, "aria-hidden": true };
  if (name === "map") return <svg {...common}><path d="m9 18-6 3V6l6-3 6 3 6-3v15l-6 3-6-3Z"/><path d="M9 3v15M15 6v15"/></svg>;
  if (name === "photo") return <svg {...common}><rect x="3" y="5" width="18" height="14" rx="2"/><circle cx="9" cy="10" r="2"/><path d="m21 15-5-5L5 19"/></svg>;
  if (name === "cart") return <svg {...common}><path d="M3 4h2l2 11h10l2-7H7"/><circle cx="9" cy="19" r="1"/><circle cx="17" cy="19" r="1"/></svg>;
  if (name === "flask") return <svg {...common}><path d="M9 3h6M10 3v6l-5 9a2 2 0 0 0 2 3h10a2 2 0 0 0 2-3l-5-9V3"/><path d="M8 15h8"/></svg>;
  if (name === "eye") return <svg {...common}><path d="M2 12s3.5-6 10-6 10 6 10 6-3.5 6-10 6S2 12 2 12Z"/><circle cx="12" cy="12" r="2.5"/></svg>;
  if (name === "clock") return <svg {...common}><circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/></svg>;
  if (name === "skip") return <svg {...common}><path d="m5 5 14 14M19 5 5 19"/></svg>;
  if (name === "menu") return <svg {...common}><circle cx="5" cy="12" r="1" fill="currentColor" stroke="none"/><circle cx="12" cy="12" r="1" fill="currentColor" stroke="none"/><circle cx="19" cy="12" r="1" fill="currentColor" stroke="none"/></svg>;
  return <svg {...common}><path d="M12 2v4M12 18v4M4 12H2M22 12h-2"/><circle cx="12" cy="12" r="6"/><circle cx="12" cy="12" r="2"/></svg>;
}

function mutationError(payload: unknown) {
  if (!payload || typeof payload !== "object") return "Không cập nhật được trạng thái Có đơn.";
  const value = payload as { error?: string | { message?: string }; detail?: string; message?: string };
  if (typeof value.error === "string" && value.error.trim()) return value.error;
  if (value.error && typeof value.error === "object" && value.error.message?.trim()) return value.error.message;
  return value.detail || value.message || "Không cập nhật được trạng thái Có đơn.";
}

export function McpLineCard({
  line,
  onOpen,
  onAction,
  onToggleCheckin,
  checkinBusy = false
}: {
  line: McpDayLine;
  onOpen: (line: McpDayLine) => void;
  onAction: (line: McpDayLine, action: McpCustomerAction) => void;
  onToggleCheckin?: (line: McpDayLine) => void;
  checkinBusy?: boolean;
}) {
  const directions = useMcpCustomerDirections(line.routeCustomerId, line.accountName, line.area);
  const checkinEnabled = typeof onToggleCheckin === "function";
  const actionMenuId = useId();
  const router = useRouter();
  const [actionsOpen, setActionsOpen] = useState(false);
  const [orderBusy, setOrderBusy] = useState(false);
  const [orderError, setOrderError] = useState<string | null>(null);
  const [hasOrder, setHasOrder] = useState(Boolean(line.hasOrder));
  const orderSubmission = useRef<{ target: boolean; key: string } | null>(null);
  const openLegacySheet = () => onOpen(line);
  const displayLine: McpDayLine = { ...line, hasOrder };

  useEffect(() => {
    setHasOrder(Boolean(line.hasOrder));
  }, [line.hasOrder]);

  function openProfile(focus: "detail" | "media") {
    requestMcpCustomerProfile({ line, focus, fallback: openLegacySheet });
  }

  async function toggleHasOrder() {
    if (orderBusy) return;
    const target = !hasOrder;
    if (!orderSubmission.current || orderSubmission.current.target !== target) {
      orderSubmission.current = {
        target,
        key: createIdempotencyKey("session-customer.result.record")
      };
    }
    const key = orderSubmission.current.key;
    const sessionCustomerId = line.sessionCustomerId || line.id;
    setOrderBusy(true);
    setOrderError(null);
    try {
      const response = await idempotentMutationFetch(
        "/api/backend/mcp-day/session-customer/result",
        {
          method: "POST",
          cache: "no-store",
          headers: { Accept: "application/json", "Content-Type": "application/json" },
          body: JSON.stringify({ sessionCustomerId, resultType: "order", hasOrder: target })
        },
        { operation: "session-customer.result.record", key }
      );
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(mutationError(payload));
      setHasOrder(target);
      orderSubmission.current = null;
      router.refresh();
    } catch (error) {
      setOrderError(error instanceof Error ? error.message : "Không cập nhật được trạng thái Có đơn.");
    } finally {
      setOrderBusy(false);
    }
  }

  function runAction(action: McpCustomerAction) {
    setActionsOpen(false);
    if (action === "order") {
      void toggleHasOrder();
      return;
    }
    onAction(line, action);
  }

  function openDirections() {
    window.location.assign(directions.url);
  }

  return (
    <article className={`${styles.card} ${statusClass(line.status)} ${checkinEnabled ? "" : styles.withoutCheckin}`} data-mcp-session-card="true">
      <button className={styles.main} type="button" onClick={() => openProfile("detail")}>
        <span className={styles.index}>{line.sortOrder || "–"}</span>
        <span className={styles.identity}><span className={styles.identityHead}><strong>{line.accountName}</strong><span className={styles.badge}>{statusLabel(line.status)}</span></span><small>{line.area} · {sourceLabel(line.source)}</small><span className={styles.summary}>{resultSummary(displayLine)}</span></span>
      </button>
      <div className={styles.primaryRow} data-session-primary-actions="4">
        {onToggleCheckin ? <button className={`${styles.checkin} ${line.checkedIn ? styles.checkinActive : ""}`} type="button" aria-pressed={line.checkedIn === true} aria-label={line.checkedIn ? `Bỏ check-in tại ${line.accountName}` : `Check-in vị trí hiện tại tại ${line.accountName}`} title={line.checkedIn ? `Đã check-in lúc ${checkinTime(line.checkinAt)}. Bấm lần nữa để bỏ check-in nếu thao tác nhầm` : "Chỉ lấy vị trí hiện tại khi bấm nút này"} disabled={checkinBusy} onClick={() => onToggleCheckin(line)}><ActionIcon name="checkin" /><span>{checkinBusy ? "Đang xử lý" : line.checkedIn ? "Đã check-in" : "Check-in"}</span></button> : null}
        <button className={styles.iconButton} type="button" onClick={openDirections} aria-label={directions.exact ? `Di chuyển đến ${line.accountName}` : `Tìm đường đến ${line.accountName} trên Google Maps`} title={directions.exact ? "Mở chỉ đường theo GPS điểm bán đã lưu" : "Khách chưa có GPS chính xác, mở tìm kiếm Google Maps"} data-customer-directions="true"><ActionIcon name="map" /><span>Di chuyển</span></button>
        <button className={styles.iconButton} type="button" onClick={() => openProfile("media")} aria-label={`Xem hoặc bổ sung ảnh cho ${line.accountName}`} title="Xem, chụp hoặc chọn ảnh điểm bán"><ActionIcon name="photo" /><span>Ảnh</span></button>
        <button className={`${styles.iconButton} ${styles.actionsTrigger} ${actionsOpen ? styles.actionsTriggerActive : ""}`} type="button" aria-expanded={actionsOpen} aria-controls={actionMenuId} onClick={() => setActionsOpen((open) => !open)}><ActionIcon name="menu" /><span>Thao tác</span></button>
      </div>
      {actionsOpen ? <div className={styles.actionMenu} id={actionMenuId} data-customer-action-menu="open"><div className={styles.actions} aria-label={`Thao tác với ${line.accountName}`} data-customer-action-count="5" role="group">{actionItems(displayLine).map((item) => <button className={styles.action} type="button" key={item.action} onClick={() => runAction(item.action)} disabled={item.action === "order" && orderBusy} aria-pressed={item.action === "order" ? hasOrder : undefined}><ActionIcon name={item.icon} /><span>{item.action === "order" && orderBusy ? "Đang xử lý" : item.label}</span></button>)}</div></div> : null}
      {orderError ? <small role="alert">{orderError}</small> : null}
    </article>
  );
}
