import { listAllEmployees, resolveEmployeeRequestId } from '../../../lib/employee-gateway';
import { listOrganizationResource, resolveOrganizationRequestId } from '../../../lib/organization-gateway';
import type { Branch } from '../../../lib/organization-types';
import type { Employee } from '../../../lib/employee-types';
import EmployeeInitialRetry from './employee-initial-retry';
import EmployeeWorkspace from './employee-workspace';

export const dynamic = 'force-dynamic';

function errorMessage(error: unknown, fallback: string) {
  return error instanceof Error ? error.message : fallback;
}

export default async function EmployeesPage() {
  const [employeeResult, branchResult] = await Promise.allSettled([
    listAllEmployees<Employee>(resolveEmployeeRequestId(undefined)),
    listOrganizationResource<Branch[]>(
      'branches',
      resolveOrganizationRequestId(undefined),
      new URLSearchParams({ limit: '1000' }),
    ),
  ]);

  const employees = employeeResult.status === 'fulfilled' ? employeeResult.value : [];
  const branches = branchResult.status === 'fulfilled' ? branchResult.value : [];
  const errors = [
    employeeResult.status === 'rejected'
      ? errorMessage(employeeResult.reason, 'Không tải được danh mục nhân sự')
      : null,
    branchResult.status === 'rejected'
      ? errorMessage(branchResult.reason, 'Không tải được danh mục chi nhánh')
      : null,
  ].filter((value): value is string => Boolean(value));
  const initialError = errors.length ? errors.join(' · ') : null;

  return (
    <>
      <EmployeeInitialRetry enabled={Boolean(initialError)} />
      <EmployeeWorkspace
        initialEmployees={employees}
        branches={branches}
        initialError={initialError}
      />
    </>
  );
}
