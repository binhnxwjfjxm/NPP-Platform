'use client';

import { createIdempotencyKey } from '@npp/contracts';
import { useEffect, useMemo, useRef, useState } from 'react';
import { AppShell } from '../../components/app-shell-core';
import styles from './data-backup.module.css';

type Artifact = { size?: number; sha256?: string } | null;
type BackupJob = {
  id: string;
  status: string;
  requestedAt: string;
  startedAt?: string | null;
  completedAt?: string | null;
  snapshotAt?: string | null;
  verifiedAt?: string | null;
  includeXlsx: boolean;
  datasetCount: number;
  totalRowCount: number;
  failureCode?: string | null;
  failureMessage?: string | null;
  artifacts: { databaseDump: Artifact; csvZip: Artifact; xlsx: Artifact; manifest: Artifact };
};
type DeleteIntent = { id: string; status: string; backupJobId: string; challengeExpiresAt?: string; ownerRecipientCount?: number; authorizedAt?: string; purgeExecuted?: boolean };
type Envelope<T> = { data?: T; error?: { code?: string; message?: string; retryable?: boolean; details?: unknown } };
type BackupAccess = { canCreateBackup: boolean; canDownloadBackup: boolean; canAuthorizeDeletion: boolean };

const STAGES = [
  ['QUEUED', 'Xếp hàng'],
  ['SNAPSHOTTING', 'Chuẩn bị snapshot'],
  ['DUMPING_DATABASE', 'Xuất database'],
  ['EXPORTING_DATASETS', 'Tạo CSV / Excel'],
  ['BUILDING_ARCHIVE', 'Đóng gói dữ liệu'],
  ['HASHING', 'Tính checksum'],
  ['UPLOADING_R2', 'Upload R2'],
  ['VERIFYING_R2', 'Xác minh R2'],
  ['VERIFIED', 'Đã xác minh'],
] as const;
const ACTIVE = new Set<string>(STAGES.slice(0, -1).map(([status]) => status));

function formatDate(value?: string | null) {
  if (!value) return '—';
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? '—' : new Intl.DateTimeFormat('vi-VN', { dateStyle: 'short', timeStyle: 'medium' }).format(date);
}
function formatBytes(value?: number) {
  const bytes = Number(value ?? 0);
  if (!Number.isFinite(bytes) || bytes <= 0) return '—';
  const units = ['B', 'KB', 'MB', 'GB'];
  let size = bytes; let unit = 0;
  while (size >= 1024 && unit < units.length - 1) { size /= 1024; unit += 1; }
  return `${size.toLocaleString('vi-VN', { maximumFractionDigits: unit ? 1 : 0 })} ${units[unit]}`;
}
function statusLabel(status: string) {
  return STAGES.find(([key]) => key === status)?.[1] ?? (status === 'FAILED' ? 'Thất bại' : status);
}
function progress(status: string) {
  const index = STAGES.findIndex(([key]) => key === status);
  return index < 0 ? 0 : Math.round((index / (STAGES.length - 1)) * 100);
}

export default function DataBackupWorkspace() {
  const [jobs, setJobs] = useState<BackupJob[]>([]);
  const [access, setAccess] = useState<BackupAccess | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [backupConfirmOpen, setBackupConfirmOpen] = useState(false);
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [deleteIntent, setDeleteIntent] = useState<DeleteIntent | null>(null);
  const [deleteCode, setDeleteCode] = useState('');
  const [deleteReason, setDeleteReason] = useState('');
  const [busyAction, setBusyAction] = useState('');
  const mutationKeys = useRef(new Map<string, string>());

  const activeJob = useMemo(() => jobs.find((job) => ACTIVE.has(job.status)) ?? null, [jobs]);
  const latestVerified = useMemo(() => jobs.find((job) => job.status === 'VERIFIED') ?? null, [jobs]);
  const canCreateBackup = access?.canCreateBackup === true;
  const canDownloadBackup = access?.canDownloadBackup === true;
  const canAuthorizeDeletion = access?.canAuthorizeDeletion === true;

  function keyFor(intent: string) {
    const current = mutationKeys.current.get(intent);
    if (current) return current;
    const next = createIdempotencyKey(intent);
    mutationKeys.current.set(intent, next);
    return next;
  }

  async function request<T>(url: string, init?: RequestInit): Promise<T> {
    const response = await fetch(url, { cache: 'no-store', ...init });
    const payload = await response.json().catch(() => null) as Envelope<T> | null;
    if (!payload) throw Object.assign(new Error('Phản hồi máy chủ không hợp lệ'), { retryable: false });
    if (!response.ok) throw Object.assign(new Error(payload.error?.message || 'Thao tác không thành công'), { retryable: payload.error?.retryable === true });
    return payload.data as T;
  }

  async function mutate<T>(intent: string, url: string, body: unknown): Promise<T> {
    const key = keyFor(intent);
    try {
      const result = await request<T>(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Idempotency-Key': key },
        body: JSON.stringify(body),
      });
      mutationKeys.current.delete(intent);
      return result;
    } catch (cause) {
      if (!(cause as { retryable?: boolean })?.retryable) mutationKeys.current.delete(intent);
      throw cause;
    }
  }

  async function refresh() {
    try {
      const [data, capabilities] = await Promise.all([
        request<BackupJob[]>('/api/backups'),
        request<BackupAccess>('/api/backups/access'),
      ]);
      setJobs(data);
      setAccess(capabilities);
      setError('');
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Không tải được lịch sử sao lưu');
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { void refresh(); }, []);
  useEffect(() => {
    if (!activeJob) return;
    const timer = window.setInterval(() => { void refresh(); }, 1500);
    return () => window.clearInterval(timer);
  }, [activeJob?.id, activeJob?.status]);

  async function startBackup() {
    if (!canCreateBackup) return;
    setBusyAction('backup'); setError('');
    try {
      const job = await mutate<BackupJob>('backup.create', '/api/backups', { includeXlsx: true });
      setBackupConfirmOpen(false);
      setJobs((current) => [job, ...current.filter((item) => item.id !== job.id)]);
      await refresh();
    } catch (cause) { setError(cause instanceof Error ? cause.message : 'Không tạo được bản sao lưu'); }
    finally { setBusyAction(''); }
  }

  async function download(job: BackupJob, artifactType: 'database' | 'csv' | 'xlsx' | 'manifest') {
    if (!canDownloadBackup) return;
    const intent = `backup.download.${job.id}.${artifactType}`;
    setBusyAction(intent); setError('');
    try {
      const data = await mutate<{ url: string; expiresIn: number }>(intent, `/api/backups/${job.id}/download`, { artifactType });
      window.location.assign(data.url);
    } catch (cause) { setError(cause instanceof Error ? cause.message : 'Không tạo được liên kết tải'); }
    finally { setBusyAction(''); }
  }

  async function requestDeleteChallenge() {
    if (!canAuthorizeDeletion) return;
    if (!latestVerified) { setError('Cần một bản backup VERIFIED trước khi xác minh xóa dữ liệu'); return; }
    const intentKey = `data-deletion.create.${latestVerified.id}`;
    setBusyAction(intentKey); setError('');
    try {
      const intent = await mutate<DeleteIntent>(intentKey, '/api/data-deletions', { backupJobId: latestVerified.id, reason: deleteReason });
      setDeleteIntent(intent);
    } catch (cause) { setError(cause instanceof Error ? cause.message : 'Không gửi được mã xác nhận Owner'); }
    finally { setBusyAction(''); }
  }

  async function verifyDeleteChallenge() {
    if (!deleteIntent || !canAuthorizeDeletion) return;
    const intentKey = `data-deletion.verify.${deleteIntent.id}`;
    setBusyAction(intentKey); setError('');
    try {
      const intent = await mutate<DeleteIntent>(intentKey, `/api/data-deletions/${deleteIntent.id}/verify`, { code: deleteCode });
      setDeleteIntent(intent);
      setDeleteCode('');
    } catch (cause) { setError(cause instanceof Error ? cause.message : 'Mã xác nhận không hợp lệ'); }
    finally { setBusyAction(''); }
  }

  const currentStage = activeJob ? STAGES.findIndex(([key]) => key === activeJob.status) : -1;

  return <AppShell title="Dữ liệu & sao lưu" subtitle="Backup toàn bộ, kiểm tra tính toàn vẹn và bảo vệ yêu cầu xóa dữ liệu.">
    <div className={styles.stack}>
      {error ? <div className={styles.error} role="alert">{error}</div> : null}

      <section className={styles.hero}>
        <div>
          <p className={styles.eyebrow}>SAO LƯU DỮ LIỆU</p>
          <h2>Bản sao lưu gần nhất</h2>
          <p>{latestVerified ? formatDate(latestVerified.verifiedAt) : 'Chưa có bản VERIFIED'}</p>
        </div>
        <div className={styles.heroMeta}>
          <span><b>R2</b>{latestVerified ? '✓ Đã xác minh' : '—'}</span>
          <span><b>Checksum</b>{latestVerified ? '✓ Hợp lệ' : '—'}</span>
          <span><b>Trạng thái</b>{latestVerified ? 'VERIFIED' : 'Chưa có'}</span>
        </div>
        {canCreateBackup ? <button className={styles.primary} disabled={Boolean(activeJob) || busyAction === 'backup'} onClick={() => setBackupConfirmOpen(true)}>
          {activeJob ? 'ĐANG SAO LƯU' : 'SAO LƯU TOÀN BỘ'}
        </button> : null}
      </section>

      {activeJob ? <section className={styles.progressCard} aria-live="polite">
        <div className={styles.progressHeader}><div><p className={styles.eyebrow}>ĐANG SAO LƯU</p><h3>{statusLabel(activeJob.status)}</h3></div><strong>{progress(activeJob.status)}%</strong></div>
        <div className={styles.progressTrack}><span style={{ width: `${progress(activeJob.status)}%` }} /></div>
        <div className={styles.steps}>{STAGES.slice(0, -1).map(([key, label], index) => <span key={key} className={index <= currentStage ? styles.stepDone : ''}>● {label}</span>)}</div>
        <p className={styles.muted}>Có thể đóng màn hình này; backup job tiếp tục chạy ở backend và sẽ hiện lại khi quay lại.</p>
      </section> : null}

      <section className={styles.panel}>
        <div className={styles.sectionTitle}><div><p className={styles.eyebrow}>LỊCH SỬ SAO LƯU</p><h2>Các lần sao lưu</h2></div><button className={styles.secondary} onClick={() => void refresh()} disabled={loading}>Làm mới</button></div>
        {loading ? <p className={styles.muted}>Đang tải...</p> : jobs.length === 0 ? <p className={styles.muted}>Chưa có lịch sử sao lưu.</p> : <div className={styles.history}>
          {jobs.map((job) => <article key={job.id} className={styles.historyCard}>
            <div><strong>{formatDate(job.requestedAt)}</strong><span className={job.status === 'FAILED' ? styles.failed : job.status === 'VERIFIED' ? styles.verified : styles.running}>{statusLabel(job.status)}</span></div>
            <p>Snapshot: {formatDate(job.snapshotAt)} · {job.datasetCount.toLocaleString('vi-VN')} tập dữ liệu · {job.totalRowCount.toLocaleString('vi-VN')} dòng</p>
            {job.failureMessage ? <p className={styles.failedText}>{job.failureMessage}</p> : null}
            {job.status === 'VERIFIED' && canDownloadBackup ? <div className={styles.downloads}>
              <button onClick={() => void download(job, 'database')} disabled={Boolean(busyAction)}>DB {formatBytes(job.artifacts.databaseDump?.size)}</button>
              <button onClick={() => void download(job, 'csv')} disabled={Boolean(busyAction)}>ZIP CSV {formatBytes(job.artifacts.csvZip?.size)}</button>
              {job.artifacts.xlsx ? <button onClick={() => void download(job, 'xlsx')} disabled={Boolean(busyAction)}>Excel {formatBytes(job.artifacts.xlsx?.size)}</button> : null}
              <button onClick={() => void download(job, 'manifest')} disabled={Boolean(busyAction)}>Manifest</button>
            </div> : null}
          </article>)}
        </div>}
      </section>

      {canAuthorizeDeletion ? <section className={styles.danger}>
        <p className={styles.eyebrow}>VÙNG NGUY HIỂM</p>
        <h2>Xóa dữ liệu</h2>
        <p>Backend chỉ mở gate khi có backup VERIFIED còn đủ mới. Sau đó cùng một mã xác nhận được gửi tới toàn bộ email Owner đã cấu hình.</p>
        <button className={styles.dangerButton} onClick={() => { setDeleteOpen(true); setDeleteIntent(null); setDeleteCode(''); }} disabled={!latestVerified}>XÓA DỮ LIỆU</button>
        <p className={styles.muted}>Phase này xác minh và audit Delete Intent; purge production chưa được thực thi tự động.</p>
      </section> : null}
    </div>

    {backupConfirmOpen && canCreateBackup ? <div className={styles.overlay} role="dialog" aria-modal="true" aria-labelledby="backup-confirm-title">
      <div className={styles.modal}>
        <p className={styles.eyebrow}>XÁC NHẬN</p><h2 id="backup-confirm-title">Sao lưu toàn bộ dữ liệu?</h2>
        <ul><li>Database restore dump</li><li>ZIP nhiều CSV</li><li>Excel nhiều sheet</li><li>SHA-256 + manifest</li><li>Upload R2 private + verify</li></ul>
        <div className={styles.modalActions}><button className={styles.secondary} onClick={() => setBackupConfirmOpen(false)}>HỦY</button><button className={styles.primary} onClick={() => void startBackup()} disabled={busyAction === 'backup'}>XÁC NHẬN SAO LƯU</button></div>
      </div>
    </div> : null}

    {deleteOpen && canAuthorizeDeletion ? <div className={styles.overlay} role="dialog" aria-modal="true" aria-labelledby="delete-title">
      <div className={styles.modal}>
        <p className={styles.dangerEyebrow}>XÓA DỮ LIỆU</p><h2 id="delete-title">Xác minh yêu cầu xóa</h2>
        {!deleteIntent ? <>
          <p>Backup bảo vệ: <strong>{latestVerified?.id ?? '—'}</strong></p>
          <label className={styles.field}>Lý do (không bắt buộc)<textarea value={deleteReason} onChange={(event) => setDeleteReason(event.currentTarget.value)} maxLength={1000} /></label>
          <p className={styles.muted}>Bước tiếp theo chỉ gửi mã đến toàn bộ Owner và tạo Delete Intent. Không tự xóa dữ liệu.</p>
          <div className={styles.modalActions}><button className={styles.secondary} onClick={() => setDeleteOpen(false)}>HỦY</button><button className={styles.dangerButton} onClick={() => void requestDeleteChallenge()} disabled={Boolean(busyAction)}>GỬI MÃ OWNER</button></div>
        </> : deleteIntent.status === 'AUTHORIZED' ? <>
          <div className={styles.success}>✓ Yêu cầu xóa đã được Owner xác minh</div>
          <p>Backup liên kết: <strong>{deleteIntent.backupJobId}</strong></p>
          <p>Trạng thái: <strong>AUTHORIZED</strong></p>
          <p className={styles.muted}>Không có purge tự động trong phase này; authorization đã được audit và có thể làm gate cho task xóa dữ liệu sau.</p>
          <div className={styles.modalActions}><button className={styles.primary} onClick={() => setDeleteOpen(false)}>ĐÓNG</button></div>
        </> : <>
          <p>Mã đã được gửi tới <strong>{deleteIntent.ownerRecipientCount ?? 0} email Owner</strong>. Hết hạn: {formatDate(deleteIntent.challengeExpiresAt)}</p>
          <label className={styles.field}>Mã xác nhận<input inputMode="numeric" autoComplete="one-time-code" value={deleteCode} onChange={(event) => setDeleteCode(event.currentTarget.value.replace(/\D/g, '').slice(0, 6))} maxLength={6} /></label>
          <div className={styles.modalActions}><button className={styles.secondary} onClick={() => setDeleteOpen(false)}>ĐÓNG</button><button className={styles.dangerButton} onClick={() => void verifyDeleteChallenge()} disabled={deleteCode.length !== 6 || Boolean(busyAction)}>XÁC MINH MÃ</button></div>
        </>}
      </div>
    </div> : null}
  </AppShell>;
}
