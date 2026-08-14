export const CUSTOMER_MEDIA_MAX_PHOTOS: number;
export const CUSTOMER_MEDIA_MAX_IMAGE_BYTES: number;
export const CUSTOMER_MEDIA_MAX_IMAGE_EDGE: number;
export const CUSTOMER_MEDIA_JPEG_QUALITY: number;

export type CompressedCustomerPhoto = {
  file: File;
  width: number;
  height: number;
};

export function compressCustomerPhoto(
  source: File,
  options?: { maxEdge?: number; maxBytes?: number; jpegQuality?: number },
): Promise<CompressedCustomerPhoto>;
