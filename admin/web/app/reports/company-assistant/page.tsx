import { AdminIconTabs } from '../../admin-icon-tabs';
import { AdminShell } from '../../admin-shell';
import { CompanyAssistantChat } from './company-assistant-chat';

const tabs = [
  { href: '/reports', label: 'Báo cáo quản trị', icon: 'document' as const },
  { href: '/reports/ai-usage', label: 'AI / tín dụng', icon: 'coin' as const },
  { href: '/reports/company-assistant', label: 'Trợ lý Công Ty', icon: 'overview' as const, active: true },
];

export const dynamic = 'force-dynamic';

export default function CompanyAssistantPage() {
  return (
    <AdminShell
      activeSection="reports"
      title="Trợ lý Công Ty"
      subtitle="Hỏi nhanh số liệu quản trị bằng ngôn ngữ tự nhiên. Giai đoạn hiện tại chỉ mở quyền đọc."
      contentWidth="focused"
    >
      <AdminIconTabs label="AI và trợ lý quản trị" tabs={tabs} />
      <CompanyAssistantChat />
    </AdminShell>
  );
}
