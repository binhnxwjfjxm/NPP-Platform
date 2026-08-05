'use client';

import { useMemo, useRef, useState } from 'react';
import type { Customer } from '../../../lib/customer-types';
import type { Warehouse } from '../../../lib/organization-types';
import type {
  CustomerPayment,
  CustomerPaymentAllocationDraft,
  CustomerPaymentDraft,
  ReceivableAllocation,
  ReceivableAllocationTarget,
} from '../../../lib/customer-payment-types';
import styles from '../supplier-payments/supplier-payments.module.css';

type Props = {
  initialPayments: CustomerPayment[];
  initialTargets: ReceivableAllocationTarget[];
  customers: Customer[];
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
  const negative = value < 0n;
  const absolute = negative ? -value : value;
  return `${negative ? '-' : ''}${absolute / SCALE}.${String(absolute % SCALE).padStart(6, '0')}`;
}

function money(value: string, currencyCode = 'VND') {
  const normalized = String(value ?? '').trim();
  const match = /^(-?)(\d+)(?:\.(\d{1,6}))?$/.exec(normalized);
  if (!match) return `${value} ${currencyCode}`;
  const fraction = (match[3] ?? '').replace(/0+$/, '');
  const whole = new Intl.NumberFormat('vi-VN').format(BigInt(match[2]));
  return `${match[1]}${whole}${fraction ? `,${fraction}` : ''} ${currencyCode}`;
}

function statusLabel(status: CustomerPayment['status']) {
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

function allocationRows(
  values: Record<string, string>,
  targets: ReceivableAllocationTarget[],
): CustomerPaymentAllocationDraft[] {
  const targetIds = new Set(targets.map((target) => target.id));
  return Object.entries(values)
    .filter(([id, amount]) => targetIds.has(id) && (decimalToScaled(amount) ?? 0n) > 0n)
    .map(([receivableDocumentId, amount]) => ({ receivableDocumentId, amount }))
    .sort((left, right) => left.receivableDocumentId.localeCompare(right.receivableDocumentId));
}

function allocationTotal(rows: CustomerPaymentAllocationDraft[]): bigint {
  return rows.reduce((total, row) => total + (decimalToScaled(row.amount) ?? 0n), 0n);
}

function allocationsWithinTargets(
  rows: CustomerPaymentAllocationDraft[],
  targets: ReceivableAllocationTarget[],
): boolean {
  const byId = new Map(targets.map((target) => [target.id, target]));
  return rows.every((row) => {
    const amount = decimalToScaled(row.amount);
    const remaining = decimalToScaled(byId.get(row.receivableDocumentId)?.remainingAmount ?? '');
    return amount !== null && amount > 0n && remaining !== null && amount <= remaining;
  });
}

export default function CustomerPaymentWorkspace({
  initialPayments,
  initialTargets,
  customers,
  warehouses,
  initialPaymentDate,
  initialError,
}: Props) {
  const [payments, setPayments] = useState(initialPayments);
  const [targets, setTargets] = useState(initialTargets);
  const [selectedId, setSelectedId] = useState(initialPayments[0]?.id ?? '');
  const [detail, setDetail] = useState<CustomerPayment | null>(initialPayments[0] ?? null);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState(initialError ?? '');
  const [paymentForm, setPaymentForm] = useState<CustomerPaymentDraft>({
    customerId: customers[0]?.id ?? '',
    warehouseId: warehouses[0]?.id ?? '',
    paymentDate: initialPaymentDate,
    currencyCode: 'VND',
    paymentMethod: 'BANK_TRANSFER',
    amount: '',
    externalReference: '',
    note: '',
  });
  const [createAmounts, setCreateAmounts] = useState<Record<string, string>>({});
  const [existingAmounts, setExistingAmounts] = useState<Record<string, string>>({});
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

  const createTargets = useMemo(() => targets.filter((target) => (
    target.customerId === paymentForm.customerId
    && target.currencyCode === paymentForm.currencyCode
    && (decimalToScaled(target.remainingAmount) ?? 0n) > 0n
  )), [targets, paymentForm.customerId, paymentForm.currencyCode]);

  const existingTargets = useMemo(() => targets.filter((target) => (
    selected
    && target.customerId === selected.customerId
    && target.currencyCode === selected.currencyCode
    && (decimalToScaled(target.remainingAmount) ?? 0n) > 0n
  )), [targets, selected]);

  const createRows = allocationRows(createAmounts, createTargets);
  const createTotal = allocationTotal(createRows);
  const paymentAmount = decimalToScaled(paymentForm.amount);
  const createAllocationValid = allocationsWithinTargets(createRows, createTargets)
    && paymentAmount !== null
    && createTotal <= paymentAmount;

  const existingRows = allocationRows(existingAmounts, existingTargets);
  const existingTotal = allocationTotal(existingRows);
  const selectedRemaining = selected ? decimalToScaled(selected.remainingAmount) : null;
  const existingAllocationValid = existingRows.length > 0
    && allocationsWithinTargets(existingRows, existingTargets)
    && selectedRemaining !== null
    && existingTotal <= selectedRemaining;

  const hasActiveAllocations = selected?.allocations?.some((item) => !item.reversed) ?? false;
  const hasAllocatedAmount = selected
    ? (decimalToScaled(selected.allocatedAmount) ?? 0n) > 0n
    : false;

  async function refresh(nextSelectedId = selectedId) {
    const [paymentResponse, targetResponse] = await Promise.all([
      fetch('/api/customer-payments?limit=1000', { cache: 'no-store' }),
      fetch('/api/customer-payments/allocation-targets', { cache: 'no-store' }),
    ]);
    const nextPayments = await readResponse<CustomerPayment[]>(paymentResponse);
    const nextTargets = await readResponse<ReceivableAllocationTarget[]>(targetResponse);
    setPayments(nextPayments);
    setTargets(nextTargets);
    if (nextSelectedId) {
      const detailResponse = await fetch(`/api/customer-payments/${nextSelectedId}`, {
        cache: 'no-store',
      });
      setDetail(detailResponse.ok
        ? await readResponse<CustomerPayment>(detailResponse)
        : null);
    }
  }

  async function selectPayment(id: string) {
    setSelectedId(id);
    setExistingAmounts({});
    setMessage('');
    try {
      const response = await fetch(`/api/customer-payments/${id}`, { cache: 'no-store' });
      setDetail(await readResponse<CustomerPayment>(response));
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'Không tải được chi tiết phiếu thu.');
    }
  }

  async function createPayment(event: React.FormEvent) {
    event.preventDefault();
    if (paymentAmount === null || paymentAmount <= 0n || !createAllocationValid) {
      setMessage('Kiểm tra số tiền thu và tổng phân bổ trước khi ghi nhận.');
      return;
    }
    const payload: CustomerPaymentDraft = {
      ...paymentForm,
      allocations: createRows.length ? createRows : undefined,
    };
    const mutation = keyFor('customer-payment', payload);
    setBusy(true);
    setMessage('');
    try {
      const response = await fetch('/api/customer-payments', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Idempotency-Key': mutation.key },
        body: JSON.stringify(payload),
      });
      const created = await readResponse<CustomerPayment>(response);
      mutationKeys.current.delete(mutation.slot);
      setSelectedId(created.id);
      setDetail(created);
      setCreateAmounts({});
      setPaymentForm((current) => ({
        ...current,
        amount: '',
        externalReference: '',
        note: '',
      }));
      await refresh(created.id);
      setMessage(`Đã ghi nhận phiếu thu ${created.documentNumber}.`);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'Không ghi nhận được tiền khách trả.');
    } finally {
      setBusy(false);
    }
  }

  async function allocateSelectedPayment(event: React.FormEvent) {
    event.preventDefault();
    if (!selected || !existingAllocationValid) {
      setMessage('Chọn ít nhất một khoản nợ và kiểm tra tổng phân bổ.');
      return;
    }
    const payload = { allocationDate, allocations: existingRows };
    const mutation = keyFor(`customer-payment-allocation-${selected.id}`, payload);
    setBusy(true);
    setMessage('');
    try {
      const response = await fetch(`/api/customer-payments/${selected.id}/allocations`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Idempotency-Key': mutation.key },
        body: JSON.stringify(payload),
      });
      const updated = await readResponse<CustomerPayment>(response);
      mutationKeys.current.delete(mutation.slot);
      setExistingAmounts({});
      await refresh(updated.id);
      setMessage(`Đã phân bổ ${money(scaledToDecimal(existingTotal), selected.currencyCode)} vào ${existingRows.length} khoản nợ.`);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'Không phân bổ được tiền thu.');
    } finally {
      setBusy(false);
    }
  }

  async function reverseAllocation(allocation: ReceivableAllocation) {
    const reason = reversalReason.trim();
    if (!reason) {
      setMessage('Nhập lý do đảo trước khi thực hiện.');
      return;
    }
    const payload = { reason };
    const mutation = keyFor(`receivable-allocation-reverse-${allocation.id}`, payload);
    setBusy(true);
    setMessage('');
    try {
      const response = await fetch(`/api/receivable-allocations/${allocation.id}/reverse`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Idempotency-Key': mutation.key },
        body: JSON.stringify(payload),
      });
      await readResponse<ReceivableAllocation>(response);
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
    const mutation = keyFor(`customer-payment-reverse-${selected.id}`, payload);
    setBusy(true);
    setMessage('');
    try {
      const response = await fetch(`/api/customer-payments/${selected.id}/reverse`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Idempotency-Key': mutation.key },
        body: JSON.stringify(payload),
      });
      const reversed = await readResponse<CustomerPayment>(response);
      mutationKeys.current.delete(mutation.slot);
      await refresh(reversed.id);
      setMessage(`Đã đảo phiếu thu ${reversed.documentNumber}.`);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'Không đảo được phiếu thu.');
    } finally {
      setBusy(false);
    }
  }

  function setCreateAmount(targetId: string, value: string) {
    setCreateAmounts((current) => ({ ...current, [targetId]: value }));
  }

  function setExistingAmount(targetId: string, value: string) {
    setExistingAmounts((current) => ({ ...current, [targetId]: value }));
  }

  return (
    <div className={styles.workspace} data-testid="customer-payments-page">
      {message ? <div className={styles.notice} role="status">{message}</div> : null}

      <section className={styles.card}>
        <h2>Ghi nhận tiền khách trả</h2>
        <form className={styles.formGrid} onSubmit={createPayment} data-testid="customer-payment-form">
          <label>Khách hàng<select value={paymentForm.customerId} required onChange={(event) => { setPaymentForm({ ...paymentForm, customerId: event.target.value }); setCreateAmounts({}); }}><option value="">Chọn khách hàng</option>{customers.map((customer) => <option key={customer.id} value={customer.id}>{customer.code} · {customer.name}</option>)}</select></label>
          <label>Kho nhận tiền<select value={paymentForm.warehouseId} required onChange={(event) => setPaymentForm({ ...paymentForm, warehouseId: event.target.value })}><option value="">Chọn kho</option>{warehouses.map((warehouse) => <option key={warehouse.id} value={warehouse.id}>{warehouse.code} · {warehouse.name}</option>)}</select></label>
          <label>Ngày thu<input type="date" required value={paymentForm.paymentDate} onChange={(event) => setPaymentForm({ ...paymentForm, paymentDate: event.target.value })} /></label>
          <label>Số tiền đã nhận<input inputMode="decimal" required value={paymentForm.amount} placeholder="0" onChange={(event) => setPaymentForm({ ...paymentForm, amount: event.target.value })} /></label>
          <label>Phương thức<select value={paymentForm.paymentMethod} onChange={(event) => setPaymentForm({ ...paymentForm, paymentMethod: event.target.value })}><option value="BANK_TRANSFER">Chuyển khoản</option><option value="CASH">Tiền mặt</option><option value="OTHER">Khác</option></select></label>
          <label>Tham chiếu ngân hàng<input value={paymentForm.externalReference ?? ''} maxLength={256} onChange={(event) => setPaymentForm({ ...paymentForm, externalReference: event.target.value })} /></label>
          <label className={styles.wide}>Ghi chú<textarea value={paymentForm.note ?? ''} maxLength={4000} onChange={(event) => setPaymentForm({ ...paymentForm, note: event.target.value })} /></label>

          <div className={styles.wide}>
            <h3>Phân bổ ngay vào công nợ (không bắt buộc)</h3>
            <div className={styles.tableWrap}>
              <table className={styles.table} data-testid="customer-payment-create-allocation-table">
                <thead><tr><th>Chứng từ</th><th>Kho</th><th className={styles.amount}>Còn nợ</th><th className={styles.amount}>Phân bổ</th></tr></thead>
                <tbody>
                  {createTargets.map((target) => <tr key={target.id}><td>{target.documentNumber}<br /><span>{target.sourceDocumentDate}</span></td><td>{target.warehouseCode}<br /><span>{target.warehouseName}</span></td><td className={styles.amount}>{money(target.remainingAmount, target.currencyCode)}</td><td className={styles.amount}><input aria-label={`Phân bổ ${target.documentNumber}`} inputMode="decimal" value={createAmounts[target.id] ?? ''} onChange={(event) => setCreateAmount(target.id, event.target.value)} placeholder="0" /></td></tr>)}
                  {!createTargets.length ? <tr><td colSpan={4}>Khách hàng chưa có khoản nợ mở cùng loại tiền.</td></tr> : null}
                </tbody>
              </table>
            </div>
            <p>Tổng phân bổ: <strong>{money(scaledToDecimal(createTotal), paymentForm.currencyCode)}</strong>. Phần còn lại sẽ là tiền chưa phân bổ.</p>
          </div>

          <button type="submit" disabled={busy || paymentAmount === null || paymentAmount <= 0n || !createAllocationValid}>Ghi nhận phiếu thu</button>
        </form>
      </section>

      <div className={styles.columns}>
        <section className={styles.card}>
          <h2>Phiếu thu khách hàng</h2>
          <div className={styles.tableWrap}><table className={styles.table} data-testid="customer-payments-table"><thead><tr><th>Số phiếu</th><th>Khách hàng</th><th className={styles.amount}>Số tiền</th><th>Trạng thái</th></tr></thead><tbody>{payments.map((payment) => <tr key={payment.id} className={payment.id === selectedId ? styles.selected : undefined}><td><button type="button" className={styles.linkButton} onClick={() => selectPayment(payment.id)}>{payment.documentNumber}</button><br /><span>{payment.paymentDate}</span></td><td>{payment.customerCode}<br /><span>{payment.customerName}</span></td><td className={styles.amount}>{money(payment.originalAmount, payment.currencyCode)}<br /><span>Còn {money(payment.remainingAmount, payment.currencyCode)}</span></td><td>{statusLabel(payment.status)}</td></tr>)}{!payments.length ? <tr><td colSpan={4}>Chưa có phiếu thu.</td></tr> : null}</tbody></table></div>
        </section>

        <section className={styles.card} data-testid="customer-payment-detail">
          <h2>Chi tiết và phân bổ</h2>
          {!selected ? <p>Chọn một phiếu thu để xem chi tiết.</p> : <>
            <div className={styles.summary}><strong>{selected.documentNumber}</strong><span>{selected.customerCode} · {selected.customerName}</span><span>{money(selected.remainingAmount, selected.currencyCode)} chưa phân bổ</span></div>

            {selected.status !== 'reversed' && (selectedRemaining ?? 0n) > 0n ? <form className={styles.allocationForm} onSubmit={allocateSelectedPayment} data-testid="customer-payment-allocation-form">
              <label>Ngày phân bổ<input type="date" required value={allocationDate} onChange={(event) => setAllocationDate(event.target.value)} /></label>
              <div className={styles.tableWrap}><table className={styles.table}><thead><tr><th>Khoản nợ</th><th>Kho</th><th className={styles.amount}>Còn nợ</th><th className={styles.amount}>Phân bổ</th></tr></thead><tbody>{existingTargets.map((target) => <tr key={target.id}><td>{target.documentNumber}<br /><span>{target.sourceDocumentDate}</span></td><td>{target.warehouseCode}</td><td className={styles.amount}>{money(target.remainingAmount, target.currencyCode)}</td><td className={styles.amount}><input aria-label={`Phân bổ thêm ${target.documentNumber}`} inputMode="decimal" value={existingAmounts[target.id] ?? ''} onChange={(event) => setExistingAmount(target.id, event.target.value)} placeholder="0" /></td></tr>)}{!existingTargets.length ? <tr><td colSpan={4}>Không còn khoản nợ phù hợp để phân bổ.</td></tr> : null}</tbody></table></div>
              <p>Tổng phân bổ thêm: <strong>{money(scaledToDecimal(existingTotal), selected.currencyCode)}</strong></p>
              <button type="submit" disabled={busy || !existingAllocationValid}>Phân bổ các khoản đã nhập</button>
            </form> : null}

            <label className={styles.reason}>Lý do đảo<textarea value={reversalReason} maxLength={2000} onChange={(event) => setReversalReason(event.target.value)} placeholder="Bắt buộc khi đảo phân bổ hoặc phiếu thu" /></label>
            <div className={styles.actions}><button type="button" disabled={busy || selected.status === 'reversed' || hasActiveAllocations || hasAllocatedAmount} onClick={reversePayment}>Đảo phiếu thu</button></div>

            <h3>Lịch sử phân bổ</h3>
            <div className={styles.tableWrap}><table className={styles.table} data-testid="customer-payment-allocations-table"><thead><tr><th>Chứng từ đích</th><th>Kho</th><th>Ngày</th><th className={styles.amount}>Số tiền</th><th>Trạng thái</th><th /></tr></thead><tbody>{selected.allocations.map((allocation) => <tr key={allocation.id}><td>{allocation.targetDocumentNumber}</td><td>{warehouses.find((warehouse) => warehouse.id === allocation.targetWarehouseId)?.code ?? allocation.targetWarehouseId}</td><td>{allocation.allocationDate}</td><td className={styles.amount}>{money(allocation.amount, selected.currencyCode)}</td><td>{allocation.reversed ? 'Đã đảo' : 'Hiệu lực'}</td><td>{!allocation.reversed ? <button type="button" disabled={busy} onClick={() => reverseAllocation(allocation)}>Đảo</button> : null}</td></tr>)}{!selected.allocations.length ? <tr><td colSpan={6}>Chưa có phân bổ.</td></tr> : null}</tbody></table></div>
          </>}
        </section>
      </div>
    </div>
  );
}
