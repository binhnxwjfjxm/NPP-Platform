'use client';

import { useMemo, useState } from 'react';
import type { Employee } from '../../../lib/employee-types';
import type { ScheduleBulkResult, WorkWeekTemplate } from '../../../lib/workforce-types';
import styles from '../../organization/organization.module.css';
import type { PlanningMutation } from './schedule-planning-panel';

function dateString(offsetDays: number) {
  const value = new Date();
  value.setDate(value.getDate() + offsetDays);
  return `${value.getFullYear()}-${String(value.getMonth() + 1).padStart(2, '0')}-${String(value.getDate()).padStart(2, '0')}`;
}

export default function BulkSchedulePanel({
  employees, weeks, mutate, onSchedulesChanged,
}: {
  employees: Employee[];
  weeks: WorkWeekTemplate[];
  mutate: PlanningMutation;
  onSchedulesChanged: () => void;
}) {
  const activeEmployees = useMemo(() => employees.filter((item) => item.is_active), [employees]);
  const activeWeeks = useMemo(() => weeks.filter((item) => item.is_active), [weeks]);
  const [mode, setMode] = useState<'APPLY' | 'COPY'>('APPLY');
  const [selected, setSelected] = useState<string[]>([]);
  const [weekTemplateId, setWeekTemplateId] = useState('');
  const [fromDate, setFromDate] = useState(dateString(1));
  const [toDate, setToDate] = useState(dateString(7));
  const [sourceFrom, setSourceFrom] = useState(dateString(-7));
  const [sourceTo, setSourceTo] = useState(dateString(-1));
  const [targetFrom, setTargetFrom] = useState(dateString(1));
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{ error: boolean; text: string } | null>(null);

  function toggle(id: string) {
    setSelected((current) => current.includes(id) ? current.filter((value) => value !== id) : [...current, id]);
  }
  function toggleAll() {
    setSelected((current) => current.length === activeEmployees.length ? [] : activeEmployees.map((item) => item.id));
  }
  async function apply() {
    setBusy(true); setMessage(null);
    try {
      if (!selected.length) throw new Error('Hãy chọn ít nhất một nhân sự.');
      const payload = mode === 'APPLY'
        ? {
          action: 'APPLY_WEEK_TEMPLATE', weekTemplateId,
          employeeIds: selected, fromDate, toDate, reason,
        }
        : {
          action: 'COPY_SCHEDULE', employeeIds: selected,
          sourceFrom, sourceTo, targetFrom, reason,
        };
      const result = await mutate<ScheduleBulkResult>(
        payload,
        mode === 'APPLY' ? 'web-week-template-apply' : 'web-schedule-copy',
      );
      const preserved = result.skippedOverrides
        ? ` Giữ nguyên ${result.skippedOverrides} ngoại lệ cá nhân.`
        : '';
      setMessage({ error: false, text: `Đã ghi ${result.affectedCount}/${result.requestedCount} dòng lịch.${preserved}` });
      setReason('');
      onSchedulesChanged();
    } catch (error) {
      setMessage({ error: true, text: error instanceof Error ? error.message : 'Không xếp được lịch' });
    } finally { setBusy(false); }
  }

  return (
    <>
      {message ? <div className={`${styles.banner} ${message.error ? styles.bannerError : styles.bannerSuccess}`} role="status">{message.text}</div> : null}
      <div className={styles.formActions}>
        <button type="button" className={mode === 'APPLY' ? styles.primaryButton : styles.secondaryButton} onClick={() => setMode('APPLY')}>Xếp từ lịch tuần</button>
        <button type="button" className={mode === 'COPY' ? styles.primaryButton : styles.secondaryButton} onClick={() => setMode('COPY')}>Sao chép lịch</button>
      </div>
      <div className={styles.form}>
        {mode === 'APPLY' ? <>
          <label>Mẫu lịch tuần<select value={weekTemplateId} onChange={(event) => setWeekTemplateId(event.target.value)}><option value="">Chọn mẫu lịch</option>{activeWeeks.map((item) => <option key={item.id} value={item.id}>{item.code} · {item.name}</option>)}</select></label>
          <label>Từ ngày<input type="date" min={dateString(1)} value={fromDate} onChange={(event) => setFromDate(event.target.value)} /></label>
          <label>Đến ngày<input type="date" min={fromDate} value={toDate} onChange={(event) => setToDate(event.target.value)} /></label>
        </> : <>
          <label>Lịch nguồn từ ngày<input type="date" value={sourceFrom} onChange={(event) => setSourceFrom(event.target.value)} /></label>
          <label>Lịch nguồn đến ngày<input type="date" min={sourceFrom} value={sourceTo} onChange={(event) => setSourceTo(event.target.value)} /></label>
          <label>Bắt đầu lịch mới<input type="date" min={dateString(1)} value={targetFrom} onChange={(event) => setTargetFrom(event.target.value)} /></label>
        </>}
        <label>Lý do<input value={reason} onChange={(event) => setReason(event.target.value)} maxLength={512} placeholder="Ví dụ: xếp lịch tháng tới theo kế hoạch vận hành" /></label>
      </div>
      <div className={styles.sectionHeader}>
        <div><p className={styles.panelKicker}>Phạm vi áp dụng</p><h3>Chọn nhân sự</h3></div>
        <button type="button" className={styles.secondaryButton} onClick={toggleAll}>
          {selected.length === activeEmployees.length && activeEmployees.length ? 'Bỏ chọn tất cả' : 'Chọn tất cả'}
        </button>
      </div>
      <div className={styles.tableWrap}><table className={styles.table}>
        <thead><tr><th>Chọn</th><th>Mã</th><th>Nhân sự</th></tr></thead>
        <tbody>
          {activeEmployees.map((employee) => <tr key={employee.id}>
            <td><input type="checkbox" checked={selected.includes(employee.id)} onChange={() => toggle(employee.id)} aria-label={`Chọn ${employee.full_name}`} /></td>
            <td>{employee.code}</td><td>{employee.full_name}</td>
          </tr>)}
          {!activeEmployees.length ? <tr><td colSpan={3}><div className={styles.emptyState}>Chưa có nhân sự đang làm việc.</div></td></tr> : null}
        </tbody>
      </table></div>
      <div className={styles.banner} role="note">Lịch đã điều chỉnh riêng theo người/ngày sẽ được giữ nguyên, không bị xếp hàng loạt ghi đè.</div>
      <div className={styles.formActions}>
        <button type="button" className={styles.primaryButton} disabled={busy} onClick={() => void apply()}>
          {busy ? 'Đang xử lý…' : mode === 'APPLY' ? 'Xếp lịch hàng loạt' : 'Sao chép lịch'}
        </button>
      </div>
    </>
  );
}
