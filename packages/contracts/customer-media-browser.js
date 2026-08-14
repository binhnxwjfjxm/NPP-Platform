export const CUSTOMER_MEDIA_MAX_PHOTOS = 3;
export const CUSTOMER_MEDIA_MAX_IMAGE_BYTES = 5 * 1024 * 1024;
export const CUSTOMER_MEDIA_MAX_IMAGE_EDGE = 1600;
export const CUSTOMER_MEDIA_JPEG_QUALITY = 0.82;

async function loadDrawable(source) {
  if (!(source instanceof Blob)) throw new Error('customer_media_file_required');
  if (typeof createImageBitmap === 'function') {
    const bitmap = await createImageBitmap(source);
    return {
      source: bitmap,
      width: bitmap.width,
      height: bitmap.height,
      cleanup: () => bitmap.close(),
    };
  }

  const url = URL.createObjectURL(source);
  const image = await new Promise((resolve, reject) => {
    const target = new Image();
    target.onload = () => resolve(target);
    target.onerror = () => reject(new Error('Không đọc được ảnh trên thiết bị này'));
    target.src = url;
  });
  return {
    source: image,
    width: image.naturalWidth,
    height: image.naturalHeight,
    cleanup: () => URL.revokeObjectURL(url),
  };
}

export async function compressCustomerPhoto(source, {
  maxEdge = CUSTOMER_MEDIA_MAX_IMAGE_EDGE,
  maxBytes = CUSTOMER_MEDIA_MAX_IMAGE_BYTES,
  jpegQuality = CUSTOMER_MEDIA_JPEG_QUALITY,
} = {}) {
  if (!(source instanceof File) || !source.type.startsWith('image/')) {
    throw new Error('Chỉ chấp nhận tập tin hình ảnh');
  }
  if (!Number.isInteger(maxEdge) || maxEdge < 1) throw new Error('customer_media_max_edge_invalid');
  if (!Number.isInteger(maxBytes) || maxBytes < 1) throw new Error('customer_media_max_bytes_invalid');
  if (!(jpegQuality > 0 && jpegQuality <= 1)) throw new Error('customer_media_jpeg_quality_invalid');

  const drawable = await loadDrawable(source);
  try {
    const scale = Math.min(1, maxEdge / Math.max(drawable.width, drawable.height));
    const width = Math.max(1, Math.round(drawable.width * scale));
    const height = Math.max(1, Math.round(drawable.height * scale));
    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    const context = canvas.getContext('2d');
    if (!context) throw new Error('Không xử lý được ảnh trên thiết bị này');
    context.drawImage(drawable.source, 0, 0, width, height);
    const blob = await new Promise((resolve) => canvas.toBlob(resolve, 'image/jpeg', jpegQuality));
    if (!blob) throw new Error('Không nén được ảnh');
    if (blob.size > maxBytes) throw new Error('Ảnh vẫn lớn hơn 5MB sau khi nén');
    const baseName = source.name.replace(/\.[^.]+$/, '') || 'khach-hang';
    return {
      file: new File([blob], `${baseName}.jpg`, { type: 'image/jpeg' }),
      width,
      height,
    };
  } finally {
    drawable.cleanup();
  }
}
