"use client";

import { useEffect, useState } from "react";
import { BottomSheet } from "@/ui/overlay/BottomSheet";
import type { McpDayLine } from "@/features/mcp-day/mcp-day.types";
import { outletMediaData, outletMediaError } from "./outlet-media-client";
import type { McpCustomerProfileFocus } from "./mcp-customer-profile-events";
import { OutletPhotoManager } from "./OutletPhotoManager";
import styles from "./McpCustomerProfileSheet.module.css";

type CustomerGeo = {
  lat: number;
  lng: number;
  accuracy?: number | null;
  capturedAt?: string | null;
  source?: string | null;
};

type CustomerProfile = {
  id: string;
  routeId?: string | null;
  customerId?: string | null;
  customerName: string;
  phone?: string | null;
  area?: string | null;
  address?: string | null;
  sortOrder?: number | null;
  active: boolean;
  note?: string | null;
  createdAt?: string | null;
  updatedAt?: string | null;
  geo?: CustomerGeo | null;
  googleMapsUrl?: string | null;
  syncStatus?: string | null;
};

type ProfilePayload = {
  customer: CustomerProfile;
};

function formatDateTime(value?: string | null) {
  if (!value) return "—";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleString("vi-VN", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit"
  });
}

function visitStatus(line: McpDayLine) {
  if (line.status === "visited") return "Đã ghé";
  if (line.status === "skipped") return "Bỏ qua / không mua";
  if (line.status === "cancelled") return "Đã hủy";
  return "Chờ ghé";
}

function sourceLabel(line: McpDayLine) {
  if (line.source === "added") return "Phát sinh";
  if (line.source === "planned") return "Tuyến gốc";
  return "Đồng bộ";
}

function activitySummary(line: McpDayLine) {
  const values = [
    line.hasOrder ? "Có đơn" : null,
    line.hasTest ? "Có thử sản phẩm" : null,
    line.hasReport ? "Có quan sát" : null,
    Number(line.followupCount || 0) > 0 ? `${line.followupCount} việc theo dõi` : null
  ].filter(Boolean);
  return values.length ? values.join(" · ") : line.result || line.note || "Chưa có kết quả";
}

function mapsUrl(customer: CustomerProfile) {
  if (customer.googleMapsUrl) return customer.googleMapsUrl;
  if (!customer.geo) return null;
  return `https://www.google.com/maps/search/?api=1&query=${customer.geo.lat},${customer.geo.lng}`;
}

export function McpCustomerProfileSheet({
  line,
  sessionId,
  routeName,
  focus,
  open,
  onClose,
  onOpenActions
}: {
  line: McpDayLine | null;
  sessionId: string;
  routeName: string;
  focus: McpCustomerProfileFocus;
  open: boolean;
  onClose: () => void;
  onOpenActions?: () => void;
}) {
  const [profile, setProfile] = useState<ProfilePayload | null>(null);
  const [loading, setLoading] = useState(false);
  const [mediaBusy, setMediaBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const routeCustomerId = line?.routeCustomerId || "";
  const busy = loading || mediaBusy;

  async function loadProfile() {
    if (!routeCustomerId) {
      setProfile(null);
      setMessage("Điểm bán này chưa có mã khách tuyến để tải hồ sơ ảnh.");
      return;
    }
    setLoading(true);
    setMessage(null);
    try {
      const response = await fetch(
        `/api/backend/outlet-media/customer-profile?routeCustomerId=${encodeURIComponent(routeCustomerId)}`,
        { cache: "no-store", headers: { Accept: "application/json" } }
      );
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(outletMediaError(payload, "Không tải được hồ sơ khách"));
      setProfile(outletMediaData(payload) as unknown as ProfilePayload);
    } catch (error) {
      setProfile(null);
      setMessage(error instanceof Error ? error.message : "Không tải được hồ sơ khách");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    if (!open || !routeCustomerId) return;
    void loadProfile();
  }, [open, routeCustomerId]);

  useEffect(() => {
    if (open) return;
    setProfile(null);
    setMessage(null);
    setMediaBusy(false);
  }, [open]);

  function close() {
    if (busy) return;
    onClose();
  }

  function openActions() {
    if (busy || !onOpenActions) return;
    onClose();
    queueMicrotask(onOpenActions);
  }

  const customer = profile?.customer;
  const mapLink = customer ? mapsUrl(customer) : null;
  const mediaSection = (
    <OutletPhotoManager
      routeCustomerId={routeCustomerId}
      sessionId={sessionId}
      active={open && Boolean(routeCustomerId)}
      onBusyChange={setMediaBusy}
      onChanged={loadProfile}
    />
  );

  const detailSection = (
    <section className={styles.section}>
      <div className={styles.sectionHead}>
        <div>
          <strong>Thông tin điểm bán</strong>
          <small>{routeName} · #{customer?.sortOrder || line?.sortOrder || "—"}</small>
        </div>
        <span className={customer?.active === false ? styles.missingBadge : styles.readyBadge}>
          {customer?.active === false ? "Ngừng hoạt động" : "Đang hoạt động"}
        </span>
      </div>
      {loading && !customer ? <div className={styles.empty}>Đang tải hồ sơ…</div> : null}
      {customer ? (
        <div className={styles.profileGrid}>
          <div><small>Tên điểm bán</small><strong>{customer.customerName}</strong></div>
          <div><small>Điện thoại</small>{customer.phone ? <a href={`tel:${customer.phone}`}>{customer.phone}</a> : <span>Chưa có</span>}</div>
          <div className={styles.wide}><small>Địa chỉ</small><strong>{customer.address || "Chưa có địa chỉ"}</strong></div>
          <div><small>Khu vực</small><strong>{customer.area || line?.area || "Chưa có"}</strong></div>
          <div><small>Nguồn khách</small><strong>{line ? sourceLabel(line) : "—"}</strong></div>
          <div><small>Trạng thái ghé</small><strong>{line ? visitStatus(line) : "—"}</strong></div>
          <div><small>Check-in</small><strong>{line?.checkedIn ? formatDateTime(line.checkinAt) : "Chưa check-in"}</strong></div>
          <div><small>GPS điểm bán</small><strong>{customer.geo ? `Có · sai số ${Math.round(customer.geo.accuracy || 0)}m` : "Chưa có"}</strong></div>
          <div className={styles.wide}><small>Kết quả trong phiên</small><strong>{line ? activitySummary(line) : "—"}</strong></div>
          <div className={styles.wide}><small>Ghi chú khách</small><strong>{customer.note || line?.note || "Chưa có ghi chú"}</strong></div>
          <div><small>Cập nhật</small><strong>{formatDateTime(customer.updatedAt)}</strong></div>
          <div><small>Đồng bộ</small><strong>{customer.syncStatus || "—"}</strong></div>
        </div>
      ) : null}
      {mapLink ? (
        <a className={styles.mapLink} href={mapLink} target="_blank" rel="noreferrer">
          ↗ Mở vị trí điểm bán trên Google Maps
        </a>
      ) : null}
    </section>
  );

  return (
    <BottomSheet
      variant="compact"
      open={open}
      onClose={close}
      title={line?.accountName || "Hồ sơ điểm bán"}
      description={focus === "media" ? "Bổ sung và quản lý ảnh điểm bán" : "Toàn bộ thông tin và ảnh điểm bán"}
      footer={
        <div className={styles.footer}>
          {onOpenActions ? (
            <button className="button primary" type="button" onClick={openActions} disabled={busy}>Thao tác bán hàng</button>
          ) : null}
          <button className="button" type="button" onClick={close} disabled={busy}>Đóng</button>
        </div>
      }
    >
      <div className={styles.content}>
        {focus === "media" ? mediaSection : detailSection}
        {focus === "media" ? detailSection : mediaSection}
        {message ? <p className={styles.message} role="status">{message}</p> : null}
      </div>
    </BottomSheet>
  );
}
