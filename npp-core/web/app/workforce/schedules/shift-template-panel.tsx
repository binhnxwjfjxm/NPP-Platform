'use client';

import { useState } from 'react';
import type { WorkShiftTemplate } from '../../../lib/workforce-types';
import styles from '../../organization/organization.module.css';
import type { PlanningMutation } from './schedule-planning-panel';

function clock(value: string) { return String(value || '').slice(0, 5); }

export default function ShiftTemplatePanel({
  items, mutate, refresh,
}: {
  items: WorkShiftTemplate[];
  mutate: PlanningMutation;
  refresh: () => Promise<void>;
}) {
  const [id, setId] = useState('');
  const [code, setCode] = useState('');
  const [name, setName] = useState('');
  const [startTime, setStartTime] = useState('08:00');
  const [endTime, setEndTime] = useState('17:00');
  const [breakMinutes, setBreakMinutes] = useState('60');
  const [active, setActive] = useState(true);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{ error: boolean; text: string } | null>(null);

  function reset() {
    setId(''); setCode(''); setName(''); setStartTime('08:00'); setEndTime('17:00'); setBreakMinutes('60'); setActive(true);
  }
  function edit(item: WorkShiftTemplate) {
    setId(item.id); setCode(item.code); setName(item.name); setStartTime(clock(item.start_time));
    setEndTime(clock(item.end_time)); setBreakMinutes(String(item.break_minutes)); setActive(item.is_active);
  }
  async function save() {
    setBusy(true); setMessage(null);
    try {
      await mutate({
        action: 'SAVE_SHIFT_TEMPLATE', id: id || undefined, code, name,
        startTime, endTime, breakMinutes: Number(breakMinutes), isActive: active,
      }, 'web-shift-template-save');
      setMessage({ error: false, text: id ? 'Đã cập nhật ca mẫu.' : 'Đã tạo ca mẫu.' });
      reset();
      await refresh();
    } catch (error) {
      setMessage({ error: true, text: error instanceof Error ? error.message : 'Không lưu được ca mẫu' });
    } finally { setBusy(false); }
  }

  return (
    <>
      {message ? <div className={`${styles.banner} ${message.error ? styles.bannerError : styles.bannerSuccess}`} role="status">{message.text}</div> : null}
      <div className={styles.form}>
        <label>Mã ca<input value={code} onChange={(event) => setCode(event.target.value.toUpperCase())} maxLength={64} placeholder="CA_SANG" /></label>
        <label>Tên ca<input value={name} onChange={(event) => setName(event.target.value)} maxLength={256} placeholder="Ca sáng" /></label>
        <label>Bắt đầu<input type="time" value={startTime} onChange={(event) => setStartTime(event.target.value)} /></label>
        <label>Kết thúc<input type="time" value={endTime} onChange={(event) => setEndTime(event.target.value)} /></label>
        <label>Nghỉ giữa ca (phút)<input type="number" min={0} max={720} value={breakMinutes} onChange={(event) => setBreakMinutes(event.target.value)} /></label>
        <label><input type="checkbox" checked={active} onChange={(event) => setActive(event.target.checked)} /> Đang sử dụng</label>
        <div className={styles.formActions}>
          <button type="button" className={styles.secondaryButton} onClick={reset}>Mới</button>
          <button type="button" className={styles.primaryButton} disabled={busy} onClick={() => void save()}>{busy ? 'Đang lưu…' : 'Lưu ca mẫu'}</button>
        </div>
      </div>
      <div className={styles.tableWrap}><table className={styles.table}>
        <thead><tr><th>Mã</th><th>Tên ca</th><th>Giờ làm việc</th><th>Nghỉ giữa ca</th><th>Trạng thái</th><th>Thao tác</th></tr></thead>
        <tbody>
          {items.map((item) => <tr key={item.id}><td>{item.code}</td><td>{item.name}</td><td>{clock(item.start_time)} – {clock(item.end_time)}</td><td>{item.break_minutes} phút</td><td>{item.is_active ? 'Đang dùng' : 'Ngừng dùng'}</td><td><button type="button" onClick={() => edit(item)}>Sửa</button></td></tr>)}
          {!items.length ? <tr><td colSpan={6}><div className={styles.emptyState}>Chưa có ca mẫu.</div></td></tr> : null}
        </tbody>
      </table></div>
    </>
  );
}
