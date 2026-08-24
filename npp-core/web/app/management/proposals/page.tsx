import Link from 'next/link';
import { createIdempotencyKey } from '@npp/contracts';
import { AppShell } from '../../components/app-shell';
import {
  listOwnManagementProposals,
  ManagementProposalGatewayError,
  resolveManagementProposalRequestId,
  type ManagementProposalItem,
} from '../../../lib/management-proposal-gateway';
import { ManagementProposalForm, ManagementProposalResubmitForm } from './proposal-forms';
import styles from './proposals.module.css';

export const dynamic = 'force-dynamic';

const statusLabel: Record<ManagementProposalItem['status'], string> = {
  pending: 'Chờ quyết định',
  'needs-info': 'Chờ bổ sung',
  approved: 'Đã đồng ý',
  rejected: 'Đã từ chối',
};

const domainLabel: Record<ManagementProposalItem['domain'], string> = {
  commercial: 'Thương mại',
  'customer-debt': 'Khách hàng & công nợ',
  operations: 'Vận hành',
};

function formatDateTime(value: string) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '—';
  return new Intl.DateTimeFormat('vi-VN', {
    timeZone: 'Asia/Ho_Chi_Minh',
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  }).format(date);
}

async function loadPageData() {
  try {
    return { items: await listOwnManagementProposals(resolveManagementProposalRequestId(null)), error: null, forbidden: false };
  } catch (error) {
    if (error instanceof ManagementProposalGatewayError) {
      return { items: [], error: error.publicMessage, forbidden: error.statusCode === 403 };
    }
    return { items: [], error: 'Không tải được Đề xuất ở thời điểm hiện tại.', forbidden: false };
  }
}

export default async function ManagementProposalsPage({ searchParams }: { searchParams?: { sent?: string; resubmitted?: string } }) {
  const data = await loadPageData();
  const createKey = createIdempotencyKey('company-management-proposal');

  return (
    <AppShell
      kicker="Đề xuất quản trị"
      title="Gửi đề xuất lên Admin"
      subtitle="Chỉ cần nêu rõ tiêu đề và nội dung cần quyết định. Thông tin liên quan có thể bổ sung khi thật sự cần."
      actions={<Link className={styles.secondaryLink} href="/management">Quay lại Điều hành bán hàng</Link>}
    >
      <div className={styles.page} data-testid="company-management-proposals-page">
        {searchParams?.sent === '1' ? <p className={styles.success} role="status">Đề xuất đã được gửi đến Admin.</p> : null}
        {searchParams?.resubmitted === '1' ? <p className={styles.success} role="status">Nội dung bổ sung đã được gửi lại.</p> : null}
        {data.error ? <p className={styles.error} role="alert">{data.error}</p> : null}

        {!data.forbidden ? (
          <section className={styles.card} aria-labelledby="proposal-form-title">
            <div className={styles.sectionHeader}>
              <div>
                <p className={styles.eyebrow}>Phiếu Đề xuất</p>
                <h2 id="proposal-form-title">Nội dung cần Admin quyết định</h2>
              </div>
              <span className={styles.sourceBadge}>Nguồn: Công Ty</span>
            </div>
            <ManagementProposalForm idempotencyKey={createKey} />
          </section>
        ) : null}

        <section className={styles.card} aria-labelledby="proposal-history-title">
          <div className={styles.sectionHeader}>
            <div>
              <p className={styles.eyebrow}>Phản hồi từ Admin</p>
              <h2 id="proposal-history-title">Đề xuất của tôi</h2>
            </div>
            <span>{data.items.length} phiếu</span>
          </div>
          {!data.items.length && !data.error ? <p className={styles.empty}>Chưa có đề xuất nào.</p> : null}
          <div className={styles.list}>
            {data.items.map((item) => (
              <article className={styles.proposal} key={item.id}>
                <div className={styles.proposalTop}>
                  <div>
                    <span className={styles.meta}>{domainLabel[item.domain]}{item.entityLabel ? ` · ${item.entityLabel}` : ''}</span>
                    <h3>{item.title}</h3>
                  </div>
                  <span className={`${styles.status} ${styles[`status_${item.status.replace('-', '_')}`]}`}>{statusLabel[item.status]}</span>
                </div>
                <p className={styles.content}>{item.content}</p>
                <dl className={styles.details}>
                  {item.impact ? <div><dt>Tác động</dt><dd>{item.impact}</dd></div> : null}
                  <div><dt>Cập nhật</dt><dd>{formatDateTime(item.updatedAt)}</dd></div>
                </dl>
                {item.decisionNote ? <p className={styles.decision}><strong>Phản hồi Admin:</strong> {item.decisionNote}</p> : null}
                {item.status === 'needs-info' ? (
                  <ManagementProposalResubmitForm
                    proposalId={item.id}
                    idempotencyKey={createIdempotencyKey('company-management-proposal-resubmit')}
                    content={item.content}
                    reason={item.reason}
                    evidence={item.evidence}
                  />
                ) : null}
              </article>
            ))}
          </div>
        </section>
      </div>
    </AppShell>
  );
}
