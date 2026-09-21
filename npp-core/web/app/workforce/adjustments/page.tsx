import { headers } from 'next/headers';
import {
  listAttendanceAdjustments,
  listAttendancePeriodLocks,
  resolveWorkforceRequestId,
} from '../../../lib/workforce-gateway';
import type {
  AttendanceAdjustmentListResponse,
  AttendancePeriodLockListResponse,
} from '../../../lib/workforce-types';
import AttendanceAdjustmentWorkspace from './attendance-adjustment-workspace';

export const dynamic = 'force-dynamic';

type PageSearchParams = Promise<{
  employeeId?: string;
  workDate?: string;
}>;

function currentMonthBounds() {
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat('en-US', {
      timeZone: 'Asia/Ho_Chi_Minh',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    }).formatToParts(new Date()).map((part) => [part.type, part.value]),
  );
  const year = Number(parts.year);
  const month = Number(parts.month);
  const lastDay = new Date(Date.UTC(year, month, 0)).getUTCDate();
  return {
    from: `${year}-${String(month).padStart(2, '0')}-01`,
    to: `${year}-${String(month).padStart(2, '0')}-${String(lastDay).padStart(2, '0')}`,
    today: `${parts.year}-${parts.month}-${parts.day}`,
  };
}

export default async function AttendanceAdjustmentsPage({ searchParams }: { searchParams: PageSearchParams }) {
  const [{ employeeId, workDate }, headerStore] = await Promise.all([searchParams, headers()]);
  const period = currentMonthBounds();
  const requestId = resolveWorkforceRequestId(headerStore.get('x-request-id'));
  let initialData: AttendanceAdjustmentListResponse | null = null;
  let initialLocks: AttendancePeriodLockListResponse | null = null;
  let initialError: string | null = null;
  try {
    const params = new URLSearchParams({
      from: period.from,
      to: period.to,
      limit: '50',
      offset: '0',
    });
    if (employeeId?.trim()) params.set('employeeId', employeeId.trim());
    initialData = await listAttendanceAdjustments<AttendanceAdjustmentListResponse>(requestId, params);
    if (initialData.capabilities.canManage || initialData.capabilities.canLock) {
      initialLocks = await listAttendancePeriodLocks<AttendancePeriodLockListResponse>(
        resolveWorkforceRequestId(undefined),
        new URLSearchParams({ from: period.from, to: period.to }),
      );
    }
  } catch (error) {
    initialError = error instanceof Error ? error.message : 'Không tải được dữ liệu điều chỉnh công';
  }

  return (
    <AttendanceAdjustmentWorkspace
      initialData={initialData}
      initialLocks={initialLocks}
      initialFrom={period.from}
      initialTo={period.to}
      initialToday={period.today}
      initialEmployeeId={employeeId?.trim() || null}
      initialWorkDate={workDate?.trim() || null}
      initialError={initialError}
    />
  );
}
