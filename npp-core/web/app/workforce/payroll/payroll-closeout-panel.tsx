'use client';

import { useMemo, useState } from 'react';
import sharedStyles from '../../organization/organization.module.css';
import styles from '../overtime/overtime.module.css';

type Period = {
  id: string;
  status: 'AGGREGATING' | 'NEEDS_ACTION' | 'RECONCILED' | 'CLOSED';
  period_start: string;
  period_end: string;
  branch_name?: string | null;
} | null;

type ComponentType = {
  id: string;
  code: string;
  name: string;
  category: 'INCOME' | 'DEDUCTION' | 'REIMBURSEMENT';
  include_in_gross: boolean;
  include_in_net: boolean;
};

type Pay = {
  employeeId: string;
  employeeCode: string;
  employeeName: string;
  branchName?: string | null;
  standardWorkDays: number;
  payableWorkDays: number;
  confirmedOvertimeMinutes: number;
  salaryAmount: string;
  incomeTotal: string;
  reimbursementTotal: string;
  deductionTotal: string;
  grossIncome: string;
  netPay: string;
};

export type PayrollPayslipSnapshot = {
  id: string;
  payroll_period_id: string;
  employee_id: string;
  revision: number;
  source_kind: 'CLOSE' | 'ADJUSTMENT';
  created_at: string;
  snapshot: {
    period: { from: string; to: string; currencyCode?: string };
    employee: { id: string; code: string; name: string; branchName?: string | null };
    pay: Pay;
    adjustments?: Array<{
      id: string;
      name: string;
      category: 'INCOME' | 'DEDUCTION' | 'REIMBURSEMENT';
      direction: 'ADD' | 'REVERSE';
      amount: string;
      reason: string;
      createdBy?: string;
    }>;
  };
};

export type PayrollCloseSnapshot = {
  id: string;
  payroll_period_id: string;
  calculation_revision: number;
  created_at: string;
  snapshot: {
    period: { from: string; to: string; branchId?: string | null; currencyCode?: string };
    totals: {
      employeeCount: number;
      grossIncome: string;
      reimbursementTotal: string;
      deductionTotal: string;
      netPay: string;
    };
  };
};

export type PayrollCloseoutData = {
  closeSnapshot: PayrollCloseSnapshot | null;
  payslips: PayrollPayslipSnapshot[];
  payslipHistory: PayrollPayslipSnapshot[];
  adjustments: Array<{
    id: string;
    employee_id: string;
    component_name: string;
    direction: 'ADD' | 'REVERSE';
    amount: string;
    reason: string;
    resulting_revision: number;
    created_by: string;
    created_at: string;
  }>;
  history: PayrollCloseSnapshot[];
};

function moneyLabel(value: string | null | undefined) {
  const raw = String(value ?? '0').trim();
  const [wholeRaw, fractionRaw = ''] = raw.split('.');
  const negative = wholeRaw.startsWith('-');
  const digits = negative ? wholeRaw.slice(1) : wholeRaw;
  const grouped = digits.replace(/\B(?=(\d{3})+(?!\d))/g, '.');
  const fraction = fractionRaw.replace(/0+$/, '');
  return `${negative ? '-' : ''}${grouped}${fraction ? ',' + fraction : ''} ₫`;
}
function dateLabel(value: string | null | undefined) {
  if (!value) return '—';
  const raw = String(value).slice(0, 10);
  const [year, month, day] = raw.split('-');
  return year && month && day ? `${day}/${month}/${year}` : String(value);
}
function periodLabel(period: { from: string; to: string }) {
  return `${dateLabel(period.from)} – ${dateLabel(period.to)}`;
}
function hours(minutes: number) {
  return (Number(minutes ?? 0) / 60).toLocaleString('vi-VN', { maximumFractionDigits: 2 });
}

export function PayrollCloseoutPanel({
  mode,
  period,
  closeout,
  componentTypes,
  canClose,
  canAdjust,
  canExport,
  busy,
  onClose,
  onAdjust,
  onOpenPeriod,
}: {
  mode: 'closeout' | 'payslips' | 'history';
  period: Period;
  closeout: PayrollCloseoutData | null;
  componentTypes: ComponentType[];
  canClose: boolean;
  canAdjust: boolean;
  canExport: boolean;
  busy: boolean;
  onClose: () => Promise<void>;
  onAdjust: (input: { employeeId: string; componentTypeId: string; direction: 'ADD' | 'REVERSE'; amount: string; reason: string }) => Promise<void>;
  onOpenPeriod: (periodId: string) => void;
}) {
  const [selectedEmployeeId, setSelectedEmployeeId] = useState('');
  const [componentTypeId, setComponentTypeId] = useState('');
  const [direction, setDirection] = useState<'ADD' | 'REVERSE'>('ADD');
  const [amount, setAmount] = useState('');
  const [reason, setReason] = useState('');

  const selectedPayslip = useMemo(
    () => closeout?.payslips.find((item) => item.employee_id === selectedEmployeeId) ?? null,
    [closeout, selectedEmployeeId],
  );
  const revisions = useMemo(
    () => (closeout?.payslipHistory ?? []).filter((item) => item.employee_id === selectedEmployeeId).sort((a, b) => b.revision - a.revision),
    [closeout, selectedEmployeeId],
  );

  if (mode === 'closeout') {
    if (!period) return null;
    if (period.status === 'CLOSED') {
      return <div className={`${sharedStyles.banner} ${sharedStyles.bannerSuccess}`}>Kỳ lương đã chốt. Mọi thay đổi sau chốt được ghi bằng Điều chỉnh lương và giữ nguyên phiếu cũ.</div>;
    }
    if (period.status !== 'RECONCILED') {
      return <div className={sharedStyles.emptyState}>Kỳ lương phải được đối soát trên bản tổng hợp hiện tại trước khi chốt.</div>;
    }
    return (
      <div className={styles.actions}>
        <span className={styles.inlineMeta}>Chốt sẽ tạo hồ sơ kỳ và phiếu lương bất biến cho từng nhân sự.</span>
        {canClose ? <button type="button" className={sharedStyles.primaryButton} disabled={busy} onClick={() => void onClose()}>Chốt lương</button> : null}
      </div>
    );
  }

  if (mode === 'history') {
    return (
      <section className={sharedStyles.tableSection}>
        <div className={sharedStyles.sectionHeader}>
          <div><p className={sharedStyles.panelKicker}>Lịch sử</p><h2>Kỳ lương đã chốt</h2></div>
          <span className={sharedStyles.panelChip}>Đọc từ hồ sơ kỳ đã chốt</span>
        </div>
        <div className={sharedStyles.tableWrap}>
          <table className={sharedStyles.table}>
            <thead><tr><th>Kỳ</th><th>Nhân sự</th><th>Tổng thu nhập</th><th>Khấu trừ</th><th>Thực nhận</th><th>Xử lý</th></tr></thead>
            <tbody>
              {(closeout?.history ?? []).map((item) => (
                <tr key={item.id}>
                  <td>{periodLabel(item.snapshot.period)}</td>
                  <td>{item.snapshot.totals.employeeCount}</td>
                  <td>{moneyLabel(item.snapshot.totals.grossIncome)}</td>
                  <td>{moneyLabel(item.snapshot.totals.deductionTotal)}</td>
                  <td><strong>{moneyLabel(item.snapshot.totals.netPay)}</strong></td>
                  <td><button type="button" className={sharedStyles.secondaryButton} onClick={() => onOpenPeriod(item.payroll_period_id)}>Mở kỳ</button></td>
                </tr>
              ))}
              {!closeout?.history?.length ? <tr><td colSpan={6}><div className={sharedStyles.emptyState}>Chưa có kỳ lương đã chốt.</div></td></tr> : null}
            </tbody>
          </table>
        </div>
      </section>
    );
  }

  if (!period || period.status !== 'CLOSED' || !closeout?.closeSnapshot) {
    return (
      <section className={sharedStyles.tableSection}>
        <div className={sharedStyles.sectionHeader}><div><p className={sharedStyles.panelKicker}>Phiếu lương</p><h2>Phiếu lương nhân sự</h2></div></div>
        <div className={sharedStyles.emptyState}>Phiếu lương chỉ xuất hiện sau khi kỳ lương được chốt.</div>
      </section>
    );
  }

  async function submitAdjustment(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!selectedPayslip || !componentTypeId) return;
    await onAdjust({
      employeeId: selectedPayslip.employee_id,
      componentTypeId,
      direction,
      amount,
      reason,
    });
    setAmount('');
    setReason('');
  }

  return (
    <section className={sharedStyles.tableSection}>
      <div className={sharedStyles.sectionHeader}>
        <div><p className={sharedStyles.panelKicker}>Phiếu lương</p><h2>Phiếu lương kỳ {periodLabel(closeout.closeSnapshot.snapshot.period)}</h2></div>
        <div className={styles.actions}>
          {canExport ? <a className={sharedStyles.secondaryButton} href={`/api/workforce/payroll/export?periodId=${period.id}`}>Xuất Excel</a> : null}
          <span className={sharedStyles.panelChip}>Đã chốt</span>
        </div>
      </div>
      <div className={sharedStyles.tableWrap}>
        <table className={sharedStyles.table}>
          <thead><tr><th>Nhân sự</th><th>Thu nhập</th><th>Hoàn chi</th><th>Khấu trừ</th><th>Thực nhận</th><th>Phiên bản</th><th>Xử lý</th></tr></thead>
          <tbody>
            {closeout.payslips.map((item) => (
              <tr key={item.id}>
                <td>{item.snapshot.employee.code} · {item.snapshot.employee.name}</td>
                <td>{moneyLabel(item.snapshot.pay.grossIncome)}</td>
                <td>{moneyLabel(item.snapshot.pay.reimbursementTotal)}</td>
                <td>{moneyLabel(item.snapshot.pay.deductionTotal)}</td>
                <td><strong>{moneyLabel(item.snapshot.pay.netPay)}</strong></td>
                <td>Lần {item.revision}</td>
                <td><button type="button" className={sharedStyles.secondaryButton} onClick={() => { setSelectedEmployeeId(item.employee_id); if (!componentTypeId && componentTypes[0]) setComponentTypeId(componentTypes[0].id); }}>Xem phiếu lương</button></td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {selectedPayslip ? (
        <div className={sharedStyles.modalBackdrop} role="presentation" onMouseDown={() => setSelectedEmployeeId('')}>
          <div className={sharedStyles.modal} role="dialog" aria-modal="true" aria-label="Phiếu lương" onMouseDown={(event) => event.stopPropagation()}>
            <div className={sharedStyles.modalHeader}>
              <div><p className={sharedStyles.panelKicker}>Phiếu lương</p><h3>{selectedPayslip.snapshot.employee.code} · {selectedPayslip.snapshot.employee.name}</h3></div>
              <button type="button" className={sharedStyles.modalClose} onClick={() => setSelectedEmployeeId('')}>Đóng</button>
            </div>
            <div className={styles.detailGrid}>
              <div className={styles.detailSection}>
                <h4>Kỳ lương</h4>
                <div className={styles.detailRow}><span>Thời gian</span><strong>{periodLabel(selectedPayslip.snapshot.period)}</strong></div>
                <div className={styles.detailRow}><span>Công được tính</span><strong>{selectedPayslip.snapshot.pay.payableWorkDays}/{selectedPayslip.snapshot.pay.standardWorkDays} ngày</strong></div>
                <div className={styles.detailRow}><span>Tăng ca đã xác nhận</span><strong>{hours(selectedPayslip.snapshot.pay.confirmedOvertimeMinutes)} giờ</strong></div>
              </div>
              <div className={styles.detailSection}>
                <h4>Số tiền</h4>
                <div className={styles.detailRow}><span>Lương theo công</span><strong>{moneyLabel(selectedPayslip.snapshot.pay.salaryAmount)}</strong></div>
                <div className={styles.detailRow}><span>Tổng thu nhập</span><strong>{moneyLabel(selectedPayslip.snapshot.pay.grossIncome)}</strong></div>
                <div className={styles.detailRow}><span>Hoàn chi phí</span><strong>{moneyLabel(selectedPayslip.snapshot.pay.reimbursementTotal)}</strong></div>
                <div className={styles.detailRow}><span>Khấu trừ</span><strong>{moneyLabel(selectedPayslip.snapshot.pay.deductionTotal)}</strong></div>
                <div className={styles.detailRow}><span>Thực nhận</span><strong>{moneyLabel(selectedPayslip.snapshot.pay.netPay)}</strong></div>
              </div>
              {canExport ? <div className={styles.actions}><a className={sharedStyles.primaryButton} href={`/api/workforce/payroll/payslip-pdf?periodId=${period.id}&employeeId=${selectedPayslip.employee_id}`}>Xuất PDF</a></div> : null}

              <div className={styles.detailSection}>
                <h4>Lịch sử phiếu lương</h4>
                {revisions.map((item) => <div className={styles.detailRow} key={item.id}><span>Lần {item.revision} · {item.source_kind === 'CLOSE' ? 'Chốt kỳ' : 'Điều chỉnh'}</span><strong>{moneyLabel(item.snapshot.pay.netPay)}</strong></div>)}
              </div>

              {canAdjust ? (
                <form className={styles.detailSection} onSubmit={(event) => void submitAdjustment(event)}>
                  <h4>Điều chỉnh lương sau chốt</h4>
                  <label>
                    Khoản điều chỉnh
                    <select required value={componentTypeId} onChange={(event) => setComponentTypeId(event.target.value)}>
                      <option value="">Chọn khoản</option>
                      {componentTypes.map((item) => <option value={item.id} key={item.id}>{item.name}</option>)}
                    </select>
                  </label>
                  <label>
                    Cách điều chỉnh
                    <select value={direction} onChange={(event) => setDirection(event.target.value as 'ADD' | 'REVERSE')}>
                      <option value="ADD">Ghi thêm</option>
                      <option value="REVERSE">Ghi giảm / hoàn lại</option>
                    </select>
                  </label>
                  <label>Số tiền<input required inputMode="decimal" value={amount} onChange={(event) => setAmount(event.target.value)} placeholder="0" /></label>
                  <label>Lý do<textarea required maxLength={1000} value={reason} onChange={(event) => setReason(event.target.value)} placeholder="Nêu rõ nguyên nhân điều chỉnh" /></label>
                  <div className={styles.actions}><button type="submit" className={sharedStyles.primaryButton} disabled={busy || !componentTypeId || !amount || !reason.trim()}>Ghi điều chỉnh</button></div>
                </form>
              ) : null}
            </div>
          </div>
        </div>
      ) : null}
    </section>
  );
}
