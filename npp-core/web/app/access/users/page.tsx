import {
  listAccessUsers,
  resolveAccessRequestId,
  listAllAccessRoles,
  getAccessUser,
} from '../../../lib/access-gateway';
import { listAllEmployees, resolveEmployeeRequestId } from '../../../lib/employee-gateway';
import type { AccessUser, AccessRole } from '../../../lib/access-types';
import type { Employee } from '../../../lib/employee-types';
import UserWorkspace from './user-workspace';

export const dynamic = 'force-dynamic';

export default async function UsersPage() {
  let users: AccessUser[] = [];
  let roles: AccessRole[] = [];
  let employees: Employee[] = [];
  let initialError: string | null = null;

  try {
    const requestId = resolveAccessRequestId(undefined);
    const [userList, roleList, employeeList] = await Promise.all([
      listAccessUsers<AccessUser[]>(requestId, new URLSearchParams({ limit: '1000' })),
      listAllAccessRoles<AccessRole>(requestId),
      listAllEmployees<Employee>(resolveEmployeeRequestId(undefined)),
    ]);
    users = userList;
    roles = roleList;
    employees = employeeList;
  } catch (error) {
    initialError = error instanceof Error ? error.message : 'Không tải được danh sách người dùng';
  }

  return (
    <UserWorkspace
      initialUsers={users}
      initialRoles={roles}
      initialEmployees={employees}
      initialError={initialError}
    />
  );
}
