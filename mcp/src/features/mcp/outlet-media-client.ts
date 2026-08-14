import {
  CUSTOMER_MEDIA_MAX_PHOTOS,
  compressCustomerPhoto,
} from "@npp/contracts/customer-media-browser";

export type OutletMediaLocation = {
  lat: number;
  lng: number;
  accuracy?: number | null;
};

export type OutletPhotoDraft = {
  clientUploadId: string;
  file: File;
  previewUrl: string;
  width: number;
  height: number;
  status: "pending" | "uploading" | "done" | "error";
};

export const MAX_OUTLET_PHOTOS = CUSTOMER_MEDIA_MAX_PHOTOS;

function object(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

export function outletMediaError(payload: unknown, fallback = "Không xử lý được ảnh") {
  const body = object(payload);
  const error = body.error;
  const errorBody = object(error);
  const code = String(errorBody.code || (typeof error === "string" ? error : "") || body.detail || "");
  if (code === "outlet_media_limit_reached") return `Điểm bán chỉ lưu tối đa ${MAX_OUTLET_PHOTOS} ảnh.`;
  if (typeof error === "string") return error;
  return String(errorBody.message || errorBody.code || body.detail || body.message || fallback);
}

export function outletMediaData(payload: unknown) {
  const first = object(object(payload).data);
  const nested = object(first.data);
  return Object.keys(nested).length ? nested : first;
}

export async function outletMediaJson(path: string, body: unknown) {
  const response = await fetch(path, {
    method: "POST",
    cache: "no-store",
    headers: { Accept: "application/json", "Content-Type": "application/json" },
    body: JSON.stringify(body)
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(outletMediaError(payload));
  return outletMediaData(payload);
}

export async function compressOutletPhoto(source: File) {
  return compressCustomerPhoto(source);
}

export async function buildOutletPhotoDrafts(files: FileList | File[], available: number) {
  const drafts: OutletPhotoDraft[] = [];
  for (const source of Array.from(files).slice(0, Math.max(0, available))) {
    if (!source.type.startsWith("image/")) continue;
    const compressed = await compressOutletPhoto(source);
    drafts.push({
      clientUploadId: crypto.randomUUID(),
      file: compressed.file,
      previewUrl: URL.createObjectURL(compressed.file),
      width: compressed.width,
      height: compressed.height,
      status: "pending"
    });
  }
  return drafts;
}

export async function uploadOutletPhoto(
  photo: OutletPhotoDraft,
  target: {
    routeCustomerId: string;
    sessionId?: string | null;
    location?: OutletMediaLocation | null;
  }
) {
  const init = await outletMediaJson("/api/backend/outlet-media/upload-init", {
    routeCustomerId: target.routeCustomerId,
    sessionId: target.sessionId || undefined,
    clientUploadId: photo.clientUploadId,
    mimeType: photo.file.type,
    byteSize: photo.file.size,
    geoLat: target.location?.lat,
    geoLng: target.location?.lng,
    geoAccuracy: target.location?.accuracy
  });
  const putUrl = String(init.putUrl || "");
  const mediaId = String(init.mediaId || "");
  if (!putUrl || !mediaId) throw new Error("Backend chưa cấp URL tải ảnh");

  const upload = await fetch(putUrl, {
    method: "PUT",
    headers: { "Content-Type": photo.file.type },
    body: photo.file
  });
  if (!upload.ok) throw new Error(`R2 từ chối ảnh (${upload.status})`);

  await outletMediaJson("/api/backend/outlet-media/upload-finalize", {
    mediaId,
    width: photo.width,
    height: photo.height
  });
  return mediaId;
}
