import OrganizationWorkspace from '../organization-workspace';
import { loadOrganizationSnapshot } from '../../../lib/organization-snapshot';
import { createEmptyOrganizationSnapshot } from '../../../lib/organization-types';

export const dynamic = 'force-dynamic';

export default async function WarehousesPage() {
  let initialData = createEmptyOrganizationSnapshot();
  let initialError: string | null = null;

  try {
    initialData = await loadOrganizationSnapshot();
  } catch (error) {
    initialError = error instanceof Error ? error.message : 'Không tải được dữ liệu tổ chức';
  }

  return (
    <OrganizationWorkspace
      scope="warehouses"
      title="Kho hàng"
      subtitle="Quản lý kho theo chi nhánh mẹ, giữ nguyên idempotency và expectedUpdatedAt khi thao tác."
      initialData={initialData}
      initialError={initialError}
    />
  );
}
