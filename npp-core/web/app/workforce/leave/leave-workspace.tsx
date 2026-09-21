'use client';

import { createIdempotencyKey } from '@npp/contracts';
import Link from 'next/link';
import { useMemo, useRef, useState } from 'react';
import { AppShell } from '../../components/app-shell';
import shellStyles from '../../components/app-shell.module.css';
import sharedStyles from '../../organization/organization.module.css';
import styles from './leave.module.css';
import type {
  LeaveDayPart,
  LeaveRequest,
  LeaveRequestListResponse,
  LeaveRequestStatus,
  LeaveType,
  LeaveTypeListResponse,
} from '../../../lib/workforce-types';

type ApiEnvelope<T> = { data?: T; error?: { message?: string } };
type Attempt = { payload: string; key: string } | null;
type LeaveTypeBalanceFields = { tracks_balance?: boolean; allow_negative_balance?: boolean };
type LeaveBalanceRow = {
  employee_id: string;
  employee_code: string;
  employee_name: string;
  branch_name: string | null;
  leave_type_id: string;
  leave_type_code: string;
  leave_type_name: string;
  balance_days: number;
  allow_negative_balance: boolean;
  last_activity_date: string | null;
};
type LeaveBalanceEntry = {
  id: string;
  employee_id: string;
  employee_code: string;
  employee_name: string;
  leave_type_id: string;
  leave_type_name_snapshot: string;
  entry_type: string;
  quantity_days: number;
  effective_date: string;
  reason: string;
};
type LeaveDataWithBalance = LeaveRequestListResponse & {
  balanceAsOfDate?: string;
  leaveBalances?: LeaveBalanceRow[];
  balanceEntries?: LeaveBalanceEntry[];
};

const STATUS_LABEL: Record<LeaveRequestStatus, string> = {
  SUBMITTED: 'Chờ duyệt',
  APPROVED: 'Đã duyệt',
  REJECTED: 'Từ chối',
  CANCELLED: 'Đã hủy',
};

const DAY_PART_LABEL: Record<LeaveDayPart, string> = {
  FULL_DAY: 'Cả ngày',
  FIRST_HALF: 'Nửa ca đầu',
  SECOND_HALF: 'Nửa ca sau',
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
  if (!response.ok || payload.data === undefined) throw new Error(payload.error?.message || 'Không thực hiện được yêu cầu');
  return payload.data;
}

function dateLabel(value: string | null | undefined) {
  if (!value) return '—';
  const raw = String(value).slice(0, 10);
  const parts = raw.split('-');
  return parts.length === 3 ? parts[2] + '/' + parts[1] + '/' + parts[0] : String(value);
}

function requestPeriod(row: LeaveRequest) {
  return row.date_from === row.date_to
    ? dateLabel(row.date_from)
    : dateLabel(row.date_from) + ' – ' + dateLabel(row.date_to);
}

function typeBadges(type: LeaveType) {
  const balance = type as LeaveType & LeaveTypeBalanceFields;
  return [
    type.is_paid ? 'Hưởng lương' : 'Không lương',
    type.counts_as_workday ? 'Tính ngày công' : 'Không tính ngày công',
    type.requires_approval ? 'Cần duyệt' : 'Tự động duyệt',
    type.allows_half_day ? 'Có nửa ngày' : null,
    type.requires_attachment ? 'Cần chứng từ' : null,
    balance.tracks_balance ? 'Theo dõi số dư' : null,
    balance.allow_negative_balance ? 'Cho phép âm' : null,
    !type.is_active ? 'Ngừng áp dụng' : null,
  ].filter(Boolean) as string[];
}

const blankTypeForm = {
  id: '',
  expectedVersion: 0,
  code: '',
  name: '',
  isActive: true,
  isPaid: true,
  countsAsWorkday: true,
  requiresApproval: true,
  allowsFullDay: true,
  allowsHalfDay: true,
  requiresAttachment: false,
  tracksBalance: false,
  allowNegativeBalance: false,
};

export default function LeaveWorkspace({
  initialData,
  initialTypes,
  initialFrom,
  initialTo,
  initialToday,
  initialError,
}: {
  initialData: LeaveDataWithBalance | null;
  initialTypes: LeaveTypeListResponse | null;
  initialFrom: string;
  initialTo: string;
  initialToday: string;
  initialError: string | null;
}) {
  const [data, setData] = useState(initialData);
  const [typesData, setTypesData] = useState(initialTypes);
  const [from, setFrom] = useState(initialFrom);
  const [to, setTo] = useState(initialTo);
  const [status, setStatus] = useState('');
  const [employeeQuery, setEmployeeQuery] = useState('');
  const [branchId, setBranchId] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(initialError);
  const [notice, setNotice] = useState<string | null>(null);

  const activeTypes = useMemo(
    () => (typesData?.leaveTypes ?? []).filter((item) => item.is_active),
    [typesData],
  );

  const [leaveTypeId, setLeaveTypeId] = useState(activeTypes[0]?.id ?? '');
  const [dateFrom, setDateFrom] = useState(initialToday);
  const [dateTo, setDateTo] = useState(initialToday);
  const [dayPart, setDayPart] = useState<LeaveDayPart>('FULL_DAY');
  const [reason, setReason] = useState('');
  const [attachmentReference, setAttachmentReference] = useState('');

  const [reviewId, setReviewId] = useState<string | null>(null);
  const [reviewReason, setReviewReason] = useState('');
  const [cancelId, setCancelId] = useState<string | null>(null);
  const [cancelReason, setCancelReason] = useState('');

  const [typeForm, setTypeForm] = useState(blankTypeForm);

  const submitAttempt = useRef<Attempt>(null);
  const reviewAttempt = useRef<Attempt>(null);
  const cancelAttempt = useRef<Attempt>(null);
  const typeAttempt = useRef<Attempt>(null);

  const selectedType = useMemo(
    () => activeTypes.find((item) => item.id === leaveTypeId) ?? null,
    [activeTypes, leaveTypeId],
  );
  const selectedReview = useMemo(
    () => data?.requests.find((item) => item.id === reviewId) ?? null,
    [data, reviewId],
  );
  const selectedCancel = useMemo(
    () => data?.requests.find((item) => item.id === cancelId) ?? null,
    [data, cancelId],
  );
  const configWarning = useMemo(() => {
    if (!typeForm.isPaid && typeForm.countsAsWorkday) return 'Thiết lập không lương nhưng vẫn tính ngày công có thể làm thay đổi cách tính công. Bạn vẫn có thể lưu nếu đây là chính sách của Công Ty.';
    if (!typeForm.requiresApproval) return 'Chế độ này sẽ tự động duyệt khi nhân viên gửi đơn. Bạn vẫn có thể lưu nếu đây là chính sách của Công Ty.';
    return null;
  }, [typeForm]);

  async function loadTypes() {
    const next = await requestJson<LeaveTypeListResponse>('/api/workforce/leave-types');
    setTypesData(next);
    if (!leaveTypeId || !next.leaveTypes.some((item) => item.id === leaveTypeId && item.is_active)) {
      const first = next.leaveTypes.find((item) => item.is_active);
      setLeaveTypeId(first?.id ?? '');
    }
  }

  async function load(nextOffset = 0) {
    setBusy(true); setError(null); setNotice(null);
    try {
      const params = new URLSearchParams({ from, to, limit: '50', offset: String(Math.max(0, nextOffset)) });
      if (status) params.set('status', status);
      if (!data?.capabilities.selfOnly && employeeQuery.trim()) params.set('employeeQuery', employeeQuery.trim());
      if (!data?.capabilities.selfOnly && branchId) params.set('branchId', branchId);
      const next = await requestJson<LeaveDataWithBalance>('/api/workforce/leave/requests?' + params.toString());
      setData(next);
      if (branchId && !next.branches.some((branch) => branch.id === branchId)) setBranchId('');
      await loadTypes();
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : 'Không tải được dữ liệu nghỉ');
    } finally { setBusy(false); }
  }

  function validateRequest() {
    if (!selectedType) return 'Vui lòng chọn chế độ nghỉ.';
    if (!dateFrom || !dateTo || dateTo < dateFrom) return 'Khoảng ngày nghỉ không hợp lệ.';
    if (dayPart !== 'FULL_DAY' && dateFrom !== dateTo) return 'Nghỉ nửa ngày chỉ áp dụng cho một ngày.';
    if (dayPart === 'FULL_DAY' && !selectedType.allows_full_day) return 'Chế độ nghỉ này không cho phép nghỉ cả ngày.';
    if (dayPart !== 'FULL_DAY' && !selectedType.allows_half_day) return 'Chế độ nghỉ này không cho phép nghỉ nửa ngày.';
    if (!reason.trim()) return 'Vui lòng nhập lý do nghỉ.';
    if (selectedType.requires_attachment && !attachmentReference.trim()) return 'Chế độ nghỉ này yêu cầu thông tin chứng từ.';
    return null;
  }

  async function submitRequest(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const validation = validateRequest();
    if (validation) { setError(validation); return; }
    const payload = {
      leaveTypeId,
      dateFrom,
      dateTo,
      dayPart,
      reason: reason.trim(),
      attachmentReference: attachmentReference.trim() || null,
    };
    const key = stableKey(submitAttempt, 'web-leave-request-submit', payload);
    setBusy(true); setError(null); setNotice(null);
    try {
      const result = await requestJson<LeaveRequest>('/api/workforce/leave/requests', {
        method: 'POST',
        headers: { 'Idempotency-Key': key },
        body: JSON.stringify(payload),
      });
      submitAttempt.current = null;
      setReason(''); setAttachmentReference('');
      await load(0);
      setNotice(result.status === 'APPROVED'
        ? 'Đơn nghỉ đã được ghi nhận và tự động duyệt theo chế độ nghỉ.'
        : 'Đơn nghỉ đã được gửi để duyệt.');
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : 'Không gửi được đơn nghỉ');
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
    const key = stableKey(reviewAttempt, 'web-leave-request-review', payload);
    setBusy(true); setError(null); setNotice(null);
    try {
      await requestJson<LeaveRequest>('/api/workforce/leave/requests/review', {
        method: 'POST',
        headers: { 'Idempotency-Key': key },
        body: JSON.stringify(payload),
      });
      reviewAttempt.current = null;
      setReviewId(null); setReviewReason('');
      await load(0);
      setNotice(action === 'APPROVE' ? 'Đơn nghỉ đã được duyệt.' : 'Đơn nghỉ đã được từ chối.');
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : 'Không xử lý được đơn nghỉ');
    } finally { setBusy(false); }
  }

  async function cancelRequest() {
    if (!selectedCancel || !cancelReason.trim()) return;
    const payload = {
      requestId: selectedCancel.id,
      expectedVersion: selectedCancel.version,
      cancelReason: cancelReason.trim(),
    };
    const key = stableKey(cancelAttempt, 'web-leave-request-cancel', payload);
    setBusy(true); setError(null); setNotice(null);
    try {
      await requestJson<LeaveRequest>('/api/workforce/leave/requests/cancel', {
        method: 'POST',
        headers: { 'Idempotency-Key': key },
        body: JSON.stringify(payload),
      });
      cancelAttempt.current = null;
      setCancelId(null); setCancelReason('');
      await load(0);
      setNotice('Đơn nghỉ đã được hủy.');
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : 'Không hủy được đơn nghỉ');
    } finally { setBusy(false); }
  }

  function editType(type: LeaveType) {
    const balance = type as LeaveType & LeaveTypeBalanceFields;
    setTypeForm({
      id: type.id,
      expectedVersion: type.version,
      code: type.code,
      name: type.name,
      isActive: type.is_active,
      isPaid: type.is_paid,
      countsAsWorkday: type.counts_as_workday,
      requiresApproval: type.requires_approval,
      allowsFullDay: type.allows_full_day,
      allowsHalfDay: type.allows_half_day,
      requiresAttachment: type.requires_attachment,
      tracksBalance: Boolean(balance.tracks_balance),
      allowNegativeBalance: Boolean(balance.allow_negative_balance),
    });
  }

  async function saveType(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!typeForm.name.trim()) { setError('Vui lòng nhập tên chế độ nghỉ.'); return; }
    if (!typeForm.id && !typeForm.code.trim()) { setError('Vui lòng nhập mã chế độ nghỉ.'); return; }
    if (!typeForm.allowsFullDay && !typeForm.allowsHalfDay) { setError('Chế độ nghỉ phải cho phép cả ngày hoặc nửa ngày.'); return; }
    if (typeForm.allowNegativeBalance && !typeForm.tracksBalance) { setError('Chỉ được cho phép âm khi chế độ nghỉ có theo dõi số dư.'); return; }
    const payload = typeForm.id ? {
      id: typeForm.id,
      expectedVersion: typeForm.expectedVersion,
      name: typeForm.name.trim(),
      isActive: typeForm.isActive,
      isPaid: typeForm.isPaid,
      countsAsWorkday: typeForm.countsAsWorkday,
      requiresApproval: typeForm.requiresApproval,
      allowsFullDay: typeForm.allowsFullDay,
      allowsHalfDay: typeForm.allowsHalfDay,
      requiresAttachment: typeForm.requiresAttachment,
      tracksBalance: typeForm.tracksBalance,
      allowNegativeBalance: typeForm.allowNegativeBalance,
    } : {
      code: typeForm.code.trim().toUpperCase(),
      name: typeForm.name.trim(),
      isActive: typeForm.isActive,
      isPaid: typeForm.isPaid,
      countsAsWorkday: typeForm.countsAsWorkday,
      requiresApproval: typeForm.requiresApproval,
      allowsFullDay: typeForm.allowsFullDay,
      allowsHalfDay: typeForm.allowsHalfDay,
      requiresAttachment: typeForm.requiresAttachment,
      tracksBalance: typeForm.tracksBalance,
      allowNegativeBalance: typeForm.allowNegativeBalance,
    };
    const operation = typeForm.id ? 'web-leave-type-update' : 'web-leave-type-create';
    const key = stableKey(typeAttempt, operation, payload);
    setBusy(true); setError(null); setNotice(null);
    try {
      await requestJson<LeaveType>(typeForm.id ? '/api/workforce/leave-types/update' : '/api/workforce/leave-types', {
        method: 'POST',
        headers: { 'Idempotency-Key': key },
        body: JSON.stringify(payload),
      });
      typeAttempt.current = null;
      setTypeForm(blankTypeForm);
      await loadTypes();
      setNotice(typeForm.id ? 'Chế độ nghỉ đã được cập nhật.' : 'Chế độ nghỉ đã được tạo.');
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : 'Không lưu được chế độ nghỉ');
    } finally { setBusy(false); }
  }

  const total = data?.pagination.total ?? 0;
  const rangeStart = total && data ? data.pagination.offset + 1 : 0;
  const rangeEnd = data ? Math.min(data.pagination.offset + data.requests.length, total) : 0;
  const canManagerCancel = Boolean(data?.capabilities.canApprove);

  return (
    <AppShell
      title="Nghỉ và đơn nghỉ"
      subtitle="Gửi, duyệt và theo dõi nghỉ phép theo đúng chế độ nghỉ và phạm vi được cấp."
      kicker="Nhân sự"
      actions={<Link className={shellStyles.actionButton + ' ' + shellStyles.actionButtonPrimary} href="/workforce/timesheet">Mở Bảng công</Link>}
    >
      <section className={sharedStyles.page} data-testid="workforce-leave-page">
        {(error || notice) ? <div className={sharedStyles.banner + ' ' + (error ? sharedStyles.bannerError : sharedStyles.bannerSuccess)} role="status">{error ?? notice}</div> : null}

        <section className={sharedStyles.summaryGrid}>
          <article className={sharedStyles.summaryCard}><span>Đơn trong kỳ</span><strong>{total}</strong><small>{dateLabel(from)} – {dateLabel(to)}</small></article>
          <article className={sharedStyles.summaryCard}><span>Chờ duyệt</span><strong>{data?.requests.filter((item) => item.status === 'SUBMITTED').length ?? 0}</strong><small>Trong trang đang xem</small></article>
          <article className={sharedStyles.summaryCard}><span>Chế độ nghỉ</span><strong>{activeTypes.length}</strong><small>Đang áp dụng</small></article>
        </section>

        <section className={sharedStyles.toolbar}>
          <div className={sharedStyles.toolbarFilter}><label htmlFor="leave-from">Từ ngày</label><input id="leave-from" type="date" value={from} onChange={(event) => setFrom(event.target.value)} /></div>
          <div className={sharedStyles.toolbarFilter}><label htmlFor="leave-to">Đến ngày</label><input id="leave-to" type="date" value={to} onChange={(event) => setTo(event.target.value)} /></div>
          <div className={sharedStyles.toolbarFilter}><label htmlFor="leave-status">Trạng thái</label><select id="leave-status" value={status} onChange={(event) => setStatus(event.target.value)}><option value="">Tất cả</option><option value="SUBMITTED">Chờ duyệt</option><option value="APPROVED">Đã duyệt</option><option value="REJECTED">Từ chối</option><option value="CANCELLED">Đã hủy</option></select></div>
          {!data?.capabilities.selfOnly ? <div className={sharedStyles.toolbarFilter}><label htmlFor="leave-employee">Nhân sự</label><input id="leave-employee" value={employeeQuery} onChange={(event) => setEmployeeQuery(event.target.value)} placeholder="Mã hoặc tên nhân sự" /></div> : null}
          {!data?.capabilities.selfOnly && (data?.branches.length ?? 0) > 0 ? <div className={sharedStyles.toolbarFilter}><label htmlFor="leave-branch">Chi nhánh</label><select id="leave-branch" value={branchId} onChange={(event) => setBranchId(event.target.value)}><option value="">Tất cả chi nhánh được cấp</option>{data?.branches.map((branch) => <option key={branch.id} value={branch.id}>{branch.code} · {branch.name}</option>)}</select></div> : null}
          <div className={sharedStyles.formActions}><button type="button" className={sharedStyles.secondaryButton} onClick={() => void load(0)} disabled={busy}>{busy ? 'Đang tải…' : 'Xem dữ liệu'}</button></div>
        </section>

        <div className={styles.grid}>
          <div className={styles.stack}>
            <section className={sharedStyles.tableSection}>
              <div className={sharedStyles.sectionHeader}><div><p className={sharedStyles.panelKicker}>Đơn nghỉ</p><h2>Lịch sử và trạng thái xử lý</h2></div><span className={sharedStyles.panelChip}>{total} đơn</span></div>
              <div className={sharedStyles.tableWrap}>
                <table className={sharedStyles.table}>
                  <thead><tr><th>Thời gian</th><th>Nhân sự</th><th>Chế độ nghỉ</th><th>Trạng thái</th><th>Lý do</th><th>Xử lý</th></tr></thead>
                  <tbody>
                    {data?.requests.map((row) => {
                      const canCancel = (data.capabilities.selfOnly && row.status === 'SUBMITTED')
                        || (canManagerCancel && (row.status === 'SUBMITTED' || row.status === 'APPROVED'));
                      return <tr key={row.id}>
                        <td><div className={styles.meta}><strong>{requestPeriod(row)}</strong><small>{DAY_PART_LABEL[row.day_part]}</small></div></td>
                        <td><div className={styles.meta}><strong>{row.employee_code ? row.employee_code + ' · ' + row.employee_name : data.selectedEmployee?.name || 'Bản thân'}</strong><small>{row.branch_name || 'Chưa gán chi nhánh'}</small></div></td>
                        <td><div className={styles.meta}><strong>{row.leave_type_name_snapshot}</strong><small>{row.leave_is_paid_snapshot ? 'Hưởng lương' : 'Không lương'} · {row.leave_counts_as_workday_snapshot ? 'Tính ngày công' : 'Không tính ngày công'}</small></div></td>
                        <td><span className={styles.status}>{STATUS_LABEL[row.status]}</span></td>
                        <td>{row.reason}</td>
                        <td><div className={styles.actions}>
                          {data.capabilities.canApprove && row.status === 'SUBMITTED' ? <button type="button" className={styles.secondary} onClick={() => { setReviewId(row.id); setReviewReason(''); }}>Duyệt / từ chối</button> : null}
                          {canCancel ? <button type="button" className={styles.secondary} onClick={() => { setCancelId(row.id); setCancelReason(''); }}>Hủy đơn</button> : null}
                          {!data.capabilities.canApprove && !canCancel ? <span>{row.review_reason || row.cancel_reason || '—'}</span> : null}
                        </div></td>
                      </tr>;
                    })}
                    {!data?.requests.length ? <tr><td colSpan={6}><div className={sharedStyles.emptyState}>Chưa có đơn nghỉ trong thời gian đã chọn.</div></td></tr> : null}
                  </tbody>
                </table>
              </div>
              {data ? <div className={styles.actions}>
                <button type="button" className={styles.secondary} disabled={busy || !data.pagination.hasPrevious} onClick={() => void load(Math.max(0, data.pagination.offset - data.pagination.limit))}>Trang trước</button>
                <span>{rangeStart}–{rangeEnd} / {total}</span>
                <button type="button" className={styles.secondary} disabled={busy || !data.pagination.hasNext} onClick={() => void load(data.pagination.offset + data.pagination.limit)}>Trang sau</button>
              </div> : null}
              {selectedReview ? <div className={styles.reviewBox}>
                <h3>Xử lý đơn nghỉ {requestPeriod(selectedReview)}</h3>
                <p>{selectedReview.employee_code} · {selectedReview.employee_name} — {selectedReview.leave_type_name_snapshot} · {DAY_PART_LABEL[selectedReview.day_part]}</p>
                <label>Ý kiến xử lý<textarea value={reviewReason} onChange={(event) => setReviewReason(event.target.value)} maxLength={1000} placeholder="Bắt buộc khi từ chối; có thể ghi chú khi duyệt" /></label>
                <div className={styles.actions}>
                  <button type="button" className={styles.primary} disabled={busy} onClick={() => void review('APPROVE')}>Duyệt</button>
                  <button type="button" className={styles.danger} disabled={busy || !reviewReason.trim()} onClick={() => void review('REJECT')}>Từ chối</button>
                  <button type="button" className={styles.secondary} disabled={busy} onClick={() => setReviewId(null)}>Đóng</button>
                </div>
              </div> : null}
              {selectedCancel ? <div className={styles.reviewBox}>
                <h3>Hủy đơn nghỉ {requestPeriod(selectedCancel)}</h3>
                <p>{selectedCancel.leave_type_name_snapshot} · {DAY_PART_LABEL[selectedCancel.day_part]}</p>
                <label>Lý do hủy<textarea value={cancelReason} onChange={(event) => setCancelReason(event.target.value)} maxLength={1000} required /></label>
                <div className={styles.actions}>
                  <button type="button" className={styles.danger} disabled={busy || !cancelReason.trim()} onClick={() => void cancelRequest()}>Xác nhận hủy</button>
                  <button type="button" className={styles.secondary} disabled={busy} onClick={() => setCancelId(null)}>Đóng</button>
                </div>
              </div> : null}
            </section>

            {typesData?.capabilities.canManage ? <section className={styles.panel}>
              <h3>Chế độ nghỉ</h3>
              <p className={styles.note}>Thiết lập áp dụng cho Công Ty. Thay đổi sau này không làm đổi nội dung các đơn đã gửi trước đó.</p>
              <form onSubmit={(event) => void saveType(event)}>
                <div className={styles.formGrid}>
                  <label>Mã chế độ<input value={typeForm.code} onChange={(event) => setTypeForm((current) => ({ ...current, code: event.target.value.toUpperCase() }))} disabled={Boolean(typeForm.id)} maxLength={32} placeholder="VD: PHEP_NAM" required /></label>
                  <label>Tên chế độ<input value={typeForm.name} onChange={(event) => setTypeForm((current) => ({ ...current, name: event.target.value }))} maxLength={100} placeholder="VD: Nghỉ phép năm" required /></label>
                </div>
                <div className={styles.checkGrid}>
                  <label><input type="checkbox" checked={typeForm.isActive} onChange={(event) => setTypeForm((current) => ({ ...current, isActive: event.target.checked }))} />Đang áp dụng</label>
                  <label><input type="checkbox" checked={typeForm.isPaid} onChange={(event) => setTypeForm((current) => ({ ...current, isPaid: event.target.checked }))} />Hưởng lương</label>
                  <label><input type="checkbox" checked={typeForm.countsAsWorkday} onChange={(event) => setTypeForm((current) => ({ ...current, countsAsWorkday: event.target.checked }))} />Tính ngày công</label>
                  <label><input type="checkbox" checked={typeForm.requiresApproval} onChange={(event) => setTypeForm((current) => ({ ...current, requiresApproval: event.target.checked }))} />Cần duyệt</label>
                  <label><input type="checkbox" checked={typeForm.allowsFullDay} onChange={(event) => setTypeForm((current) => ({ ...current, allowsFullDay: event.target.checked }))} />Cho phép cả ngày</label>
                  <label><input type="checkbox" checked={typeForm.allowsHalfDay} onChange={(event) => setTypeForm((current) => ({ ...current, allowsHalfDay: event.target.checked }))} />Cho phép nửa ngày</label>
                  <label><input type="checkbox" checked={typeForm.requiresAttachment} onChange={(event) => setTypeForm((current) => ({ ...current, requiresAttachment: event.target.checked }))} />Cần chứng từ</label>
                  <label><input type="checkbox" checked={typeForm.tracksBalance} onChange={(event) => setTypeForm((current) => ({ ...current, tracksBalance: event.target.checked, allowNegativeBalance: event.target.checked ? current.allowNegativeBalance : false }))} />Theo dõi số dư phép</label>
                  <label><input type="checkbox" checked={typeForm.allowNegativeBalance} disabled={!typeForm.tracksBalance} onChange={(event) => setTypeForm((current) => ({ ...current, allowNegativeBalance: event.target.checked }))} />Cho phép số dư âm</label>
                </div>
                {configWarning ? <div className={styles.warning} role="status">{configWarning}</div> : null}
                <div className={styles.actions}><button type="submit" className={styles.primary} disabled={busy}>{typeForm.id ? 'Lưu thay đổi' : 'Thêm chế độ nghỉ'}</button>{typeForm.id ? <button type="button" className={styles.secondary} disabled={busy} onClick={() => setTypeForm(blankTypeForm)}>Hủy sửa</button> : null}</div>
              </form>
              <div className={styles.typeList}>
                {typesData.leaveTypes.map((type) => <div className={styles.typeRow} key={type.id}><div className={styles.meta}><strong>{type.name}</strong><small>{type.code}</small><div className={styles.badges}>{typeBadges(type).map((badge) => <span className={styles.badge} key={badge}>{badge}</span>)}</div></div><button type="button" className={styles.secondary} onClick={() => editType(type)}>Sửa</button></div>)}
              </div>
            </section> : null}
          </div>

          <div className={styles.stack}>
            {data?.capabilities.canSubmitOwn ? <section className={styles.panel}>
              <h3>Gửi đơn nghỉ của tôi</h3>
              <p className={styles.note}>Chọn chế độ nghỉ và thời gian cần nghỉ. Nghỉ nửa ngày được tính theo nửa ca đầu hoặc nửa ca sau, không theo giờ sáng/chiều cố định.</p>
              <form onSubmit={(event) => void submitRequest(event)}>
                <div className={styles.formGrid}>
                  <label className={styles.full}>Chế độ nghỉ<select value={leaveTypeId} onChange={(event) => setLeaveTypeId(event.target.value)} required><option value="">Chọn chế độ nghỉ</option>{activeTypes.map((type) => <option value={type.id} key={type.id}>{type.name}</option>)}</select></label>
                  <label>Từ ngày<input type="date" value={dateFrom} onChange={(event) => { setDateFrom(event.target.value); if (dayPart !== 'FULL_DAY') setDateTo(event.target.value); }} required /></label>
                  <label>Đến ngày<input type="date" value={dateTo} min={dateFrom} onChange={(event) => setDateTo(event.target.value)} disabled={dayPart !== 'FULL_DAY'} required /></label>
                  <label className={styles.full}>Phần ngày<select value={dayPart} onChange={(event) => { const value = event.target.value as LeaveDayPart; setDayPart(value); if (value !== 'FULL_DAY') setDateTo(dateFrom); }}><option value="FULL_DAY">Cả ngày</option><option value="FIRST_HALF">Nửa ca đầu</option><option value="SECOND_HALF">Nửa ca sau</option></select></label>
                  <label className={styles.full}>Lý do<textarea value={reason} onChange={(event) => setReason(event.target.value)} maxLength={1000} required /></label>
                  {selectedType?.requires_attachment ? <label className={styles.full}>Thông tin chứng từ<input value={attachmentReference} onChange={(event) => setAttachmentReference(event.target.value)} maxLength={1000} placeholder="Số giấy tờ hoặc tham chiếu tài liệu" required /></label> : null}
                </div>
                {selectedType ? <div className={styles.badges}>{typeBadges(selectedType).filter((badge) => badge !== 'Ngừng áp dụng').map((badge) => <span className={styles.badge} key={badge}>{badge}</span>)}</div> : null}
                <div className={styles.actions}><button type="submit" className={styles.primary} disabled={busy || !leaveTypeId || !reason.trim()}>Gửi đơn nghỉ</button></div>
              </form>
            </section> : <section className={styles.panel}><h3>Đơn nghỉ</h3><p className={styles.note}>Tài khoản hiện không có quyền gửi đơn nghỉ cho bản thân.</p></section>}

            <section className={styles.panel}>
              <h3>Quy tắc xử lý</h3>
              <p className={styles.note}>“Nghỉ” theo lịch làm việc và “nghỉ có phép” là hai nghiệp vụ khác nhau. Đơn nghỉ chỉ xác nhận quyền nghỉ; dữ liệu chấm công thực tế không bị sửa hoặc xóa.</p>
              <p className={styles.note}>Nếu kỳ công đã khóa, hệ thống sẽ chặn thay đổi trừ người xử lý có quyền ngoại lệ phù hợp.</p>
            </section>
          </div>
        </div>
      </section>
    </AppShell>
  );
}
