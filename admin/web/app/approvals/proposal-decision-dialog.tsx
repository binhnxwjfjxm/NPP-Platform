'use client';

import { useRef, useState } from 'react';
import { decideProposal } from './actions';
import styles from './proposal-decision-dialog.module.css';

type ProposalDecision = 'approved' | 'needs-info' | 'rejected';

const decisionOptions: Array<{ value: ProposalDecision; label: string; description: string }> = [
  { value: 'approved', label: 'Đồng ý', description: 'Chấp thuận đề xuất để đơn vị gửi tiếp tục thực hiện.' },
  { value: 'needs-info', label: 'Yêu cầu bổ sung', description: 'Trả lại để người gửi bổ sung thông tin trước khi xem xét tiếp.' },
  { value: 'rejected', label: 'Từ chối', description: 'Không chấp thuận đề xuất ở lần xem xét này.' },
];

const confirmationLabel: Record<ProposalDecision, string> = {
  approved: 'Xác nhận đồng ý',
  'needs-info': 'Gửi yêu cầu bổ sung',
  rejected: 'Xác nhận từ chối',
};

export function ProposalDecisionDialog({
  proposalId,
  idempotencyKey,
  title,
  requesterName,
}: {
  proposalId: string;
  idempotencyKey: string;
  title: string;
  requesterName: string;
}) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const [decision, setDecision] = useState<ProposalDecision | null>(null);
  const selectedOption = decisionOptions.find((option) => option.value === decision) ?? null;
  const noteRequired = decision === 'needs-info' || decision === 'rejected';
  const dialogTitleId = `proposal-review-title-${proposalId}`;

  function openDialog() {
    setDecision(null);
    dialogRef.current?.showModal();
  }

  function closeDialog() {
    dialogRef.current?.close();
  }

  return <>
    <div className={styles.entry}>
      <button type="button" className={styles.reviewButton} onClick={openDialog}>Xem xét đề xuất</button>
      <span>Ra quyết định trong cửa sổ riêng sau khi đã đọc đủ thông tin.</span>
    </div>
    <dialog ref={dialogRef} className={styles.dialog} aria-labelledby={dialogTitleId} onClose={() => setDecision(null)}>
      <form action={decideProposal} className={styles.form}>
        <input type="hidden" name="proposalId" value={proposalId}/>
        <input type="hidden" name="idempotencyKey" value={idempotencyKey}/>
        <input type="hidden" name="decision" value={decision ?? ''}/>

        <header className={styles.header}>
          <div>
            <span className={styles.eyebrow}>Xem xét đề xuất</span>
            <h2 id={dialogTitleId}>{title}</h2>
            <p>Người gửi: <strong>{requesterName}</strong></p>
          </div>
          <button type="button" className={styles.closeButton} onClick={closeDialog} aria-label="Đóng cửa sổ xem xét">Đóng</button>
        </header>

        <section className={styles.body}>
          <div className={styles.sectionHeading}>
            <strong>Chọn quyết định</strong>
            <span>Chọn một phương án trước khi xác nhận.</span>
          </div>

          <div className={styles.decisionGrid} role="group" aria-label="Quyết định đề xuất">
            {decisionOptions.map((option) => <button
              key={option.value}
              type="button"
              className={`${styles.decisionOption} ${decision === option.value ? styles.selected : ''}`}
              onClick={() => setDecision(option.value)}
              aria-pressed={decision === option.value}
            >
              <strong>{option.label}</strong>
              <span>{option.description}</span>
            </button>)}
          </div>

          <label className={styles.noteField}>
            <span>Ghi chú quyết định {noteRequired ? <strong>Bắt buộc</strong> : <small>Không bắt buộc khi đồng ý</small>}</span>
            <textarea
              name="note"
              rows={4}
              maxLength={2000}
              required={noteRequired}
              placeholder={noteRequired ? 'Ghi rõ nội dung cần bổ sung hoặc lý do từ chối' : 'Có thể ghi thêm lưu ý cho người gửi'}
            />
          </label>

          <div className={styles.selectionSummary} aria-live="polite">
            {selectedOption ? <><strong>{selectedOption.label}</strong><span>{selectedOption.description}</span></> : <><strong>Chưa chọn quyết định</strong><span>Chọn một phương án ở trên để mở nút xác nhận.</span></>}
          </div>
        </section>

        <footer className={styles.footer}>
          <button type="button" className={styles.cancelButton} onClick={closeDialog}>Hủy</button>
          <button type="submit" className={`${styles.confirmButton} ${decision ? styles[`confirm_${decision}`] : ''}`} disabled={!decision}>
            {decision ? confirmationLabel[decision] : 'Chọn quyết định'}
          </button>
        </footer>
      </form>
    </dialog>
  </>;
}
