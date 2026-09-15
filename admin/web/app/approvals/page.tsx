import { AdminShell } from '../admin-shell';
import { ApprovalsLocal } from './approvals-local';

const validTabs = new Set(['all', 'commercial', 'customer-debt', 'operations', 'mcp', 'history']);

export default function ApprovalsPage({ searchParams }: { searchParams?: { tab?: string } }) {
  const selected = searchParams?.tab && validTabs.has(searchParams.tab) ? searchParams.tab : 'all';
  return (
    <AdminShell activeSection="approvals" title="Trung tâm đề xuất" subtitle="Tập trung các đề xuất thật sự cần quyết định cấp quản lý.">
      <ApprovalsLocal selected={selected} />
    </AdminShell>
  );
}
