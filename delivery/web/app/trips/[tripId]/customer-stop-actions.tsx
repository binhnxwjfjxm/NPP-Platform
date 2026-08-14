'use client';

import { useState } from 'react';
import type { DeliveryCustomerMediaItem, DeliveryCustomerMediaResponse } from '../../../lib/core-api';
import styles from './customer-stop-actions.module.css';

type Props = Readonly<{
  tripId: string;
  customerId: string;
  customerName: string;
  address: string;
  phone: string | null;
  locationUrl: string | null;
}>;

export default function CustomerStopActions({
  tripId,
  customerId,
  customerName,
  address,
  phone,
  locationUrl,
}: Props) {
  const [dialogOpen, setDialogOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [media, setMedia] = useState<readonly DeliveryCustomerMediaItem[] | null>(null);
  const [mediaError, setMediaError] = useState('');
  const [copyMessage, setCopyMessage] = useState('');

  async function openMedia() {
    setDialogOpen(true);
    if (media !== null || loading) return;
    setLoading(true);
    setMediaError('');
    try {
      const response = await fetch(
        `/api/trips/${encodeURIComponent(tripId)}/customers/${encodeURIComponent(customerId)}/media`,
        { method: 'GET', cache: 'no-store' },
      );
      const body = await response.json().catch(() => null) as (
        { data?: DeliveryCustomerMediaResponse; error?: { message?: string } }
      ) | null;
      if (!response.ok || !body?.data) {
        throw new Error(body?.error?.message || 'Không tải được ảnh khách hàng.');
      }
      setMedia(body.data.media.slice(0, 3));
    } catch (error) {
      setMediaError(error instanceof Error ? error.message : 'Không tải được ảnh khách hàng.');
      setMedia([]);
    } finally {
      setLoading(false);
    }
  }

  async function copyAddress() {
    if (!address || address === 'Chưa có địa chỉ') return;
    try {
      await navigator.clipboard.writeText(address);
      setCopyMessage('Đã sao chép địa chỉ');
    } catch {
      setCopyMessage('Không sao chép được');
    }
  }

  const visibleMedia = (media ?? []).filter((item) => Boolean(item.viewUrl)).slice(0, 3);

  return (
    <div className={styles.root}>
      <p className={styles.phoneLine}><strong>SĐT</strong><span>{phone || 'Chưa có'}</span></p>
      <div className={styles.actions} aria-label={`Thao tác tại ${customerName}`}>
        {phone ? (
          <a className={styles.action} href={`tel:${phone}`}>Gọi khách</a>
        ) : (
          <span className={`${styles.action} ${styles.disabled}`} aria-disabled="true">Chưa có SĐT</span>
        )}
        {locationUrl ? (
          <a className={styles.action} href={locationUrl} target="_blank" rel="noreferrer">Mở định vị</a>
        ) : (
          <span className={`${styles.action} ${styles.disabled}`} aria-disabled="true">Chưa có định vị</span>
        )}
        <button
          className={styles.action}
          type="button"
          onClick={copyAddress}
          disabled={!address || address === 'Chưa có địa chỉ'}
        >
          Sao chép địa chỉ
        </button>
        <button className={styles.action} type="button" onClick={openMedia}>Xem ảnh khách</button>
      </div>
      {copyMessage ? <small className={styles.feedback} role="status">{copyMessage}</small> : null}

      {dialogOpen ? (
        <div className={styles.backdrop} role="presentation" onMouseDown={() => setDialogOpen(false)}>
          <section
            className={styles.dialog}
            role="dialog"
            aria-modal="true"
            aria-label={`Ảnh khách ${customerName}`}
            onMouseDown={(event) => event.stopPropagation()}
          >
            <div className={styles.dialogHeading}>
              <div><small>Khách hàng</small><strong>{customerName}</strong></div>
              <button type="button" onClick={() => setDialogOpen(false)} aria-label="Đóng ảnh khách">×</button>
            </div>
            {loading ? <p className={styles.state}>Đang tải ảnh…</p> : null}
            {!loading && mediaError ? <p className={styles.state} role="status">{mediaError}</p> : null}
            {!loading && !mediaError && visibleMedia.length === 0 ? (
              <p className={styles.state}>Khách chưa có ảnh. Vẫn có thể tiếp tục giao hàng bình thường.</p>
            ) : null}
            {!loading && visibleMedia.length > 0 ? (
              <div className={styles.gallery}>
                {visibleMedia.map((item, index) => (
                  <img
                    key={item.id}
                    src={item.viewUrl || ''}
                    alt={`Ảnh khách ${customerName} ${index + 1}`}
                    loading="lazy"
                    referrerPolicy="no-referrer"
                  />
                ))}
              </div>
            ) : null}
          </section>
        </div>
      ) : null}
    </div>
  );
}
