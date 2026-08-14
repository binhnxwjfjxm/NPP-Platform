import { listAccessUsers, resolveAccessRequestId } from '../../../../lib/access-gateway';
import { loadOrganizationSnapshot } from '../../../../lib/organization-snapshot';
import type { AccessUser } from '../../../../lib/access-types';
import type { Branch, Warehouse } from '../../../../lib/organization-types';
import UserScopeWorkspace from './user-scope-workspace';

export const dynamic = 'force-dynamic';

export default async function UserScopesPage() {
  let users: AccessUser[] = [];
  let branches: Branch[] = [];
  let warehouses: Warehouse[] = [];
  let initialError: string | null = null;

  try {
    const requestId = resolveAccessRequestId(undefined);
    const [userList, organization] = await Promise.all([
      listAccessUsers<AccessUser[]>(requestId, new URLSearchParams({ limit: '1000' })),
      loadOrganizationSnapshot(),
    ]);
    users = userList;
    branches = organization.branches;
    warehouses = organization.warehouses;
  } catch (error) {
    initialError = error instanceof Error ? error.message : 'Không tải được phạm vi người dùng';
  }

  return (
    <UserScopeWorkspace
      initialUsers={users}
      initialBranches={branches}
      initialWarehouses={warehouses}
      initialError={initialError}
    />
  );
}
