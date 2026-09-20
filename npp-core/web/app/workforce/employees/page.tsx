import { listAllEmployees, resolveEmployeeRequestId } from '../../../lib/employee-gateway';
import { listOrganizationResource, resolveOrganizationRequestId } from '../../../lib/organization-gateway';
import { listWorkPolicies, resolveWorkforceRequestId } from '../../../lib/workforce-gateway';
import type { Branch } from '../../../lib/organization-types';
import type { Employee } from '../../../lib/employee-types';
import type { WorkPolicy } from '../../../lib/workforce-types';
import EmployeeInitialRetry from '../../access/employees/employee-initial-retry';
import EmployeeWorkspace from './employee-workspace';

export const dynamic = 'force-dynamic';

function message(error: unknown, fallback: string) {
  return error instanceof Error ? error.message : fallback;
}

export default async function WorkforceEmployeesPage() {
  const [employeeResult, branchResult, policyResult] = await Promise.allSettled([
    listAllEmployees<Employee>(resolveEmployeeRequestId(undefined)),
    listOrganizationResource<Branch[]>(
      'branches',
      resolveOrganizationRequestId(undefined),
      new URLSearchParams({ limit: '1000' }),
    ),
    listWorkPolicies<WorkPolicy[]>(resolveWorkforceRequestId(undefined)),
  ]);

  const employees = employeeResult.status === 'fulfilled' ? employeeResult.value : [];
  const branches = branchResult.status === 'fulfilled' ? branchResult.value : [];
  const policies = policyResult.status === 'fulfilled' ? policyResult.value : [];
  const errors = [
    employeeResult.status === 'rejected' ? message(employeeResult.reason, 'Không tải được danh mục nhân sự') : null,
    branchResult.status === 'rejected' ? message(branchResult.reason, 'Không tải được danh mục chi nhánh') : null,
    policyResult.status === 'rejected' ? message(policyResult.reason, 'Không tải được chính sách làm việc') : null,
  ].filter((value): value is string => Boolean(value));
  const initialError = errors.length ? errors.join(' · ') : null;

  return (
    <>
      <EmployeeInitialRetry enabled={Boolean(initialError)} />
      <EmployeeWorkspace
        initialEmployees={employees}
        branches={branches}
        policies={policies}
        initialError={initialError}
      />
    </>
  );
}
