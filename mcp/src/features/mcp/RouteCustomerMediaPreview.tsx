"use client";

import { useEffect, useState } from "react";
import { outletMediaData, outletMediaError } from "./outlet-media-client";
import styles from "./McpCustomerProfileSheet.module.css";

type RouteCustomerMedia = {
  id: string;
  capturedAt?: string | null;
  viewUrl: string;
};

type RouteCustomerMediaPayload = {
  media?: unknown;
  mediaLimit?: number;
};

function parseMedia(payload: unknown): RouteCustomerMedia[] {
  const data = outletMediaData(payload) as RouteCustomerMediaPayload;
  if (!Array.isArray(data.media)) return [];
  return data.media.flatMap((value) => {
    if (!value || typeof value !== "object") return [];
    const item = value as { id?: unknown; capturedAt?: unknown; viewUrl?: unknown };
    if (typeof item.id !== "string" || typeof item.viewUrl !== "string" || !item.viewUrl) return [];
    return [{
      id: item.id,
      capturedAt: typeof item.capturedAt === "string" ? item.capturedAt : null,
      viewUrl: item.viewUrl
    }];
  });
}

function formatCapturedAt(value?: string | null) {
  if (!value) return "Ảnh điểm bán";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "Ảnh điểm bán";
  return date.toLocaleDateString("vi-VN", { day: "2-digit", month: "2-digit", year: "numeric" });
}

export function RouteCustomerMediaPreview({
  routeCustomerId,
  customerName
}: {
  routeCustomerId: string;
  customerName: string;
}) {
  const [media, setMedia] = useState<RouteCustomerMedia[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [reloadToken, setReloadToken] = useState(0);

  useEffect(() => {
    const controller = new AbortController();
    setMedia([]);
    setError(null);
    setLoading(true);

    async function loadMedia() {
      try {
        const response = await fetch(
          `/api/backend/outlet-media/customer-profile?routeCustomerId=${encodeURIComponent(routeCustomerId)}`,
          {
            cache: "no-store",
            headers: { Accept: "application/json" },
            signal: controller.signal
          }
        );
        const payload = await response.json().catch(() => ({}));
        if (!response.ok) throw new Error(outletMediaError(payload, "Không tải được ảnh điểm bán"));
        setMedia(parseMedia(payload));
      } catch (loadError) {
        if (controller.signal.aborted) return;
        setError(loadError instanceof Error ? loadError.message : "Không tải được ảnh điểm bán");
      } finally {
        if (!controller.signal.aborted) setLoading(false);
      }
    }

    void loadMedia();
    return () => controller.abort();
  }, [routeCustomerId, reloadToken]);

  return (
    <section className={styles.section} data-route-customer-media-preview="true">
      <div className={styles.sectionHead}>
        <div>
          <strong>Ảnh điểm bán</strong>
          <small>Ảnh riêng tư của khách · vuốt ngang hoặc bấm ảnh để xem lớn</small>
        </div>
        <span className={media.length ? styles.readyBadge : styles.missingBadge}>
          {loading ? "Đang tải" : media.length ? `${media.length} ảnh` : "Chưa có ảnh"}
        </span>
      </div>

      {loading ? (
        <div className={styles.empty}>Đang tải ảnh điểm bán…</div>
      ) : error ? (
        <>
          <p className={styles.message}>{error}</p>
          <button className="button" type="button" onClick={() => setReloadToken((value) => value + 1)}>
            Tải lại ảnh
          </button>
        </>
      ) : media.length ? (
        <div className={styles.previewScroller} data-route-customer-media-gallery="true">
          {media.map((item, index) => (
            <figure className={styles.previewCard} key={item.id}>
              <a
                href={item.viewUrl}
                target="_blank"
                rel="noreferrer"
                aria-label={`Mở ảnh ${index + 1} của ${customerName}`}
              >
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={item.viewUrl} alt={`Ảnh điểm bán ${customerName} ${index + 1}`} loading="lazy" />
              </a>
              <figcaption>
                <span>{formatCapturedAt(item.capturedAt)}</span>
                <strong>{index + 1}/{media.length}</strong>
              </figcaption>
            </figure>
          ))}
        </div>
      ) : (
        <div className={styles.empty}>Khách này chưa có ảnh cửa hàng.</div>
      )}
    </section>
  );
}
