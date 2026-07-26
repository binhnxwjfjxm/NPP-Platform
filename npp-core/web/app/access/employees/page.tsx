import { listEmployees, resolveEmployeeRequestId } from '../../../lib/employee-gateway';
import { listOrganizationResource, resolveOrganizationRequestId } from '../../../lib/organization-gateway';
import type { Branch } from '../../../lib/organization-types';
import type { Employee } from '../../../lib/employee-types';
import EmployeeWorkspace from './employee-workspace';

export const dynamic = 'force-dynamic';

export default async function EmployeesPage() {
  let employees: Employee[] = [];
  let branches: Branch[] = [];
  let initialError: string | null = null;

  try {
    const [employeeData, branchData] = await Promise.all([
      listEmployees<Employee[]>(
        resolveEmployeeRequestId(undefined),
        new URLSearchParams({ limit: '1000' }),
      ),
      listOrganizationResource<Branch[]>(
        'branches',
        resolveOrganizationRequestId(undefined),
        new URLSearchParams({ limit: '1000' }),
      ),
    ]);
    employees = employeeData;
    branches = branchData;
  } catch (error) {
    initialError = error instanceof Error ? error.message : 'Không tải được danh mục nhân sự';
  }

  return (
    <EmployeeWorkspace
      initialEmployees={employees}
      branches={branches}
      initialError={initialError}
    />
  );
}
