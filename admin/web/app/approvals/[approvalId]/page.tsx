import Link from 'next/link';
import { createIdempotencyKey } from '@npp/contracts';
import { notFound } from 'next/navigation';
import { AdminShell } from '../../admin-shell';
import { CoreApiError } from '../../../lib/core-api';
import { safeAdminReturnTo } from '../../../lib/admin-session';
import { decideProposal } from '../actions';
import { formatProposalDateTime, loadProposal, proposalDomainLabel, proposalSourceLabel, proposalStateLabel, proposalWaitingAge } from '../proposal-data';

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

export default async function ApprovalDetailPage({ params, searchParams }: { params: { approvalId: string }; searchParams?: { returnTo?: string } }) {
  const back = backDestination(searchParams?.returnTo); let item;
  try { item = await loadProposal(params.approvalId); }
  catch (error) {
    if (error instanceof CoreApiError && error.statusCode === 404) notFound();
    return <AdminShell activeSection="approvals" title="Chi tiết đề xuất" subtitle="Xem đầy đủ tác động, điều kiện và bằng chứng trước khi ra quyết định."><Link className="approvalBackLink" href={back.href}>{back.label}</Link><div className="card approvalEmpty" role="alert"><strong>{proposalLoadMessage(error)}</strong><span>Vui lòng thử lại sau.</span></div></AdminShell>;
  }
  const decisionKey = createIdempotencyKey('admin-proposal-decision');
  return <AdminShell activeSection="approvals" title="Chi tiết đề xuất" subtitle="Xem đầy đủ tác động, điều kiện và bằng chứng trước khi ra quyết định.">
    <Link className="approvalBackLink" href={back.href}>{back.label}</Link>
    <article className="approvalDetailHero card"><div className="approvalListTopline"><span className={`approvalPriority is-${item.priority}`}>{item.priority === 'critical' ? 'Ưu tiên cao' : item.priority === 'high' ? 'Cần xử lý sớm' : 'Bình thường'}</span><span className={`approvalState is-${item.status}`}>{proposalStateLabel[item.status]}</span></div><p className="approvalDetailDomain">{proposalDomainLabel[item.domain]} · {proposalSourceLabel[item.source]}</p><h2>{item.title}</h2><strong className="approvalDetailImpact">{item.impact}</strong><p>{item.entityLabel}</p></article>
    <section className="approvalDetailSection card"><h3>Nội dung đề xuất</h3><p>{item.content}</p></section>
    <section className="approvalDetailSection card"><h3>Đối tượng liên quan</h3><dl className="approvalDefinitionList"><div><dt>Loại</dt><dd>{entityTypeLabel(item.entityType)}</dd></div><div><dt>Tên</dt><dd>{item.entityLabel}</dd></div><div><dt>Mã tham chiếu</dt><dd>{item.entityId}</dd></div></dl></section>
    <section className="approvalDetailSection card"><h3>Lý do đề xuất</h3><p>{item.reason}</p></section>
    <section className="approvalDetailSection card"><h3>Điều kiện liên quan</h3><p>{item.rule}</p></section>
    <section className="approvalDetailSection card"><h3>Dữ liệu và bằng chứng</h3><div className="approvalEvidenceList">{item.evidence.length ? item.evidence.map((entry) => <div key={entry}>{entry}</div>) : <div>Chưa có bằng chứng bổ sung.</div>}</div></section>
    <section className="approvalDetailSection card"><h3>Người gửi & thời gian</h3><dl className="approvalDefinitionList"><div><dt>Người gửi</dt><dd>{item.requesterName}</dd></div><div><dt>Nguồn</dt><dd>{proposalSourceLabel[item.source]}</dd></div><div><dt>Gửi lúc</dt><dd>{formatProposalDateTime(item.createdAt)}</dd></div><div><dt>Thời gian chờ</dt><dd>{proposalWaitingAge(item)}</dd></div></dl></section>
    {item.decisionNote ? <section className="approvalDetailSection card"><h3>Ghi chú quyết định</h3><p>{item.decisionNote}</p></section> : null}
    <section className="approvalDetailSection card"><h3>Lịch sử</h3><div className="approvalTimeline">{item.history.length ? item.history.map((event) => <div key={event.id}><span>{formatProposalDateTime(event.occurredAt)}</span><strong>{proposalStateLabel[event.toStatus]}</strong><small>{event.actorLabel}{event.note ? ` · ${event.note}` : ''}</small></div>) : <div><span>—</span><strong>Chưa có lịch sử bổ sung</strong><small>Đề xuất đang được theo dõi.</small></div>}</div></section>
    {item.status === 'pending' ? <form action={decideProposal} className="approvalDecisionBar" aria-label="Hành động quyết định"><input type="hidden" name="proposalId" value={item.id}/><input type="hidden" name="idempotencyKey" value={decisionKey}/><label style={{ display: 'grid', gap: '.35rem', flex: '1 1 100%' }}><span>Ghi chú quyết định</span><textarea name="note" rows={3} maxLength={2000} placeholder="Bắt buộc khi yêu cầu bổ sung hoặc từ chối"/></label><button type="submit" name="decision" value="approved">Đồng ý</button><button type="submit" name="decision" value="needs-info">Yêu cầu bổ sung</button><button type="submit" name="decision" value="rejected">Từ chối</button></form> : null}
  </AdminShell>;
}
