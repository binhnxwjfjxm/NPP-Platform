import { listAccessPermissions, listAllAccessRoles, resolveAccessRequestId } from '../../../lib/access-gateway';
import { createEmptyAccessSnapshot, type AccessPermission, type AccessRole } from '../../../lib/access-types';
import InitialLoadRetry from '../../components/initial-load-retry';
import RoleWorkspace from './role-workspace';

export const dynamic = 'force-dynamic';

function message(error: unknown, fallback: string) {
  return error instanceof Error ? error.message : fallback;
}

export default async function RolesPage() {
  const [permissionResult, roleResult] = await Promise.allSettled([
    listAccessPermissions<AccessPermission[]>(resolveAccessRequestId(undefined)),
    listAllAccessRoles<AccessRole>(resolveAccessRequestId(undefined)),
  ]);

  const permissions = permissionResult.status === 'fulfilled' ? permissionResult.value : [];
  const roles = roleResult.status === 'fulfilled' ? roleResult.value : [];
  const errors = [
    permissionResult.status === 'rejected'
      ? message(permissionResult.reason, 'Không tải được danh mục quyền')
      : null,
    roleResult.status === 'rejected'
      ? message(roleResult.reason, 'Không tải được danh mục vai trò')
      : null,
  ].filter((value): value is string => Boolean(value));
  const initialError = errors.length ? errors.join(' · ') : null;
  const initialData = createEmptyAccessSnapshot();

  return (
    <>
      <InitialLoadRetry enabled={Boolean(initialError)} retryKey="access-roles" />
      <RoleWorkspace
        initialRoles={roles}
        permissions={permissions}
        initialError={initialError}
        initialSnapshot={initialData}
      />
    </>
  );
}
