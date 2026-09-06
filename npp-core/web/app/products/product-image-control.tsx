'use client';

import { Fragment, useEffect, useRef, useState } from 'react';
import { createIdempotencyKey } from '@npp/contracts';
import type { Product } from '../../lib/product-types';
import {
  productImageUrl,
  resizeProductImage,
  type ProductImageMutation,
  type ProductImagePrepare,
} from '../../lib/product-images';
import styles from './product-image-control.module.css';

type Props = {
  product: Product | null;
  imageBaseUrl: string;
  hasImage: boolean;
  imageStatusKnown: boolean;
  onImageStatusChange: (productCode: string, hasImage: boolean) => void;
};

type ApiEnvelope<T> = {
  data?: T;
  error?: { message?: string };
};

async function apiJson<T>(url: string, init?: RequestInit) {
  const response = await fetch(url, { cache: 'no-store', ...init });
  const payload = await response.json().catch(() => ({})) as ApiEnvelope<T>;
  if (!response.ok || !Object.prototype.hasOwnProperty.call(payload, 'data')) {
    throw new Error(payload.error?.message || 'Không thể cập nhật ảnh sản phẩm.');
  }
  return payload.data as T;
}

export default function ProductImageControl({
  product,
  imageBaseUrl,
  hasImage,
  imageStatusKnown,
  onImageStatusChange,
}: Props) {
  const inputRef = useRef<HTMLInputElement | null>(null);
  const pendingKeys = useRef(new Map<string, string>());
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [version, setVersion] = useState<number | null>(null);
  const [brokenPreview, setBrokenPreview] = useState(false);

  const imageUrl = product ? productImageUrl(imageBaseUrl, product.code, version) : '';
  const showImage = Boolean(product && imageStatusKnown && hasImage && imageUrl && !brokenPreview);

  useEffect(() => {
    setBrokenPreview(false);
    setError(null);
    setVersion(null);
  }, [product?.id, hasImage]);

  function retryKey(fingerprint: string, operation: string) {
    const existing = pendingKeys.current.get(fingerprint);
    if (existing) return existing;
    const key = createIdempotencyKey(operation);
    pendingKeys.current.set(fingerprint, key);
    return key;
  }

  async function upload(file: File) {
    if (!product) return;
    setBusy(true);
    setError(null);
    try {
      const resized = await resizeProductImage(file);
      const prepared = await apiJson<ProductImagePrepare>('/api/products/images', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'prepare',
          productId: product.id,
          mimeType: resized.mimeType,
          byteSize: resized.byteSize,
        }),
      });

      const uploaded = await fetch(prepared.uploadUrl, {
        method: 'PUT',
        headers: prepared.uploadHeaders,
        body: resized.blob,
      });
      if (!uploaded.ok) throw new Error('Không thể tải ảnh lên kho ảnh.');

      const fingerprint = `commit:${product.id}:${resized.byteSize}:${file.name}:${file.lastModified}`;
      const key = retryKey(fingerprint, 'product-image-commit');
      await apiJson<ProductImageMutation>('/api/products/images', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Idempotency-Key': key },
        body: JSON.stringify({
          action: 'commit',
          productId: product.id,
          expectedByteSize: resized.byteSize,
        }),
      });
      pendingKeys.current.delete(fingerprint);
      onImageStatusChange(product.code, true);
      setBrokenPreview(false);
      setVersion(Date.now());
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Không thể cập nhật ảnh sản phẩm.');
    } finally {
      setBusy(false);
      if (inputRef.current) inputRef.current.value = '';
    }
  }

  async function removeImage() {
    if (!product || !hasImage) return;
    if (!window.confirm(`Xóa ảnh dùng chung của ${product.code}? Ảnh sẽ không còn hiển thị ở các ứng dụng dùng cùng kho ảnh.`)) return;
    setBusy(true);
    setError(null);
    const fingerprint = `delete:${product.id}`;
    const key = retryKey(fingerprint, 'product-image-delete');
    try {
      await apiJson<ProductImageMutation>('/api/products/images', {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json', 'Idempotency-Key': key },
        body: JSON.stringify({ productId: product.id }),
      });
      pendingKeys.current.delete(fingerprint);
      onImageStatusChange(product.code, false);
      setBrokenPreview(false);
      setVersion(null);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Không thể xóa ảnh sản phẩm.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <Fragment>
      <div className={styles.preview} data-testid="quick-product-image-preview">
        {showImage ? (
          <img src={imageUrl} alt={product?.name || 'Ảnh sản phẩm'} onError={() => setBrokenPreview(true)} />
        ) : (
          <span>{imageStatusKnown ? 'Chưa có ảnh' : 'Đang kiểm tra'}</span>
        )}
      </div>
      <div className={styles.meta} data-testid="product-image-control">
        <strong>Ảnh dùng chung</strong>
        <span>Thu nhỏ trước khi tải lên R2; các ứng dụng dùng cùng mã ảnh sẽ nhận ảnh mới.</span>
        {product ? (
          <div className={styles.actions}>
            <button type="button" onClick={() => inputRef.current?.click()} disabled={busy || !imageStatusKnown}>
              {busy ? 'Đang xử lý…' : hasImage ? 'Đổi ảnh' : 'Thêm ảnh'}
            </button>
            {hasImage ? <button type="button" onClick={() => void removeImage()} disabled={busy}>Xóa ảnh</button> : null}
          </div>
        ) : null}
        {error ? <small className={styles.error} role="alert">{error}</small> : null}
        <input
          ref={inputRef}
          className={styles.fileInput}
          type="file"
          accept="image/jpeg,image/png,image/webp"
          onChange={(event) => {
            const file = event.target.files?.[0];
            if (file) void upload(file);
          }}
        />
      </div>
    </Fragment>
  );
}
