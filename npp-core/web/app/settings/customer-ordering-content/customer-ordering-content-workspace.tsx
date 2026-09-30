'use client';

import { useEffect, useRef, useState } from 'react';
import { createIdempotencyKey } from '@npp/contracts';
import { AppShell } from '../../components/app-shell-core';
import { resizeProductImage } from '../../../lib/product-images';
import styles from './customer-ordering-content.module.css';

type HomeContent = {
  sectionTitle: string;
  programContent: string;
  visible: boolean;
  bannerUrl: string | null;
  imagePresent: boolean;
  updatedAt: string | null;
};

type Envelope = {
  data?: { content?: HomeContent };
  error?: { message?: string };
};

async function readEnvelope(response: Response) {
  const payload = await response.json().catch(() => ({})) as Envelope;
  if (!response.ok || !payload.data?.content) {
    throw new Error(payload.error?.message || 'Không thể cập nhật nội dung đặt hàng.');
  }
  return payload.data.content;
}

export default function CustomerOrderingContentWorkspace() {
  const inputRef = useRef<HTMLInputElement | null>(null);
  const [content, setContent] = useState<HomeContent | null>(null);
  const [sectionTitle, setSectionTitle] = useState('Sự kiện');
  const [programContent, setProgramContent] = useState('');
  const [visible, setVisible] = useState(false);
  const [busy, setBusy] = useState<'load' | 'save' | 'upload' | null>('load');
  const [message, setMessage] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    void fetch('/api/settings/customer-ordering-content', { cache: 'no-store' })
      .then(readEnvelope)
      .then((next) => {
        if (!active) return;
        setContent(next);
        setSectionTitle(next.sectionTitle);
        setProgramContent(next.programContent);
        setVisible(next.visible);
        setBusy(null);
      })
      .catch((error) => {
        if (!active) return;
        setMessage(error instanceof Error ? error.message : 'Không tải được nội dung đặt hàng.');
        setBusy(null);
      });
    return () => { active = false; };
  }, []);

  async function save() {
    setBusy('save');
    setMessage(null);
    try {
      const next = await readEnvelope(await fetch('/api/settings/customer-ordering-content', {
        method: 'PATCH',
        cache: 'no-store',
        headers: {
          'Content-Type': 'application/json',
          'Idempotency-Key': createIdempotencyKey('customer-ordering-home-content-update'),
        },
        body: JSON.stringify({
          sectionTitle: sectionTitle.trim(),
          programContent: programContent.trim(),
          visible,
        }),
      }));
      setContent(next);
      setSectionTitle(next.sectionTitle);
      setProgramContent(next.programContent);
      setVisible(next.visible);
      setMessage('Đã lưu nội dung Trang chủ khách hàng.');
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'Không lưu được nội dung đặt hàng.');
    } finally {
      setBusy(null);
    }
  }

  async function upload(file: File) {
    setBusy('upload');
    setMessage(null);
    try {
      const resized = await resizeProductImage(file);
      const next = await readEnvelope(await fetch('/api/settings/customer-ordering-content', {
        method: 'PUT',
        cache: 'no-store',
        headers: {
          'Content-Type': resized.mimeType,
          'Idempotency-Key': createIdempotencyKey('customer-ordering-home-banner-upload'),
        },
        body: resized.blob,
      }));
      setContent(next);
      setMessage('Đã tải ảnh banner lên kho ảnh dùng chung.');
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'Không tải được ảnh banner.');
    } finally {
      setBusy(null);
      if (inputRef.current) inputRef.current.value = '';
    }
  }

  return (
    <AppShell
      title="Nội dung đặt hàng"
      subtitle="Thiết lập một banner Trang chủ dùng chung cho PWA và ứng dụng đặt hàng."
    >
      <div className={styles.workspace}>
        <section className={styles.card}>
          <div className={styles.heading}>
            <div>
              <p className={styles.eyebrow}>TRANG CHỦ KHÁCH HÀNG</p>
              <h2>Sự kiện / thông báo</h2>
              <p>Tiêu đề, nội dung chương trình và ảnh bên dưới dùng chung cho các kênh đặt hàng.</p>
            </div>
            <label className={styles.toggle}>
              <input type="checkbox" checked={visible} onChange={(event) => setVisible(event.currentTarget.checked)} disabled={busy !== null} />
              <span>Hiển thị</span>
            </label>
          </div>

          <label className={styles.field}>
            <span>Tiêu đề mục</span>
            <input value={sectionTitle} maxLength={80} onChange={(event) => setSectionTitle(event.currentTarget.value)} disabled={busy !== null} placeholder="Ví dụ: Sự kiện" />
          </label>

          <label className={styles.field}>
            <span>Nội dung chương trình</span>
            <textarea
              value={programContent}
              maxLength={4000}
              rows={7}
              onChange={(event) => setProgramContent(event.currentTarget.value)}
              disabled={busy !== null}
              placeholder="Ví dụ: Nội dung ưu đãi, thời gian áp dụng, điều kiện chương trình…"
            />
            <small>Nội dung này hiển thị khi khách bấm vào banner Sự kiện trên ứng dụng đặt hàng.</small>
          </label>

          <div className={styles.bannerField}>
            <div className={styles.bannerLabel}>
              <span>Ảnh banner</span>
              <small>JPG, PNG hoặc WebP. Hệ thống tự chuyển sang WebP và lưu lên R2.</small>
            </div>
            <div className={styles.preview}>
              {content?.bannerUrl ? <img src={content.bannerUrl} alt="Banner Trang chủ khách hàng" /> : <span>Chưa có ảnh banner</span>}
            </div>
            <div className={styles.actions}>
              <button type="button" onClick={() => inputRef.current?.click()} disabled={busy !== null}>
                {busy === 'upload' ? 'Đang tải ảnh…' : content?.imagePresent ? 'Thay ảnh' : 'Chọn ảnh'}
              </button>
              <button className={styles.primary} type="button" onClick={() => void save()} disabled={busy !== null || !sectionTitle.trim()}>
                {busy === 'save' ? 'Đang lưu…' : 'Lưu thiết lập'}
              </button>
            </div>
            <input ref={inputRef} className={styles.fileInput} type="file" accept="image/jpeg,image/png,image/webp" onChange={(event) => { const file = event.currentTarget.files?.[0]; if (file) void upload(file); }} />
          </div>

          {message ? <p className={styles.message} role="status">{message}</p> : null}
          {busy === 'load' ? <p className={styles.message}>Đang tải thiết lập…</p> : null}
        </section>
      </div>
    </AppShell>
  );
}
