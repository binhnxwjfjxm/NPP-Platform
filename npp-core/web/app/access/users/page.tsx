import {
  listAccessUsers,
  resolveAccessRequestId,
  listAllAccessRoles,
  getAccessUser,
} from '../../../lib/access-gateway';
import { listAllEmployees, resolveEmployeeRequestId } from '../../../lib/employee-gateway';
import { loadOrganizationSnapshot } from '../../../lib/organization-snapshot';
import type { AccessUser, AccessRole } from '../../../lib/access-types';
import type { Employee } from '../../../lib/employee-types';
import type { Branch, Warehouse } from '../../../lib/organization-types';
import UserWorkspace from './user-workspace';

export const dynamic = 'force-dynamic';

export default async function UsersPage() {
  let users: AccessUser[] = [];
  let roles: AccessRole[] = [];
  let employees: Employee[] = [];
  let branches: Branch[] = [];
  let warehouses: Warehouse[] = [];
  let initialError: string | null = null;

  try {
    const requestId = resolveAccessRequestId(undefined);
    const [userList, roleList, employeeList, organization] = await Promise.all([
      listAccessUsers<AccessUser[]>(requestId, new URLSearchParams({ limit: '1000' })),
      listAllAccessRoles<AccessRole>(requestId),
      listAllEmployees<Employee>(resolveEmployeeRequestId(undefined)),
      loadOrganizationSnapshot(),
    ]);
    users = userList;
    roles = roleList;
    employees = employeeList;
    branches = organization.branches;
    warehouses = organization.warehouses;
  } catch (error) {
    initialError = error instanceof Error ? error.message : 'Không tải được danh sách người dùng';
  }

  return (
    <UserWorkspace
      initialUsers={users}
      initialRoles={roles}
      initialEmployees={employees}
      initialBranches={branches}
      initialWarehouses={warehouses}
      initialError={initialError}
    />
  );
}
