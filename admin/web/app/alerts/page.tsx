import { AdminIconTabs } from '../admin-icon-tabs';
import { AdminShell } from '../admin-shell';

const tabs = [
  { href: '/alerts', label: 'Tổng hợp', icon: 'exception' as const, active: true },
  { href: '/alerts?tab=sales', label: 'Kinh doanh', icon: 'overview' as const },
  { href: '/alerts?tab=debt', label: 'Công nợ', icon: 'coin' as const },
  { href: '/alerts?tab=inventory', label: 'Kho', icon: 'warehouse' as const },
  { href: '/alerts?tab=delivery', label: 'Giao vận', icon: 'truck' as const },
  { href: '/alerts?tab=mcp', label: 'MCP', icon: 'mobile' as const },
  { href: '/alerts?tab=rules', label: 'Quy tắc', icon: 'clipboard' as const },
  { href: '/alerts?tab=history', label: 'Lịch sử', icon: 'document' as const },
];

export default function AlertsPage() {
  return (
    <AdminShell activeSection="alerts" title="Trung tâm cảnh báo" subtitle="Theo dõi tín hiệu bất thường theo quy tắc quản trị.">
      <AdminIconTabs label="Nhóm cảnh báo" tabs={tabs} />
      <section className="card adminModulePlaceholder" aria-label="Khung trung tâm cảnh báo">
        <span className="emptyStateIcon">!</span>
        <div><h2>Khung cảnh báo đã sẵn sàng</h2><p>Danh sách cảnh báo, mức độ và cấu hình rule sẽ được triển khai ở bước riêng. Chưa có rule frontend nào được coi là rule production.</p></div>
      </section>
    </AdminShell>
  );
}
