import OrganizationWorkspace from '../organization/organization-workspace';
import { loadOrganizationSnapshot } from '../../lib/organization-snapshot';
import { createEmptyOrganizationSnapshot } from '../../lib/organization-types';

export const dynamic = 'force-dynamic';

export default async function DashboardPage() {
  let initialData = createEmptyOrganizationSnapshot();
  let initialError: string | null = null;

  try {
    initialData = await loadOrganizationSnapshot();
  } catch (error) {
    initialError = error instanceof Error ? error.message : 'Không tải được dữ liệu tổ chức';
  }

  return (
    <OrganizationWorkspace
      scope="overview"
      title="Tổng quan cơ cấu"
      subtitle="Theo dõi nhanh chi nhánh, kho hàng và vị trí lưu trữ trong toàn hệ thống."
      initialData={initialData}
      initialError={initialError}
    />
  );
}
