import { AdminIconTabs } from '../admin-icon-tabs';
import { AdminShell } from '../admin-shell';

const tabs = [
  { href: '/reports', label: 'Điều hành', icon: 'overview' as const, active: true },
  { href: '/reports?tab=sales-profit', label: 'Kinh doanh & lợi nhuận', icon: 'tag' as const },
  { href: '/reports?tab=debt', label: 'Công nợ', icon: 'coin' as const },
  { href: '/reports?tab=inventory', label: 'Kho', icon: 'warehouse' as const },
  { href: '/reports?tab=delivery-cod', label: 'Giao vận & COD', icon: 'truck' as const },
  { href: '/reports?tab=mcp', label: 'MCP / thị trường', icon: 'mobile' as const },
  { href: '/reports?tab=people', label: 'Nhân sự / hiệu suất', icon: 'user' as const },
  { href: '/reports?tab=decisions', label: 'Phê duyệt & cảnh báo', icon: 'document' as const },
];

export default function ReportsPage() {
  return (
    <AdminShell activeSection="reports" title="Báo cáo quản trị" subtitle="Báo cáo điều hành tổng hợp từ Core và MCP, tối ưu cho quản lý trên mobile.">
      <AdminIconTabs label="Nhóm báo cáo quản trị" tabs={tabs} />
      <section className="card adminModulePlaceholder" aria-label="Khung báo cáo quản trị">
        <span className="emptyStateIcon">≋</span>
        <div><h2>Khung báo cáo đã sẵn sàng</h2><p>KPI, xu hướng, so sánh kỳ và các báo cáo Core/MCP sẽ được triển khai ở bước báo cáo riêng.</p></div>
      </section>
    </AdminShell>
  );
}
