import { listAllEmployees, resolveEmployeeRequestId } from '../../../lib/employee-gateway';
import {
  listWorkPolicies,
  listWorkSchedules,
  resolveWorkforceRequestId,
} from '../../../lib/workforce-gateway';
import type { Employee } from '../../../lib/employee-types';
import type { WorkPolicy, WorkSchedule } from '../../../lib/workforce-types';
import WorkScheduleWorkspace from './work-schedule-workspace';

export const dynamic = 'force-dynamic';

function dateString(offsetDays: number) {
  const date = new Date();
  date.setDate(date.getDate() + offsetDays);
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
}
function message(error: unknown, fallback: string) {
  return error instanceof Error ? error.message : fallback;
}

export default async function WorkSchedulesPage() {
  const from = dateString(0);
  const to = dateString(30);
  const [employeeResult, policyResult, scheduleResult] = await Promise.allSettled([
    listAllEmployees<Employee>(resolveEmployeeRequestId(undefined), new URLSearchParams({ active: 'true' })),
    listWorkPolicies<WorkPolicy[]>(resolveWorkforceRequestId(undefined)),
    listWorkSchedules<WorkSchedule[]>(
      resolveWorkforceRequestId(undefined),
      new URLSearchParams({ from, to }),
    ),
  ]);
  const employees = employeeResult.status === 'fulfilled' ? employeeResult.value : [];
  const policies = policyResult.status === 'fulfilled' ? policyResult.value : [];
  const schedules = scheduleResult.status === 'fulfilled' ? scheduleResult.value : [];
  const errors = [
    employeeResult.status === 'rejected' ? message(employeeResult.reason, 'Không tải được nhân sự') : null,
    policyResult.status === 'rejected' ? message(policyResult.reason, 'Không tải được chính sách làm việc') : null,
    scheduleResult.status === 'rejected' ? message(scheduleResult.reason, 'Không tải được lịch làm việc') : null,
  ].filter((value): value is string => Boolean(value));
  return (
    <WorkScheduleWorkspace
      initialEmployees={employees}
      policies={policies}
      initialSchedules={schedules}
      initialFrom={from}
      initialTo={to}
      initialError={errors.length ? errors.join(' · ') : null}
    />
  );
}
