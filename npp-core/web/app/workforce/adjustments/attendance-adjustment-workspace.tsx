'use client';

import { createIdempotencyKey } from '@npp/contracts';
import Link from 'next/link';
import { useMemo, useRef, useState } from 'react';
import { AppShell } from '../../components/app-shell';
import shellStyles from '../../components/app-shell.module.css';
import sharedStyles from '../../organization/organization.module.css';
import styles from './attendance-adjustment.module.css';
import type {
  AttendanceAdjustmentListResponse,
  AttendanceAdjustmentMutationResult,
  AttendanceAdjustmentRequest,
  AttendanceAdjustmentStatus,
  AttendancePeriodLock,
  AttendancePeriodLockListResponse,
} from '../../../lib/workforce-types';

type ApiEnvelope<T> = { data?: T; error?: { message?: string } };
type Attempt = { payload: string; key: string } | null;

const STATUS_LABEL: Record<AttendanceAdjustmentStatus, string> = {
  SUBMITTED: 'Chờ duyệt',
  APPROVED: 'Đã duyệt',
  REJECTED: 'Từ chối',
};

function stableKey(ref: React.MutableRefObject<Attempt>, operation: string, payload: unknown) {
  const serialized = JSON.stringify(payload);
  if (ref.current?.payload === serialized) return ref.current.key;
  const key = createIdempotencyKey(operation);
  ref.current = { payload: serialized, key };
  return key;
}

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
  const payload = await response.json().catch(() => ({})) as ApiEnvelope<T>;
  if (!response.ok || payload.data === undefined) {
    throw new Error(payload.error?.message || 'Không thực hiện được yêu cầu');
  }
  return payload.data;
}

function hcmIso(value: string) {
  if (!value) return null;
  if (!/^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}$/.test(value)) return null;
  const parsed = new Date(value + ':00+07:00');
  return Number.isNaN(parsed.getTime()) ? null : parsed.toISOString();
}

function dateLabel(value: string | null | undefined) {
  if (!value) return '—';
  const raw = String(value).slice(0, 10);
  const parts = raw.split('-');
  return parts.length === 3 ? parts[2] + '/' + parts[1] + '/' + parts[0] : String(value);
}

function dateTimeLabel(value: string | null | undefined) {
  if (!value) return '—';
  try {
    return new Intl.DateTimeFormat('vi-VN', {
      timeZone: 'Asia/Ho_Chi_Minh',
      day: '2-digit',
      month: '2-digit',
      year: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
      hourCycle: 'h23',
    }).format(new Date(value));
  } catch {
    return String(value);
  }
}

function requestedTimes(row: AttendanceAdjustmentRequest) {
  const values: string[] = [];
  if (row.requested_check_in_at) values.push('Giờ vào ' + dateTimeLabel(row.requested_check_in_at));
  if (row.requested_check_out_at) values.push('Giờ ra ' + dateTimeLabel(row.requested_check_out_at));
  return values.join(' · ') || '—';
}

export default function AttendanceAdjustmentWorkspace({
  initialData,
  initialLocks,
  initialFrom,
  initialTo,
  initialToday,
  initialEmployeeId,
  initialWorkDate,
  initialError,
}: {
  initialData: AttendanceAdjustmentListResponse | null;
  initialLocks: AttendancePeriodLockListResponse | null;
  initialFrom: string;
  initialTo: string;
  initialToday: string;
  initialEmployeeId: string | null;
  initialWorkDate: string | null;
  initialError: string | null;
}) {
  const [data, setData] = useState(initialData);
  const [locks, setLocks] = useState(initialLocks);
  const [from, setFrom] = useState(initialData?.period.from ?? initialFrom);
  const [to, setTo] = useState(initialData?.period.to ?? initialTo);
  const [status, setStatus] = useState('');
  const [employeeQuery, setEmployeeQuery] = useState('');
  const [branchId, setBranchId] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(initialError);
  const [notice, setNotice] = useState<string | null>(null);

  const [requestDate, setRequestDate] = useState(initialWorkDate || initialToday);
  const [requestIn, setRequestIn] = useState('');
  const [requestOut, setRequestOut] = useState('');
  const [requestReason, setRequestReason] = useState('');

  const targetEmployeeId = initialEmployeeId || data?.selectedEmployee?.id || '';
  const [directDate, setDirectDate] = useState(initialWorkDate || initialToday);
  const [directIn, setDirectIn] = useState('');
  const [directOut, setDirectOut] = useState('');
  const [directReason, setDirectReason] = useState('');

  const [reviewId, setReviewId] = useState<string | null>(null);
  const [reviewReason, setReviewReason] = useState('');
  const [lockFrom, setLockFrom] = useState(initialFrom);
  const [lockTo, setLockTo] = useState(initialTo);
  const [lockBranch, setLockBranch] = useState('');
  const [lockReason, setLockReason] = useState('');

  const selfAttempt = useRef<Attempt>(null);
  const reviewAttempt = useRef<Attempt>(null);
  const directAttempt = useRef<Attempt>(null);
  const lockAttempt = useRef<Attempt>(null);

  const selectedReview = useMemo(
    () => data?.requests.find((item) => item.id === reviewId) ?? null,
    [data, reviewId],
  );

  async function loadLocks() {
    const params = new URLSearchParams({ from, to });
    if (branchId) params.set('branchId', branchId);
    const next = await requestJson<AttendancePeriodLockListResponse>(
      '/api/workforce/period-locks?' + params.toString(),
    );
    setLocks(next);
  }

  async function load(nextOffset = 0) {
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      const params = new URLSearchParams({
        from,
        to,
        limit: '50',
        offset: String(Math.max(0, nextOffset)),
      });
      if (status) params.set('status', status);
      if (!data?.capabilities.selfOnly && employeeQuery.trim()) params.set('employeeQuery', employeeQuery.trim());
      if (!data?.capabilities.selfOnly && branchId) params.set('branchId', branchId);
      if (initialEmployeeId) params.set('employeeId', initialEmployeeId);
      const next = await requestJson<AttendanceAdjustmentListResponse>(
        '/api/workforce/adjustments?' + params.toString(),
      );
      setData(next);
      if (branchId && !next.branches.some((branch) => branch.id === branchId)) setBranchId('');
      if (next.capabilities.canManage || next.capabilities.canLock) await loadLocks();
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : 'Không tải được điều chỉnh công');
    } finally {
      setBusy(false);
    }
  }

  async function submitOwn(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const payload = {
      workDate: requestDate,
      requestedCheckInAt: hcmIso(requestIn),
      requestedCheckOutAt: hcmIso(requestOut),
      reason: requestReason.trim(),
    };
    const key = stableKey(selfAttempt, 'web-attendance-adjustment-submit', payload);
    setBusy(true); setError(null); setNotice(null);
    try {
      await requestJson<AttendanceAdjustmentRequest>('/api/workforce/adjustments', {
        method: 'POST',
        headers: { 'Idempotency-Key': key },
        body: JSON.stringify(payload),
      });
      selfAttempt.current = null;
      setRequestIn(''); setRequestOut(''); setRequestReason('');
      await load(0);
      setNotice('Yêu cầu điều chỉnh công đã được gửi.');
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : 'Không gửi được yêu cầu điều chỉnh công');
    } finally { setBusy(false); }
  }

  async function review(action: 'APPROVE' | 'REJECT') {
    if (!selectedReview) return;
    const payload = {
      requestId: selectedReview.id,
      action,
      expectedVersion: selectedReview.version,
      reviewReason: reviewReason.trim(),
    };
    const key = stableKey(reviewAttempt, 'web-attendance-adjustment-review', payload);
    setBusy(true); setError(null); setNotice(null);
    try {
      await requestJson<AttendanceAdjustmentMutationResult>('/api/workforce/adjustments/review', {
        method: 'POST',
        headers: { 'Idempotency-Key': key },
        body: JSON.stringify(payload),
      });
      reviewAttempt.current = null;
      setReviewId(null); setReviewReason('');
      await load(0);
      setNotice(action === 'APPROVE'
        ? 'Yêu cầu đã được duyệt và ghi nhận vào bảng công.'
        : 'Yêu cầu đã được từ chối.');
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : 'Không xử lý được yêu cầu điều chỉnh');
    } finally { setBusy(false); }
  }

  async function submitDirect(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!targetEmployeeId) return;
    const payload = {
      employeeId: targetEmployeeId,
      workDate: directDate,
      requestedCheckInAt: hcmIso(directIn),
      requestedCheckOutAt: hcmIso(directOut),
      reason: directReason.trim(),
    };
    const key = stableKey(directAttempt, 'web-attendance-adjustment-direct', payload);
    setBusy(true); setError(null); setNotice(null);
    try {
      await requestJson<AttendanceAdjustmentMutationResult>('/api/workforce/adjustments/direct', {
        method: 'POST',
        headers: { 'Idempotency-Key': key },
        body: JSON.stringify(payload),
      });
      directAttempt.current = null;
      setDirectIn(''); setDirectOut(''); setDirectReason('');
      await load(0);
      setNotice('Điều chỉnh trực tiếp đã được ghi nhận vào bảng công.');
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : 'Không ghi nhận được điều chỉnh trực tiếp');
    } finally { setBusy(false); }
  }

  async function submitLock(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const payload = {
      periodStart: lockFrom,
      periodEnd: lockTo,
      branchId: lockBranch || null,
      reason: lockReason.trim(),
    };
    const key = stableKey(lockAttempt, 'web-attendance-period-lock', payload);
    setBusy(true); setError(null); setNotice(null);
    try {
      await requestJson<AttendancePeriodLock>('/api/workforce/period-locks', {
        method: 'POST',
        headers: { 'Idempotency-Key': key },
        body: JSON.stringify(payload),
      });
      lockAttempt.current = null;
      setLockReason('');
      setNotice('Kỳ công đã được khóa.');
      await loadLocks();
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : 'Không khóa được kỳ công');
    } finally { setBusy(false); }
  }

  const actions = (
    <Link className={shellStyles.actionButton + ' ' + shellStyles.actionButtonPrimary} href="/workforce/timesheet">
      Mở Bảng công
    </Link>
  );

  const total = data?.pagination.total ?? 0;
  const rangeStart = total && data ? data.pagination.offset + 1 : 0;
  const rangeEnd = data ? Math.min(data.pagination.offset + data.requests.length, total) : 0;

  return (
    <AppShell
      title="Điều chỉnh công"
      subtitle="Gửi, duyệt và theo dõi thay đổi giờ chấm công có lý do và lịch sử xử lý."
      kicker="Nhân sự"
      actions={actions}
    >
      <section className={sharedStyles.page} data-testid="attendance-adjustment-page">
        {(error || notice) ? (
          <div className={sharedStyles.banner + ' ' + (error ? sharedStyles.bannerError : sharedStyles.bannerSuccess)} role="status">
            {error ?? notice}
          </div>
        ) : null}

        <section className={sharedStyles.summaryGrid}>
          <article className={sharedStyles.summaryCard}><span>Yêu cầu trong kỳ</span><strong>{total}</strong><small>{dateLabel(from)} – {dateLabel(to)}</small></article>
          <article className={sharedStyles.summaryCard}><span>Chờ duyệt</span><strong>{data?.requests.filter((item) => item.status === 'SUBMITTED').length ?? 0}</strong><small>Trong trang đang xem</small></article>
          <article className={sharedStyles.summaryCard}><span>Kỳ đã khóa</span><strong>{locks?.locks.length ?? 0}</strong><small>Trong thời gian đang xem</small></article>
        </section>

        <section className={sharedStyles.toolbar}>
          <div className={sharedStyles.toolbarFilter}><label htmlFor="adj-from">Từ ngày</label><input id="adj-from" type="date" value={from} onChange={(event) => setFrom(event.target.value)} /></div>
          <div className={sharedStyles.toolbarFilter}><label htmlFor="adj-to">Đến ngày</label><input id="adj-to" type="date" value={to} onChange={(event) => setTo(event.target.value)} /></div>
          <div className={sharedStyles.toolbarFilter}><label htmlFor="adj-status">Trạng thái</label><select id="adj-status" value={status} onChange={(event) => setStatus(event.target.value)}><option value="">Tất cả</option><option value="SUBMITTED">Chờ duyệt</option><option value="APPROVED">Đã duyệt</option><option value="REJECTED">Từ chối</option></select></div>
          {!data?.capabilities.selfOnly ? <div className={sharedStyles.toolbarFilter}><label htmlFor="adj-employee">Nhân sự</label><input id="adj-employee" value={employeeQuery} onChange={(event) => setEmployeeQuery(event.target.value)} placeholder="Mã hoặc tên nhân sự" /></div> : null}
          {!data?.capabilities.selfOnly && (data?.branches.length ?? 0) > 0 ? <div className={sharedStyles.toolbarFilter}><label htmlFor="adj-branch">Chi nhánh</label><select id="adj-branch" value={branchId} onChange={(event) => setBranchId(event.target.value)}><option value="">Tất cả chi nhánh được cấp</option>{data?.branches.map((branch) => <option key={branch.id} value={branch.id}>{branch.code} · {branch.name}</option>)}</select></div> : null}
          <div className={sharedStyles.formActions}><button type="button" className={sharedStyles.secondaryButton} onClick={() => void load(0)} disabled={busy}>{busy ? 'Đang tải…' : 'Xem dữ liệu'}</button></div>
        </section>

        <div className={styles.grid}>
          <div>
            <section className={sharedStyles.tableSection}>
              <div className={sharedStyles.sectionHeader}>
                <div><p className={sharedStyles.panelKicker}>Lịch sử xử lý</p><h2>Yêu cầu điều chỉnh công</h2></div>
                <span className={sharedStyles.panelChip}>{total} yêu cầu</span>
              </div>
              <div className={sharedStyles.tableWrap}>
                <table className={sharedStyles.table}>
                  <thead><tr><th>Ngày công</th><th>Nhân sự</th><th>Đề nghị</th><th>Trạng thái</th><th>Lý do</th><th>Xử lý</th></tr></thead>
                  <tbody>
                    {data?.requests.map((row) => (
                      <tr key={row.id}>
                        <td>{dateLabel(row.work_date)}</td>
                        <td><div className={styles.meta}><strong>{row.employee_code ? row.employee_code + ' · ' + row.employee_name : data?.selectedEmployee?.name || 'Bản thân'}</strong><small>{row.branch_name || 'Chưa gán chi nhánh'}</small></div></td>
                        <td><div className={styles.meta}><span>{requestedTimes(row)}</span><small>{row.request_source === 'DIRECT' ? 'Điều chỉnh trực tiếp' : 'Nhân viên gửi yêu cầu'}</small></div></td>
                        <td><span className={styles.status}>{STATUS_LABEL[row.status]}</span></td>
                        <td>{row.reason}</td>
                        <td>{data?.capabilities.canManage && row.status === 'SUBMITTED' ? <button type="button" className={styles.secondary} onClick={() => { setReviewId(row.id); setReviewReason(''); }}>Xử lý</button> : row.review_reason || '—'}</td>
                      </tr>
                    ))}
                    {!data?.requests.length ? <tr><td colSpan={6}><div className={sharedStyles.emptyState}>Chưa có yêu cầu điều chỉnh công trong kỳ đã chọn.</div></td></tr> : null}
                  </tbody>
                </table>
              </div>
              {data ? <div className={styles.actions}>
                <button type="button" className={styles.secondary} disabled={busy || !data.pagination.hasPrevious} onClick={() => void load(Math.max(0, data.pagination.offset - data.pagination.limit))}>Trang trước</button>
                <span>{rangeStart}–{rangeEnd} / {total}</span>
                <button type="button" className={styles.secondary} disabled={busy || !data.pagination.hasNext} onClick={() => void load(data.pagination.offset + data.pagination.limit)}>Trang sau</button>
              </div> : null}
              {selectedReview ? <div className={styles.reviewBox}>
                <h3>Xử lý yêu cầu ngày {dateLabel(selectedReview.work_date)}</h3>
                <p>{selectedReview.employee_code} · {selectedReview.employee_name} — {requestedTimes(selectedReview)}</p>
                <label>Ý kiến xử lý<textarea value={reviewReason} onChange={(event) => setReviewReason(event.target.value)} maxLength={1000} placeholder="Bắt buộc khi từ chối; có thể ghi chú khi duyệt" /></label>
                <div className={styles.actions}>
                  <button type="button" className={styles.primary} disabled={busy} onClick={() => void review('APPROVE')}>Duyệt</button>
                  <button type="button" className={styles.danger} disabled={busy || !reviewReason.trim()} onClick={() => void review('REJECT')}>Từ chối</button>
                  <button type="button" className={styles.secondary} disabled={busy} onClick={() => setReviewId(null)}>Đóng</button>
                </div>
              </div> : null}
            </section>

            {(data?.capabilities.canManage || data?.capabilities.canLock) ? <section className={sharedStyles.tableSection}>
              <div className={sharedStyles.sectionHeader}><div><p className={sharedStyles.panelKicker}>Kiểm soát kỳ</p><h2>Kỳ công đã khóa</h2></div></div>
              <div className={sharedStyles.tableWrap}><table className={sharedStyles.table}><thead><tr><th>Thời gian</th><th>Phạm vi</th><th>Lý do</th><th>Thời điểm khóa</th></tr></thead><tbody>
                {locks?.locks.map((lock) => <tr key={lock.id}><td className={styles.locked}>{dateLabel(lock.period_start)} – {dateLabel(lock.period_end)}</td><td>{lock.branch_id ? ((lock.branch_code || '') + ' ' + (lock.branch_name || '')).trim() : 'Toàn Công Ty'}</td><td>{lock.reason}</td><td>{dateTimeLabel(lock.locked_at)}</td></tr>)}
                {!locks?.locks.length ? <tr><td colSpan={4}><div className={sharedStyles.emptyState}>Chưa có kỳ công bị khóa trong thời gian này.</div></td></tr> : null}
              </tbody></table></div>
            </section> : null}
          </div>

          <div>
            {data?.capabilities.canSubmitOwn ? <section className={styles.panel}>
              <h3>Gửi yêu cầu của tôi</h3>
              <p className={styles.note}>Dùng khi quên chấm công, QR lỗi hoặc cần xác nhận thời gian thực tế.</p>
              <form onSubmit={(event) => void submitOwn(event)}>
                <div className={styles.formGrid}>
                  <label>Ngày công<input type="date" max={initialToday} value={requestDate} onChange={(event) => setRequestDate(event.target.value)} required /></label><span />
                  <label>Giờ vào đề nghị<input type="datetime-local" value={requestIn} onChange={(event) => setRequestIn(event.target.value)} /></label>
                  <label>Giờ ra đề nghị<input type="datetime-local" value={requestOut} onChange={(event) => setRequestOut(event.target.value)} /></label>
                  <label className={styles.full}>Lý do<textarea value={requestReason} onChange={(event) => setRequestReason(event.target.value)} maxLength={1000} required /></label>
                </div>
                <div className={styles.actions}><button type="submit" className={styles.primary} disabled={busy || (!requestIn && !requestOut)}>Gửi yêu cầu</button></div>
              </form>
            </section> : null}

            {data?.capabilities.canManage ? <section className={styles.panel}>
              <h3>Điều chỉnh trực tiếp</h3>
              {targetEmployeeId ? <>
                <p className={styles.note}>Nhân sự: <strong>{data?.selectedEmployee ? data.selectedEmployee.code + ' · ' + data.selectedEmployee.name : 'Đã chọn từ Bảng công'}</strong></p>
                <form onSubmit={(event) => void submitDirect(event)}>
                  <div className={styles.formGrid}>
                    <label>Ngày công<input type="date" max={initialToday} value={directDate} onChange={(event) => setDirectDate(event.target.value)} required /></label><span />
                    <label>Giờ vào đúng<input type="datetime-local" value={directIn} onChange={(event) => setDirectIn(event.target.value)} /></label>
                    <label>Giờ ra đúng<input type="datetime-local" value={directOut} onChange={(event) => setDirectOut(event.target.value)} /></label>
                    <label className={styles.full}>Lý do xác nhận<textarea value={directReason} onChange={(event) => setDirectReason(event.target.value)} maxLength={1000} required /></label>
                  </div>
                  <div className={styles.actions}><button type="submit" className={styles.primary} disabled={busy || (!directIn && !directOut)}>Ghi nhận điều chỉnh</button></div>
                </form>
              </> : <p className={styles.note}>Chọn một ngày công tại <Link className={styles.inlineLink} href="/workforce/timesheet">Bảng công</Link> rồi chọn “Điều chỉnh” để tránh chọn nhầm nhân sự.</p>}
            </section> : null}

            {data?.capabilities.canLock ? <section className={styles.panel}>
              <h3>Khóa kỳ công</h3>
              <p className={styles.note}>Sau khi khóa, nhân viên không thể gửi yêu cầu mới. Điều chỉnh ngoại lệ cần đồng thời quyền điều chỉnh công và quyền khóa kỳ.</p>
              <form onSubmit={(event) => void submitLock(event)}>
                <div className={styles.formGrid}>
                  <label>Từ ngày<input type="date" value={lockFrom} onChange={(event) => setLockFrom(event.target.value)} required /></label>
                  <label>Đến ngày<input type="date" value={lockTo} onChange={(event) => setLockTo(event.target.value)} required /></label>
                  {locks?.companyScope ? <label className={styles.full}>Phạm vi<select value={lockBranch} onChange={(event) => setLockBranch(event.target.value)}><option value="">Toàn Công Ty</option>{locks.branches.map((branch) => <option key={branch.id} value={branch.id}>{branch.code} · {branch.name}</option>)}</select></label> : <label className={styles.full}>Chi nhánh<select value={lockBranch} onChange={(event) => setLockBranch(event.target.value)} required><option value="">Chọn chi nhánh</option>{locks?.branches.map((branch) => <option key={branch.id} value={branch.id}>{branch.code} · {branch.name}</option>)}</select></label>}
                  <label className={styles.full}>Lý do khóa kỳ<textarea value={lockReason} onChange={(event) => setLockReason(event.target.value)} maxLength={1000} required /></label>
                </div>
                <div className={styles.actions}><button type="submit" className={styles.primary} disabled={busy || !lockReason.trim()}>Khóa kỳ công</button></div>
              </form>
            </section> : null}
          </div>
        </div>
      </section>
    </AppShell>
  );
}
