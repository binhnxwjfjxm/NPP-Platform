'use client';

import { useState } from 'react';
import type { WorkShiftTemplate, WorkWeekTemplate } from '../../../lib/workforce-types';
import styles from '../../organization/organization.module.css';
import type { PlanningMutation } from './schedule-planning-panel';

type DayDraft = { weekday: number; scheduleKind: 'WORK' | 'OFF'; shiftTemplateId: string };
const DAYS = [
  [1, 'Thứ Hai'], [2, 'Thứ Ba'], [3, 'Thứ Tư'], [4, 'Thứ Năm'],
  [5, 'Thứ Sáu'], [6, 'Thứ Bảy'], [0, 'Chủ nhật'],
] as const;
function blankDays(): DayDraft[] {
  return DAYS.map(([weekday]) => ({ weekday, scheduleKind: 'OFF', shiftTemplateId: '' }));
}

export default function WeekTemplatePanel({
  items, shifts, mutate, refresh,
}: {
  items: WorkWeekTemplate[];
  shifts: WorkShiftTemplate[];
  mutate: PlanningMutation;
  refresh: () => Promise<void>;
}) {
  const [id, setId] = useState('');
  const [code, setCode] = useState('');
  const [name, setName] = useState('');
  const [active, setActive] = useState(true);
  const [days, setDays] = useState<DayDraft[]>(blankDays);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{ error: boolean; text: string } | null>(null);
  const activeShifts = shifts.filter((item) => item.is_active);

  function reset() {
    setId(''); setCode(''); setName(''); setActive(true); setDays(blankDays());
  }
  function edit(item: WorkWeekTemplate) {
    const map = new Map(item.days.map((day) => [Number(day.weekday), day]));
    setId(item.id); setCode(item.code); setName(item.name); setActive(item.is_active);
    setDays(DAYS.map(([weekday]) => {
      const day = map.get(weekday);
      return {
        weekday,
        scheduleKind: day?.schedule_kind ?? 'OFF',
        shiftTemplateId: day?.shift_template_id ?? '',
      };
    }));
  }
  async function save() {
    setBusy(true); setMessage(null);
    try {
      await mutate({
        action: 'SAVE_WEEK_TEMPLATE', id: id || undefined, code, name, isActive: active, days,
      }, 'web-week-template-save');
      setMessage({ error: false, text: id ? 'Đã cập nhật mẫu lịch tuần.' : 'Đã tạo mẫu lịch tuần.' });
      reset();
      await refresh();
    } catch (error) {
      setMessage({ error: true, text: error instanceof Error ? error.message : 'Không lưu được mẫu lịch tuần' });
    } finally { setBusy(false); }
  }

  return (
    <>
      {message ? <div className={`${styles.banner} ${message.error ? styles.bannerError : styles.bannerSuccess}`} role="status">{message.text}</div> : null}
      <div className={styles.form}>
        <label>Mã lịch tuần<input value={code} onChange={(event) => setCode(event.target.value.toUpperCase())} maxLength={64} placeholder="VAN_PHONG" /></label>
        <label>Tên lịch tuần<input value={name} onChange={(event) => setName(event.target.value)} maxLength={256} placeholder="Lịch văn phòng" /></label>
        <label><input type="checkbox" checked={active} onChange={(event) => setActive(event.target.checked)} /> Đang sử dụng</label>
      </div>
      <div className={styles.tableWrap}><table className={styles.table}>
        <thead><tr><th>Ngày</th><th>Loại ngày</th><th>Ca làm việc</th></tr></thead>
        <tbody>
          {days.map((day, index) => <tr key={day.weekday}>
            <td>{DAYS.find(([weekday]) => weekday === day.weekday)?.[1]}</td>
            <td><select value={day.scheduleKind} onChange={(event) => setDays((current) => current.map((item, itemIndex) => itemIndex === index ? ({ ...item, scheduleKind: event.target.value as 'WORK' | 'OFF', shiftTemplateId: event.target.value === 'OFF' ? '' : item.shiftTemplateId }) : item))}><option value="WORK">Ngày làm việc</option><option value="OFF">Ngày nghỉ</option></select></td>
            <td>{day.scheduleKind === 'WORK' ? <select value={day.shiftTemplateId} onChange={(event) => setDays((current) => current.map((item, itemIndex) => itemIndex === index ? ({ ...item, shiftTemplateId: event.target.value }) : item))}><option value="">Chọn ca mẫu</option>{activeShifts.map((shift) => <option key={shift.id} value={shift.id}>{shift.code} · {shift.name}</option>)}</select> : '—'}</td>
          </tr>)}
        </tbody>
      </table></div>
      <div className={styles.formActions}>
        <button type="button" className={styles.secondaryButton} onClick={reset}>Tạo mới</button>
        <button type="button" className={styles.primaryButton} disabled={busy} onClick={() => void save()}>{busy ? 'Đang lưu…' : 'Lưu lịch tuần'}</button>
      </div>
      <div className={styles.tableWrap}><table className={styles.table}>
        <thead><tr><th>Mã</th><th>Tên lịch</th><th>Trạng thái</th><th>Thao tác</th></tr></thead>
        <tbody>
          {items.map((item) => <tr key={item.id}><td>{item.code}</td><td>{item.name}</td><td>{item.is_active ? 'Đang sử dụng' : 'Ngừng sử dụng'}</td><td><button type="button" onClick={() => edit(item)}>Sửa</button></td></tr>)}
          {!items.length ? <tr><td colSpan={4}><div className={styles.emptyState}>Chưa có mẫu lịch tuần.</div></td></tr> : null}
        </tbody>
      </table></div>
    </>
  );
}
