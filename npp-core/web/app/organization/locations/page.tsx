import OrganizationWorkspace from '../organization-workspace';
import { loadOrganizationSnapshot } from '../../../lib/organization-snapshot';
import { createEmptyOrganizationSnapshot } from '../../../lib/organization-types';

export const dynamic = 'force-dynamic';

export default async function LocationsPage() {
  let initialData = createEmptyOrganizationSnapshot();
  let initialError: string | null = null;

  try {
    initialData = await loadOrganizationSnapshot();
  } catch (error) {
    initialError = error instanceof Error ? error.message : 'Không tải được dữ liệu tổ chức';
  }

  return (
    <OrganizationWorkspace
      scope="locations"
      title="Vị trí kho"
      subtitle="Quản lý vị trí theo chuỗi chi nhánh -> kho -> vị trí kho, không gọi backend trực tiếp từ browser."
      initialData={initialData}
      initialError={initialError}
    />
  );
}
