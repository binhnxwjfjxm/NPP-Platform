"use client";

import { ChangeEvent, FormEvent, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { idempotentMutationFetch } from "@/lib/api/idempotent-fetch";
import { BottomSheet } from "@/ui/overlay/BottomSheet";
import {
  MAX_OUTLET_PHOTOS,
  buildOutletPhotoDrafts,
  outletMediaData,
  outletMediaError,
  uploadOutletPhoto,
  type OutletPhotoDraft
} from "./outlet-media-client";

type AddCustomerDraft = {
  customerName: string;
  phone: string;
  area: string;
  address: string;
  note: string;
};

type CapturedLocation = { lat: number; lng: number; accuracy: number };
type CreatedCustomer = { routeCustomerId: string; sessionCustomerId: string };

const EMPTY_DRAFT: AddCustomerDraft = {
  customerName: "",
  phone: "",
  area: "",
  address: "",
  note: ""
};

function geolocationErrorMessage(error: GeolocationPositionError) {
  if (error.code === 1) return "Điện thoại chưa cấp quyền vị trí cho phần mềm";
  if (error.code === 2) return "Thiết bị chưa xác định được vị trí";
  if (error.code === 3) return "Lấy vị trí quá lâu, vui lòng thử lại";
  return "Không lấy được vị trí hiện tại";
}

export function McpSessionAddCustomerButton({
  sessionId,
  routeName
}: {
  sessionId: string;
  routeName: string;
}) {
  const router = useRouter();
  const cameraInputRef = useRef<HTMLInputElement>(null);
  const galleryInputRef = useRef<HTMLInputElement>(null);
  const photosRef = useRef<OutletPhotoDraft[]>([]);
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState<AddCustomerDraft>(EMPTY_DRAFT);
  const [location, setLocation] = useState<CapturedLocation | null>(null);
  const [photos, setPhotos] = useState<OutletPhotoDraft[]>([]);
  const [createdCustomer, setCreatedCustomer] = useState<CreatedCustomer | null>(null);
  const [locating, setLocating] = useState(false);
  const [processingPhoto, setProcessingPhoto] = useState(false);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  useEffect(() => {
    photosRef.current = photos;
  }, [photos]);

  useEffect(
    () => () => {
      for (const photo of photosRef.current) URL.revokeObjectURL(photo.previewUrl);
    },
    []
  );

  function update(field: keyof AddCustomerDraft, value: string) {
    setDraft((current) => ({ ...current, [field]: value }));
  }

  function reset() {
    for (const photo of photosRef.current) URL.revokeObjectURL(photo.previewUrl);
    setDraft(EMPTY_DRAFT);
    setLocation(null);
    setPhotos([]);
    setCreatedCustomer(null);
    setMessage(null);
  }

  function close() {
    if (saving || locating || processingPhoto) return;
    setOpen(false);
    if (!createdCustomer) setMessage(null);
  }

  function captureLocation() {
    setMessage(null);
    if (!navigator.geolocation) {
      setMessage("Thiết bị hoặc trình duyệt không hỗ trợ định vị");
      return;
    }
    setLocating(true);
    navigator.geolocation.getCurrentPosition(
      (position) => {
        setLocation({
          lat: position.coords.latitude,
          lng: position.coords.longitude,
          accuracy: position.coords.accuracy
        });
        setLocating(false);
      },
      (error) => {
        setMessage(geolocationErrorMessage(error));
        setLocating(false);
      },
      { enableHighAccuracy: true, timeout: 15000, maximumAge: 0 }
    );
  }

  async function addSelectedFiles(files: FileList | null) {
    if (!files?.length) return;
    const available = MAX_OUTLET_PHOTOS - photos.length;
    if (available <= 0) {
      setMessage(`Chỉ chọn tối đa ${MAX_OUTLET_PHOTOS} ảnh`);
      return;
    }
    setProcessingPhoto(true);
    setMessage(null);
    try {
      const additions = await buildOutletPhotoDrafts(files, available);
      setPhotos((current) => [...current, ...additions]);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Không xử lý được ảnh");
    } finally {
      setProcessingPhoto(false);
      if (cameraInputRef.current) cameraInputRef.current.value = "";
      if (galleryInputRef.current) galleryInputRef.current.value = "";
    }
  }

  function removePhoto(clientUploadId: string) {
    setPhotos((current) => {
      const target = current.find((photo) => photo.clientUploadId === clientUploadId);
      if (target) URL.revokeObjectURL(target.previewUrl);
      return current.filter((photo) => photo.clientUploadId !== clientUploadId);
    });
  }

  async function createCustomer() {
    const response = await idempotentMutationFetch(
      "/api/backend/mcp-day/session-customer/add",
      {
        method: "POST",
        cache: "no-store",
        headers: { Accept: "application/json", "Content-Type": "application/json" },
        body: JSON.stringify({
          sessionId,
          customerName: draft.customerName.trim(),
          phone: draft.phone.trim() || undefined,
          area: draft.area.trim() || undefined,
          address: draft.address.trim() || undefined,
          note: draft.note.trim() || undefined,
          geoLat: location?.lat,
          geoLng: location?.lng,
          geoAccuracy: location?.accuracy,
          geoSource: location ? "browser" : undefined
        })
      },
      { operation: "session-customer.add" }
    );
    const payload = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(outletMediaError(payload, "Không thêm được khách"));
    const data = outletMediaData(payload);
    const routeCustomer = (data.routeCustomer || {}) as Record<string, unknown>;
    const sessionCustomer = (data.sessionCustomer || {}) as Record<string, unknown>;
    const result = {
      routeCustomerId: String(routeCustomer.id || ""),
      sessionCustomerId: String(sessionCustomer.id || "")
    };
    if (!result.routeCustomerId || !result.sessionCustomerId) {
      throw new Error("Backend chưa trả mã điểm bán vừa tạo");
    }
    setCreatedCustomer(result);
    return result;
  }

  async function uploadPhoto(photo: OutletPhotoDraft, customer: CreatedCustomer) {
    setPhotos((current) =>
      current.map((item) =>
        item.clientUploadId === photo.clientUploadId ? { ...item, status: "uploading" } : item
      )
    );
    try {
      await uploadOutletPhoto(photo, {
        routeCustomerId: customer.routeCustomerId,
        sessionId,
        location
      });
      setPhotos((current) =>
        current.map((item) =>
          item.clientUploadId === photo.clientUploadId ? { ...item, status: "done" } : item
        )
      );
      return true;
    } catch {
      setPhotos((current) =>
        current.map((item) =>
          item.clientUploadId === photo.clientUploadId ? { ...item, status: "error" } : item
        )
      );
      return false;
    }
  }

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!createdCustomer && !draft.customerName.trim()) {
      setMessage("Cần nhập tên khách");
      return;
    }
    setSaving(true);
    setMessage(null);
    try {
      const customer = createdCustomer || (await createCustomer());
      const pending = photos.filter((photo) => photo.status !== "done");
      const results: boolean[] = [];
      for (const photo of pending) results.push(await uploadPhoto(photo, customer));
      const failed = results.filter((ok) => !ok).length;
      if (failed > 0) {
        setMessage(`Đã tạo điểm bán. Còn ${failed} ảnh chưa tải lên, bấm Thử lại ảnh.`);
        return;
      }
      reset();
      setOpen(false);
      router.refresh();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Không thêm được khách");
    } finally {
      setSaving(false);
    }
  }

  const busy = saving || locating || processingPhoto;
  const pendingPhotoCount = photos.filter((photo) => photo.status !== "done").length;

  return (
    <>
      <button
        className="mcp-add-customer-fab"
        type="button"
        aria-label="Thêm khách vào phiên và tuyến"
        onClick={() => {
          setMessage(null);
          setOpen(true);
        }}
      >
        <span aria-hidden="true">＋</span>
        <b>Thêm khách</b>
      </button>
      <BottomSheet
        open={open}
        onClose={close}
        title="Thêm khách"
        description={`${routeName} · khách được lưu vào tuyến gốc và phiên hiện tại`}
        footer={
          <div className="sheet-action-grid">
            <button
              className="button primary"
              type="submit"
              form="mcp-add-session-customer-form"
              disabled={busy}
            >
              {saving
                ? "Đang lưu..."
                : createdCustomer && pendingPhotoCount
                  ? "Thử lại ảnh"
                  : "Thêm khách"}
            </button>
            <button className="button" type="button" onClick={close} disabled={busy}>
              Đóng
            </button>
          </div>
        }
      >
        <form id="mcp-add-session-customer-form" className="mcp-add-customer-form" onSubmit={submit}>
          <label className="form-field">
            <small>Tên khách *</small>
            <input
              autoFocus
              value={draft.customerName}
              onChange={(event) => update("customerName", event.target.value)}
              placeholder="Tên cửa hàng / điểm bán"
              disabled={saving || Boolean(createdCustomer)}
            />
          </label>
          <div className="mcp-add-customer-grid">
            <label className="form-field">
              <small>Điện thoại</small>
              <input
                inputMode="tel"
                value={draft.phone}
                onChange={(event) => update("phone", event.target.value)}
                placeholder="Số điện thoại"
                disabled={saving || Boolean(createdCustomer)}
              />
            </label>
            <label className="form-field">
              <small>Khu vực</small>
              <input
                value={draft.area}
                onChange={(event) => update("area", event.target.value)}
                placeholder="Ấp / xã / huyện"
                disabled={saving || Boolean(createdCustomer)}
              />
            </label>
          </div>
          <label className="form-field">
            <small>Địa chỉ</small>
            <input
              value={draft.address}
              onChange={(event) => update("address", event.target.value)}
              placeholder="Địa chỉ điểm bán"
              disabled={saving || Boolean(createdCustomer)}
            />
          </label>
          <section className="mcp-add-customer-photo">
            <div>
              <strong>Ảnh cửa hàng</strong>
              <small>Tối đa {MAX_OUTLET_PHOTOS} ảnh · tự thu nhỏ trước khi tải lên</small>
            </div>
            <div className="mcp-add-customer-photo-actions">
              <button
                className="button"
                type="button"
                onClick={() => cameraInputRef.current?.click()}
                disabled={busy || photos.length >= MAX_OUTLET_PHOTOS}
              >
                📷 Chụp ảnh
              </button>
              <button
                className="button"
                type="button"
                onClick={() => galleryInputRef.current?.click()}
                disabled={busy || photos.length >= MAX_OUTLET_PHOTOS}
              >
                ▧ Thư viện
              </button>
            </div>
            <input
              ref={cameraInputRef}
              className="mcp-photo-input"
              type="file"
              accept="image/*"
              capture="environment"
              onChange={(event: ChangeEvent<HTMLInputElement>) => void addSelectedFiles(event.target.files)}
            />
            <input
              ref={galleryInputRef}
              className="mcp-photo-input"
              type="file"
              accept="image/*"
              multiple
              onChange={(event: ChangeEvent<HTMLInputElement>) => void addSelectedFiles(event.target.files)}
            />
            {photos.length ? (
              <div className="mcp-photo-preview-grid">
                {photos.map((photo) => (
                  <figure key={photo.clientUploadId} className={`mcp-photo-preview ${photo.status}`}>
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img src={photo.previewUrl} alt="Ảnh cửa hàng đã chọn" />
                    <figcaption>
                      {photo.status === "uploading"
                        ? "Đang tải"
                        : photo.status === "done"
                          ? "Đã tải"
                          : photo.status === "error"
                            ? "Lỗi tải"
                            : "Sẵn sàng"}
                    </figcaption>
                    {photo.status !== "done" && photo.status !== "uploading" ? (
                      <button
                        type="button"
                        aria-label="Xóa ảnh"
                        onClick={() => removePhoto(photo.clientUploadId)}
                      >
                        ×
                      </button>
                    ) : null}
                  </figure>
                ))}
              </div>
            ) : null}
          </section>
          <section
            className={location ? "mcp-add-customer-location captured" : "mcp-add-customer-location"}
            aria-live="polite"
          >
            <div>
              <strong>Định vị điểm bán</strong>
              <small>
                {location
                  ? `Đã lấy GPS · sai số khoảng ${Math.round(location.accuracy)}m`
                  : "Đứng tại điểm bán rồi lấy vị trí để sales có thể chỉ đường chính xác."}
              </small>
            </div>
            <button
              className="button"
              type="button"
              onClick={captureLocation}
              disabled={busy || Boolean(createdCustomer)}
            >
              {locating ? "Đang lấy vị trí..." : location ? "Lấy lại vị trí" : "⌖ Lấy vị trí hiện tại"}
            </button>
          </section>
          <label className="form-field">
            <small>Ghi chú</small>
            <textarea
              value={draft.note}
              onChange={(event) => update("note", event.target.value)}
              placeholder="Thông tin cần nhớ"
              disabled={saving || Boolean(createdCustomer)}
            />
          </label>
          {message ? (
            <p className="mcp-add-customer-message" role="alert">
              {message}
            </p>
          ) : null}
        </form>
      </BottomSheet>
    </>
  );
}
