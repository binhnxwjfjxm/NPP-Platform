import InitialLoadRetry from '../../components/initial-load-retry';
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
    <>
      <InitialLoadRetry enabled={Boolean(initialError)} retryKey="organization-branches" />
      <OrganizationWorkspace
        scope="branches"
        title="Chi nhánh"
        subtitle="Quản lý danh mục chi nhánh và thông tin liên hệ phục vụ vận hành, hạch toán và báo cáo."
        initialData={initialData}
        initialError={initialError}
      />
    </>
  );
}
