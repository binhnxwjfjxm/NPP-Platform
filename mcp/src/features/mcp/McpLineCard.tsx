"use client";

import type { McpDayLine } from "@/features/mcp-day/mcp-day.types";
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
  if (!value) return "Đã lưu GPS";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "Đã lưu GPS";
  return date.toLocaleTimeString("vi-VN", { hour: "2-digit", minute: "2-digit" });
}

function actionItems(): Array<{ label: string; action: McpCustomerAction; tone?: "primary" }> {
  return [
    { label: "Đơn", action: "order", tone: "primary" },
    { label: "Test", action: "test" },
    { label: "Quan sát", action: "market_report" },
    { label: "Theo dõi", action: "follow_up" },
    { label: "Bỏ qua", action: "skip" }
  ];
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
  const openLegacySheet = () => onOpen(line);

  function openProfile(focus: "detail" | "media") {
    requestMcpCustomerProfile({ line, focus, fallback: openLegacySheet });
  }

  return (
    <article className={`${styles.card} ${statusClass(line.status)} ${checkinEnabled ? "" : styles.withoutCheckin}`}>
      <button className={styles.main} type="button" onClick={() => openProfile("detail")}>
        <span className={styles.index}>#{line.sortOrder || "-"}</span>
        <span className={styles.identity}>
          <span className={styles.identityHead}>
            <strong>{line.accountName}</strong>
            <span className={styles.badge}>{statusLabel(line.status)}</span>
          </span>
          <small>{line.area} · {sourceLabel(line.source)}</small>
          <span className={styles.summary}>{resultSummary(line)}</span>
        </span>
      </button>
      <div className={styles.actions} data-customer-action-rows="2">
        <a
          className={`${styles.action} ${styles.directions}`}
          href={directions.url}
          target="_blank"
          rel="noreferrer"
          aria-label={directions.exact ? `Chỉ đường đến ${line.accountName}` : `Tìm ${line.accountName} trên Google Maps`}
          title={directions.exact ? "Mở chỉ đường theo GPS điểm bán đã lưu" : "Khách chưa có GPS chính xác, mở tìm kiếm Google Maps"}
        >
          ↗ Đường
        </a>
        <button
          className={`${styles.action} ${styles.photo}`}
          type="button"
          onClick={() => openProfile("media")}
          aria-label={`Xem hoặc bổ sung ảnh cho ${line.accountName}`}
          title="Xem, chụp hoặc chọn ảnh điểm bán"
        >
          📷 Ảnh
        </button>
        {actionItems().map((item) => (
          <button
            className={item.tone === "primary" ? `${styles.action} button primary` : styles.action}
            type="button"
            key={item.action}
            onClick={() => onAction(line, item.action)}
          >
            {item.label}
          </button>
        ))}
      </div>
      {onToggleCheckin ? (
        <button
          className={`${styles.checkin} ${line.checkedIn ? styles.checkinActive : ""}`}
          type="button"
          aria-pressed={line.checkedIn === true}
          aria-label={line.checkedIn ? `Bỏ check-in tại ${line.accountName}` : `Check-in vị trí hiện tại tại ${line.accountName}`}
          title={line.checkedIn ? "Bấm lần nữa để bỏ check-in nếu thao tác nhầm" : "Chỉ lấy vị trí hiện tại khi bấm nút này"}
          disabled={checkinBusy}
          onClick={() => onToggleCheckin(line)}
        >
          <span aria-hidden="true">{checkinBusy ? "…" : line.checkedIn ? "✓" : "⌖"}</span>
          <strong>{checkinBusy ? "Đang xử lý" : line.checkedIn ? "Đã check-in" : "Check-in"}</strong>
          <small>{line.checkedIn ? checkinTime(line.checkinAt) : "Lấy GPS"}</small>
        </button>
      ) : null}
    </article>
  );
}
