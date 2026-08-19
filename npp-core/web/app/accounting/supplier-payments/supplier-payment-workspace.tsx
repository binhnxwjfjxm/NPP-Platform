'use client';

import { useMemo, useRef, useState } from 'react';
import {
  BusinessTableSequenceCell,
  BusinessTableSequenceHeader,
} from '../../components/business-table-sequence';
import type { Supplier } from '../../../lib/supplier-types';
import type { Warehouse } from '../../../lib/organization-types';
import type {
  AllocationTarget,
  PayableAllocation,
  SupplierPayment,
  SupplierPaymentDraft,
} from '../../../lib/supplier-payment-types';
import styles from './supplier-payments.module.css';

type Props = {
  initialPayments: SupplierPayment[];
  initialTargets: AllocationTarget[];
  suppliers: Supplier[];
  warehouses: Warehouse[];
  initialPaymentDate: string;
  initialError: string | null;
};

type ApiEnvelope<T> = {
  data?: T;
  error?: { code?: string; message?: string; retryable?: boolean };
};

const SCALE = 1_000_000n;
const DECIMAL_PATTERN = /^(0|[1-9]\d{0,13})(?:\.(\d{1,6}))?$/;

function decimalToScaled(value: string): bigint | null {
  const match = DECIMAL_PATTERN.exec(String(value ?? '').trim());
  if (!match) return null;
  return BigInt(match[1]) * SCALE + BigInt((match[2] ?? '').padEnd(6, '0'));
}

function scaledToDecimal(value: bigint): string {
  return `${value / SCALE}.${String(value % SCALE).padStart(6, '0')}`;
}

function money(value: string, currencyCode = 'VND') {
  const normalized = String(value ?? '').trim();
  const match = /^(-?)(\d+)(?:\.(\d{1,6}))?$/.exec(normalized);
  if (!match) return `${value} ${currencyCode}`;
  const fraction = (match[3] ?? '').replace(/0+$/, '');
  const whole = new Intl.NumberFormat('vi-VN').format(BigInt(match[2]));
  return `${match[1]}${whole}${fraction ? `,${fraction}` : ''} ${currencyCode}`;
}

function statusLabel(status: SupplierPayment['status']) {
  return {
    open: 'Chưa phân bổ',
    partially_allocated: 'Đã phân bổ một phần',
    settled: 'Đã phân bổ hết',
    reversed: 'Đã đảo',
  }[status];
}

async function readResponse<T>(response: Response): Promise<T> {
  const payload = await response.json() as ApiEnvelope<T>;
  if (!response.ok || !Object.prototype.hasOwnProperty.call(payload, 'data')) {
    throw new Error(payload.error?.message || 'Yêu cầu không thành công');
  }
  return payload.data as T;
}

export default function SupplierPaymentWorkspace({
  initialPayments,
  initialTargets,
  suppliers,
  warehouses,
  initialPaymentDate,
  initialError,
}: Props) {
  const [payments, setPayments] = useState(initialPayments);
  const [targets, setTargets] = useState(initialTargets);
  const [selectedId, setSelectedId] = useState(initialPayments[0]?.id ?? '');
  const [detail, setDetail] = useState<SupplierPayment | null>(initialPayments[0] ?? null);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState(initialError ?? '');
  const [paymentForm, setPaymentForm] = useState<SupplierPaymentDraft>({
    supplierId: suppliers[0]?.id ?? '',
    warehouseId: warehouses[0]?.id ?? '',
    paymentDate: initialPaymentDate,
    currencyCode: 'VND',
    paymentMethod: 'BANK_TRANSFER',
    amount: '',
    externalReference: '',
    note: '',
  });
  const [targetId, setTargetId] = useState('');
  const [allocationAmount, setAllocationAmount] = useState('');
  const [allocationDate, setAllocationDate] = useState(initialPaymentDate);
  const [reversalReason, setReversalReason] = useState('');
  const mutationKeys = useRef(new Map<string, string>());

  function keyFor(prefix: string, payload: unknown) {
    const slot = `${prefix}:${JSON.stringify(payload)}`;
    const existing = mutationKeys.current.get(slot);
    if (existing) return { key: existing, slot };
    const key = `${prefix}-${crypto.randomUUID()}`;
    mutationKeys.current.set(slot, key);
    return { key, slot };
  }

  const selected = detail?.id === selectedId
    ? detail
    : payments.find((payment) => payment.id === selectedId) ?? null;
  const matchingTargets = useMemo(() => targets.filter((target) => (
    selected
      && target.supplierId === selected.supplierId
      && target.warehouseId === selected.warehouseId
      && target.currencyCode === selected.currencyCode
      && (decimalToScaled(target.remainingAmount) ?? 0n) > 0n
  )), [targets, selected]);
  const selectedTarget = matchingTargets.find((target) => target.id === targetId) ?? null;
  const selectedRemaining = selected ? decimalToScaled(selected.remainingAmount) : null;
  const targetRemaining = selectedTarget ? decimalToScaled(selectedTarget.remainingAmount) : null;
  const maximumAllocation = selectedRemaining !== null && targetRemaining !== null
    ? (selectedRemaining < targetRemaining ? selectedRemaining : targetRemaining)
    : 0n;
  const enteredAllocation = decimalToScaled(allocationAmount);
  const allocationValid = enteredAllocation !== null
    && enteredAllocation > 0n
    && enteredAllocation <= maximumAllocation;
  const hasActiveAllocations = selected?.allocations?.some((item) => !item.reversed) ?? false;
  const hasAllocatedAmount = selected
    ? (decimalToScaled(selected.allocatedAmount) ?? 0n) > 0n
    : false;

  async function refresh(nextSelectedId = selectedId) {
    const [paymentResponse, targetResponse] = await Promise.all([
      fetch('/api/supplier-payments?limit=1000', { cache: 'no-store' }),
      fetch('/api/supplier-payments/allocation-targets', { cache: 'no-store' }),
    ]);
    const nextPayments = await readResponse<SupplierPayment[]>(paymentResponse);
    const nextTargets = await readResponse<AllocationTarget[]>(targetResponse);
    setPayments(nextPayments);
    setTargets(nextTargets);
    if (nextSelectedId) {
      const detailResponse = await fetch(`/api/supplier-payments/${nextSelectedId}`, { cache: 'no-store' });
      setDetail(detailResponse.ok ? await readResponse<SupplierPayment>(detailResponse) : null);
    }
  }

  async function selectPayment(id: string) {
    setSelectedId(id);
    setTargetId('');
    setAllocationAmount('');
    setMessage('');
    try {
      const response = await fetch(`/api/supplier-payments/${id}`, { cache: 'no-store' });
      setDetail(await readResponse<SupplierPayment>(response));
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'Không tải được chi tiết phiếu thanh toán.');
    }
  }

  async function createPayment(event: React.FormEvent) {
    event.preventDefault();
    setBusy(true);
    setMessage('');
    const mutation = keyFor('payment', paymentForm);
    try {
      const response = await fetch('/api/supplier-payments', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Idempotency-Key': mutation.key },
        body: JSON.stringify(paymentForm),
      });
      const created = await readResponse<SupplierPayment>(response);
      mutationKeys.current.delete(mutation.slot);
      setSelectedId(created.id);
      setDetail(created);
      setPaymentForm((current) => ({ ...current, amount: '', externalReference: '', note: '' }));
      await refresh(created.id);
      setMessage(`Đã ghi nhận phiếu ${created.documentNumber}.`);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'Không ghi nhận được thanh toán.');
    } finally {
      setBusy(false);
    }
  }

  async function allocatePayment(event: React.FormEvent) {
    event.preventDefault();
    if (!selected || !selectedTarget || !allocationValid) return;
    const payload = {
      sourcePayableDocumentId: selected.id,
      targetPayableDocumentId: selectedTarget.id,
      amount: scaledToDecimal(enteredAllocation),
      allocationDate,
    };
    const mutation = keyFor('allocation', payload);
    setBusy(true);
    setMessage('');
    try {
      const response = await fetch('/api/payable-allocations', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Idempotency-Key': mutation.key },
        body: JSON.stringify(payload),
      });
      await readResponse<PayableAllocation>(response);
      mutationKeys.current.delete(mutation.slot);
      setAllocationAmount('');
      setTargetId('');
      await refresh(selected.id);
      setMessage('Đã phân bổ thanh toán vào chứng từ phải trả.');
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'Không phân bổ được thanh toán.');
    } finally {
      setBusy(false);
    }
  }

  async function reverseAllocation(allocation: PayableAllocation) {
    const reason = reversalReason.trim();
    if (!reason) {
      setMessage('Nhập lý do đảo trước khi thực hiện.');
      return;
    }
    const payload = { reason };
    const mutation = keyFor(`allocation-reverse-${allocation.id}`, payload);
    setBusy(true);
    setMessage('');
    try {
      const response = await fetch(`/api/payable-allocations/${allocation.id}/reverse`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Idempotency-Key': mutation.key },
        body: JSON.stringify(payload),
      });
      await readResponse<PayableAllocation>(response);
      mutationKeys.current.delete(mutation.slot);
      await refresh(selectedId);
      setMessage('Đã đảo phân bổ công nợ.');
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'Không đảo được phân bổ.');
    } finally {
      setBusy(false);
    }
  }

  async function reversePayment() {
    const reason = reversalReason.trim();
    if (!selected || !reason) {
      setMessage('Chọn phiếu và nhập lý do đảo trước khi thực hiện.');
      return;
    }
    const payload = { reason };
    const mutation = keyFor(`payment-reverse-${selected.id}`, payload);
    setBusy(true);
    setMessage('');
    try {
      const response = await fetch(`/api/supplier-payments/${selected.id}/reverse`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Idempotency-Key': mutation.key },
        body: JSON.stringify(payload),
      });
      const reversed = await readResponse<SupplierPayment>(response);
      mutationKeys.current.delete(mutation.slot);
      await refresh(reversed.id);
      setMessage(`Đã đảo phiếu ${reversed.documentNumber}.`);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'Không đảo được phiếu thanh toán.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className={styles.workspace} data-testid="supplier-payments-page">
      {message ? <div className={styles.notice} role="status">{message}</div> : null}

      <section className={styles.card}>
        <h2>Ghi nhận thanh toán</h2>
        <form className={styles.formGrid} onSubmit={createPayment} data-testid="supplier-payment-form">
          <label>Nhà cung cấp<select value={paymentForm.supplierId} required onChange={(event) => setPaymentForm({ ...paymentForm, supplierId: event.target.value })}><option value="">Chọn nhà cung cấp</option>{suppliers.map((supplier) => <option key={supplier.id} value={supplier.id}>{supplier.code} · {supplier.name}</option>)}</select></label>
          <label>Kho<select value={paymentForm.warehouseId} required onChange={(event) => setPaymentForm({ ...paymentForm, warehouseId: event.target.value })}><option value="">Chọn kho</option>{warehouses.map((warehouse) => <option key={warehouse.id} value={warehouse.id}>{warehouse.code} · {warehouse.name}</option>)}</select></label>
          <label>Ngày thanh toán<input type="date" required value={paymentForm.paymentDate} onChange={(event) => setPaymentForm({ ...paymentForm, paymentDate: event.target.value })} /></label>
          <label>Số tiền<input inputMode="decimal" required value={paymentForm.amount} placeholder="0" onChange={(event) => setPaymentForm({ ...paymentForm, amount: event.target.value })} /></label>
          <label>Phương thức<select value={paymentForm.paymentMethod} onChange={(event) => setPaymentForm({ ...paymentForm, paymentMethod: event.target.value })}><option value="BANK_TRANSFER">Chuyển khoản</option><option value="CASH">Tiền mặt</option><option value="OTHER">Khác</option></select></label>
          <label>Tham chiếu ngân hàng<input value={paymentForm.externalReference ?? ''} maxLength={256} onChange={(event) => setPaymentForm({ ...paymentForm, externalReference: event.target.value })} /></label>
          <label className={styles.wide}>Ghi chú<textarea value={paymentForm.note ?? ''} maxLength={4000} onChange={(event) => setPaymentForm({ ...paymentForm, note: event.target.value })} /></label>
          <button type="submit" disabled={busy}>Ghi nhận thanh toán</button>
        </form>
      </section>

      <div className={styles.columns}>
        <section className={styles.card}>
          <h2>Phiếu thanh toán</h2>
          <div className={styles.tableWrap}><table className={styles.table} data-testid="supplier-payments-table"><thead><tr><BusinessTableSequenceHeader /><th>Số phiếu</th><th>Nhà cung cấp</th><th className={styles.amount}>Số tiền</th><th>Trạng thái</th></tr></thead><tbody>{payments.map((payment, rowIndex) => <tr key={payment.id} className={payment.id === selectedId ? styles.selected : undefined}><BusinessTableSequenceCell rowIndex={rowIndex} /><td><button type="button" className={styles.linkButton} onClick={() => selectPayment(payment.id)}>{payment.documentNumber}</button><br /><span>{payment.paymentDate}</span></td><td>{payment.supplierCode}<br /><span>{payment.supplierName}</span></td><td className={styles.amount}>{money(payment.originalAmount, payment.currencyCode)}<br /><span>Còn {money(payment.remainingAmount, payment.currencyCode)}</span></td><td>{statusLabel(payment.status)}</td></tr>)}{!payments.length ? <tr><td colSpan={5}>Chưa có phiếu thanh toán.</td></tr> : null}</tbody></table></div>
        </section>

        <section className={styles.card} data-testid="supplier-payment-detail">
          <h2>Chi tiết và phân bổ</h2>
          {!selected ? <p>Chọn một phiếu thanh toán để xem chi tiết.</p> : <>
            <div className={styles.summary}><strong>{selected.documentNumber}</strong><span>{selected.supplierCode} · {selected.supplierName}</span><span>{money(selected.remainingAmount, selected.currencyCode)} chưa phân bổ</span></div>
            {selected.status !== 'reversed' && (selectedRemaining ?? 0n) > 0n ? <form className={styles.allocationForm} onSubmit={allocatePayment} data-testid="supplier-payment-allocation-form">
              <label>Chứng từ phải trả<select value={targetId} required onChange={(event) => { setTargetId(event.target.value); setAllocationAmount(''); }}><option value="">Chọn chứng từ</option>{matchingTargets.map((target) => <option key={target.id} value={target.id}>{target.documentNumber} · còn {money(target.remainingAmount, target.currencyCode)}</option>)}</select></label>
              <label>Ngày phân bổ<input type="date" required value={allocationDate} onChange={(event) => setAllocationDate(event.target.value)} /></label>
              <label>Số tiền phân bổ<input inputMode="decimal" required value={allocationAmount} onChange={(event) => setAllocationAmount(event.target.value)} placeholder={maximumAllocation > 0n ? scaledToDecimal(maximumAllocation) : '0'} /></label>
              <button type="submit" disabled={busy || !selectedTarget || !allocationValid}>Phân bổ</button>
            </form> : null}
            <label className={styles.reason}>Lý do đảo<textarea value={reversalReason} maxLength={2000} onChange={(event) => setReversalReason(event.target.value)} placeholder="Bắt buộc khi đảo phân bổ hoặc phiếu" /></label>
            <div className={styles.actions}><button type="button" disabled={busy || selected.status === 'reversed' || hasActiveAllocations || hasAllocatedAmount} onClick={reversePayment}>Đảo phiếu thanh toán</button></div>
            <h3>Lịch sử phân bổ</h3>
            <div className={styles.tableWrap}><table className={styles.table} data-testid="supplier-payment-allocations-table"><thead><tr><th>Chứng từ đích</th><th>Ngày</th><th className={styles.amount}>Số tiền</th><th>Trạng thái</th><th /></tr></thead><tbody>{selected.allocations.map((allocation) => <tr key={allocation.id}><td>{allocation.targetDocumentNumber}</td><td>{allocation.allocationDate}</td><td className={styles.amount}>{money(allocation.amount, selected.currencyCode)}</td><td>{allocation.reversed ? 'Đã đảo' : 'Hiệu lực'}</td><td>{!allocation.reversed ? <button type="button" disabled={busy} onClick={() => reverseAllocation(allocation)}>Đảo</button> : null}</td></tr>)}{!selected.allocations.length ? <tr><td colSpan={5}>Chưa có phân bổ.</td></tr> : null}</tbody></table></div>
          </>}
        </section>
      </div>
    </div>
  );
}
