/**
 * Exports the existing Retail print preview, never reconstructs a second receipt
 * or changes the physical-printer path. Used by both order entry and history.
 */
export function receiptImageFilename(orderNumber: string | null): string {
  const normalized = String(orderNumber || 'don-hang').trim().replace(/[^A-Za-z0-9._-]+/g, '-').replace(/^[-.]+|[-.]+$/g, '');
  return `Phieu-ban-hang-${normalized || 'don-hang'}.png`;
}

export async function captureReceiptPng(documentElement: HTMLElement): Promise<Blob> {
  if (!documentElement.isConnected) throw new Error('RECEIPT_NOT_MOUNTED');
  await document.fonts?.ready;
  const width = Math.ceil(documentElement.scrollWidth);
  const height = Math.ceil(documentElement.scrollHeight);
  if (width <= 0 || height <= 0) throw new Error('RECEIPT_EMPTY');

  // Bound PNG canvas dimensions on mobile; preserve the full receipt height.
  const pixelRatio = Math.min(2, 8192 / Math.max(width, height));
  if (pixelRatio < 0.5) throw new Error('RECEIPT_TOO_LONG');
  // Canvas painting avoids SVG foreignObject, which may export blank images on iOS.
  const { default: html2canvas } = await import('html2canvas');
  const canvas = await html2canvas(documentElement, {
    backgroundColor: '#ffffff',
    width,
    height,
    scale: pixelRatio,
    useCORS: true,
    foreignObjectRendering: false,
    logging: false,
  });
  const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, 'image/png'));
  if (!blob || blob.size < 100) throw new Error('RECEIPT_IMAGE_FAILED');
  return blob;
}

export type ReceiptShareResult = 'shared' | 'downloaded' | 'cancelled';

/** Called directly from a click with a prepared PNG to preserve iOS user activation. */
export async function shareReceiptPng(blob: Blob, orderNumber: string | null): Promise<ReceiptShareResult> {
  const file = new File([blob], receiptImageFilename(orderNumber), { type: 'image/png' });
  if (typeof navigator.share === 'function'
      && typeof navigator.canShare === 'function'
      && navigator.canShare({ files: [file] })) {
    try {
      await navigator.share({ files: [file], title: `Phiếu bán hàng ${orderNumber ?? ''}` });
      return 'shared';
    } catch (error) {
      if (error instanceof Error && error.name === 'AbortError') return 'cancelled';
      throw error;
    }
  }

  // Browsers without file sharing can still download the PNG; never send a PDF/link instead.
  const url = URL.createObjectURL(file);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = file.name;
  document.body.appendChild(anchor);
  try {
    anchor.click();
  } finally {
    anchor.remove();
    window.setTimeout(() => URL.revokeObjectURL(url), 60_000);
  }
  return 'downloaded';
}
