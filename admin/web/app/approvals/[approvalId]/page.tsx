import Link from 'next/link';
import { notFound } from 'next/navigation';
import { AdminShell } from '../../admin-shell';
import { approvalDomainLabel, approvalFixtures, approvalStateLabel } from '../approval-fixtures';

export default function ApprovalDetailPage({ params }: { params: { approvalId: string } }) {
  const item = approvalFixtures.find((candidate) => candidate.id === params.approvalId);
  if (!item) notFound();

  return (
    <AdminShell activeSection="approvals" title="Chi tiết đề xuất" subtitle="Xem đầy đủ tác động, điều kiện và bằng chứng trước khi ra quyết định.">
      <Link className="approvalBackLink" href="/approvals">← Quay lại danh sách</Link>
      <p className="adminPreviewNotice">Dữ liệu minh họa. Các hành động quyết định chưa được mở.</p>
      <article className="approvalDetailHero card">
        <div className="approvalListTopline"><span className={`approvalPriority is-${item.priority}`}>{item.priority === 'critical' ? 'Ưu tiên cao' : item.priority === 'high' ? 'Cần xử lý sớm' : 'Bình thường'}</span><span className={`approvalState is-${item.state}`}>{approvalStateLabel[item.state]}</span></div>
        <p className="approvalDetailDomain">{approvalDomainLabel[item.domain]} · {item.source}</p>
        <h2>{item.title}</h2>
        <strong className="approvalDetailImpact">{item.impact}</strong>
        <p>{item.entity}</p>
      </article>

      <section className="approvalDetailSection card"><h3>Lý do đề xuất</h3><p>{item.reason}</p></section>
      <section className="approvalDetailSection card"><h3>Điều kiện liên quan</h3><p>{item.rule}</p></section>
      <section className="approvalDetailSection card"><h3>Dữ liệu và bằng chứng</h3><div className="approvalEvidenceList">{item.evidence.map((entry) => <div key={entry}>{entry}</div>)}</div></section>
      <section className="approvalDetailSection card"><h3>Người gửi & thời gian</h3><dl className="approvalDefinitionList"><div><dt>Người gửi</dt><dd>{item.requester}</dd></div><div><dt>Nguồn</dt><dd>{item.source}</dd></div><div><dt>Gửi lúc</dt><dd>{item.submittedAt}</dd></div><div><dt>Thời gian chờ</dt><dd>{item.waitingAge}</dd></div></dl></section>
      <section className="approvalDetailSection card"><h3>Lịch sử</h3><div className="approvalTimeline">{item.history.map((event) => <div key={`${event.time}-${event.label}`}><span>{event.time}</span><strong>{event.label}</strong><small>{event.actor}</small></div>)}</div></section>

      {item.state === 'pending' ? <section className="approvalDecisionBar" aria-label="Hành động quyết định"><button type="button" disabled>Đồng ý</button><button type="button" disabled>Yêu cầu bổ sung</button><button type="button" disabled>Từ chối</button><small>Các hành động sẽ được mở khi luồng xử lý chính thức sẵn sàng.</small></section> : null}
    </AdminShell>
  );
}
