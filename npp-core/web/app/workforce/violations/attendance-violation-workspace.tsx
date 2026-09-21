'use client';

import { createIdempotencyKey } from '@npp/contracts';
import { useMemo, useRef, useState } from 'react';
import { AppShell } from '../../components/app-shell';
import shellStyles from '../../components/app-shell.module.css';
import styles from '../../organization/organization.module.css';
import localStyles from './attendance-violation.module.css';
import type {
  AttendanceViolationCase,
  AttendanceViolationHandlingEntry,
  AttendanceViolationHandlingResponse,
  AttendanceViolationOutcome,
} from '../../../lib/workforce-types';

type ApiEnvelope<T> = { data?: T; error?: { message?: string } };
type Attempt = { payload: string; key: string } | null;

const CASE_STATUS_LABEL = {
  EXPLANATION_SUBMITTED: 'Đã gửi giải trình',
  UNDER_REVIEW: 'Đang xem xét',
  RESOLVED: 'Đã kết luận',
} as const;

const OUTCOME_LABEL: Record<AttendanceViolationOutcome, string> = {
  CONFIRMED: 'Xác nhận vi phạm',
  EXCUSED: 'Chấp nhận giải trình',
};

function dateLabel(value: string) {
  const [year, month, day] = value.split('-');
  return year && month && day ? `${day}/${month}/${year}` : value;
}
function numberLabel(value: number | string | null | undefined) {
  const parsed = Number(value || 0);
  return new Intl.NumberFormat('vi-VN', { maximumFractionDigits: 2 }).format(parsed);
}
function violationDetail(entry: AttendanceViolationHandlingEntry) {
  if (entry.violation) return entry.violation.detail;
  if (entry.case) return entry.case.violation_detail_snapshot + ' · Dữ liệu công hiện tại đã thay đổi.';
  return 'Không còn dữ liệu vi phạm hiện tại.';
}
function violationLabel(entry: AttendanceViolationHandlingEntry) {
  return entry.violation?.label || entry.case?.violation_label_snapshot || 'Vi phạm công';
}
function caseStatus(entry: AttendanceViolationHandlingEntry) {
  if (!entry.case) return 'Chưa giải trình';
  if (entry.case.status === 'RESOLVED' && entry.case.outcome) {
    return `${CASE_STATUS_LABEL.RESOLVED} · ${OUTCOME_LABEL[entry.case.outcome]}`;
  }
  return CASE_STATUS_LABEL[entry.case.status];
}
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

export default function AttendanceViolationWorkspace({
  initialData,
  initialFrom,
  initialTo,
  initialError,
}: {
  initialData: AttendanceViolationHandlingResponse | null;
  initialFrom: string;
  initialTo: string;
  initialError: string | null;
}) {
  const [data, setData] = useState(initialData);
  const [from, setFrom] = useState(initialData?.period.from ?? initialFrom);
  const [to, setTo] = useState(initialData?.period.to ?? initialTo);
  const [employeeQuery, setEmployeeQuery] = useState('');
  const [branchId, setBranchId] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(initialError);
  const [notice, setNotice] = useState<string | null>(null);

  const [explainEntry, setExplainEntry] = useState<AttendanceViolationHandlingEntry | null>(null);
  const [explanation, setExplanation] = useState('');
  const [reviewEntry, setReviewEntry] = useState<AttendanceViolationHandlingEntry | null>(null);
  const [outcome, setOutcome] = useState<AttendanceViolationOutcome>('EXCUSED');
  const [reviewNote, setReviewNote] = useState('');

  const explainAttempt = useRef<Attempt>(null);
  const reviewAttempt = useRef<Attempt>(null);

  const entries = data?.entries ?? [];
  const counts = useMemo(() => ({
    current: entries.filter((entry) => entry.violation).length,
    waiting: entries.filter((entry) => entry.case?.status === 'EXPLANATION_SUBMITTED').length,
    reviewing: entries.filter((entry) => entry.case?.status === 'UNDER_REVIEW').length,
    resolved: entries.filter((entry) => entry.case?.status === 'RESOLVED').length,
  }), [entries]);

  async function load(nextOffset = 0) {
    setBusy(true); setError(null); setNotice(null);
    try {
      const params = new URLSearchParams({
        from, to, limit: '100', offset: String(Math.max(0, nextOffset)),
      });
      if (employeeQuery.trim()) params.set('employeeQuery', employeeQuery.trim());
      if (branchId) params.set('branchId', branchId);
      const next = await requestJson<AttendanceViolationHandlingResponse>(`/api/workforce/violations?${params.toString()}`);
      setData(next);
      setFrom(next.period.from); setTo(next.period.to);
      if (branchId && !next.scope.branches.some((branch) => branch.id === branchId)) setBranchId('');
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : 'Không tải được hồ sơ xử lý vi phạm');
    } finally { setBusy(false); }
  }

  function openExplanation(entry: AttendanceViolationHandlingEntry) {
    setExplainEntry(entry); setExplanation(''); setError(null); setNotice(null); explainAttempt.current = null;
  }

  async function submitExplanation(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!explainEntry?.violation) return;
    const payload = {
      workDate: explainEntry.workDate,
      violationKind: explainEntry.violation.kind,
      explanation: explanation.trim(),
    };
    if (!payload.explanation) { setError('Vui lòng nhập nội dung giải trình'); return; }
    const key = stableKey(explainAttempt, 'web-attendance-violation-explain', payload);
    setBusy(true); setError(null); setNotice(null);
    try {
      await requestJson<AttendanceViolationCase>('/api/workforce/violations/explain', {
        method: 'POST', headers: { 'Idempotency-Key': key }, body: JSON.stringify(payload),
      });
      explainAttempt.current = null;
      setExplainEntry(null); setExplanation('');
      await load(data?.pagination.offset ?? 0);
      setNotice('Đã gửi giải trình. Quản lý có thể xem xét và kết luận hồ sơ.');
    } catch (submitError) {
      setError(submitError instanceof Error ? submitError.message : 'Không gửi được giải trình');
    } finally { setBusy(false); }
  }

  async function startReview(entry: AttendanceViolationHandlingEntry) {
    if (!entry.case) return;
    const payload = { caseId: entry.case.id, expectedVersion: entry.case.version, action: 'START_REVIEW' };
    const key = stableKey(reviewAttempt, 'web-attendance-violation-review', payload);
    setBusy(true); setError(null); setNotice(null);
    try {
      await requestJson<AttendanceViolationCase>('/api/workforce/violations/review', {
        method: 'POST', headers: { 'Idempotency-Key': key }, body: JSON.stringify(payload),
      });
      reviewAttempt.current = null;
      await load(data?.pagination.offset ?? 0);
      setNotice('Hồ sơ đã chuyển sang trạng thái đang xem xét.');
    } catch (reviewError) {
      setError(reviewError instanceof Error ? reviewError.message : 'Không bắt đầu xem xét được hồ sơ');
    } finally { setBusy(false); }
  }

  function openConclusion(entry: AttendanceViolationHandlingEntry) {
    setReviewEntry(entry); setOutcome('EXCUSED'); setReviewNote('');
    setError(null); setNotice(null); reviewAttempt.current = null;
  }

  async function submitConclusion(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!reviewEntry?.case) return;
    const payload = {
      caseId: reviewEntry.case.id,
      expectedVersion: reviewEntry.case.version,
      action: 'CONCLUDE',
      outcome,
      reviewNote: reviewNote.trim(),
    };
    if (!payload.reviewNote) { setError('Vui lòng nhập kết luận xử lý'); return; }
    const key = stableKey(reviewAttempt, 'web-attendance-violation-review', payload);
    setBusy(true); setError(null); setNotice(null);
    try {
      await requestJson<AttendanceViolationCase>('/api/workforce/violations/review', {
        method: 'POST', headers: { 'Idempotency-Key': key }, body: JSON.stringify(payload),
      });
      reviewAttempt.current = null;
      setReviewEntry(null); setReviewNote('');
      await load(data?.pagination.offset ?? 0);
      setNotice(outcome === 'CONFIRMED' ? 'Đã xác nhận vi phạm.' : 'Đã chấp nhận giải trình.');
    } catch (reviewError) {
      setError(reviewError instanceof Error ? reviewError.message : 'Không lưu được kết luận xử lý');
    } finally { setBusy(false); }
  }

  const actions = (
    <button
      type="button"
      className={`${shellStyles.actionButton} ${shellStyles.actionButtonPrimary}`}
      onClick={() => void load(data?.pagination.offset ?? 0)}
      disabled={busy}
    >
      {busy ? 'Đang cập nhật…' : 'Cập nhật hồ sơ'}
    </button>
  );

  return (
    <AppShell
      title="Xử lý vi phạm công"
      subtitle="Giải trình, xem xét và kết luận các sai lệch chấm công đã được Bảng công ghi nhận."
      kicker="Nhân sự"
      actions={actions}
    >
      <section className={styles.page} data-testid="attendance-violation-page">
        {(error || notice) ? (
          <div className={`${styles.banner} ${error ? styles.bannerError : styles.bannerSuccess}`} role="status">{error ?? notice}</div>
        ) : null}

        <section className={styles.summaryGrid}>
          <article className={styles.summaryCard}><span>Vi phạm hiện tại</span><strong>{counts.current}</strong><small>Theo dữ liệu Bảng công trong trang đang xem</small></article>
          <article className={styles.summaryCard}><span>Chờ xem xét</span><strong>{counts.waiting}</strong><small>Nhân viên đã gửi giải trình</small></article>
          <article className={styles.summaryCard}><span>Đang xem xét</span><strong>{counts.reviewing}</strong><small>Quản lý đang xử lý hồ sơ</small></article>
          <article className={styles.summaryCard}><span>Đã kết luận</span><strong>{counts.resolved}</strong><small>Không làm thay đổi dữ liệu chấm công gốc</small></article>
        </section>

        <section className={styles.toolbar}>
          <div className={styles.toolbarFilter}>
            <label htmlFor="violation-from">Từ ngày</label>
            <input id="violation-from" type="date" value={from} onChange={(event) => setFrom(event.target.value)} />
          </div>
          <div className={styles.toolbarFilter}>
            <label htmlFor="violation-to">Đến ngày</label>
            <input id="violation-to" type="date" value={to} onChange={(event) => setTo(event.target.value)} />
          </div>
          {!data?.scope.selfOnly ? (
            <div className={styles.toolbarFilter}>
              <label htmlFor="violation-employee">Nhân sự</label>
              <input id="violation-employee" value={employeeQuery} onChange={(event) => setEmployeeQuery(event.target.value)} placeholder="Mã hoặc tên nhân sự" maxLength={80} />
            </div>
          ) : null}
          {!data?.scope.selfOnly && (data?.scope.branches.length ?? 0) > 0 ? (
            <div className={styles.toolbarFilter}>
              <label htmlFor="violation-branch">Chi nhánh</label>
              <select id="violation-branch" value={branchId} onChange={(event) => setBranchId(event.target.value)}>
                <option value="">Tất cả chi nhánh được cấp</option>
                {data?.scope.branches.map((branch) => <option key={branch.id} value={branch.id}>{branch.code} · {branch.name}</option>)}
              </select>
            </div>
          ) : null}
          <div className={styles.formActions}>
            <button type="button" className={styles.secondaryButton} onClick={() => void load(0)} disabled={busy}>Xem hồ sơ</button>
          </div>
        </section>

        <div className={styles.banner} role="note">
          Vi phạm được đánh giá từ Bảng công hiện tại. Hồ sơ này chỉ lưu giải trình và kết luận xử lý; không sửa sự kiện chấm công và không tự điều chỉnh thu nhập.
        </div>

        <section className={styles.tableSection}>
          <div className={styles.sectionHeader}>
            <div><p className={styles.panelKicker}>Theo dõi xử lý</p><h2>Vi phạm và giải trình</h2></div>
            <span className={styles.panelChip}>{entries.length} mục</span>
          </div>
          <div className={styles.tableWrap}>
            <table className={styles.table} data-testid="attendance-violation-table">
              <thead>
                <tr>
                  <th>Ngày</th><th>Nhân sự</th><th>Vi phạm</th><th>Ghi nhận</th>
                  <th>Trạng thái xử lý</th><th>Giải trình / kết luận</th><th>Thao tác</th>
                </tr>
              </thead>
              <tbody>
                {entries.map((entry) => {
                  const itemKey = `${entry.employee.id}-${entry.workDate}-${entry.violation?.kind ?? entry.case?.violation_kind ?? 'case'}`;
                  return (
                    <tr key={itemKey}>
                      <td>{dateLabel(entry.workDate)}</td>
                      <td><strong>{entry.employee.code} · {entry.employee.name}</strong><br /><small>{entry.employee.branchName || 'Chưa gán chi nhánh'}</small></td>
                      <td><strong>{violationLabel(entry)}</strong></td>
                      <td>
                        <div className={localStyles.fact}>
                          <span>{violationDetail(entry)}</span>
                          {entry.violation?.minutes != null ? <small>{entry.violation.minutes} phút</small> : null}
                          {entry.violation?.dayFraction != null ? <small>{numberLabel(entry.violation.dayFraction)} ngày</small> : null}
                        </div>
                      </td>
                      <td><div className={localStyles.statusStack}><strong>{caseStatus(entry)}</strong>{entry.case ? <small>Phiên bản {entry.case.version}</small> : null}</div></td>
                      <td>
                        <div className={localStyles.detailBox}>
                          {entry.case ? <><span><strong>Giải trình:</strong> {entry.case.explanation}</span>{entry.case.review_note ? <span><strong>Kết luận:</strong> {entry.case.review_note}</span> : null}</> : <span className={localStyles.muted}>Chưa có giải trình.</span>}
                        </div>
                      </td>
                      <td>
                        <div className={localStyles.actionStack}>
                          {data?.capabilities.canExplain && !entry.case && entry.violation ? (
                            <button type="button" onClick={() => openExplanation(entry)}>Gửi giải trình</button>
                          ) : null}
                          {data?.capabilities.canReview && entry.case?.status === 'EXPLANATION_SUBMITTED' ? (
                            <button type="button" disabled={busy} onClick={() => void startReview(entry)}>Bắt đầu xem xét</button>
                          ) : null}
                          {data?.capabilities.canReview && entry.case && ['EXPLANATION_SUBMITTED', 'UNDER_REVIEW'].includes(entry.case.status) ? (
                            <button type="button" onClick={() => openConclusion(entry)}>Kết luận</button>
                          ) : null}
                          {!data?.capabilities.canExplain && !data?.capabilities.canReview ? <span>Chỉ xem</span> : null}
                        </div>
                      </td>
                    </tr>
                  );
                })}
                {!entries.length ? <tr><td colSpan={7}><div className={styles.emptyState}>Không có vi phạm hoặc hồ sơ xử lý trong phạm vi đã chọn.</div></td></tr> : null}
              </tbody>
            </table>
          </div>
        </section>

        {data ? (
          <div className={localStyles.pagination}>
            <button type="button" className={styles.secondaryButton} disabled={busy || !data.pagination.hasPrevious} onClick={() => void load(Math.max(0, data.pagination.offset - data.pagination.limit))}>Trang trước</button>
            <span>{data.pagination.total} dòng ngày công nền</span>
            <button type="button" className={styles.secondaryButton} disabled={busy || !data.pagination.hasNext} onClick={() => void load(data.pagination.offset + data.pagination.limit)}>Trang sau</button>
          </div>
        ) : null}

        {explainEntry ? (
          <div className={styles.modalBackdrop} role="presentation" onClick={() => setExplainEntry(null)}>
            <div className={`${styles.modal} ${localStyles.modalWide}`} role="dialog" aria-modal="true" onClick={(event) => event.stopPropagation()}>
              <div className={styles.modalHeader}>
                <div><p className={styles.panelKicker}>Giải trình</p><h3>{violationLabel(explainEntry)} · {dateLabel(explainEntry.workDate)}</h3></div>
                <button type="button" className={styles.modalClose} onClick={() => setExplainEntry(null)}>Đóng</button>
              </div>
              <form className={styles.form} onSubmit={(event) => void submitExplanation(event)}>
                <div className={localStyles.readOnlyBox}><span>Ghi nhận trên Bảng công</span><strong>{violationDetail(explainEntry)}</strong></div>
                <label>Nội dung giải trình<textarea value={explanation} onChange={(event) => setExplanation(event.target.value)} maxLength={2000} rows={6} required placeholder="Trình bày lý do và thông tin cần quản lý xem xét" /></label>
                <div className={styles.formActions}><button type="button" className={styles.secondaryButton} onClick={() => setExplainEntry(null)}>Hủy</button><button type="submit" className={styles.primaryButton} disabled={busy}>{busy ? 'Đang gửi…' : 'Gửi giải trình'}</button></div>
              </form>
            </div>
          </div>
        ) : null}

        {reviewEntry?.case ? (
          <div className={styles.modalBackdrop} role="presentation" onClick={() => setReviewEntry(null)}>
            <div className={`${styles.modal} ${localStyles.modalWide}`} role="dialog" aria-modal="true" onClick={(event) => event.stopPropagation()}>
              <div className={styles.modalHeader}>
                <div><p className={styles.panelKicker}>Kết luận hồ sơ</p><h3>{violationLabel(reviewEntry)} · {reviewEntry.employee.name}</h3></div>
                <button type="button" className={styles.modalClose} onClick={() => setReviewEntry(null)}>Đóng</button>
              </div>
              <form className={styles.form} onSubmit={(event) => void submitConclusion(event)}>
                <div className={localStyles.readOnlyBox}><span>Giải trình của nhân viên</span><strong>{reviewEntry.case.explanation}</strong><span>Ghi nhận ban đầu: {reviewEntry.case.violation_detail_snapshot}</span></div>
                <fieldset className={localStyles.outcomeGroup}>
                  <legend>Kết luận</legend>
                  <label className={localStyles.outcomeChoice}><input type="radio" name="outcome" checked={outcome === 'EXCUSED'} onChange={() => setOutcome('EXCUSED')} /><span><strong>Chấp nhận giải trình</strong><br /><small>Hồ sơ được kết luận là có lý do được chấp nhận.</small></span></label>
                  <label className={localStyles.outcomeChoice}><input type="radio" name="outcome" checked={outcome === 'CONFIRMED'} onChange={() => setOutcome('CONFIRMED')} /><span><strong>Xác nhận vi phạm</strong><br /><small>Chỉ xác nhận khi vi phạm vẫn còn trên Bảng công hiện tại.</small></span></label>
                </fieldset>
                <label>Kết luận xử lý<textarea value={reviewNote} onChange={(event) => setReviewNote(event.target.value)} maxLength={2000} rows={5} required placeholder="Ghi rõ căn cứ và kết luận quản lý" /></label>
                <div className={styles.banner} role="note">Kết luận này là hồ sơ quản lý. Mọi ảnh hưởng thu nhập nếu có trong tương lai phải đi qua quy trình riêng.</div>
                <div className={styles.formActions}><button type="button" className={styles.secondaryButton} onClick={() => setReviewEntry(null)}>Hủy</button><button type="submit" className={styles.primaryButton} disabled={busy}>{busy ? 'Đang lưu…' : 'Lưu kết luận'}</button></div>
              </form>
            </div>
          </div>
        ) : null}
      </section>
    </AppShell>
  );
}
