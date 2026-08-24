import Link from 'next/link';
import { AdminIconTabs } from '../admin-icon-tabs';
import { AdminShell } from '../admin-shell';
import { CoreApiError } from '../../lib/core-api';
import {
  loadProposals,
  proposalDomainLabel,
  proposalSourceLabel,
  proposalStateLabel,
  proposalWaitingAge,
  type ProposalItem,
} from './proposal-data';

const tabDefs = [
  { key: 'all', label: 'Tất cả', icon: 'check' as const },
  { key: 'commercial', label: 'Thương mại', icon: 'tag' as const },
  { key: 'customer-debt', label: 'Khách hàng & công nợ', icon: 'user' as const },
  { key: 'operations', label: 'Ngoại lệ vận hành', icon: 'exception' as const },
  { key: 'mcp', label: 'MCP', icon: 'mobile' as const },
  { key: 'history', label: 'Lịch sử', icon: 'clipboard' as const },
];

function priorityLabel(priority: string) {
  if (priority === 'critical') return 'Ưu tiên cao';
  if (priority === 'high') return 'Cần xử lý sớm';
  return 'Bình thường';
}

function matchesTab(item: ProposalItem, selected: string) {
  if (selected === 'all') return item.status !== 'approved' && item.status !== 'rejected';
  if (selected === 'history') return item.status === 'approved' || item.status === 'rejected';
  return item.domain === selected;
}

function proposalLoadMessage(error: unknown): string {
  if (error instanceof CoreApiError && error.statusCode === 403) return 'Tài khoản hiện tại không có quyền xem đề xuất quản trị.';
  if (error instanceof CoreApiError && error.statusCode === 401) return 'Phiên đăng nhập đã hết hiệu lực. Vui lòng đăng nhập lại.';
  return 'Không thể tải danh sách đề xuất ở thời điểm hiện tại.';
}

export default async function ApprovalsPage({ searchParams }: { searchParams?: { tab?: string } }) {
  const selected = tabDefs.some((tab) => tab.key === searchParams?.tab) ? searchParams?.tab ?? 'all' : 'all';
  let proposals: ProposalItem[] | null = null;
  let loadMessage: string | null = null;
  try {
    proposals = await loadProposals();
  } catch (error) {
    loadMessage = proposalLoadMessage(error);
  }

  const tabs = tabDefs.map((tab) => ({
    href: tab.key === 'all' ? '/approvals' : `/approvals?tab=${tab.key}`,
    label: tab.label,
    icon: tab.icon,
    active: selected === tab.key,
    badge: tab.key === 'all' && proposals ? String(proposals.filter((item) => item.status === 'pending').length) : undefined,
  }));

  const items = proposals?.filter((item) => matchesTab(item, selected)) ?? [];

  return (
    <AdminShell activeSection="approvals" title="Trung tâm đề xuất" subtitle="Tập trung các đề xuất thật sự cần quyết định cấp quản lý.">
      <AdminIconTabs label="Nhóm đề xuất" tabs={tabs} />
      {proposals ? (
        <section className="approvalSummaryStrip" aria-label="Tóm tắt đề xuất">
          <div><span>Chờ quyết định</span><strong>{proposals.filter((item) => item.status === 'pending').length}</strong></div>
          <div><span>Chờ bổ sung</span><strong>{proposals.filter((item) => item.status === 'needs-info').length}</strong></div>
          <div><span>Ưu tiên cao</span><strong>{proposals.filter((item) => item.priority === 'critical' && item.status === 'pending').length}</strong></div>
        </section>
      ) : (
        <div className="card approvalEmpty" role="alert"><strong>{loadMessage ?? 'Không thể tải danh sách đề xuất.'}</strong><span>Vui lòng thử lại sau.</span></div>
      )}

      {proposals ? (
        <section className="approvalList" aria-label="Danh sách đề xuất">
          {items.length ? items.map((item) => (
            <Link key={item.id} className="card approvalListItem" href={`/approvals/${item.id}`}>
              <div className="approvalListTopline">
                <span className={`approvalPriority is-${item.priority}`}>{priorityLabel(item.priority)}</span>
                <span className={`approvalState is-${item.status}`}>{proposalStateLabel[item.status]}</span>
              </div>
              <h2>{item.title}</h2>
              {item.entityLabel ? <p className="approvalEntity">{item.entityLabel}</p> : null}
              <div className="approvalMetaGrid">
                <span><small>Nguồn</small><strong>{proposalSourceLabel[item.source]}</strong></span>
                <span><small>Người gửi</small><strong>{item.requesterName}</strong></span>
                {item.impact ? <span><small>Tác động</small><strong>{item.impact}</strong></span> : null}
                <span><small>Thời gian chờ</small><strong>{proposalWaitingAge(item)}</strong></span>
              </div>
              {item.reason ? <p className="approvalReason">{item.reason}</p> : null}
              <span className="approvalOpenLabel">Xem chi tiết · {proposalDomainLabel[item.domain]}</span>
            </Link>
          )) : <div className="card approvalEmpty"><strong>Không có đề xuất trong nhóm này.</strong><span>Chọn nhóm khác để tiếp tục.</span></div>}
        </section>
      ) : null}
    </AdminShell>
  );
}
