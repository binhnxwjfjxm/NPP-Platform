import OrganizationWorkspace from '../organization-workspace';
import { loadOrganizationSnapshot } from '../../../lib/organization-snapshot';
import { createEmptyOrganizationSnapshot } from '../../../lib/organization-types';

export const dynamic = 'force-dynamic';

export default async function BranchesPage() {
  let initialData = createEmptyOrganizationSnapshot();
  let initialError: string | null = null;

  try {
    initialData = await loadOrganizationSnapshot();
  } catch (error) {
    initialError = error instanceof Error ? error.message : 'Không tải được dữ liệu tổ chức';
  }

  return (
    <OrganizationWorkspace
      scope="branches"
      title="Chi nhánh"
      subtitle="Danh sách chi nhánh, tìm kiếm theo mã hoặc tên, thêm mới, chỉnh sửa và bật tắt trạng thái."
      initialData={initialData}
      initialError={initialError}
    />
  );
}
