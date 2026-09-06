export const PRODUCT_IMAGE_MAX_EDGE = 1600;
export const PRODUCT_IMAGE_WEBP_QUALITY = 0.82;
export const PRODUCT_IMAGE_INPUT_MAX_BYTES = 20 * 1024 * 1024;

const PRODUCT_CODE_PATTERN = /^[A-Z0-9_-]{1,64}$/;
const INPUT_TYPES = new Set(['image/jpeg', 'image/png', 'image/webp']);

export type ProductImageIndex = {
  baseUrl: string;
  codes: string[];
};

export type ProductImagePrepare = {
  productId: string;
  productCode: string;
  publicUrl: string;
  uploadUrl: string;
  uploadHeaders: Record<string, string>;
  expiresIn: number;
};

export type ProductImageMutation = {
  productId: string;
  productCode: string;
  imageUrl: string;
  byteSize?: number;
  deleted?: boolean;
};

export function productImageUrl(baseUrl: string, productCode: string, version?: string | number | null) {
  const base = String(baseUrl ?? '').trim().replace(/\/+$/, '');
  const code = String(productCode ?? '').trim().toUpperCase();
  if (!base || !PRODUCT_CODE_PATTERN.test(code)) return '';
  const url = `${base}/${encodeURIComponent(code)}.webp`;
  return version === undefined || version === null || String(version) === ''
    ? url
    : `${url}?v=${encodeURIComponent(String(version))}`;
}

function imageDimensions(width: number, height: number) {
  if (!Number.isFinite(width) || !Number.isFinite(height) || width < 1 || height < 1) {
    throw new Error('Không đọc được kích thước ảnh.');
  }
  const longest = Math.max(width, height);
  if (longest <= PRODUCT_IMAGE_MAX_EDGE) return { width, height };
  const ratio = PRODUCT_IMAGE_MAX_EDGE / longest;
  return {
    width: Math.max(1, Math.round(width * ratio)),
    height: Math.max(1, Math.round(height * ratio)),
  };
}

function canvasToWebp(canvas: HTMLCanvasElement) {
  return new Promise<Blob>((resolve, reject) => {
    canvas.toBlob((blob) => {
      if (!blob) {
        reject(new Error('Trình duyệt không thể chuyển ảnh sang WebP.'));
        return;
      }
      resolve(blob);
    }, 'image/webp', PRODUCT_IMAGE_WEBP_QUALITY);
  });
}

export async function resizeProductImage(file: File) {
  if (!INPUT_TYPES.has(file.type)) {
    throw new Error('Chọn ảnh JPG, PNG hoặc WebP.');
  }
  if (!Number.isInteger(file.size) || file.size < 1 || file.size > PRODUCT_IMAGE_INPUT_MAX_BYTES) {
    throw new Error('Ảnh gốc tối đa 20 MB.');
  }
  if (typeof createImageBitmap !== 'function') {
    throw new Error('Trình duyệt này chưa hỗ trợ xử lý ảnh trước khi tải lên.');
  }

  const bitmap = await createImageBitmap(file, { imageOrientation: 'from-image' });
  try {
    const size = imageDimensions(bitmap.width, bitmap.height);
    const canvas = document.createElement('canvas');
    canvas.width = size.width;
    canvas.height = size.height;
    const context = canvas.getContext('2d');
    if (!context) throw new Error('Không thể chuẩn bị ảnh.');
    context.drawImage(bitmap, 0, 0, size.width, size.height);
    const blob = await canvasToWebp(canvas);
    return Object.freeze({
      blob,
      width: size.width,
      height: size.height,
      originalByteSize: file.size,
      byteSize: blob.size,
      mimeType: 'image/webp' as const,
    });
  } finally {
    bitmap.close();
  }
}
