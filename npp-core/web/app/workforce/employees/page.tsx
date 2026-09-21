import { listAllEmployees, resolveEmployeeRequestId } from '../../../lib/employee-gateway';
import { listOrganizationResource, resolveOrganizationRequestId } from '../../../lib/organization-gateway';
import { getWorkPolicyCoverage, listWorkPolicies, resolveWorkforceRequestId } from '../../../lib/workforce-gateway';
import type { Branch } from '../../../lib/organization-types';
import type { Employee } from '../../../lib/employee-types';
import type { WorkPolicy, WorkPolicyCoverage } from '../../../lib/workforce-types';
import EmployeeInitialRetry from '../../access/employees/employee-initial-retry';
import EmployeeWorkspace from './employee-workspace';

export const dynamic = 'force-dynamic';

function message(error: unknown, fallback: string) {
  return error instanceof Error ? error.message : fallback;
}

function currentCompanyDate() {
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat('en-US', {
      timeZone: 'Asia/Ho_Chi_Minh',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    }).formatToParts(new Date()).map((part) => [part.type, part.value]),
  );
  return `${parts.year}-${parts.month}-${parts.day}`;
}

export default async function WorkforceEmployeesPage() {
  const [employeeResult, branchResult, policyResult, coverageResult] = await Promise.allSettled([
    listAllEmployees<Employee>(resolveEmployeeRequestId(undefined)),
    listOrganizationResource<Branch[]>(
      'branches',
      resolveOrganizationRequestId(undefined),
      new URLSearchParams({ limit: '1000' }),
    ),
    listWorkPolicies<WorkPolicy[]>(resolveWorkforceRequestId(undefined)),
    getWorkPolicyCoverage<WorkPolicyCoverage>(
      resolveWorkforceRequestId(undefined),
      new URLSearchParams({ date: currentCompanyDate() }),
    ),
  ]);

  const employees = employeeResult.status === 'fulfilled' ? employeeResult.value : [];
  const branches = branchResult.status === 'fulfilled' ? branchResult.value : [];
  const policies = policyResult.status === 'fulfilled' ? policyResult.value : [];
  const coverage = coverageResult.status === 'fulfilled' ? coverageResult.value : null;
  const errors = [
    employeeResult.status === 'rejected' ? message(employeeResult.reason, 'Không tải được danh mục nhân sự') : null,
    branchResult.status === 'rejected' ? message(branchResult.reason, 'Không tải được danh mục chi nhánh') : null,
    policyResult.status === 'rejected' ? message(policyResult.reason, 'Không tải được chính sách làm việc') : null,
    coverageResult.status === 'rejected' ? message(coverageResult.reason, 'Không kiểm tra được nhân sự chưa có chính sách') : null,
  ].filter((value): value is string => Boolean(value));
  const initialError = errors.length ? errors.join(' · ') : null;

  return (
    <>
      <EmployeeInitialRetry enabled={Boolean(initialError)} />
      <EmployeeWorkspace
        initialEmployees={employees}
        branches={branches}
        policies={policies}
        initialCoverage={coverage}
        initialError={initialError}
      />
    </>
  );
}
