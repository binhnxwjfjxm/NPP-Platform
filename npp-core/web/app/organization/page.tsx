import InitialLoadRetry from '../components/initial-load-retry';
import OrganizationWorkspace from './organization-workspace';
import layoutStyles from './organization-overview-layout.module.css';
import { loadOrganizationSnapshot } from '../../lib/organization-snapshot';
import { createEmptyOrganizationSnapshot } from '../../lib/organization-types';

export const dynamic = 'force-dynamic';

export default async function OrganizationPage() {
  let initialData = createEmptyOrganizationSnapshot();
  let initialError: string | null = null;

  try {
    initialData = await loadOrganizationSnapshot();
  } catch (error) {
    initialError = error instanceof Error ? error.message : 'Không tải được dữ liệu tổ chức';
  }

  return (
    <div className={layoutStyles.scope}>
      <InitialLoadRetry enabled={Boolean(initialError)} retryKey="organization-overview" />
      <OrganizationWorkspace
        scope="overview"
        title="Tổ chức"
        subtitle="Theo dõi cơ cấu chi nhánh, kho hàng và vị trí lưu trữ trong toàn hệ thống."
        initialData={initialData}
        initialError={initialError}
      />
    </div>
  );
}
