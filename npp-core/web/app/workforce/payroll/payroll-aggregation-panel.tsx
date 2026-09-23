'use client';

import { useMemo, useState } from 'react';
import sharedStyles from '../../organization/organization.module.css';
import styles from './payroll-aggregation.module.css';

export type PayrollIssueSummary = {
  blockers: Record<string, number | undefined>;
  warnings: Record<string, number | undefined>;
};

export type PayrollComponentLine = {
  id: string;
  code: string;
  name: string;
  category: 'INCOME' | 'DEDUCTION' | 'REIMBURSEMENT';
  appliedAmount?: string;
  amount?: string;
  originalAmount?: string;
  note?: string | null;
  proratedByWorkdays?: boolean;
};

export type PayrollCalculationRow = {
  employeeId: string;
  employeeCode: string;
  employeeName: string;
  branchName?: string | null;
  standardWorkDays: number;
  payableWorkDays: number;
  unpaidLeaveDays: number;
  confirmedOvertimeMinutes: number;
  monthlySalary: string;
  salaryAmount: string;
  incomeTotal: string;
  reimbursementTotal: string;
  deductionTotal: string;
  grossIncome: string;
  netPay: string;
  fixedComponents: PayrollComponentLine[];
  periodComponents: PayrollComponentLine[];
};

export type PayrollCalculation = {
  revision: number;
  sourceFingerprint: string;
  issueSummary: PayrollIssueSummary;
  snapshot: {
    contractVersion: number;
    totals: {
      employeeCount: number;
      salaryAmount: string;
      incomeTotal: string;
      reimbursementTotal: string;
      deductionTotal: string;
      grossIncome: string;
      netPay: string;
    };
    rows: PayrollCalculationRow[];
  };
};

type PayrollPeriod = {
  id: string;
  status: 'AGGREGATING' | 'NEEDS_ACTION' | 'RECONCILED' | 'CLOSED';
};

const ISSUE_LABELS: Record<string, string> = {
  emptyPayrollPeriod: 'Kỳ lương chưa có nhân sự từ kỳ công đã chốt.',
  missingSalaryProfiles: 'nhân sự chưa có mức lương áp dụng cho toàn kỳ',
  salaryCoverageConflicts: 'nhân sự có nhiều mức lương trong kỳ cần kiểm tra',
  fixedComponentCoverageConflicts: 'khoản cố định thay đổi trong kỳ cần kiểm tra cách tính',
  zeroStandardWorkdays: 'nhân sự đã có mức lương nhưng chưa có ngày công chuẩn trong kỳ',
  sourceChanged: 'Dữ liệu kỳ công hoặc thiết lập lương đã thay đổi sau lần tổng hợp trước.',
  confirmedOvertimeEmployees: 'nhân sự có giờ tăng ca đã xác nhận; cần kiểm tra khoản tiền tăng ca trước khi đối soát',
  incompleteAttendanceDays: 'ngày công chưa đầy đủ cần kiểm tra',
  unexcusedAbsenceDays: 'ngày vắng không phép cần kiểm tra',
  violationDays: 'ngày có vi phạm công cần kiểm tra',
};

function moneyLabel(value: string | null | undefined) {
  const raw = String(value ?? '0.00');
  const [wholeRaw, fractionRaw = ''] = raw.split('.');
  const negative = wholeRaw.startsWith('-');
  const digits = negative ? wholeRaw.slice(1) : wholeRaw;
  const grouped = digits.replace(/\B(?=(\d{3})+(?!\d))/g, '.');
  const fraction = fractionRaw.replace(/0+$/, '');
  return `${negative ? '-' : ''}${grouped}${fraction ? ',' + fraction : ''} ₫`;
}
function hours(minutes: number) {
  return (Number(minutes ?? 0) / 60).toLocaleString('vi-VN', { maximumFractionDigits: 2 });
}
function activeIssues(group: Record<string, number | undefined>) {
  return Object.entries(group ?? {}).filter(([, value]) => Number(value ?? 0) > 0);
}
function componentAmount(line: PayrollComponentLine) {
  return moneyLabel(line.appliedAmount ?? line.amount ?? '0.00');
}

export function PayrollAggregationPanel({
  mode,
  period,
  calculation,
  canManage,
  busy,
  onAggregate,
  onReconcile,
}: {
  mode: 'board' | 'reconcile';
  period: PayrollPeriod;
  calculation: PayrollCalculation | null;
  canManage: boolean;
  busy: boolean;
  onAggregate: () => Promise<void>;
  onReconcile: (acknowledgeWarnings: boolean, note: string) => Promise<void>;
}) {
  const [selectedRow, setSelectedRow] = useState<PayrollCalculationRow | null>(null);
  const [acknowledgeWarnings, setAcknowledgeWarnings] = useState(false);
  const [note, setNote] = useState('');
  const blockers = useMemo(() => activeIssues(calculation?.issueSummary.blockers ?? {}), [calculation]);
  const warnings = useMemo(() => activeIssues(calculation?.issueSummary.warnings ?? {}), [calculation]);

  if (!calculation) {
    return (
      <div className={sharedStyles.emptyState}>
        <p>Chưa có bản tổng hợp lương cho kỳ này.</p>
        {canManage ? (
          <button type="button" className={sharedStyles.primaryButton} disabled={busy} onClick={() => void onAggregate()}>
            Tổng hợp lương
          </button>
        ) : null}
      </div>
    );
  }

  if (mode === 'reconcile') {
    return (
      <div className={styles.reconcileForm}>
        {blockers.length ? (
          <div className={styles.issueBox}>
            <strong>Cần xử lý trước khi đối soát</strong>
            <ul className={styles.issueList}>
              {blockers.map(([key, value]) => <li key={key}>{ISSUE_LABELS[key] || key}: {value}</li>)}
            </ul>
          </div>
        ) : null}
        {warnings.length ? (
          <div className={styles.issueBox}>
            <strong>Cần kiểm tra</strong>
            <ul className={styles.issueList}>
              {warnings.map(([key, value]) => <li key={key}>{ISSUE_LABELS[key] || key}: {value}</li>)}
            </ul>
          </div>
        ) : null}
        {!blockers.length && !warnings.length ? (
          <div className={`${sharedStyles.banner} ${sharedStyles.bannerSuccess}`}>Số liệu tổng hợp không còn cảnh báo cần xử lý.</div>
        ) : null}
        {period.status === 'RECONCILED' ? (
          <div className={`${sharedStyles.banner} ${sharedStyles.bannerSuccess}`}>Kỳ lương đã được đối soát trên bản tổng hợp hiện tại.</div>
        ) : null}
        {canManage && period.status !== 'RECONCILED' ? (
          <>
            {warnings.length ? (
              <label className={styles.checkRow}>
                <input type="checkbox" checked={acknowledgeWarnings} onChange={(event) => setAcknowledgeWarnings(event.target.checked)} />
                <span>Tôi đã kiểm tra các cảnh báo trên và xác nhận số liệu phù hợp để đối soát.</span>
              </label>
            ) : null}
            <label>
              Ghi chú đối soát
              <textarea value={note} onChange={(event) => setNote(event.target.value)} maxLength={1000} placeholder="Ghi lại nội dung đã kiểm tra khi cần" />
            </label>
            <div className={styles.actions}>
              <button
                type="button"
                className={sharedStyles.primaryButton}
                disabled={busy || blockers.length > 0 || (warnings.length > 0 && !acknowledgeWarnings)}
                onClick={() => void onReconcile(acknowledgeWarnings, note)}
              >
                Xác nhận đối soát
              </button>
            </div>
          </>
        ) : null}
      </div>
    );
  }

  const totals = calculation.snapshot.totals;
  return (
    <div className={styles.detailGrid}>
      <div className={styles.actions}>
        <span className={styles.inlineMeta}>Bản tổng hợp lần {calculation.revision}</span>
        {canManage && period.status !== 'CLOSED' ? (
          <button type="button" className={sharedStyles.secondaryButton} disabled={busy} onClick={() => void onAggregate()}>
            Tổng hợp lại
          </button>
        ) : null}
      </div>

      <div className={styles.summaryStrip}>
        <div className={styles.summaryItem}><span>Tổng thu nhập</span><strong>{moneyLabel(totals.grossIncome)}</strong><small>{totals.employeeCount} nhân sự</small></div>
        <div className={styles.summaryItem}><span>Hoàn chi phí</span><strong>{moneyLabel(totals.reimbursementTotal)}</strong><small>Tách riêng tiền lương</small></div>
        <div className={styles.summaryItem}><span>Khấu trừ</span><strong>{moneyLabel(totals.deductionTotal)}</strong><small>Theo khoản đã thiết lập</small></div>
        <div className={styles.summaryItem}><span>Thực nhận</span><strong>{moneyLabel(totals.netPay)}</strong><small>Trước khi chốt lương</small></div>
      </div>

      {blockers.length || warnings.length ? (
        <div className={styles.issueBox}>
          <strong>{blockers.length ? 'Kỳ lương còn dữ liệu cần xử lý' : 'Kỳ lương còn nội dung cần kiểm tra'}</strong>
          <ul className={styles.issueList}>
            {[...blockers, ...warnings].map(([key, value]) => <li key={key}>{ISSUE_LABELS[key] || key}: {value}</li>)}
          </ul>
        </div>
      ) : null}

      <div className={sharedStyles.tableWrap}>
        <table className={sharedStyles.table}>
          <thead>
            <tr>
              <th>Nhân sự</th>
              <th>Lương theo công</th>
              <th>Công & tăng ca</th>
              <th>Thu nhập thêm</th>
              <th>Hoàn chi</th>
              <th>Khấu trừ</th>
              <th>Thực nhận</th>
              <th>Chi tiết</th>
            </tr>
          </thead>
          <tbody>
            {calculation.snapshot.rows.map((row) => (
              <tr key={row.employeeId}>
                <td>
                  <button type="button" className={styles.employeeButton} onClick={() => setSelectedRow(row)}>
                    {row.employeeCode} · {row.employeeName}
                  </button>
                  <div className={styles.inlineMeta}>{row.branchName || 'Toàn Công Ty'}</div>
                </td>
                <td className={styles.metricCell}><strong>{moneyLabel(row.salaryAmount)}</strong></td>
                <td className={styles.metricCell}>{row.payableWorkDays}/{row.standardWorkDays} ngày · {hours(row.confirmedOvertimeMinutes)} giờ OT</td>
                <td className={styles.metricCell}>{moneyLabel(row.incomeTotal)}</td>
                <td className={styles.metricCell}>{moneyLabel(row.reimbursementTotal)}</td>
                <td className={styles.metricCell}>{moneyLabel(row.deductionTotal)}</td>
                <td className={styles.metricCell}><strong>{moneyLabel(row.netPay)}</strong></td>
                <td><button type="button" className={sharedStyles.secondaryButton} onClick={() => setSelectedRow(row)}>Xem chi tiết</button></td>
              </tr>
            ))}
            {!calculation.snapshot.rows.length ? <tr><td colSpan={8}><div className={sharedStyles.emptyState}>Kỳ lương chưa có nhân sự.</div></td></tr> : null}
          </tbody>
        </table>
      </div>

      {selectedRow ? (
        <div className={sharedStyles.modalBackdrop} role="presentation" onMouseDown={() => setSelectedRow(null)}>
          <div className={sharedStyles.modal} role="dialog" aria-modal="true" aria-label="Chi tiết lương" onMouseDown={(event) => event.stopPropagation()}>
            <div className={sharedStyles.modalHeader}>
              <div>
                <p className={sharedStyles.panelKicker}>Chi tiết lương</p>
                <h3>{selectedRow.employeeCode} · {selectedRow.employeeName}</h3>
              </div>
              <button type="button" className={sharedStyles.modalClose} onClick={() => setSelectedRow(null)}>Đóng</button>
            </div>
            <div className={styles.detailGrid}>
              <div className={styles.detailSection}>
                <h4>Lương cố định</h4>
                <div className={styles.detailRow}><span>Mức lương tháng</span><strong>{moneyLabel(selectedRow.monthlySalary)}</strong></div>
                <div className={styles.detailRow}><span>Lương theo công được tính</span><strong>{moneyLabel(selectedRow.salaryAmount)}</strong></div>
              </div>
              <div className={styles.detailSection}>
                <h4>Ngày công & tăng ca</h4>
                <div className={styles.detailRow}><span>Công chuẩn</span><strong>{selectedRow.standardWorkDays} ngày</strong></div>
                <div className={styles.detailRow}><span>Công được tính</span><strong>{selectedRow.payableWorkDays} ngày</strong></div>
                <div className={styles.detailRow}><span>Nghỉ không lương</span><strong>{selectedRow.unpaidLeaveDays} ngày</strong></div>
                <div className={styles.detailRow}><span>Tăng ca đã xác nhận</span><strong>{hours(selectedRow.confirmedOvertimeMinutes)} giờ</strong></div>
              </div>
              <div className={styles.detailSection}>
                <h4>Thưởng & phụ cấp</h4>
                {[...selectedRow.fixedComponents, ...selectedRow.periodComponents].filter((line) => line.category === 'INCOME').map((line) => (
                  <div className={styles.detailRow} key={line.id}><span>{line.name}</span><strong>{componentAmount(line)}</strong></div>
                ))}
                {![...selectedRow.fixedComponents, ...selectedRow.periodComponents].some((line) => line.category === 'INCOME') ? <div className={styles.inlineMeta}>Không có khoản phát sinh.</div> : null}
              </div>
              <div className={styles.detailSection}>
                <h4>Công tác phí & hoàn chi phí</h4>
                {[...selectedRow.fixedComponents, ...selectedRow.periodComponents].filter((line) => line.category === 'REIMBURSEMENT').map((line) => (
                  <div className={styles.detailRow} key={line.id}><span>{line.name}</span><strong>{componentAmount(line)}</strong></div>
                ))}
                {![...selectedRow.fixedComponents, ...selectedRow.periodComponents].some((line) => line.category === 'REIMBURSEMENT') ? <div className={styles.inlineMeta}>Không có khoản hoàn chi.</div> : null}
              </div>
              <div className={styles.detailSection}>
                <h4>Khấu trừ</h4>
                {[...selectedRow.fixedComponents, ...selectedRow.periodComponents].filter((line) => line.category === 'DEDUCTION').map((line) => (
                  <div className={styles.detailRow} key={line.id}><span>{line.name}</span><strong>{componentAmount(line)}</strong></div>
                ))}
                {![...selectedRow.fixedComponents, ...selectedRow.periodComponents].some((line) => line.category === 'DEDUCTION') ? <div className={styles.inlineMeta}>Không có khoản khấu trừ.</div> : null}
              </div>
              <div className={styles.detailSection}>
                <h4>Thực nhận</h4>
                <div className={styles.detailRow}><span>Tổng thu nhập lương</span><strong>{moneyLabel(selectedRow.grossIncome)}</strong></div>
                <div className={styles.detailRow}><span>Hoàn chi phí</span><strong>{moneyLabel(selectedRow.reimbursementTotal)}</strong></div>
                <div className={styles.detailRow}><span>Khấu trừ</span><strong>{moneyLabel(selectedRow.deductionTotal)}</strong></div>
                <div className={styles.detailRow}><span>Thực nhận</span><strong>{moneyLabel(selectedRow.netPay)}</strong></div>
              </div>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}
