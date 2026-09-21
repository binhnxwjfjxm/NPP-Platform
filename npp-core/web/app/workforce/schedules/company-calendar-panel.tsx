'use client';

import { useState } from 'react';
import type { CompanyCalendarDay } from '../../../lib/workforce-types';
import styles from '../../organization/organization.module.css';
import type { PlanningMutation } from './schedule-planning-panel';

function dateString(offsetDays: number) {
  const value = new Date();
  value.setDate(value.getDate() + offsetDays);
  return `${value.getFullYear()}-${String(value.getMonth() + 1).padStart(2, '0')}-${String(value.getDate()).padStart(2, '0')}`;
}

export default function CompanyCalendarPanel({
  items, mutate, refresh,
}: {
  items: CompanyCalendarDay[];
  mutate: PlanningMutation;
  refresh: () => Promise<void>;
}) {
  const [calendarDate, setCalendarDate] = useState(dateString(1));
  const [calendarKind, setCalendarKind] = useState<'PUBLIC_HOLIDAY' | 'COMPANY_DAY_OFF'>('PUBLIC_HOLIDAY');
  const [name, setName] = useState('');
  const [active, setActive] = useState(true);
  const [editing, setEditing] = useState(false);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{ error: boolean; text: string } | null>(null);

  function reset() {
    setCalendarDate(dateString(1)); setCalendarKind('PUBLIC_HOLIDAY'); setName(''); setActive(true); setEditing(false);
  }
  function edit(item: CompanyCalendarDay) {
    setCalendarDate(item.calendar_date); setCalendarKind(item.calendar_kind); setName(item.name);
    setActive(item.is_active); setEditing(true);
  }
  async function save() {
    setBusy(true); setMessage(null);
    try {
      await mutate({
        action: 'SAVE_CALENDAR_DAY', calendarDate, calendarKind, name, isActive: active,
      }, 'web-company-calendar-save');
      setMessage({ error: false, text: editing ? 'Đã cập nhật ngày nghỉ.' : 'Đã thêm ngày nghỉ.' });
      reset();
      await refresh();
    } catch (error) {
      setMessage({ error: true, text: error instanceof Error ? error.message : 'Không lưu được ngày nghỉ' });
    } finally { setBusy(false); }
  }

  return (
    <>
      {message ? <div className={`${styles.banner} ${message.error ? styles.bannerError : styles.bannerSuccess}`} role="status">{message.text}</div> : null}
      <div className={styles.form}>
        <label>Ngày<input type="date" min={dateString(1)} value={calendarDate} disabled={editing} onChange={(event) => setCalendarDate(event.target.value)} /></label>
        <label>Loại ngày<select value={calendarKind} onChange={(event) => setCalendarKind(event.target.value as 'PUBLIC_HOLIDAY' | 'COMPANY_DAY_OFF')}><option value="PUBLIC_HOLIDAY">Ngày lễ</option><option value="COMPANY_DAY_OFF">Ngày nghỉ Công Ty</option></select></label>
        <label>Tên ngày nghỉ<input value={name} onChange={(event) => setName(event.target.value)} maxLength={256} placeholder="Ví dụ: Tết Dương lịch" /></label>
        <label><input type="checkbox" checked={active} onChange={(event) => setActive(event.target.checked)} /> Áp dụng</label>
        <div className={styles.formActions}>
          <button type="button" className={styles.secondaryButton} onClick={reset}>Mới</button>
          <button type="button" className={styles.primaryButton} disabled={busy} onClick={() => void save()}>{busy ? 'Đang lưu…' : 'Lưu ngày nghỉ'}</button>
        </div>
      </div>
      <div className={styles.banner} role="note">Khi xếp lịch hàng loạt, ngày nghỉ Công Ty được ưu tiên. Ngoại lệ cho một người/ngày vẫn dùng nút Điều chỉnh ở bảng lịch phía trên và bắt buộc ghi lý do.</div>
      <div className={styles.tableWrap}><table className={styles.table}>
        <thead><tr><th>Ngày</th><th>Tên</th><th>Loại</th><th>Trạng thái</th><th>Thao tác</th></tr></thead>
        <tbody>
          {items.map((item) => <tr key={item.id}>
            <td>{item.calendar_date}</td><td>{item.name}</td>
            <td>{item.calendar_kind === 'PUBLIC_HOLIDAY' ? 'Ngày lễ' : 'Ngày nghỉ Công Ty'}</td>
            <td>{item.is_active ? 'Áp dụng' : 'Ngừng áp dụng'}</td>
            <td>{item.calendar_date >= dateString(1) ? <button type="button" onClick={() => edit(item)}>Sửa</button> : <span>Chỉ xem</span>}</td>
          </tr>)}
          {!items.length ? <tr><td colSpan={5}><div className={styles.emptyState}>Chưa có ngày lễ hoặc ngày nghỉ Công Ty.</div></td></tr> : null}
        </tbody>
      </table></div>
    </>
  );
}
