'use client';

import { createIdempotencyKey } from '@npp/contracts';
import { useEffect, useMemo, useRef, useState } from 'react';
import { AppShell } from '../../components/app-shell-core';
import SettingsTabs from '../settings-tabs';
import styles from './data-backup.module.css';

type Artifact = { size?: number; sha256?: string } | null;
type BackupJob = {
  id: string;
  status: string;
  requestedAt: string;
  startedAt?: string | null;
  completedAt?: string | null;
  snapshotAt?: string | null;
  schemaVersion?: string | null;
  verifiedAt?: string | null;
  includeXlsx: boolean;
  datasetCount: number;
  totalRowCount: number;
  failureCode?: string | null;
  failureMessage?: string | null;
  artifacts: { databaseDump: Artifact; csvZip: Artifact; xlsx: Artifact; manifest: Artifact };
};
type PurgeTargetCode = 'ALL_BUSINESS_DATA' | 'OPERATIONS_ONLY' | 'CUSTOMERS_AND_SALES' | 'SUPPLIERS_AND_PURCHASING' | 'PRODUCTS_AND_INVENTORY' | 'MCP_ONLY';
type DeleteIntent = {
  id: string;
  status: string;
  backupJobId: string;
  targetCode: PurgeTargetCode;
  challengeExpiresAt?: string;
  ownerRecipientCount?: number;
  authorizedAt?: string;
  purgeExecuted?: boolean;
  purgeStartedAt?: string | null;
  purgeCompletedAt?: string | null;
  purgeSummary?: { deletedRows?: number; affectedTableCount?: number } | null;
};
type Envelope<T> = { data?: T; error?: { code?: string; message?: string; retryable?: boolean; details?: unknown } };
type BackupAccess = { canReadBackup: boolean; canCreateBackup: boolean; canDownloadBackup: boolean; canAuthorizeDeletion: boolean };
type TechnicalAccess = { unlocked: boolean; expiresAt: string | null };
type TechnicalChallenge = { id: string; challengeExpiresAt: string; recipient: string };
type RequestFailure = Error & { retryable?: boolean; statusCode?: number };
type BackupArtifactType = 'database' | 'manifest';

const TECHNICAL_RECIPIENT = 'khuongbinh.info@gmail.com';
const PURGE_TARGETS: ReadonlyArray<{ code: PurgeTargetCode; label: string; description: string }> = [
  { code: 'ALL_BUSINESS_DATA', label: 'Toàn bộ dữ liệu nghiệp vụ', description: 'Dùng khi dọn dữ liệu test để bàn giao. Giữ tài khoản đăng nhập, phân quyền, cấu hình tổ chức, cấu hình nền và bản sao lưu kỹ thuật.' },
  { code: 'OPERATIONS_ONLY', label: 'Dữ liệu phát sinh', description: 'Xóa đơn hàng, kho, công nợ, giao hàng, báo cáo và hoạt động MCP; giữ danh mục khách hàng, nhà cung cấp và sản phẩm.' },
  { code: 'CUSTOMERS_AND_SALES', label: 'Khách hàng & bán hàng', description: 'Xóa khách hàng và toàn bộ bán hàng, giao hàng, công nợ và dữ liệu phụ thuộc liên quan.' },
  { code: 'SUPPLIERS_AND_PURCHASING', label: 'Nhà cung cấp & mua hàng', description: 'Xóa nhà cung cấp, mua hàng và dữ liệu phụ thuộc liên quan.' },
  { code: 'PRODUCTS_AND_INVENTORY', label: 'Sản phẩm & kho', description: 'Xóa danh mục sản phẩm, bảng giá, tồn kho và các giao dịch phụ thuộc.' },
  { code: 'MCP_ONLY', label: 'Dữ liệu MCP', description: 'Xóa tuyến, phiên, ghé điểm, báo cáo và dữ liệu hoạt động MCP; giữ cấu hình MCP và dữ liệu Công Ty.' },
];
const NO_BACKUP_ACCESS: BackupAccess = {
  canReadBackup: false,
  canCreateBackup: false,
  canDownloadBackup: false,
  canAuthorizeDeletion: false,
};
const STAGES = [
  ['QUEUED', 'Xếp hàng'],
  ['SNAPSHOTTING', 'Chốt thời điểm dữ liệu'],
  ['DUMPING_DATABASE', 'Tạo file .dump'],
  ['HASHING', 'Tính SHA-256'],
  ['UPLOADING_R2', 'Lưu lên kho sao lưu'],
  ['VERIFYING_R2', 'Đối chiếu bản đã lưu'],
  ['VERIFIED', 'Đã xác minh'],
] as const;
const ACTIVE = new Set<string>([
  ...STAGES.slice(0, -1).map(([status]) => status),
  'EXPORTING_DATASETS',
  'BUILDING_ARCHIVE',
]);

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
  if (status === 'EXPORTING_DATASETS' || status === 'BUILDING_ARCHIVE') return 'Đang hoàn tất bản sao lưu cũ';
  return STAGES.find(([key]) => key === status)?.[1] ?? (status === 'FAILED' ? 'Thất bại' : status);
}
function progress(status: string) {
  const index = STAGES.findIndex(([key]) => key === status);
  if (index >= 0) return Math.round((index / (STAGES.length - 1)) * 100);
  return ACTIVE.has(status) ? 55 : 0;
}
function purgeTarget(code: PurgeTargetCode) {
  return PURGE_TARGETS.find((target) => target.code === code) ?? PURGE_TARGETS[0];
}

export default function DataBackupWorkspace() {
  const [jobs, setJobs] = useState<BackupJob[]>([]);
  const [access, setAccess] = useState<BackupAccess | null>(null);
  const [technicalAccess, setTechnicalAccess] = useState<TechnicalAccess>({ unlocked: false, expiresAt: null });
  const [technicalChallenge, setTechnicalChallenge] = useState<TechnicalChallenge | null>(null);
  const [technicalCode, setTechnicalCode] = useState('');
  const [unlockOpen, setUnlockOpen] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');
  const [backupConfirmOpen, setBackupConfirmOpen] = useState(false);
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [deleteIntent, setDeleteIntent] = useState<DeleteIntent | null>(null);
  const [deleteCode, setDeleteCode] = useState('');
  const [deleteReason, setDeleteReason] = useState('');
  const [deleteTarget, setDeleteTarget] = useState<PurgeTargetCode>('ALL_BUSINESS_DATA');
  const [busyAction, setBusyAction] = useState('');
  const mutationKeys = useRef(new Map<string, string>());

  const activeJob = useMemo(() => jobs.find((job) => ACTIVE.has(job.status)) ?? null, [jobs]);
  const latestVerified = useMemo(() => jobs.find((job) => job.status === 'VERIFIED') ?? null, [jobs]);
  const canReadBackup = access?.canReadBackup === true;
  const canCreateBackup = access?.canCreateBackup === true;
  const canDownloadBackup = access?.canDownloadBackup === true;
  const canAuthorizeDeletion = access?.canAuthorizeDeletion === true;
  const canUseTechnicalArea = canReadBackup && (canCreateBackup || canDownloadBackup);

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
    if (!payload) throw Object.assign(new Error('Phản hồi máy chủ không hợp lệ'), { retryable: false, statusCode: response.status });
    if (!response.ok) {
      throw Object.assign(
        new Error(payload.error?.message || 'Thao tác không thành công'),
        { retryable: payload.error?.retryable === true, statusCode: response.status },
      );
    }
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
      if (!(cause as RequestFailure)?.retryable) mutationKeys.current.delete(intent);
      throw cause;
    }
  }

  async function refresh() {
    try {
      const capabilities = await request<BackupAccess>('/api/backups/access');
      setAccess(capabilities);
      if (capabilities.canReadBackup) {
        const unlocked = await request<TechnicalAccess>('/api/backups/technical-access');
        setTechnicalAccess(unlocked);
        if (unlocked.unlocked) {
          setJobs(await request<BackupJob[]>('/api/backups'));
        } else {
          setJobs([]);
        }
      } else {
        setJobs([]);
        setTechnicalAccess({ unlocked: false, expiresAt: null });
      }
      setError('');
    } catch (cause) {
      if ((cause as RequestFailure)?.statusCode === 403) {
        setAccess(NO_BACKUP_ACCESS);
        setJobs([]);
        setTechnicalAccess({ unlocked: false, expiresAt: null });
        setError('');
      } else {
        setError(cause instanceof Error ? cause.message : 'Không tải được thông tin sao lưu');
      }
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

  async function requestTechnicalUnlock() {
    if (!canUseTechnicalArea) return;
    setBusyAction('technical.challenge'); setError(''); setSuccess('');
    try {
      const challenge = await mutate<TechnicalChallenge>('technical-backup.challenge', '/api/backups/technical-access', {});
      setTechnicalChallenge(challenge);
      setTechnicalCode('');
      setUnlockOpen(true);
      setSuccess(`Mã mở khóa đã được gửi tới ${TECHNICAL_RECIPIENT}.`);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Không gửi được mã mở khóa');
    } finally { setBusyAction(''); }
  }

  async function verifyTechnicalUnlock() {
    if (!technicalChallenge || !/^\d{6}$/.test(technicalCode)) return;
    const intent = `technical-backup.verify.${technicalChallenge.id}`;
    setBusyAction(intent); setError(''); setSuccess('');
    try {
      const unlocked = await mutate<TechnicalAccess>(intent, `/api/backups/technical-access/${technicalChallenge.id}/verify`, { code: technicalCode });
      const data = await request<BackupJob[]>('/api/backups');
      setTechnicalAccess(unlocked);
      setJobs(data);
      setTechnicalCode('');
      setUnlockOpen(false);
      setSuccess(`Khu vực kỹ thuật đã mở đến ${formatDate(unlocked.expiresAt)}.`);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Mã mở khóa không hợp lệ');
    } finally { setBusyAction(''); }
  }

  async function startBackup() {
    if (!canCreateBackup || !technicalAccess.unlocked) return;
    setBusyAction('backup'); setError(''); setSuccess('');
    try {
      const job = await mutate<BackupJob>('backup.create', '/api/backups', {});
      setBackupConfirmOpen(false);
      setJobs((current) => [job, ...current.filter((item) => item.id !== job.id)]);
      setSuccess('Đã tiếp nhận yêu cầu sao lưu hệ thống.');
      await refresh();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Không tạo được bản sao lưu hệ thống');
      await refresh();
    } finally { setBusyAction(''); }
  }

  async function download(job: BackupJob, artifactType: BackupArtifactType) {
    if (!canDownloadBackup) return;
    if (!technicalAccess.unlocked) {
      await requestTechnicalUnlock();
      return;
    }
    const intent = `backup.download.${job.id}.${artifactType}`;
    setBusyAction(intent); setError(''); setSuccess('');
    try {
      const data = await mutate<{ url: string; expiresIn: number }>(intent, `/api/backups/${job.id}/download`, { artifactType });
      window.location.assign(data.url);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Không tạo được liên kết tải bản sao lưu');
      await refresh();
    } finally { setBusyAction(''); }
  }

  async function requestDeleteChallenge() {
    if (!canAuthorizeDeletion) return;
    if (!latestVerified) { setError('Cần một bản sao lưu đã xác minh trước khi xóa dữ liệu'); return; }
    const intentKey = `data-deletion.create.${latestVerified.id}.${deleteTarget}`;
    setBusyAction(intentKey); setError(''); setSuccess('');
    try {
      const intent = await mutate<DeleteIntent>(intentKey, '/api/data-deletions', {
        backupJobId: latestVerified.id,
        targetCode: deleteTarget,
        reason: deleteReason,
      });
      setDeleteIntent(intent);
    } catch (cause) { setError(cause instanceof Error ? cause.message : 'Không gửi được mã xác nhận xóa dữ liệu'); }
    finally { setBusyAction(''); }
  }

  async function verifyDeleteChallenge() {
    if (!deleteIntent || !canAuthorizeDeletion) return;
    const intentKey = `data-deletion.verify.${deleteIntent.id}`;
    setBusyAction(intentKey); setError(''); setSuccess('');
    try {
      const intent = await mutate<DeleteIntent>(intentKey, `/api/data-deletions/${deleteIntent.id}/verify`, { code: deleteCode });
      setDeleteIntent(intent);
      setDeleteCode('');
    } catch (cause) { setError(cause instanceof Error ? cause.message : 'Mã xác nhận không hợp lệ'); }
    finally { setBusyAction(''); }
  }

  async function executeDelete() {
    if (!deleteIntent || deleteIntent.status !== 'AUTHORIZED' || !canAuthorizeDeletion) return;
    const intentKey = `data-deletion.execute.${deleteIntent.id}`;
    setBusyAction(intentKey); setError(''); setSuccess('');
    try {
      const intent = await mutate<DeleteIntent>(intentKey, `/api/data-deletions/${deleteIntent.id}/execute`, {});
      setDeleteIntent(intent);
      setSuccess(`Đã xóa ${purgeTarget(intent.targetCode).label.toLowerCase()}. Bản sao lưu kỹ thuật vẫn được giữ nguyên.`);
    } catch (cause) { setError(cause instanceof Error ? cause.message : 'Không thể thực hiện xóa dữ liệu'); }
    finally { setBusyAction(''); }
  }

  const currentStage = activeJob ? STAGES.findIndex(([key]) => key === activeJob.status) : -1;

  return <AppShell title="Dữ liệu & sao lưu" subtitle="Xuất số liệu doanh nghiệp, sao lưu kỹ thuật, di chuyển và khôi phục dữ liệu quan trọng.">
    <SettingsTabs active="data-backup" />
    <div className={styles.stack}>
      {error ? <div className={styles.error} role="alert">{error}</div> : null}
      {success ? <div className={styles.success} role="status">{success}</div> : null}

      <section className={styles.panel}>
        <div className={styles.sectionTitle}>
          <div>
            <p className={styles.eyebrow}>SỐ LIỆU DOANH NGHIỆP</p>
            <h2>Excel nghiệp vụ</h2>
          </div>
          <button className={styles.primary} onClick={() => window.location.assign('/api/reporting/business-export')}>
            XUẤT SỐ LIỆU
          </button>
        </div>
        <p>Xuất một file Excel dễ đọc, chỉ gồm các nghiệp vụ người dùng được cấp quyền xem như khách hàng, sản phẩm, tồn kho, đơn hàng, công nợ, giao hàng, nhân viên và MCP.</p>
        <p className={styles.muted}>File này không chứa dữ liệu kỹ thuật, tài khoản, phân quyền, phiên đăng nhập, thông tin kiểm soát nội bộ, lịch sử thay đổi cấu trúc, nhật ký hệ thống hoặc bản sao lưu thô.</p>
      </section>

      <section className={styles.hero}>
        <div>
          <p className={styles.eyebrow}>SAO LƯU HỆ THỐNG 🔒</p>
          {technicalAccess.unlocked ? <>
            <h2>Bản kỹ thuật PostgreSQL</h2>
            <p>File <strong>.dump</strong> là dữ liệu khôi phục chính. Mỗi bản mới có thêm tệp thông tin kỹ thuật để phục vụ di chuyển và đối soát.</p>
          </> : <>
            <h2>Khu vực kỹ thuật</h2>
            <p>Nhập mã xác nhận để mở chức năng sao lưu hệ thống.</p>
          </>}
        </div>
        {technicalAccess.unlocked ? <div className={styles.heroMeta}>
          <span><b>Bản gần nhất</b>{latestVerified ? formatDate(latestVerified.verifiedAt) : 'Chưa có'}</span>
          <span><b>Kho lưu</b>{latestVerified ? 'R2 riêng tư' : '—'}</span>
          <span><b>Trạng thái</b>{latestVerified ? 'Đã xác minh' : 'Chưa có'}</span>
        </div> : null}
        {canUseTechnicalArea ? technicalAccess.unlocked
          ? <button className={styles.primary} disabled={!canCreateBackup || Boolean(activeJob) || busyAction === 'backup'} onClick={() => setBackupConfirmOpen(true)}>
            {activeJob ? 'ĐANG SAO LƯU' : 'TẠO BẢN SAO LƯU'}
          </button>
          : <button className={styles.primary} disabled={busyAction === 'technical.challenge'} onClick={() => void requestTechnicalUnlock()}>MỞ KHU VỰC KỸ THUẬT</button>
          : null}
      </section>

      {canReadBackup ? <section className={styles.panel}>
        <div className={styles.sectionTitle}>
          <div><p className={styles.eyebrow}>KHU VỰC KỸ THUẬT</p><h2>{technicalAccess.unlocked ? 'Đang mở' : 'Đang khóa'}</h2></div>
          {technicalAccess.unlocked ? <strong>Hết hạn: {formatDate(technicalAccess.expiresAt)}</strong> : null}
        </div>
        <p>Mã mở khóa chỉ được gửi tới <strong>{TECHNICAL_RECIPIENT}</strong>. Người dùng không thể đổi địa chỉ nhận mã.</p>
        <p className={styles.muted}>Mã này mở toàn bộ khu vực sao lưu và khôi phục kỹ thuật. Xóa dữ liệu luôn dùng bước xác nhận riêng.</p>
      </section> : null}

      {technicalAccess.unlocked && activeJob ? <section className={styles.progressCard} aria-live="polite">
        <div className={styles.progressHeader}><div><p className={styles.eyebrow}>ĐANG SAO LƯU</p><h3>{statusLabel(activeJob.status)}</h3></div><strong>{progress(activeJob.status)}%</strong></div>
        <div className={styles.progressTrack}><span style={{ width: `${progress(activeJob.status)}%` }} /></div>
        <div className={styles.steps}>{STAGES.slice(0, -1).map(([key, label], index) => <span key={key} className={index <= currentStage ? styles.stepDone : ''}>● {label}</span>)}</div>
        <p className={styles.muted}>Có thể rời màn hình này; tiến trình vẫn tiếp tục và trạng thái sẽ được cập nhật khi quay lại.</p>
      </section> : null}

      {canReadBackup && technicalAccess.unlocked ? <section className={styles.panel}>
        <div className={styles.sectionTitle}>
          <div><p className={styles.eyebrow}>DI CHUYỂN & KHÔI PHỤC 🔒</p><h2>Gói chuyển hệ thống</h2></div>
          {latestVerified?.artifacts.manifest && canDownloadBackup ? <button className={styles.secondary} onClick={() => void download(latestVerified, 'manifest')} disabled={Boolean(busyAction)}>TẢI TỆP THÔNG TIN</button> : null}
        </div>
        <p>Một gói khôi phục gồm đúng <strong>một file .dump</strong> và <strong>một tệp thông tin khôi phục</strong> của cùng thời điểm dữ liệu. Tệp thông tin không phải bản sao dữ liệu thứ hai.</p>
        {latestVerified ? <>
          <div className={styles.heroMeta}>
            <span><b>Thời điểm dữ liệu</b>{formatDate(latestVerified.snapshotAt)}</span>
            <span><b>Thông tin cấu trúc</b>{latestVerified.schemaVersion ? 'Đã ghi nhận' : 'Chưa có'}</span>
            <span><b>Tệp khôi phục</b>{latestVerified.artifacts.manifest ? 'Sẵn sàng' : 'Chưa có'}</span>
          </div>
          {latestVerified.artifacts.manifest ? <p className={styles.muted}>Tệp thông tin ghi nhận phiên bản cấu trúc, danh sách thay đổi cấu trúc, mã kiểm tra file .dump và số dòng đối soát để phục vụ chuyển sang máy chủ khác.</p> : <p className={styles.muted}>Bản sao lưu gần nhất được tạo trước khi có gói di chuyển. Hãy tạo một bản sao lưu hệ thống mới để có đủ file .dump và tệp thông tin đi kèm.</p>}
        </> : <p className={styles.muted}>Chưa có bản sao lưu đã xác minh để tạo gói di chuyển.</p>}
      </section> : null}

      {canReadBackup && technicalAccess.unlocked ? <section className={styles.panel}>
        <div className={styles.sectionTitle}><div><p className={styles.eyebrow}>LỊCH SỬ SAO LƯU HỆ THỐNG</p><h2>Các bản đã tạo</h2></div><button className={styles.secondary} onClick={() => void refresh()} disabled={loading}>Làm mới</button></div>
        {loading ? <p className={styles.muted}>Đang tải...</p> : jobs.length === 0 ? <p className={styles.muted}>Chưa có lịch sử sao lưu.</p> : <div className={styles.history}>
          {jobs.map((job) => <article key={job.id} className={styles.historyCard}>
            <div><strong>{formatDate(job.requestedAt)}</strong><span className={job.status === 'FAILED' ? styles.failed : job.status === 'VERIFIED' ? styles.verified : styles.running}>{statusLabel(job.status)}</span></div>
            <p>Thời điểm dữ liệu: {formatDate(job.snapshotAt)} · File .dump: {formatBytes(job.artifacts.databaseDump?.size)}</p>
            {job.artifacts.databaseDump?.sha256 ? <p>SHA-256 file .dump: {job.artifacts.databaseDump.sha256}</p> : null}
            {job.artifacts.manifest?.sha256 ? <p>SHA-256 tệp thông tin khôi phục: {job.artifacts.manifest.sha256}</p> : null}
            {job.failureMessage ? <p className={styles.failedText}>{job.failureMessage}</p> : null}
            {job.status === 'VERIFIED' && canDownloadBackup ? <div className={styles.downloads}>
              <button onClick={() => void download(job, 'database')} disabled={Boolean(busyAction)}>TẢI .DUMP</button>
              {job.artifacts.manifest ? <button onClick={() => void download(job, 'manifest')} disabled={Boolean(busyAction)}>TẢI TỆP THÔNG TIN</button> : null}
            </div> : null}
          </article>)}
        </div>}
      </section> : null}

      {canAuthorizeDeletion ? <section className={styles.danger}>
        <p className={styles.eyebrow}>VÙNG NGUY HIỂM</p>
        <h2>Xóa dữ liệu</h2>
        <p>Chọn đúng nhóm dữ liệu cần dọn. Hệ thống tự xử lý dữ liệu phụ thuộc để không làm hỏng quan hệ nghiệp vụ.</p>
        {!technicalAccess.unlocked ? <p className={styles.muted}>Mở Khu vực kỹ thuật để chọn bản sao lưu đã xác minh trước khi yêu cầu xóa.</p> : null}
        <button className={styles.dangerButton} onClick={() => { setDeleteOpen(true); setDeleteIntent(null); setDeleteCode(''); setDeleteReason(''); }} disabled={!latestVerified}>XÓA DỮ LIỆU</button>
        <p className={styles.muted}>Chỉ xóa thật sau khi có bản sao lưu mới, nhập đúng mã xác nhận riêng và bấm xác nhận lần cuối.</p>
      </section> : null}
    </div>

    {backupConfirmOpen && canCreateBackup && technicalAccess.unlocked ? <div className={styles.overlay} role="dialog" aria-modal="true" aria-labelledby="backup-confirm-title">
      <div className={styles.modal}>
        <p className={styles.eyebrow}>XÁC NHẬN</p><h2 id="backup-confirm-title">Tạo bản sao lưu hệ thống?</h2>
        <ul><li>Tạo đúng một file sao lưu PostgreSQL (.dump)</li><li>Kiểm tra cấu trúc file khôi phục</li><li>Ghi nhận phiên bản cấu trúc và số dòng đối soát</li><li>Tạo tệp thông tin khôi phục đi cùng file .dump</li><li>Tính mã kiểm tra SHA-256 cho cả hai tệp</li><li>Lưu vào kho R2 riêng tư và đối chiếu trước khi đánh dấu đã xác minh</li></ul>
        <div className={styles.modalActions}><button className={styles.secondary} onClick={() => setBackupConfirmOpen(false)}>HỦY</button><button className={styles.primary} onClick={() => void startBackup()} disabled={busyAction === 'backup'}>XÁC NHẬN SAO LƯU</button></div>
      </div>
    </div> : null}

    {unlockOpen && technicalChallenge ? <div className={styles.overlay} role="dialog" aria-modal="true" aria-labelledby="technical-unlock-title">
      <div className={styles.modal}>
        <p className={styles.eyebrow}>KHU VỰC KỸ THUẬT</p><h2 id="technical-unlock-title">Nhập mã mở khóa</h2>
        <p>Mã đã gửi duy nhất tới <strong>{TECHNICAL_RECIPIENT}</strong> và hết hạn lúc {formatDate(technicalChallenge.challengeExpiresAt)}.</p>
        <label className={styles.field}>Mã 6 số<input inputMode="numeric" autoComplete="one-time-code" value={technicalCode} maxLength={6} onChange={(event) => setTechnicalCode(event.currentTarget.value.replace(/\D/g, '').slice(0, 6))} /></label>
        <div className={styles.modalActions}>
          <button className={styles.secondary} onClick={() => { setUnlockOpen(false); setTechnicalCode(''); }}>HỦY</button>
          <button className={styles.primary} onClick={() => void verifyTechnicalUnlock()} disabled={!/^\d{6}$/.test(technicalCode) || Boolean(busyAction)}>MỞ KHÓA</button>
        </div>
      </div>
    </div> : null}

    {deleteOpen && canAuthorizeDeletion ? <div className={styles.overlay} role="dialog" aria-modal="true" aria-labelledby="delete-title">
      <div className={styles.modal}>
        <p className={styles.dangerEyebrow}>XÓA DỮ LIỆU</p><h2 id="delete-title">Dọn dữ liệu trước bàn giao</h2>
        {!deleteIntent ? <>
          <p>Bản sao lưu bảo vệ: <strong>{latestVerified ? formatDate(latestVerified.verifiedAt) : '—'}</strong></p>
          <p className={styles.muted}>Bản sao lưu phải được tạo và xác minh trong vòng 1 giờ trước khi thực hiện xóa.</p>
          <label className={styles.field}>Phạm vi cần xóa
            <select value={deleteTarget} onChange={(event) => setDeleteTarget(event.currentTarget.value as PurgeTargetCode)}>
              {PURGE_TARGETS.map((target) => <option key={target.code} value={target.code}>{target.label}</option>)}
            </select>
          </label>
          <div className={styles.warningBox}>
            <strong>{purgeTarget(deleteTarget).label}</strong>
            <p>{purgeTarget(deleteTarget).description}</p>
          </div>
          <p><strong>Luôn giữ:</strong> tài khoản đăng nhập, phân quyền, cấu hình chi nhánh/kho, cấu hình nền cần để hệ thống tiếp tục hoạt động, lịch sử cấu trúc và bản sao lưu kỹ thuật trên R2.</p>
          <p className={styles.muted}>Nếu dữ liệu được chọn có dữ liệu phụ thuộc, hệ thống sẽ tự xóa phần phụ thuộc bắt buộc hoặc dừng an toàn; không để dữ liệu mồ côi.</p>
          <label className={styles.field}>Lý do<textarea value={deleteReason} maxLength={1000} placeholder="Ví dụ: Dọn dữ liệu kiểm thử trước bàn giao" onChange={(event) => setDeleteReason(event.currentTarget.value)} /></label>
          <div className={styles.modalActions}><button className={styles.secondary} onClick={() => setDeleteOpen(false)}>HỦY</button><button className={styles.dangerButton} onClick={() => void requestDeleteChallenge()} disabled={Boolean(busyAction)}>GỬI MÃ XÁC NHẬN</button></div>
        </> : deleteIntent.status === 'PURGED' ? <>
          <div className={styles.success}>Đã xóa dữ liệu thành công.</div>
          <p><strong>Phạm vi:</strong> {purgeTarget(deleteIntent.targetCode).label}</p>
          <p>Đã xóa {Number(deleteIntent.purgeSummary?.deletedRows ?? 0).toLocaleString('vi-VN')} bản ghi trong {Number(deleteIntent.purgeSummary?.affectedTableCount ?? 0).toLocaleString('vi-VN')} bảng nghiệp vụ.</p>
          <p className={styles.muted}>Tài khoản, phân quyền, cấu hình nền và bản sao lưu kỹ thuật vẫn được giữ.</p>
          <div className={styles.modalActions}><button className={styles.secondary} onClick={() => setDeleteOpen(false)}>ĐÓNG</button></div>
        </> : deleteIntent.status === 'AUTHORIZED' ? <>
          <div className={styles.warningBox}>
            <strong>Đã xác minh quyền xóa</strong>
            <p>Phạm vi: {purgeTarget(deleteIntent.targetCode).label}. Bước tiếp theo sẽ xóa dữ liệu thật và không thể hoàn tác trong cơ sở dữ liệu hiện tại.</p>
          </div>
          <p>Bản sao lưu bảo vệ vẫn nằm trên R2 để khôi phục khi cần.</p>
          <div className={styles.modalActions}>
            <button className={styles.secondary} onClick={() => setDeleteOpen(false)} disabled={Boolean(busyAction)}>CHƯA XÓA</button>
            <button className={styles.dangerButton} onClick={() => void executeDelete()} disabled={Boolean(busyAction)}>{busyAction.startsWith('data-deletion.execute.') ? 'ĐANG XÓA...' : 'XÓA DỮ LIỆU NGAY'}</button>
          </div>
        </> : <>
          <p>Phạm vi: <strong>{purgeTarget(deleteIntent.targetCode).label}</strong></p>
          <p>Mã xác nhận xóa đã được gửi theo chính sách xác nhận hiện tại. Hết hạn: {formatDate(deleteIntent.challengeExpiresAt)}</p>
          <label className={styles.field}>Mã 6 số<input inputMode="numeric" autoComplete="one-time-code" value={deleteCode} maxLength={6} onChange={(event) => setDeleteCode(event.currentTarget.value.replace(/\D/g, '').slice(0, 6))} /></label>
          <div className={styles.modalActions}><button className={styles.secondary} onClick={() => setDeleteOpen(false)}>HỦY</button><button className={styles.dangerButton} onClick={() => void verifyDeleteChallenge()} disabled={!/^\d{6}$/.test(deleteCode) || Boolean(busyAction)}>XÁC NHẬN MÃ</button></div>
        </>}
      </div>
    </div> : null}
  </AppShell>;
}
