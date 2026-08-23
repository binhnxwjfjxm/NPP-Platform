import Link from 'next/link';
import { createIdempotencyKey } from '@npp/contracts';
import { AppShell } from '../../components/app-shell';
import {
  listOwnManagementProposals,
  ManagementProposalGatewayError,
  resolveManagementProposalRequestId,
  type ManagementProposalItem,
} from '../../../lib/management-proposal-gateway';
import { createProposalAction, resubmitProposalAction } from './actions';
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
      subtitle="Tạo đề xuất có đủ nội dung, đối tượng liên quan và tác động; trạng thái quyết định sẽ trả về đúng người gửi."
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
            <form action={createProposalAction} className={styles.form}>
              <input type="hidden" name="idempotencyKey" value={createKey} />
              <label className={styles.full}>Tiêu đề
                <input name="title" required maxLength={240} placeholder="Ví dụ: Điều chỉnh điều kiện công nợ cho khách hàng A" />
              </label>
              <label className={styles.full}>Nội dung đề xuất
                <textarea name="content" required maxLength={4000} rows={5} placeholder="Nhập rõ việc cần Admin xem xét và quyết định." />
              </label>
              <label>Nhóm đề xuất
                <select name="domain" defaultValue="commercial" required>
                  <option value="commercial">Thương mại</option>
                  <option value="customer-debt">Khách hàng & công nợ</option>
                  <option value="operations">Vận hành</option>
                </select>
              </label>
              <label>Đối tượng liên quan
                <select name="entityType" defaultValue="customer" required>
                  <option value="customer">Khách hàng</option>
                  <option value="sales-order">Đơn bán hàng</option>
                  <option value="purchase-order">Đơn mua hàng</option>
                  <option value="document">Chứng từ</option>
                  <option value="route">Tuyến</option>
                  <option value="employee">Nhân viên</option>
                  <option value="outlet">Điểm bán</option>
                  <option value="other">Khác</option>
                </select>
              </label>
              <label>Mã / tham chiếu
                <input name="entityId" required maxLength={240} placeholder="Mã khách, số đơn, số chứng từ..." />
              </label>
              <label>Tên hiển thị
                <input name="entityLabel" required maxLength={240} placeholder="Tên khách hoặc mô tả đối tượng" />
              </label>
              <label>Mức ưu tiên
                <select name="priority" defaultValue="normal" required>
                  <option value="normal">Bình thường</option>
                  <option value="high">Cần xử lý sớm</option>
                  <option value="critical">Ưu tiên cao</option>
                </select>
              </label>
              <label>Tác động dự kiến
                <input name="impact" required maxLength={1000} placeholder="Ảnh hưởng tới doanh thu, khách hàng hoặc vận hành" />
              </label>
              <label className={styles.full}>Lý do
                <textarea name="reason" required maxLength={4000} rows={3} placeholder="Vì sao cần quyết định này?" />
              </label>
              <label className={styles.full}>Điều kiện / quy tắc liên quan
                <textarea name="rule" required maxLength={1000} rows={2} placeholder="Chính sách, giới hạn hoặc điều kiện cần lưu ý" />
              </label>
              <label className={styles.full}>Bằng chứng / ghi chú (mỗi dòng một mục)
                <textarea name="evidence" maxLength={4000} rows={3} placeholder="Số liệu, liên hệ, ghi chú hoặc nguồn kiểm tra" />
              </label>
              <div className={styles.full}><button className={styles.primaryButton} type="submit">Gửi Đề xuất</button></div>
            </form>
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
                    <span className={styles.meta}>{domainLabel[item.domain]} · {item.entityLabel}</span>
                    <h3>{item.title}</h3>
                  </div>
                  <span className={`${styles.status} ${styles[`status_${item.status.replace('-', '_')}`]}`}>{statusLabel[item.status]}</span>
                </div>
                <p className={styles.content}>{item.content}</p>
                <dl className={styles.details}>
                  <div><dt>Tác động</dt><dd>{item.impact}</dd></div>
                  <div><dt>Cập nhật</dt><dd>{formatDateTime(item.updatedAt)}</dd></div>
                </dl>
                {item.decisionNote ? <p className={styles.decision}><strong>Phản hồi Admin:</strong> {item.decisionNote}</p> : null}
                {item.status === 'needs-info' ? (
                  <form action={resubmitProposalAction} className={styles.resubmit}>
                    <input type="hidden" name="proposalId" value={item.id} />
                    <input type="hidden" name="idempotencyKey" value={createIdempotencyKey('company-management-proposal-resubmit')} />
                    <label>Nội dung bổ sung
                      <textarea name="content" defaultValue={item.content} required maxLength={4000} rows={4} />
                    </label>
                    <label>Lý do / giải trình
                      <textarea name="reason" defaultValue={item.reason} required maxLength={4000} rows={3} />
                    </label>
                    <label>Bằng chứng / ghi chú
                      <textarea name="evidence" defaultValue={item.evidence.join('\n')} maxLength={4000} rows={3} />
                    </label>
                    <button className={styles.primaryButton} type="submit">Gửi bổ sung</button>
                  </form>
                ) : null}
              </article>
            ))}
          </div>
        </section>
      </div>
    </AppShell>
  );
}
