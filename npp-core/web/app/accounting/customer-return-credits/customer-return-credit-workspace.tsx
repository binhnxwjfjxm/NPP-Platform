'use client';

import { useMemo, useRef, useState } from 'react';
import type { ReceivableAllocationTarget } from '../../../lib/customer-payment-types';
import type {
  CustomerRefund,
  CustomerRefundDraft,
  CustomerReturnCredit,
} from '../../../lib/customer-return-credit-types';
import styles from '../supplier-payments/supplier-payments.module.css';

type Props = {
  initialCredits: CustomerReturnCredit[];
  initialTargets: ReceivableAllocationTarget[];
  initialDate: string;
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

function money(value: string, currencyCode = 'VND') {
  const match = /^(-?)(\d+)(?:\.(\d{1,6}))?$/.exec(String(value ?? '').trim());
  if (!match) return `${value} ${currencyCode}`;
  const fraction = (match[3] ?? '').replace(/0+$/, '');
  const whole = new Intl.NumberFormat('vi-VN').format(BigInt(match[2]));
  return `${match[1]}${whole}${fraction ? `,${fraction}` : ''} ${currencyCode}`;
}

function statusLabel(status: CustomerReturnCredit['status']) {
  return {
    open: 'Chưa sử dụng',
    partially_allocated: 'Đã dùng một phần',
    settled: 'Đã dùng hết',
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
) {
  const validIds = new Set(targets.map((target) => target.id));
  return Object.entries(values)
    .filter(([id, amount]) => validIds.has(id) && (decimalToScaled(amount) ?? 0n) > 0n)
    .map(([receivableDocumentId, amount]) => ({ receivableDocumentId, amount }))
    .sort((left, right) => left.receivableDocumentId.localeCompare(right.receivableDocumentId));
}

export default function CustomerReturnCreditWorkspace({
  initialCredits,
  initialTargets,
  initialDate,
  initialError,
}: Props) {
  const [credits, setCredits] = useState(initialCredits);
  const [targets, setTargets] = useState(initialTargets);
  const [selectedId, setSelectedId] = useState(initialCredits[0]?.id ?? '');
  const [detail, setDetail] = useState<CustomerReturnCredit | null>(initialCredits[0] ?? null);
  const [allocationAmounts, setAllocationAmounts] = useState<Record<string, string>>({});
  const [allocationDate, setAllocationDate] = useState(initialDate);
  const [refundForm, setRefundForm] = useState<CustomerRefundDraft>({
    sourceCreditDocumentId: initialCredits[0]?.id ?? '',
    amount: '',
    refundMethod: 'BANK_TRANSFER',
    destinationReference: '',
    externalReference: '',
    reason: '',
    refundDate: initialDate,
  });
  const [reversalReason, setReversalReason] = useState('');
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState(initialError ?? '');
  const mutationKeys = useRef(new Map<string, string>());

  const selected = detail?.id === selectedId
    ? detail
    : credits.find((credit) => credit.id === selectedId) ?? null;
  const eligibleTargets = useMemo(() => targets.filter((target) => (
    selected
    && target.customerId === selected.customerId
    && target.currencyCode === selected.currencyCode
    && (decimalToScaled(target.remainingAmount) ?? 0n) > 0n
  )), [targets, selected]);
  const rows = allocationRows(allocationAmounts, eligibleTargets);
  const allocationTotal = rows.reduce(
    (total, row) => total + (decimalToScaled(row.amount) ?? 0n),
    0n,
  );
  const selectedRemaining = selected ? decimalToScaled(selected.remainingAmount) : null;
  const allocationsValid = rows.length > 0
    && selectedRemaining !== null
    && allocationTotal <= selectedRemaining
    && rows.every((row) => {
      const target = eligibleTargets.find((item) => item.id === row.receivableDocumentId);
      const amount = decimalToScaled(row.amount);
      const remaining = decimalToScaled(target?.remainingAmount ?? '');
      return amount !== null && amount > 0n && remaining !== null && amount <= remaining;
    });
  const refundAmount = decimalToScaled(refundForm.amount);
  const refundValid = Boolean(
    selected
    && selected.status !== 'reversed'
    && refundAmount !== null
    && selectedRemaining !== null
    && refundAmount > 0n
    && refundAmount <= selectedRemaining
    && refundForm.destinationReference.trim()
    && refundForm.reason.trim()
    && refundForm.refundDate,
  );
  const hasActiveRefund = selected?.refunds?.some((refund) => !refund.reversalId) ?? false;

  function keyFor(prefix: string, payload: unknown) {
    const slot = `${prefix}:${JSON.stringify(payload)}`;
    const existing = mutationKeys.current.get(slot);
    if (existing) return { key: existing, slot };
    const key = `${prefix}-${crypto.randomUUID()}`;
    mutationKeys.current.set(slot, key);
    return { key, slot };
  }

  async function refresh(nextSelectedId = selectedId) {
    const [creditsResponse, targetsResponse] = await Promise.all([
      fetch('/api/customer-return-credits?limit=1000', { cache: 'no-store' }),
      fetch('/api/customer-payments/allocation-targets', { cache: 'no-store' }),
    ]);
    const nextCredits = await readResponse<CustomerReturnCredit[]>(creditsResponse);
    const nextTargets = await readResponse<ReceivableAllocationTarget[]>(targetsResponse);
    setCredits(nextCredits);
    setTargets(nextTargets);
    const id = nextSelectedId || nextCredits[0]?.id || '';
    setSelectedId(id);
    if (id) {
      const detailResponse = await fetch(`/api/customer-return-credits/${id}`, { cache: 'no-store' });
      const nextDetail = await readResponse<CustomerReturnCredit>(detailResponse);
      setDetail(nextDetail);
      setRefundForm((current) => ({ ...current, sourceCreditDocumentId: nextDetail.id }));
    } else {
      setDetail(null);
    }
  }

  async function selectCredit(id: string) {
    setBusy(true);
    setMessage('');
    try {
      const response = await fetch(`/api/customer-return-credits/${id}`, { cache: 'no-store' });
      const next = await readResponse<CustomerReturnCredit>(response);
      setSelectedId(id);
      setDetail(next);
      setAllocationAmounts({});
      setRefundForm((current) => ({
        ...current,
        sourceCreditDocumentId: id,
        amount: '',
        destinationReference: '',
        externalReference: '',
        reason: '',
      }));
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'Không tải được credit hàng trả');
    } finally {
      setBusy(false);
    }
  }

  async function submitAllocation(event: React.FormEvent) {
    event.preventDefault();
    if (!selected || !allocationsValid) return;
    const payload = { allocationDate, allocations: rows };
    const mutation = keyFor(`return-credit-allocate-${selected.id}`, payload);
    setBusy(true);
    setMessage('');
    try {
      await readResponse<CustomerReturnCredit>(await fetch(
        `/api/customer-return-credits/${selected.id}/allocations`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'Idempotency-Key': mutation.key },
          body: JSON.stringify(payload),
        },
      ));
      mutationKeys.current.delete(mutation.slot);
      setAllocationAmounts({});
      await refresh(selected.id);
      setMessage('Đã phân bổ credit vào công nợ.');
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'Không phân bổ được credit');
    } finally {
      setBusy(false);
    }
  }

  async function submitRefund(event: React.FormEvent) {
    event.preventDefault();
    if (!selected || !refundValid) return;
    const payload = { ...refundForm, sourceCreditDocumentId: selected.id };
    const mutation = keyFor(`customer-refund-${selected.id}`, payload);
    setBusy(true);
    setMessage('');
    try {
      await readResponse<CustomerRefund>(await fetch('/api/customer-refunds', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Idempotency-Key': mutation.key },
        body: JSON.stringify(payload),
      }));
      mutationKeys.current.delete(mutation.slot);
      setRefundForm((current) => ({
        ...current,
        amount: '',
        destinationReference: '',
        externalReference: '',
        reason: '',
      }));
      await refresh(selected.id);
      setMessage('Đã ghi nhận hoàn tiền từ phần credit chưa sử dụng.');
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'Không ghi nhận được hoàn tiền');
    } finally {
      setBusy(false);
    }
  }

  async function reverseRefund(refund: CustomerRefund) {
    const reason = reversalReason.trim();
    if (!reason) {
      setMessage('Cần nhập lý do trước khi đảo hoàn tiền.');
      return;
    }
    const payload = { reason };
    const mutation = keyFor(`customer-refund-reverse-${refund.id}`, payload);
    setBusy(true);
    setMessage('');
    try {
      await readResponse<CustomerRefund>(await fetch(`/api/customer-refunds/${refund.id}/reverse`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Idempotency-Key': mutation.key },
        body: JSON.stringify(payload),
      }));
      mutationKeys.current.delete(mutation.slot);
      setReversalReason('');
      await refresh(selectedId);
      setMessage('Đã đảo hoàn tiền bằng bút toán bù.');
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'Không đảo được hoàn tiền');
    } finally {
      setBusy(false);
    }
  }

  async function reverseCredit() {
    if (!selected || !reversalReason.trim()) {
      setMessage('Cần nhập lý do trước khi đảo credit hàng trả.');
      return;
    }
    const payload = { reason: reversalReason.trim() };
    const mutation = keyFor(`return-credit-reverse-${selected.id}`, payload);
    setBusy(true);
    setMessage('');
    try {
      await readResponse<CustomerReturnCredit>(await fetch(
        `/api/customer-return-credits/${selected.id}/reverse`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'Idempotency-Key': mutation.key },
          body: JSON.stringify(payload),
        },
      ));
      mutationKeys.current.delete(mutation.slot);
      setReversalReason('');
      await refresh(selected.id);
      setMessage('Đã đảo credit hàng trả bằng bút toán bù.');
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'Không đảo được credit hàng trả');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className={styles.workspace} data-testid="customer-return-credit-workspace">
      {message ? <div className={styles.notice} role="status">{message}</div> : null}
      <div className={styles.columns}>
        <section className={styles.card}>
          <h2>Credit từ hàng khách trả</h2>
          <div className={styles.tableWrap}>
            <table className={styles.table}>
              <thead><tr><th>Phiếu trả</th><th>Khách hàng</th><th>Kho</th><th className={styles.amount}>Giá trị</th><th className={styles.amount}>Còn dùng</th><th>Trạng thái</th></tr></thead>
              <tbody>
                {credits.map((credit) => (
                  <tr key={credit.id} className={selectedId === credit.id ? styles.selected : undefined}>
                    <td><button type="button" className={styles.linkButton} disabled={busy} onClick={() => selectCredit(credit.id)}>{credit.returnNumber}</button></td>
                    <td>{credit.customerCode}<br /><span>{credit.customerName}</span></td>
                    <td>{credit.warehouseCode}<br /><span>{credit.warehouseName}</span></td>
                    <td className={styles.amount}>{money(credit.originalAmount, credit.currencyCode)}</td>
                    <td className={styles.amount}>{money(credit.remainingAmount, credit.currencyCode)}</td>
                    <td>{statusLabel(credit.status)}</td>
                  </tr>
                ))}
                {!credits.length ? <tr><td colSpan={6}>Chưa có Customer Return đã nhận phát sinh credit công nợ.</td></tr> : null}
              </tbody>
            </table>
          </div>
        </section>

        <section className={styles.card}>
          <h2>Chi tiết và xử lý</h2>
          {selected ? (
            <>
              <div className={styles.summary}>
                <strong>{selected.returnNumber} · {selected.customerCode} — {selected.customerName}</strong>
                <span>Credit gốc: {money(selected.originalAmount, selected.currencyCode)}</span>
                <span>Đã sử dụng: {money(selected.allocatedAmount, selected.currencyCode)}</span>
                <span>Chưa sử dụng: {money(selected.remainingAmount, selected.currencyCode)}</span>
                <span>Kho nhận: {selected.warehouseCode} — {selected.warehouseName}</span>
              </div>

              <h3>Dòng hàng đã nhận</h3>
              <div className={styles.tableWrap}>
                <table className={styles.table}>
                  <thead><tr><th>Hàng hóa</th><th>Chứng từ nguồn</th><th className={styles.amount}>SL nhận</th><th className={styles.amount}>Credit</th></tr></thead>
                  <tbody>
                    {(selected.lines ?? []).map((line) => (
                      <tr key={line.id}>
                        <td>{line.sku}<br /><span>{line.itemName}</span></td>
                        <td>{line.sourceDocumentNumber}</td>
                        <td className={styles.amount}>{line.acceptedBaseQuantity} {line.unitCode}</td>
                        <td className={styles.amount}>{money(line.adjustmentAmount, line.currencyCode)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>

              {selected.status !== 'reversed' && (decimalToScaled(selected.remainingAmount) ?? 0n) > 0n ? (
                <>
                  <h3>Phân bổ phần credit còn lại</h3>
                  <form className={styles.allocationForm} onSubmit={submitAllocation} data-testid="customer-return-credit-allocation-form">
                    <label>Ngày phân bổ<input type="date" value={allocationDate} onChange={(event) => setAllocationDate(event.target.value)} /></label>
                    <div className={styles.wide}>
                      <div className={styles.tableWrap}>
                        <table className={styles.table}>
                          <thead><tr><th>Khoản nợ</th><th>Kho</th><th className={styles.amount}>Còn nợ</th><th className={styles.amount}>Số phân bổ</th></tr></thead>
                          <tbody>
                            {eligibleTargets.map((target) => (
                              <tr key={target.id}>
                                <td>{target.documentNumber}<br /><span>{target.salesOrderNumber}</span></td>
                                <td>{target.warehouseCode}</td>
                                <td className={styles.amount}>{money(target.remainingAmount, target.currencyCode)}</td>
                                <td className={styles.amount}><input aria-label={`Số phân bổ ${target.documentNumber}`} inputMode="decimal" value={allocationAmounts[target.id] ?? ''} onChange={(event) => setAllocationAmounts((current) => ({ ...current, [target.id]: event.target.value }))} /></td>
                              </tr>
                            ))}
                            {!eligibleTargets.length ? <tr><td colSpan={4}>Không còn khoản nợ phù hợp để phân bổ.</td></tr> : null}
                          </tbody>
                        </table>
                      </div>
                    </div>
                    <button type="submit" disabled={busy || !allocationsValid}>Phân bổ credit</button>
                  </form>

                  <h3>Hoàn tiền từ phần chưa sử dụng</h3>
                  <form className={styles.formGrid} onSubmit={submitRefund} data-testid="customer-refund-form">
                    <label>Số tiền<input required inputMode="decimal" value={refundForm.amount} onChange={(event) => setRefundForm((current) => ({ ...current, amount: event.target.value }))} /></label>
                    <label>Ngày hoàn<input required type="date" value={refundForm.refundDate} onChange={(event) => setRefundForm((current) => ({ ...current, refundDate: event.target.value }))} /></label>
                    <label>Phương thức<select value={refundForm.refundMethod} onChange={(event) => setRefundForm((current) => ({ ...current, refundMethod: event.target.value }))}><option value="BANK_TRANSFER">Chuyển khoản</option><option value="CASH">Tiền mặt</option></select></label>
                    <label className={styles.wide}>Nơi nhận / tài khoản nhận<input required value={refundForm.destinationReference} onChange={(event) => setRefundForm((current) => ({ ...current, destinationReference: event.target.value }))} /></label>
                    <label>Tham chiếu giao dịch<input value={refundForm.externalReference ?? ''} onChange={(event) => setRefundForm((current) => ({ ...current, externalReference: event.target.value }))} /></label>
                    <label className={styles.wide}>Lý do<textarea required value={refundForm.reason} onChange={(event) => setRefundForm((current) => ({ ...current, reason: event.target.value }))} /></label>
                    <button type="submit" disabled={busy || !refundValid}>Ghi nhận hoàn tiền</button>
                  </form>
                </>
              ) : null}

              <h3>Lịch sử hoàn tiền</h3>
              <div className={styles.tableWrap}>
                <table className={styles.table}>
                  <thead><tr><th>Phiếu hoàn</th><th>Phương thức / nơi nhận</th><th className={styles.amount}>Số tiền</th><th>Trạng thái</th><th /></tr></thead>
                  <tbody>
                    {(selected.refunds ?? []).map((refund) => (
                      <tr key={refund.id}>
                        <td>{refund.refundNumber}<br /><span>{refund.externalReference}</span></td>
                        <td>{refund.refundMethod}<br /><span>{refund.destinationReference}</span></td>
                        <td className={styles.amount}>{money(refund.amount, refund.currencyCode)}</td>
                        <td>{refund.reversalId ? 'Đã đảo' : 'Đã hoàn'}</td>
                        <td>{!refund.reversalId ? <button type="button" disabled={busy || !reversalReason.trim()} onClick={() => reverseRefund(refund)}>Đảo hoàn tiền</button> : null}</td>
                      </tr>
                    ))}
                    {!selected.refunds?.length ? <tr><td colSpan={5}>Chưa có hoàn tiền từ credit này.</td></tr> : null}
                  </tbody>
                </table>
              </div>

              <label className={styles.reason}>Lý do đảo<textarea value={reversalReason} onChange={(event) => setReversalReason(event.target.value)} placeholder="Bắt buộc khi đảo credit hoặc hoàn tiền" /></label>
              <div className={styles.actions}>
                <button type="button" disabled={busy || selected.status === 'reversed' || hasActiveRefund || !reversalReason.trim()} onClick={reverseCredit}>Đảo credit hàng trả</button>
              </div>
            </>
          ) : <p>Chọn một credit để xem chi tiết.</p>}
        </section>
      </div>
    </div>
  );
}
