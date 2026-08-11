import { AdminIconTabs } from '../admin-icon-tabs';
import { AdminShell } from '../admin-shell';

const tabs = [
  { href: '/approvals', label: 'Tất cả', icon: 'check' as const, active: true },
  { href: '/approvals?tab=commercial', label: 'Thương mại', icon: 'tag' as const },
  { href: '/approvals?tab=customer-debt', label: 'Khách hàng & công nợ', icon: 'user' as const },
  { href: '/approvals?tab=inventory', label: 'Kho', icon: 'warehouse' as const },
  { href: '/approvals?tab=delivery-cod', label: 'Giao vận & COD', icon: 'truck' as const },
  { href: '/approvals?tab=mcp', label: 'MCP', icon: 'mobile' as const },
  { href: '/approvals?tab=history', label: 'Lịch sử', icon: 'clipboard' as const },
];

export default function ApprovalsPage() {
  return (
    <AdminShell activeSection="approvals" title="Trung tâm phê duyệt" subtitle="Các đề xuất cần quyết định quản lý sẽ được tập trung tại đây.">
      <AdminIconTabs label="Nhóm phê duyệt" tabs={tabs} />
      <section className="card adminModulePlaceholder" aria-label="Khung trung tâm phê duyệt">
        <span className="emptyStateIcon">✓</span>
        <div><h2>Khung phê duyệt đã sẵn sàng</h2><p>Danh sách, chi tiết và hành động quyết định sẽ được triển khai ở bước tiếp theo. Hiện chưa phát sinh thao tác phê duyệt thật.</p></div>
      </section>
    </AdminShell>
  );
}
