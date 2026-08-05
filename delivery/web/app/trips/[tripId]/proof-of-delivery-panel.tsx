'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import type {
  AttachProofOfDeliveryPayload,
  ProofOfDelivery,
  ProofOfDeliveryType,
} from '../../../lib/types';
import styles from './proof-of-delivery-panel.module.css';

type Props = Readonly<{
  tripId: string;
  assignmentId: string;
  attemptId: string;
}>;

const TYPE_LABELS: Record<ProofOfDeliveryType, string> = {
  photo: 'Ảnh giao hàng',
  signature: 'Tham chiếu chữ ký',
  otp: 'Tham chiếu OTP',
  manual_confirm: 'Xác nhận thủ công',
};

const PHOTO_TYPES = new Set(['image/jpeg', 'image/png', 'image/webp', 'image/heic', 'image/heif']);
const CLIENT_PHOTO_LIMIT = 8 * 1024 * 1024;

type ApiEnvelope<T> = Readonly<{
  data?: T;
  error?: { message?: string };
}>;

function formatDateTime(value: string): string {
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? value : parsed.toLocaleString('vi-VN');
}

function fileToBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(new Error('Không đọc được ảnh.'));
    reader.onload = () => {
      const result = typeof reader.result === 'string' ? reader.result : '';
      const comma = result.indexOf(',');
      if (comma < 0) reject(new Error('Dữ liệu ảnh không hợp lệ.'));
      else resolve(result.slice(comma + 1));
    };
    reader.readAsDataURL(file);
  });
}

export default function ProofOfDeliveryPanel({ tripId, assignmentId, attemptId }: Props) {
  const [proofs, setProofs] = useState<ProofOfDelivery[]>([]);
  const [expanded, setExpanded] = useState(false);
  const [podType, setPodType] = useState<ProofOfDeliveryType>('manual_confirm');
  const [receiverName, setReceiverName] = useState('');
  const [reference, setReference] = useState('');
  const [note, setNote] = useState('');
  const [photo, setPhoto] = useState<File | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');
  const keys = useRef(new Map<string, string>());

  const endpoint = `/api/trips/${encodeURIComponent(tripId)}`
    + `/assignments/${encodeURIComponent(assignmentId)}`
    + `/attempts/${encodeURIComponent(attemptId)}/pod`;

  const loadProofs = useCallback(async () => {
    const response = await fetch(endpoint, { cache: 'no-store', headers: { Accept: 'application/json' } });
    const body = await response.json().catch(() => null) as ApiEnvelope<{ proofs: readonly ProofOfDelivery[] }> | null;
    if (!response.ok || !body?.data) {
      throw new Error(body?.error?.message || 'Không tải được bằng chứng giao hàng.');
    }
    setProofs([...body.data.proofs]);
  }, [endpoint]);

  useEffect(() => {
    loadProofs().catch(() => {});
  }, [loadProofs]);

  function operationKey(signature: string): string {
    const existing = keys.current.get(signature);
    if (existing) return existing;
    const next = `pod-${crypto.randomUUID()}`;
    keys.current.set(signature, next);
    return next;
  }

  async function submitProof() {
    setError('');
    setMessage('');
    let contentBase64: string | undefined;
    if (podType === 'photo') {
      if (!photo) {
        setError('Chọn ảnh hoặc đổi sang loại xác nhận khác.');
        return;
      }
      if (!PHOTO_TYPES.has(photo.type) || photo.size <= 0 || photo.size > CLIENT_PHOTO_LIMIT) {
        setError('Ảnh phải là JPEG, PNG, WebP, HEIC hoặc HEIF và không quá 8 MB.');
        return;
      }
      try {
        contentBase64 = await fileToBase64(photo);
      } catch (readError) {
        setError(readError instanceof Error ? readError.message : 'Không đọc được ảnh.');
        return;
      }
    }
    if (podType === 'signature' && !receiverName.trim() && !reference.trim()) {
      setError('Nhập tên người nhận hoặc tham chiếu chữ ký.');
      return;
    }
    if (podType === 'otp' && !reference.trim()) {
      setError('Nhập tham chiếu OTP đã được xác nhận bên ngoài.');
      return;
    }
    if (podType === 'manual_confirm' && !receiverName.trim() && !note.trim()) {
      setError('Nhập tên người nhận hoặc ghi chú xác nhận.');
      return;
    }

    const payload: AttachProofOfDeliveryPayload = {
      podType,
      capturedAt: new Date().toISOString(),
      receiverName: receiverName.trim() || null,
      confirmationReference: reference.trim() || null,
      note: note.trim() || null,
      ...(photo && contentBase64
        ? { fileName: photo.name, contentType: photo.type, contentBase64 }
        : {}),
    };
    const signature = JSON.stringify(payload);
    setBusy(true);
    try {
      const response = await fetch(endpoint, {
        method: 'POST',
        cache: 'no-store',
        headers: {
          'Content-Type': 'application/json',
          'Idempotency-Key': operationKey(signature),
        },
        body: signature,
      });
      const body = await response.json().catch(() => null) as ApiEnvelope<{ replayed?: boolean }> | null;
      if (!response.ok || !body?.data) {
        throw new Error(body?.error?.message || 'Không lưu được bằng chứng giao hàng.');
      }
      await loadProofs();
      keys.current.delete(signature);
      setMessage(body.data.replayed ? 'Bằng chứng này đã được lưu trước đó.' : 'Đã lưu bằng chứng giao hàng.');
      setReceiverName('');
      setReference('');
      setNote('');
      setPhoto(null);
    } catch (submitError) {
      setError(submitError instanceof Error ? submitError.message : 'Không lưu được bằng chứng giao hàng.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className={styles.panel} data-testid={`pod-panel-${attemptId}`}>
      <div className={styles.heading}>
        <div>
          <h4>Bằng chứng giao hàng (không bắt buộc)</h4>
          <p>Có thể bỏ qua. Công ty tự quy định trường hợp cần ảnh hoặc xác nhận.</p>
        </div>
        <button
          type="button"
          className={styles.toggle}
          onClick={() => setExpanded((current) => !current)}
          disabled={busy}
        >
          {expanded ? 'Đóng' : 'Thêm'}
        </button>
      </div>

      {proofs.length ? (
        <ul className={styles.list}>
          {proofs.map((proof) => (
            <li key={proof.id}>
              <strong>{TYPE_LABELS[proof.podType]}</strong>
              <span>{formatDateTime(proof.capturedAt)}</span>
              {proof.receiverName ? <span>Người nhận: {proof.receiverName}</span> : null}
              {proof.confirmationReference ? <span>Tham chiếu: {proof.confirmationReference}</span> : null}
              {proof.note ? <span>Ghi chú: {proof.note}</span> : null}
              {proof.file?.downloadUrl ? (
                <a href={proof.file.downloadUrl} target="_blank" rel="noreferrer">Xem ảnh</a>
              ) : proof.file ? <span>Ảnh đã lưu; liên kết xem tạm thời chưa khả dụng.</span> : null}
            </li>
          ))}
        </ul>
      ) : <p className={styles.empty}>Chưa có bằng chứng đính kèm.</p>}

      {expanded ? (
        <div className={styles.form}>
          <label className={styles.field}>
            Loại bằng chứng
            <select value={podType} onChange={(event) => setPodType(event.target.value as ProofOfDeliveryType)}>
              {(Object.keys(TYPE_LABELS) as ProofOfDeliveryType[]).map((value) => (
                <option key={value} value={value}>{TYPE_LABELS[value]}</option>
              ))}
            </select>
          </label>

          {podType === 'photo' ? (
            <label className={styles.field}>
              Ảnh
              <input
                type="file"
                accept="image/jpeg,image/png,image/webp,image/heic,image/heif"
                onChange={(event) => setPhoto(event.target.files?.[0] ?? null)}
              />
            </label>
          ) : null}

          {podType === 'signature' || podType === 'manual_confirm' || podType === 'photo' ? (
            <label className={styles.field}>
              Tên người nhận
              <input value={receiverName} maxLength={200} onChange={(event) => setReceiverName(event.target.value)} />
            </label>
          ) : null}

          {podType === 'signature' || podType === 'otp' ? (
            <label className={styles.field}>
              Tham chiếu xác nhận
              <input value={reference} maxLength={200} onChange={(event) => setReference(event.target.value)} />
            </label>
          ) : null}

          <label className={styles.field}>
            Ghi chú
            <textarea value={note} maxLength={2000} rows={2} onChange={(event) => setNote(event.target.value)} />
          </label>

          <button type="button" className={styles.submit} onClick={submitProof} disabled={busy}>
            {busy ? 'Đang lưu…' : 'Lưu bằng chứng tùy chọn'}
          </button>
        </div>
      ) : null}

      {error ? <p className={styles.error} role="alert">{error}</p> : null}
      {message ? <p className={styles.message} role="status">{message}</p> : null}
    </section>
  );
}
