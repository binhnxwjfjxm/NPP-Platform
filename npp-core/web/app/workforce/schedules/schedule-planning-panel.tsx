'use client';

import { createIdempotencyKey } from '@npp/contracts';
import { useEffect, useRef, useState } from 'react';
import type { Employee } from '../../../lib/employee-types';
import type { SchedulePlanningCatalog } from '../../../lib/workforce-types';
import styles from '../../organization/organization.module.css';
import BulkSchedulePanel from './bulk-schedule-panel';
import CompanyCalendarPanel from './company-calendar-panel';
import ShiftTemplatePanel from './shift-template-panel';
import WeekTemplatePanel from './week-template-panel';

type Tab = 'SHIFT' | 'WEEK' | 'CALENDAR' | 'BULK';
type Attempt = { signature: string; key: string } | null;
type ApiEnvelope<T> = { data?: T; error?: { message?: string } };

async function readEnvelope<T>(response: Response): Promise<T> {
  let body: ApiEnvelope<T>;
  try { body = await response.json() as ApiEnvelope<T>; } catch {
    throw new Error('Phản hồi dữ liệu nhân sự không hợp lệ');
  }
  if (!response.ok || !Object.prototype.hasOwnProperty.call(body, 'data')) {
    throw new Error(body.error?.message || 'Không thể thực hiện thao tác');
  }
  return body.data as T;
}

export type PlanningMutation = <T>(payload: Record<string, unknown>, prefix: string) => Promise<T>;

export default function SchedulePlanningPanel({
  employees,
  onSchedulesChanged,
}: {
  employees: Employee[];
  onSchedulesChanged: () => void;
}) {
  const [tab, setTab] = useState<Tab>('SHIFT');
  const [catalog, setCatalog] = useState<SchedulePlanningCatalog | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const attemptRef = useRef<Attempt>(null);

  async function refresh() {
    setLoadError(null);
    try {
      const response = await fetch('/api/workforce/schedule-planning', { cache: 'no-store' });
      setCatalog(await readEnvelope<SchedulePlanningCatalog>(response));
    } catch (error) {
      setLoadError(error instanceof Error ? error.message : 'Không tải được thiết lập lịch làm việc');
    }
  }

  useEffect(() => { void refresh(); }, []);

  const mutate: PlanningMutation = async <T,>(payload: Record<string, unknown>, prefix: string) => {
    const signature = JSON.stringify(payload);
    if (!attemptRef.current || attemptRef.current.signature !== signature) {
      attemptRef.current = { signature, key: createIdempotencyKey(prefix) };
    }
    const response = await fetch('/api/workforce/schedule-planning', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Idempotency-Key': attemptRef.current.key },
      body: signature,
    });
    const result = await readEnvelope<T>(response);
    attemptRef.current = null;
    return result;
  };

  return (
    <section className={styles.tableSection} data-testid="schedule-planning-panel">
      <div className={styles.sectionHeader}>
        <div><p className={styles.panelKicker}>Thiết lập và xếp lịch</p><h2>Ca mẫu, lịch tuần và ngày nghỉ</h2></div>
        <span className={styles.panelChip}>Lập lịch tương lai</span>
      </div>
      {loadError ? <div className={`${styles.banner} ${styles.bannerError}`} role="status">{loadError}</div> : null}
      <div className={styles.formActions}>
        <button type="button" className={tab === 'SHIFT' ? styles.primaryButton : styles.secondaryButton} onClick={() => setTab('SHIFT')}>Ca mẫu</button>
        <button type="button" className={tab === 'WEEK' ? styles.primaryButton : styles.secondaryButton} onClick={() => setTab('WEEK')}>Lịch tuần</button>
        <button type="button" className={tab === 'CALENDAR' ? styles.primaryButton : styles.secondaryButton} onClick={() => setTab('CALENDAR')}>Ngày lễ và ngày nghỉ</button>
        <button type="button" className={tab === 'BULK' ? styles.primaryButton : styles.secondaryButton} onClick={() => setTab('BULK')}>Xếp lịch hàng loạt</button>
      </div>
      {tab === 'SHIFT' ? <ShiftTemplatePanel items={catalog?.shiftTemplates ?? []} mutate={mutate} refresh={refresh} /> : null}
      {tab === 'WEEK' ? <WeekTemplatePanel items={catalog?.weekTemplates ?? []} shifts={catalog?.shiftTemplates ?? []} mutate={mutate} refresh={refresh} /> : null}
      {tab === 'CALENDAR' ? <CompanyCalendarPanel items={catalog?.calendarDays ?? []} mutate={mutate} refresh={refresh} /> : null}
      {tab === 'BULK' ? <BulkSchedulePanel employees={employees} weeks={catalog?.weekTemplates ?? []} mutate={mutate} onSchedulesChanged={onSchedulesChanged} /> : null}
    </section>
  );
}
