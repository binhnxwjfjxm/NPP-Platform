import {
  getAttendanceTimesheet,
  resolveWorkforceRequestId,
} from '../../../lib/workforce-gateway';
import type { AttendanceTimesheetResponse } from '../../../lib/workforce-types';
import AttendanceTimesheetWorkspace from './attendance-timesheet-workspace';

export const dynamic = 'force-dynamic';

function currentMonthBounds() {
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat('en-US', {
      timeZone: 'Asia/Ho_Chi_Minh',
      year: 'numeric',
      month: '2-digit',
    }).formatToParts(new Date()).map((part) => [part.type, part.value]),
  );
  const year = Number(parts.year);
  const month = Number(parts.month);
  const lastDay = new Date(Date.UTC(year, month, 0)).getUTCDate();
  return {
    from: `${year}-${String(month).padStart(2, '0')}-01`,
    to: `${year}-${String(month).padStart(2, '0')}-${String(lastDay).padStart(2, '0')}`,
  };
}

export default async function AttendanceTimesheetPage() {
  const period = currentMonthBounds();
  let initialData: AttendanceTimesheetResponse | null = null;
  let initialError: string | null = null;
  try {
    initialData = await getAttendanceTimesheet<AttendanceTimesheetResponse>(
      resolveWorkforceRequestId(undefined),
      new URLSearchParams({
        view: 'employee',
        from: period.from,
        to: period.to,
        limit: '100',
        offset: '0',
      }),
    );
  } catch (error) {
    initialError = error instanceof Error ? error.message : 'Không tải được bảng công';
  }

  return (
    <AttendanceTimesheetWorkspace
      initialData={initialData}
      initialFrom={period.from}
      initialTo={period.to}
      initialError={initialError}
    />
  );
}
