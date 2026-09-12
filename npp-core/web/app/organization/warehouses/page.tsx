import InitialLoadRetry from '../../components/initial-load-retry';
import WarehouseWorkspace, { type WarehouseWorkspaceTab } from './warehouse-workspace';
import { loadOrganizationSnapshot } from '../../../lib/organization-snapshot';
import { createEmptyOrganizationSnapshot } from '../../../lib/organization-types';

export const dynamic = 'force-dynamic';

type SearchParams = Readonly<{ tab?: string; warehouseId?: string }>;

function warehouseTab(value?: string): WarehouseWorkspaceTab {
  if (value === 'quick') return 'quick';
  if (value === 'layout') return 'layout';
  return 'list';
}

export default async function WarehousesPage({ searchParams }: Readonly<{ searchParams?: SearchParams }>) {
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
      <WarehouseWorkspace
        initialData={initialData}
        initialError={initialError}
        initialTab={warehouseTab(searchParams?.tab)}
        initialWarehouseId={searchParams?.warehouseId ?? ''}
      />
    </>
  );
}
