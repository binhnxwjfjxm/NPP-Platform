"use client";

import { ChangeEvent, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import {
  MAX_OUTLET_PHOTOS,
  buildOutletPhotoDrafts,
  outletMediaData,
  outletMediaError,
  outletMediaJson,
  uploadOutletPhoto,
  type OutletMediaLocation,
  type OutletPhotoDraft
} from "./outlet-media-client";
import styles from "./McpCustomerProfileSheet.module.css";

type OutletPhotoMedia = {
  id: string;
  capturedAt?: string | null;
  viewUrl: string;
};

type OutletPhotoProfile = {
  media?: OutletPhotoMedia[];
  mediaLimit?: number;
};

function formatDateTime(value?: string | null) {
  if (!value) return "Ảnh điểm bán";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "Ảnh điểm bán";
  return date.toLocaleString("vi-VN", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit"
  });
}

function parseProfile(payload: unknown): OutletPhotoProfile {
  const data = outletMediaData(payload) as OutletPhotoProfile;
  const requestedLimit = Number(data.mediaLimit);
  return {
    media: Array.isArray(data.media)
      ? data.media.filter((item) => item && typeof item.id === "string" && typeof item.viewUrl === "string")
      : [],
    mediaLimit: Number.isInteger(requestedLimit) && requestedLimit > 0
      ? Math.min(MAX_OUTLET_PHOTOS, requestedLimit)
      : MAX_OUTLET_PHOTOS
  };
}

export function OutletPhotoManager({
  routeCustomerId,
  sessionId = null,
  active = true,
  location = null,
  onBusyChange,
  onChanged
}: {
  routeCustomerId: string;
  sessionId?: string | null;
  active?: boolean;
  location?: OutletMediaLocation | null;
  onBusyChange?: (busy: boolean) => void;
  onChanged?: () => void | Promise<void>;
}) {
  const router = useRouter();
  const cameraInputRef = useRef<HTMLInputElement>(null);
  const galleryInputRef = useRef<HTMLInputElement>(null);
  const draftsRef = useRef<OutletPhotoDraft[]>([]);
  const loadVersionRef = useRef(0);
  const [profile, setProfile] = useState<OutletPhotoProfile | null>(null);
  const [drafts, setDrafts] = useState<OutletPhotoDraft[]>([]);
  const [loading, setLoading] = useState(false);
  const [processing, setProcessing] = useState(false);
  const [saving, setSaving] = useState(false);
  const [retrying, setRetrying] = useState(false);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  const media = profile?.media || [];
  const limit = Math.min(MAX_OUTLET_PHOTOS, profile?.mediaLimit || MAX_OUTLET_PHOTOS);
  const remaining = Math.max(0, limit - media.length - drafts.length);
  const mutationBusy = processing || saving || Boolean(deletingId);
  const busy = loading || mutationBusy;

  useEffect(() => {
    draftsRef.current = drafts;
  }, [drafts]);

  useEffect(() => {
    onBusyChange?.(mutationBusy);
  }, [mutationBusy, onBusyChange]);

  useEffect(
    () => () => {
      for (const photo of draftsRef.current) URL.revokeObjectURL(photo.previewUrl);
    },
    []
  );

  async function loadProfile() {
    if (!active || !routeCustomerId) return;
    const version = ++loadVersionRef.current;
    setLoading(true);
    setMessage(null);
    try {
      const response = await fetch(
        `/api/backend/outlet-media/customer-profile?routeCustomerId=${encodeURIComponent(routeCustomerId)}`,
        { cache: "no-store", headers: { Accept: "application/json" } }
      );
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(outletMediaError(payload, "Không tải được ảnh điểm bán"));
      if (version === loadVersionRef.current) setProfile(parseProfile(payload));
    } catch (error) {
      if (version !== loadVersionRef.current) return;
      setProfile(null);
      setMessage(error instanceof Error ? error.message : "Không tải được ảnh điểm bán");
    } finally {
      if (version === loadVersionRef.current) setLoading(false);
    }
  }

  useEffect(() => {
    if (active && routeCustomerId) {
      void loadProfile();
      return;
    }
    loadVersionRef.current += 1;
    setLoading(false);
    setProfile(null);
    setMessage(null);
  }, [active, routeCustomerId]);

  useEffect(() => {
    if (active) return;
    for (const photo of draftsRef.current) URL.revokeObjectURL(photo.previewUrl);
    setDrafts([]);
  }, [active]);

  async function addSelectedFiles(files: FileList | null) {
    if (!files?.length || busy) return;
    if (remaining <= 0) {
      setMessage(`Điểm bán chỉ lưu tối đa ${MAX_OUTLET_PHOTOS} ảnh.`);
      return;
    }
    setProcessing(true);
    setMessage(null);
    try {
      const additions = await buildOutletPhotoDrafts(files, remaining);
      setDrafts((current) => [...current, ...additions].slice(0, Math.max(0, MAX_OUTLET_PHOTOS - media.length)));
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Không xử lý được ảnh");
    } finally {
      setProcessing(false);
      if (cameraInputRef.current) cameraInputRef.current.value = "";
      if (galleryInputRef.current) galleryInputRef.current.value = "";
    }
  }

  function removeDraft(clientUploadId: string) {
    if (busy) return;
    setDrafts((current) => {
      const target = current.find((photo) => photo.clientUploadId === clientUploadId);
      if (target) URL.revokeObjectURL(target.previewUrl);
      return current.filter((photo) => photo.clientUploadId !== clientUploadId);
    });
  }

  async function savePhotos() {
    if (!routeCustomerId || busy) return;
    const pending = drafts.filter((photo) => photo.status !== "done");
    if (!pending.length) return;
    setRetrying(pending.some((photo) => photo.status === "error"));
    setSaving(true);
    setMessage(null);
    const succeeded = new Set<string>();
    const failed = new Set<string>();
    try {
      for (const photo of pending) {
        setDrafts((current) =>
          current.map((item) =>
            item.clientUploadId === photo.clientUploadId ? { ...item, status: "uploading" } : item
          )
        );
        try {
          await uploadOutletPhoto(photo, { routeCustomerId, sessionId, location });
          succeeded.add(photo.clientUploadId);
        } catch {
          failed.add(photo.clientUploadId);
        }
      }

      setDrafts((current) => {
        for (const photo of current) {
          if (succeeded.has(photo.clientUploadId)) URL.revokeObjectURL(photo.previewUrl);
        }
        return current
          .filter((photo) => !succeeded.has(photo.clientUploadId))
          .map((photo) =>
            failed.has(photo.clientUploadId) ? { ...photo, status: "error" as const } : photo
          );
      });

      await loadProfile();
      router.refresh();
      await onChanged?.();
      setMessage(
        failed.size
          ? `Đã tải ${succeeded.size} ảnh. Còn ${failed.size} ảnh lỗi, bấm Thử lại.`
          : `Đã bổ sung ${succeeded.size} ảnh cho điểm bán.`
      );
    } finally {
      setSaving(false);
      setRetrying(false);
    }
  }

  async function deletePhoto(mediaId: string) {
    if (busy || !window.confirm("Xóa ảnh này khỏi điểm bán? Ảnh trên R2 cũng sẽ được xóa.")) return;
    setDeletingId(mediaId);
    setMessage(null);
    try {
      await outletMediaJson("/api/backend/outlet-media/delete", { mediaId });
      await loadProfile();
      router.refresh();
      await onChanged?.();
      setMessage("Đã xóa ảnh điểm bán.");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Không xóa được ảnh");
    } finally {
      setDeletingId(null);
    }
  }

  if (!active || !routeCustomerId) return null;

  return (
    <section className={styles.section} data-outlet-photo-manager="true" data-route-customer-id={routeCustomerId} aria-busy={busy}>
      <div className={styles.sectionHead}>
        <div>
          <strong>Ảnh điểm bán</strong>
          <small>{media.length}/{limit} ảnh đã lưu · Thay ảnh bằng cách xóa ảnh cũ rồi thêm ảnh mới</small>
        </div>
        <span className={media.length ? styles.readyBadge : styles.missingBadge}>
          {loading ? "Đang tải" : media.length ? `${media.length} ảnh` : "Chưa có ảnh"}
        </span>
      </div>

      {media.length ? (
        <div className={styles.mediaGrid}>
          {media.map((item, index) => (
            <figure className={styles.mediaCard} key={item.id}>
              <a href={item.viewUrl} target="_blank" rel="noreferrer" aria-label={`Mở ảnh điểm bán ${index + 1}`}>
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={item.viewUrl} alt={`Ảnh điểm bán ${index + 1}`} />
              </a>
              <figcaption>
                <span>{formatDateTime(item.capturedAt)}</span>
                <button type="button" onClick={() => void deletePhoto(item.id)} disabled={busy} aria-label={`Xóa ảnh điểm bán ${index + 1}`}>
                  {deletingId === item.id ? "Đang xóa" : "Xóa"}
                </button>
              </figcaption>
            </figure>
          ))}
        </div>
      ) : loading ? (
        <div className={styles.empty}>Đang tải ảnh…</div>
      ) : (
        <div className={styles.empty}>Điểm bán này chưa có ảnh cửa hàng.</div>
      )}

      {drafts.length ? (
        <div className={styles.draftGrid}>
          {drafts.map((photo) => (
            <figure className={styles.draftCard} key={photo.clientUploadId}>
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={photo.previewUrl} alt="Ảnh điểm bán đang chờ tải" />
              <figcaption>
                <span>{photo.status === "uploading" ? "Đang tải" : photo.status === "error" ? "Lỗi tải" : "Chờ tải"}</span>
                {photo.status !== "uploading" ? (
                  <button type="button" onClick={() => removeDraft(photo.clientUploadId)} disabled={busy}>Bỏ</button>
                ) : null}
              </figcaption>
            </figure>
          ))}
        </div>
      ) : null}

      <div className={styles.mediaActions}>
        <button className="button" type="button" onClick={() => cameraInputRef.current?.click()} disabled={busy || remaining <= 0}>📷 Chụp</button>
        <button className="button" type="button" onClick={() => galleryInputRef.current?.click()} disabled={busy || remaining <= 0}>▧ Thư viện</button>
        {drafts.length ? (
          <button className="button primary" type="button" onClick={() => void savePhotos()} disabled={busy}>
            {retrying || drafts.some((photo) => photo.status === "error") ? "Thử lại" : saving ? "Đang tải…" : `Lưu ${drafts.length} ảnh`}
          </button>
        ) : null}
      </div>
      <input ref={cameraInputRef} className={styles.fileInput} type="file" accept="image/*" capture="environment" onChange={(event: ChangeEvent<HTMLInputElement>) => void addSelectedFiles(event.target.files)} />
      <input ref={galleryInputRef} className={styles.fileInput} type="file" accept="image/*" multiple onChange={(event: ChangeEvent<HTMLInputElement>) => void addSelectedFiles(event.target.files)} />
      {message ? <p className={styles.message} role="status">{message}</p> : null}
    </section>
  );
}
