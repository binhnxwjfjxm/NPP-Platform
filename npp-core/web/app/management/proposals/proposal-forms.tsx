'use client';

import { useFormState, useFormStatus } from 'react-dom';
import { createProposalAction, resubmitProposalAction, type ProposalActionState } from './actions';
import styles from './proposals.module.css';

const INITIAL_STATE: ProposalActionState = { error: null, idempotencyKey: null };

function SubmitButton({ label, pendingLabel }: { label: string; pendingLabel: string }) {
  const { pending } = useFormStatus();
  return <button className={styles.primaryButton} type="submit" disabled={pending}>{pending ? pendingLabel : label}</button>;
}

export function ManagementProposalForm({ idempotencyKey }: { idempotencyKey: string }) {
  const [state, formAction] = useFormState(createProposalAction, INITIAL_STATE);
  const activeIdempotencyKey = state.idempotencyKey ?? idempotencyKey;
  return (
    <form action={formAction} className={styles.form}>
      <input type="hidden" name="idempotencyKey" value={activeIdempotencyKey} />
      <label className={styles.full}>Tiêu đề
        <input name="title" required maxLength={240} placeholder="Ví dụ: Xin điều chỉnh điều kiện thanh toán cho khách hàng A" />
      </label>
      <label className={styles.full}>Nội dung đề xuất
        <textarea name="content" required maxLength={4000} rows={6} placeholder="Nêu việc cần Admin xem xét và quyết định. Chỉ hai trường này là bắt buộc." />
      </label>

      <details className={`${styles.optionalDetails} ${styles.full}`}>
        <summary>Thêm thông tin liên quan <span>(không bắt buộc)</span></summary>
        <p className={styles.optionalHint}>Chỉ bổ sung khi thông tin này giúp Admin hiểu hoặc kiểm tra đề xuất nhanh hơn.</p>
        <div className={styles.optionalGrid}>
          <label>Nhóm xử lý
            <select name="domain" defaultValue="commercial">
              <option value="commercial">Thương mại</option>
              <option value="customer-debt">Khách hàng & công nợ</option>
              <option value="operations">Vận hành</option>
            </select>
          </label>
          <label>Mức ưu tiên
            <select name="priority" defaultValue="normal">
              <option value="normal">Bình thường</option>
              <option value="high">Cần xử lý sớm</option>
              <option value="critical">Ưu tiên cao</option>
            </select>
          </label>
          <label>Liên quan đến
            <select name="entityType" defaultValue="other">
              <option value="other">Khác / chưa xác định</option>
              <option value="customer">Khách hàng</option>
              <option value="sales-order">Đơn bán hàng</option>
              <option value="purchase-order">Đơn mua hàng</option>
              <option value="document">Chứng từ</option>
              <option value="route">Tuyến</option>
              <option value="employee">Nhân viên</option>
              <option value="outlet">Điểm bán</option>
            </select>
          </label>
          <label>Mã liên quan (nếu có)
            <input name="entityId" maxLength={240} placeholder="Mã khách, số đơn, số chứng từ..." />
          </label>
          <label className={styles.full}>Tên khách / đơn / tuyến (nếu có)
            <input name="entityLabel" maxLength={240} placeholder="Tên dễ nhận biết để Admin tra cứu" />
          </label>
          <label className={styles.full}>Lý do / bối cảnh
            <textarea name="reason" maxLength={4000} rows={3} placeholder="Bổ sung bối cảnh nếu nội dung phía trên chưa đủ." />
          </label>
          <label className={styles.full}>Tác động dự kiến
            <textarea name="impact" maxLength={1000} rows={2} placeholder="Ảnh hưởng tới khách hàng, doanh thu hoặc vận hành nếu có." />
          </label>
          <label className={styles.full}>Điều kiện cần lưu ý
            <textarea name="rule" maxLength={1000} rows={2} placeholder="Chính sách, giới hạn hoặc điều kiện liên quan nếu có." />
          </label>
          <label className={styles.full}>Bằng chứng / ghi chú
            <textarea name="evidence" maxLength={4000} rows={3} placeholder="Mỗi dòng một thông tin, số liệu hoặc nguồn kiểm tra." />
          </label>
        </div>
      </details>

      {state.error ? <p className={`${styles.error} ${styles.full}`} role="alert">{state.error}</p> : null}
      <div className={`${styles.full} ${styles.actionRow}`}><SubmitButton label="Gửi Đề xuất" pendingLabel="Đang gửi…" /></div>
    </form>
  );
}

export function ManagementProposalResubmitForm({
  proposalId,
  idempotencyKey,
  content,
  reason,
  evidence,
}: {
  proposalId: string;
  idempotencyKey: string;
  content: string;
  reason: string;
  evidence: string[];
}) {
  const [state, formAction] = useFormState(resubmitProposalAction, INITIAL_STATE);
  const activeIdempotencyKey = state.idempotencyKey ?? idempotencyKey;
  return (
    <form action={formAction} className={styles.resubmit}>
      <input type="hidden" name="proposalId" value={proposalId} />
      <input type="hidden" name="idempotencyKey" value={activeIdempotencyKey} />
      <label>Nội dung bổ sung
        <textarea name="content" defaultValue={content} required maxLength={4000} rows={4} />
      </label>
      <label>Lý do / giải trình <span className={styles.optionalLabel}>(nếu cần)</span>
        <textarea name="reason" defaultValue={reason} maxLength={4000} rows={3} />
      </label>
      <label>Bằng chứng / ghi chú <span className={styles.optionalLabel}>(nếu có)</span>
        <textarea name="evidence" defaultValue={evidence.join('\n')} maxLength={4000} rows={3} />
      </label>
      {state.error ? <p className={styles.error} role="alert">{state.error}</p> : null}
      <div className={styles.actionRow}><SubmitButton label="Gửi bổ sung" pendingLabel="Đang gửi…" /></div>
    </form>
  );
}
