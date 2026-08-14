/* eslint-disable @next/next/no-img-element */
'use client';

import { useEffect, useRef, useState } from 'react';
import { createIdempotencyKey } from '@npp/contracts';
import {
  CUSTOMER_MEDIA_MAX_PHOTOS,
  compressCustomerPhoto,
} from '@npp/contracts/customer-media-browser';
import styles from '../organization/organization.module.css';
import customerStyles from './customers.module.css';
import type { Customer } from '../../lib/customer-types';

type CustomerMedia = {
  id: string;
  customerId: string;
  sourceApp: 'CORE' | 'MCP';
  mimeType: string;
  actualByteSize: number | null;
  width: number | null;
  height: number | null;
  capturedAt: string | null;
  status: string;
  viewUrl: string | null;
};

type MediaList = { media: CustomerMedia[]; maxPhotos: number };
type PrepareResult = { mediaId: string; putUrl: string; mimeType: string; expiresIn: number };
type ApiEnvelope<T> = { data?: T; error?: { code?: string; message?: string } };

type Props = {
  customer: Customer;
  onClose: () => void;
};

async function requestJson<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(path, {
    cache: 'no-store',
    ...init,
    headers: {
      Accept: 'application/json',
      ...(init?.body ? { 'Content-Type': 'application/json' } : {}),
      ...(init?.headers || {}),
    },
  });
  const payload = (await response.json().catch(() => ({}))) as ApiEnvelope<T>;
  if (!response.ok || payload.data === undefined) {
    throw new Error(payload.error?.message || 'Không xử lý được ảnh khách hàng');
  }
  return payload.data;
}

export default function CustomerMediaDialog({ customer, onClose }: Props) {
  const [media, setMedia] = useState<CustomerMedia[]>([]);
  const [maxPhotos, setMaxPhotos] = useState(CUSTOMER_MEDIA_MAX_PHOTOS);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const fileInput = useRef<HTMLInputElement | null>(null);

  async function load() {
    setError(null);
    const result = await requestJson<MediaList>(`/api/customers/${customer.id}/media`);
    setMedia(result.media.slice(0, result.maxPhotos || CUSTOMER_MEDIA_MAX_PHOTOS));
    setMaxPhotos(result.maxPhotos || CUSTOMER_MEDIA_MAX_PHOTOS);
  }

  useEffect(() => {
    setBusy(true);
    void load()
      .catch((loadError) => setError(loadError instanceof Error ? loadError.message : 'Không tải được ảnh khách hàng'))
      .finally(() => setBusy(false));
  }, [customer.id]);

  async function uploadFiles(files: FileList | null) {
    if (!files?.length) return;
    const available = Math.max(0, maxPhotos - media.length);
    if (!available) {
      setError(`Khách hàng chỉ lưu tối đa ${maxPhotos} ảnh.`);
      return;
    }
    setBusy(true);
    setError(null);
    try {
      for (const source of Array.from(files).slice(0, available)) {
        const compressed = await compressCustomerPhoto(source);
        const clientUploadId = crypto.randomUUID();
        const prepareKey = createIdempotencyKey('web-customer-media-prepare');
        const prepared = await requestJson<PrepareResult>(`/api/customers/${customer.id}/media`, {
          method: 'POST',
          headers: { 'Idempotency-Key': prepareKey },
          body: JSON.stringify({
            action: 'prepare',
            clientUploadId,
            mimeType: compressed.file.type,
            byteSize: compressed.file.size,
          }),
        });
        const upload = await fetch(prepared.putUrl, {
          method: 'PUT',
          headers: { 'Content-Type': compressed.file.type },
          body: compressed.file,
        });
        if (!upload.ok) throw new Error(`R2 từ chối ảnh (${upload.status})`);

        const finalizeKey = createIdempotencyKey('web-customer-media-finalize');
        await requestJson<{ id: string; customerId: string }>(`/api/customers/${customer.id}/media`, {
          method: 'POST',
          headers: { 'Idempotency-Key': finalizeKey },
          body: JSON.stringify({
            action: 'finalize',
            mediaId: prepared.mediaId,
            width: compressed.width,
            height: compressed.height,
          }),
        });
      }
      await load();
    } catch (uploadError) {
      setError(uploadError instanceof Error ? uploadError.message : 'Không tải được ảnh khách hàng');
    } finally {
      if (fileInput.current) fileInput.current.value = '';
      setBusy(false);
    }
  }

  return (
    <div className={styles.modalBackdrop} role="presentation" onMouseDown={(event) => { if (event.currentTarget === event.target && !busy) onClose(); }}>
      <section className={`${styles.modal} ${customerStyles.modalWide}`} role="dialog" aria-modal="true" aria-label="Ảnh khách hàng">
        <div className={styles.modalHeader}>
          <div>
            <p className={styles.panelKicker}>{customer.code}</p>
            <h3>Ảnh khách · {customer.name}</h3>
          </div>
          <button type="button" className={styles.modalClose} onClick={onClose} disabled={busy}>Đóng</button>
        </div>

        {error ? <div className={`${styles.banner} ${styles.bannerError}`} role="status">{error}</div> : null}

        <div className={styles.panelHeader}>
          <div>
            <h2>{media.length}/{maxPhotos} ảnh</h2>
            <p className={customerStyles.muted}>MCP và Core dùng chung một bộ ảnh R2; ảnh MCP vẫn do MCP quản lý.</p>
          </div>
          <label className={styles.primaryButton} aria-disabled={busy || media.length >= maxPhotos}>
            {busy ? 'Đang xử lý…' : 'Thêm ảnh'}
            <input
              ref={fileInput}
              type="file"
              accept="image/*"
              multiple
              hidden
              disabled={busy || media.length >= maxPhotos || !customer.is_active}
              onChange={(event) => void uploadFiles(event.currentTarget.files)}
            />
          </label>
        </div>

        <div className={customerStyles.addressList}>
          {media.map((item, index) => (
            <article key={item.id} className={customerStyles.addressCard} data-testid={`customer-media-${index}`}>
              {item.viewUrl ? (
                <img
                  src={item.viewUrl}
                  alt={`Ảnh khách ${customer.name} ${index + 1}`}
                  loading="lazy"
                  style={{ width: '100%', maxHeight: 360, objectFit: 'cover', borderRadius: 12 }}
                />
              ) : <div className={customerStyles.empty}>Ảnh tạm thời chưa xem được.</div>}
              <div className={customerStyles.addressMeta}>
                {item.sourceApp === 'MCP' ? 'Nguồn: MCP hiện trường' : 'Nguồn: Core'}
                {item.capturedAt ? ` · ${new Date(item.capturedAt).toLocaleString('vi-VN')}` : ''}
              </div>
            </article>
          ))}
          {!busy && media.length === 0 ? <div className={customerStyles.empty}>Khách hàng chưa có ảnh.</div> : null}
        </div>
      </section>
    </div>
  );
}
