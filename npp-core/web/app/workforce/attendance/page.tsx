import {
  getAttendancePointManagement,
  getAttendanceToday,
  resolveWorkforceRequestId,
  WorkforceGatewayError,
} from '../../../lib/workforce-gateway';
import type { AttendancePointManagement, AttendanceToday } from '../../../lib/workforce-types';
import AttendanceWorkspace from './attendance-workspace';

export const dynamic = 'force-dynamic';

function message(error: unknown, fallback: string) {
  return error instanceof Error ? error.message : fallback;
}

export default async function AttendancePage() {
  const [todayResult, managementResult] = await Promise.allSettled([
    getAttendanceToday<AttendanceToday>(resolveWorkforceRequestId(undefined)),
    getAttendancePointManagement<AttendancePointManagement>(resolveWorkforceRequestId(undefined)),
  ]);

  const today = todayResult.status === 'fulfilled' ? todayResult.value : null;
  const management = managementResult.status === 'fulfilled' ? managementResult.value : null;
  const errors: string[] = [];
  const selfAttendanceUnavailable = todayResult.status === 'rejected'
    && todayResult.reason instanceof WorkforceGatewayError
    && ['EMPLOYEE_ID_REQUIRED', 'EMPLOYEE_NOT_FOUND', 'WORK_POLICY_REQUIRED', 'WORK_SCHEDULE_REQUIRED', 'WORK_DAY_OFF', 'ATTENDANCE_NOT_REQUIRED'].includes(todayResult.reason.code);
  if (todayResult.status === 'rejected' && !(management && selfAttendanceUnavailable)) {
    errors.push(message(todayResult.reason, 'Không tải được trạng thái chấm công'));
  }
  if (
    managementResult.status === 'rejected'
    && (!(managementResult.reason instanceof WorkforceGatewayError) || managementResult.reason.statusCode !== 403)
  ) {
    errors.push(message(managementResult.reason, 'Không tải được điểm chấm công'));
  }

  return (
    <AttendanceWorkspace
      initialToday={today}
      initialManagement={management}
      initialError={errors.length ? errors.join(' · ') : null}
    />
  );
}
