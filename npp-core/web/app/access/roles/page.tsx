import { listAccessPermissions, listAllAccessRoles, resolveAccessRequestId } from '../../../lib/access-gateway';
import { createEmptyAccessSnapshot, type AccessPermission, type AccessRole } from '../../../lib/access-types';
import RoleWorkspace from './role-workspace';

export const dynamic = 'force-dynamic';

export default async function RolesPage() {
  let permissions: AccessPermission[] = [];
  let roles: AccessRole[] = [];
  let initialError: string | null = null;

  try {
    const [permissionData, roleData] = await Promise.all([
      listAccessPermissions<AccessPermission[]>(resolveAccessRequestId(undefined)),
      listAllAccessRoles<AccessRole>(resolveAccessRequestId(undefined)),
    ]);
    permissions = permissionData;
    roles = roleData;
  } catch (error) {
    initialError = error instanceof Error ? error.message : 'Không tải được danh mục vai trò và quyền';
  }

  const initialData = createEmptyAccessSnapshot();

  return (
    <RoleWorkspace
      initialRoles={roles}
      permissions={permissions}
      initialError={initialError}
      initialSnapshot={initialData}
    />
  );
}
