import { headers } from 'next/headers';
import {
  listLeaveRequests,
  listLeaveTypes,
  resolveWorkforceRequestId,
} from '../../../lib/workforce-gateway';
import type { LeaveRequestListResponse, LeaveTypeListResponse } from '../../../lib/workforce-types';
import LeaveWorkspace from './leave-workspace';

export const dynamic = 'force-dynamic';

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

export default async function LeavePage() {
  const [headerStore] = await Promise.all([headers()]);
  const period = currentMonthBounds();
  const requestId = resolveWorkforceRequestId(headerStore.get('x-request-id'));
  let initialData: LeaveRequestListResponse | null = null;
  let initialTypes: LeaveTypeListResponse | null = null;
  let initialError: string | null = null;
  try {
    [initialData, initialTypes] = await Promise.all([
      listLeaveRequests<LeaveRequestListResponse>(
        requestId,
        new URLSearchParams({ from: period.from, to: period.to, limit: '50', offset: '0' }),
      ),
      listLeaveTypes<LeaveTypeListResponse>(resolveWorkforceRequestId(undefined)),
    ]);
  } catch (error) {
    initialError = error instanceof Error ? error.message : 'Không tải được dữ liệu nghỉ';
  }

  return (
    <LeaveWorkspace
      initialData={initialData}
      initialTypes={initialTypes}
      initialFrom={period.from}
      initialTo={period.to}
      initialToday={period.today}
      initialError={initialError}
    />
  );
}
