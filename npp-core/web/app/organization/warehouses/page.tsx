import InitialLoadRetry from '../../components/initial-load-retry';
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
    <>
      <InitialLoadRetry enabled={Boolean(initialError)} retryKey="organization-warehouses" />
      <OrganizationWorkspace
        scope="warehouses"
        title="Kho hàng"
        subtitle="Quản lý kho theo chi nhánh và danh sách loại kho cố định phục vụ phân loại, báo cáo."
        initialData={initialData}
        initialError={initialError}
      />
    </>
  );
}
