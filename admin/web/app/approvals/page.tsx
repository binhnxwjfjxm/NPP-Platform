import Link from 'next/link';
import { AdminIconTabs } from '../admin-icon-tabs';
import { AdminShell } from '../admin-shell';
import { approvalDomainLabel, approvalFixtures, approvalStateLabel, type ApprovalDomain } from './approval-fixtures';

const tabDefs = [
  { key: 'all', label: 'Tất cả', icon: 'check' as const },
  { key: 'commercial', label: 'Thương mại', icon: 'tag' as const },
  { key: 'customer-debt', label: 'Khách hàng & công nợ', icon: 'user' as const },
  { key: 'inventory', label: 'Kho', icon: 'warehouse' as const },
  { key: 'delivery-cod', label: 'Giao vận & COD', icon: 'truck' as const },
  { key: 'mcp', label: 'MCP', icon: 'mobile' as const },
  { key: 'history', label: 'Lịch sử', icon: 'clipboard' as const },
];

function priorityLabel(priority: string) {
  if (priority === 'critical') return 'Ưu tiên cao';
  if (priority === 'high') return 'Cần xử lý sớm';
  return 'Bình thường';
}

export default function ApprovalsPage({ searchParams }: { searchParams?: { tab?: string } }) {
  const selected = tabDefs.some((tab) => tab.key === searchParams?.tab) ? searchParams?.tab ?? 'all' : 'all';
  const tabs = tabDefs.map((tab) => ({
    href: tab.key === 'all' ? '/approvals' : `/approvals?tab=${tab.key}`,
    label: tab.label,
    icon: tab.icon,
    active: selected === tab.key,
    badge: tab.key === 'all' ? String(approvalFixtures.filter((item) => item.state === 'pending').length) : undefined,
  }));
  const items = approvalFixtures.filter((item) => {
    if (selected === 'all') return item.state !== 'approved' && item.state !== 'rejected';
    if (selected === 'history') return item.state === 'approved' || item.state === 'rejected';
    return item.domain === selected;
  });

  return (
    <AdminShell activeSection="approvals" title="Trung tâm phê duyệt" subtitle="Ưu tiên các đề xuất cần quyết định và xem đầy đủ bối cảnh trước khi xử lý.">
      <AdminIconTabs label="Nhóm phê duyệt" tabs={tabs} />
      <section className="approvalSummaryStrip" aria-label="Tóm tắt hàng đợi">
        <div><span>Chờ quyết định</span><strong>{approvalFixtures.filter((item) => item.state === 'pending').length}</strong></div>
        <div><span>Chờ bổ sung</span><strong>{approvalFixtures.filter((item) => item.state === 'needs-info').length}</strong></div>
        <div><span>Ưu tiên cao</span><strong>{approvalFixtures.filter((item) => item.priority === 'critical' && item.state === 'pending').length}</strong></div>
      </section>
      <p className="adminPreviewNotice">Dữ liệu bên dưới là mẫu giao diện frontend để chốt trải nghiệm. Chưa kết nối luồng phê duyệt thật.</p>
      <section className="approvalList" aria-label="Danh sách đề xuất">
        {items.length ? items.map((item) => (
          <Link key={item.id} className="card approvalListItem" href={`/approvals/${item.id}`}>
            <div className="approvalListTopline">
              <span className={`approvalPriority is-${item.priority}`}>{priorityLabel(item.priority)}</span>
              <span className={`approvalState is-${item.state}`}>{approvalStateLabel[item.state]}</span>
            </div>
            <h2>{item.title}</h2>
            <p className="approvalEntity">{item.entity}</p>
            <div className="approvalMetaGrid">
              <span><small>Nguồn</small><strong>{item.source}</strong></span>
              <span><small>Người gửi</small><strong>{item.requester}</strong></span>
              <span><small>Tác động</small><strong>{item.impact}</strong></span>
              <span><small>Thời gian chờ</small><strong>{item.waitingAge}</strong></span>
            </div>
            <p className="approvalReason">{item.reason}</p>
            <span className="approvalOpenLabel">Xem chi tiết · {approvalDomainLabel[item.domain]}</span>
          </Link>
        )) : <div className="card approvalEmpty"><strong>Không có đề xuất trong nhóm này.</strong><span>Chọn nhóm khác để tiếp tục.</span></div>}
      </section>
    </AdminShell>
  );
}
