import Link from 'next/link';
import { createIdempotencyKey } from '@npp/contracts';
import { notFound } from 'next/navigation';
import { AdminShell } from '../../admin-shell';
import { AdminStatePanel, AdminStatusBadge, type AdminStatusTone } from '../../admin-ui-primitives';
import { CoreApiError } from '../../../lib/core-api';
import { safeAdminReturnTo } from '../../../lib/admin-session';
import { ProposalDecisionDialog } from '../proposal-decision-dialog';
import { formatProposalDateTime, loadProposal, proposalDomainLabel, proposalSourceLabel, proposalStateLabel, proposalWaitingAge, type ProposalItem } from '../proposal-data';

function proposalLoadMessage(error: unknown): string {
  if (error instanceof CoreApiError && error.statusCode === 403) return 'Tài khoản hiện tại không có quyền xem đề xuất quản trị.';
  if (error instanceof CoreApiError && error.statusCode === 401) return 'Phiên đăng nhập đã hết hiệu lực. Vui lòng đăng nhập lại.';
  return 'Không thể tải đề xuất ở thời điểm hiện tại.';
}
function backDestination(returnTo?: string) {
  const safeReturnTo = safeAdminReturnTo(returnTo);
  if (returnTo && (safeReturnTo === '/' || safeReturnTo.startsWith('/?period='))) return { href: safeReturnTo, label: '← Quay lại Tổng quan' };
  if (returnTo && safeReturnTo.startsWith('/reports/')) return { href: safeReturnTo, label: '← Quay lại báo cáo' };
  return { href: '/approvals', label: '← Quay lại danh sách' };
}
function entityTypeLabel(value: string) {
  const labels: Record<string, string> = { customer: 'Khách hàng', 'sales-order': 'Đơn bán hàng', 'purchase-order': 'Đơn mua hàng', document: 'Chứng từ', route: 'Tuyến', employee: 'Nhân viên', outlet: 'Điểm bán', other: 'Khác' };
  return labels[value] || value;
}
function priorityTone(priority: ProposalItem['priority']): AdminStatusTone {
  if (priority === 'critical') return 'danger';
  if (priority === 'high') return 'attention';
  return 'neutral';
}
function stateTone(status: ProposalItem['status']): AdminStatusTone {
  if (status === 'approved') return 'success';
  if (status === 'rejected') return 'danger';
  if (status === 'needs-info') return 'info';
  return 'attention';
}

export default async function ApprovalDetailPage({ params, searchParams }: { params: { approvalId: string }; searchParams?: { returnTo?: string } }) {
  const back = backDestination(searchParams?.returnTo); let item;
  try { item = await loadProposal(params.approvalId); }
  catch (error) {
    if (error instanceof CoreApiError && error.statusCode === 404) notFound();
    const message = proposalLoadMessage(error);
    return <AdminShell activeSection="approvals" title="Chi tiết đề xuất" subtitle="Xem nội dung và thông tin liên quan trước khi ra quyết định." contentWidth="special"><Link className="approvalBackLink" href={back.href}>{back.label}</Link><AdminStatePanel title={message} message="Vui lòng thử lại sau." tone={message.includes('không có quyền') ? 'forbidden' : 'error'} icon="info" /></AdminShell>;
  }
  const decisionKey = item.status === 'pending' ? createIdempotencyKey('admin-proposal-decision') : null;
  const hasRelatedEntity = Boolean(item.entityLabel || item.entityId || item.entityType !== 'other');
  return <AdminShell activeSection="approvals" title="Chi tiết đề xuất" subtitle="Xem nội dung và thông tin liên quan trước khi ra quyết định." contentWidth="special">
    <Link className="approvalBackLink" href={back.href}>{back.label}</Link>
    <article className="approvalDetailHero card"><div className="approvalListTopline"><AdminStatusBadge tone={priorityTone(item.priority)}>{item.priority === 'critical' ? 'Ưu tiên cao' : item.priority === 'high' ? 'Cần xử lý sớm' : 'Bình thường'}</AdminStatusBadge><AdminStatusBadge tone={stateTone(item.status)}>{proposalStateLabel[item.status]}</AdminStatusBadge></div><p className="approvalDetailDomain">{proposalDomainLabel[item.domain]} · {proposalSourceLabel[item.source]}</p><h2>{item.title}</h2>{item.impact ? <strong className="approvalDetailImpact">{item.impact}</strong> : null}{item.entityLabel ? <p>{item.entityLabel}</p> : null}{decisionKey ? <ProposalDecisionDialog proposalId={item.id} idempotencyKey={decisionKey} title={item.title} requesterName={item.requesterName}/> : null}</article>
    <section className="approvalDetailSection card"><h3>Nội dung đề xuất</h3><p>{item.content}</p></section>
    {hasRelatedEntity ? <section className="approvalDetailSection card"><h3>Đối tượng liên quan</h3><dl className="approvalDefinitionList"><div><dt>Loại</dt><dd>{entityTypeLabel(item.entityType)}</dd></div>{item.entityLabel ? <div><dt>Tên</dt><dd>{item.entityLabel}</dd></div> : null}{item.entityId ? <div><dt>Mã tham chiếu</dt><dd>{item.entityId}</dd></div> : null}</dl></section> : null}
    {item.reason ? <section className="approvalDetailSection card"><h3>Lý do / bối cảnh</h3><p>{item.reason}</p></section> : null}
    {item.rule ? <section className="approvalDetailSection card"><h3>Điều kiện cần lưu ý</h3><p>{item.rule}</p></section> : null}
    {item.evidence.length ? <section className="approvalDetailSection card"><h3>Dữ liệu và bằng chứng</h3><div className="approvalEvidenceList">{item.evidence.map((entry) => <div key={entry}>{entry}</div>)}</div></section> : null}
    <section className="approvalDetailSection card"><h3>Người gửi & thời gian</h3><dl className="approvalDefinitionList"><div><dt>Người gửi</dt><dd>{item.requesterName}</dd></div><div><dt>Nguồn</dt><dd>{proposalSourceLabel[item.source]}</dd></div><div><dt>Gửi lúc</dt><dd>{formatProposalDateTime(item.createdAt)}</dd></div><div><dt>Thời gian chờ</dt><dd>{proposalWaitingAge(item)}</dd></div></dl></section>
    {item.decisionNote ? <section className="approvalDetailSection card"><h3>Ghi chú quyết định</h3><p>{item.decisionNote}</p></section> : null}
    <section className="approvalDetailSection card"><h3>Lịch sử</h3><div className="approvalTimeline">{item.history.length ? item.history.map((event) => <div key={event.id}><span>{formatProposalDateTime(event.occurredAt)}</span><strong>{proposalStateLabel[event.toStatus]}</strong><small>{event.actorLabel}{event.note ? ` · ${event.note}` : ''}</small></div>) : <div><span>—</span><strong>Chưa có lịch sử bổ sung</strong><small>Đề xuất đang được theo dõi.</small></div>}</div></section>
  </AdminShell>;
}
