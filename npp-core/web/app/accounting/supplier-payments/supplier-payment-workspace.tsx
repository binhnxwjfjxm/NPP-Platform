'use client';

import { useMemo, useState } from 'react';
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

function money(value: string, currencyCode='VND') {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) return `${value} ${currencyCode}`;
  return new Intl.NumberFormat('vi-VN', {
    style:'currency',currency:currencyCode,
    minimumFractionDigits:currencyCode==='VND'?0:2,
    maximumFractionDigits:6,
  }).format(numeric);
}

function statusLabel(status: SupplierPayment['status']) {
  return {
    open:'Chưa phân bổ',
    partially_allocated:'Đã phân bổ một phần',
    settled:'Đã phân bổ hết',
    reversed:'Đã đảo',
  }[status];
}

function mutationKey(prefix: string) {
  return `${prefix}-${crypto.randomUUID()}`;
}

async function readResponse<T>(response: Response): Promise<T> {
  const payload = await response.json() as ApiEnvelope<T>;
  if (!response.ok || !Object.prototype.hasOwnProperty.call(payload,'data')) {
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
  const [payments,setPayments] = useState(initialPayments);
  const [targets,setTargets] = useState(initialTargets);
  const [selectedId,setSelectedId] = useState(initialPayments[0]?.id ?? '');
  const [detail,setDetail] = useState<SupplierPayment | null>(initialPayments[0] ?? null);
  const [busy,setBusy] = useState(false);
  const [message,setMessage] = useState(initialError ?? '');
  const [paymentForm,setPaymentForm] = useState<SupplierPaymentDraft>({
    supplierId:suppliers[0]?.id ?? '',
    warehouseId:warehouses[0]?.id ?? '',
    paymentDate:initialPaymentDate,
    currencyCode:'VND',
    paymentMethod:'BANK_TRANSFER',
    amount:'',
    externalReference:'',
    note:'',
  });
  const [targetId,setTargetId] = useState('');
  const [allocationAmount,setAllocationAmount] = useState('');
  const [reversalReason,setReversalReason] = useState('');

  const selected = detail?.id===selectedId ? detail : payments.find((payment)=>payment.id===selectedId) ?? null;
  const matchingTargets = useMemo(()=>targets.filter((target)=>
    selected
      && target.supplierId===selected.supplierId
      && target.warehouseId===selected.warehouseId
      && target.currencyCode===selected.currencyCode
      && target.remainingAmount!=='0.000000'
  ),[targets,selected]);
  const selectedTarget = matchingTargets.find((target)=>target.id===targetId) ?? null;
  const maximumAllocation = selected && selectedTarget
    ? Math.min(Number(selected.remainingAmount),Number(selectedTarget.remainingAmount))
    : 0;

  async function refresh(nextSelectedId = selectedId) {
    const [paymentResponse,targetResponse] = await Promise.all([
      fetch('/api/supplier-payments?limit=1000',{ cache:'no-store' }),
      fetch('/api/supplier-payments/allocation-targets',{ cache:'no-store' }),
    ]);
    const nextPayments = await readResponse<SupplierPayment[]>(paymentResponse);
    const nextTargets = await readResponse<AllocationTarget[]>(targetResponse);
    setPayments(nextPayments);
    setTargets(nextTargets);
    if (nextSelectedId) {
      const detailResponse = await fetch(`/api/supplier-payments/${nextSelectedId}`,{ cache:'no-store' });
      if (detailResponse.ok) setDetail(await readResponse<SupplierPayment>(detailResponse));
      else setDetail(null);
    }
  }

  async function selectPayment(id: string) {
    setSelectedId(id);
    setTargetId('');
    setAllocationAmount('');
    setMessage('');
    try {
      const response = await fetch(`/api/supplier-payments/${id}`,{ cache:'no-store' });
      setDetail(await readResponse<SupplierPayment>(response));
    } catch (error) {
      setMessage(error instanceof Error?error.message:'Không tải được chi tiết phiếu thanh toán.');
    }
  }

  async function createPayment(event: React.FormEvent) {
    event.preventDefault();
    setBusy(true);
    setMessage('');
    try {
      const response = await fetch('/api/supplier-payments',{
        method:'POST',
        headers:{ 'Content-Type':'application/json','Idempotency-Key':mutationKey('payment') },
        body:JSON.stringify(paymentForm),
      });
      const created = await readResponse<SupplierPayment>(response);
      setSelectedId(created.id);
      setDetail(created);
      setPaymentForm((current)=>({ ...current,amount:'',externalReference:'',note:'' }));
      await refresh(created.id);
      setMessage(`Đã ghi nhận phiếu ${created.documentNumber}.`);
    } catch (error) {
      setMessage(error instanceof Error?error.message:'Không ghi nhận được thanh toán.');
    } finally {
      setBusy(false);
    }
  }

  async function allocatePayment(event: React.FormEvent) {
    event.preventDefault();
    if (!selected || !selectedTarget) return;
    setBusy(true);
    setMessage('');
    try {
      const response = await fetch('/api/payable-allocations',{
        method:'POST',
        headers:{ 'Content-Type':'application/json','Idempotency-Key':mutationKey('allocation') },
        body:JSON.stringify({
          sourcePayableDocumentId:selected.id,
          targetPayableDocumentId:selectedTarget.id,
          amount:allocationAmount,
          allocationDate:paymentForm.paymentDate,
        }),
      });
      await readResponse<PayableAllocation>(response);
      setAllocationAmount('');
      setTargetId('');
      await refresh(selected.id);
      setMessage('Đã phân bổ thanh toán vào chứng từ phải trả.');
    } catch (error) {
      setMessage(error instanceof Error?error.message:'Không phân bổ được thanh toán.');
    } finally {
      setBusy(false);
    }
  }

  async function reverseAllocation(allocation: PayableAllocation) {
    if (!reversalReason.trim()) {
      setMessage('Nhập lý do đảo trước khi thực hiện.');
      return;
    }
    setBusy(true);
    setMessage('');
    try {
      const response = await fetch(`/api/payable-allocations/${allocation.id}/reverse`,{
        method:'POST',
        headers:{ 'Content-Type':'application/json','Idempotency-Key':mutationKey('allocation-reverse') },
        body:JSON.stringify({ reason:reversalReason.trim() }),
      });
      await readResponse<PayableAllocation>(response);
      await refresh(selectedId);
      setMessage('Đã đảo phân bổ công nợ.');
    } catch (error) {
      setMessage(error instanceof Error?error.message:'Không đảo được phân bổ.');
    } finally {
      setBusy(false);
    }
  }

  async function reversePayment() {
    if (!selected || !reversalReason.trim()) {
      setMessage('Chọn phiếu và nhập lý do đảo trước khi thực hiện.');
      return;
    }
    setBusy(true);
    setMessage('');
    try {
      const response = await fetch(`/api/supplier-payments/${selected.id}/reverse`,{
        method:'POST',
        headers:{ 'Content-Type':'application/json','Idempotency-Key':mutationKey('payment-reverse') },
        body:JSON.stringify({ reason:reversalReason.trim() }),
      });
      const reversed = await readResponse<SupplierPayment>(response);
      await refresh(reversed.id);
      setMessage(`Đã đảo phiếu ${reversed.documentNumber}.`);
    } catch (error) {
      setMessage(error instanceof Error?error.message:'Không đảo được phiếu thanh toán.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className={styles.workspace} data-testid="supplier-payments-page">
      {message?<div className={styles.notice} role="status">{message}</div>:null}

      <section className={styles.card}>
        <h2>Ghi nhận thanh toán</h2>
        <form className={styles.formGrid} onSubmit={createPayment} data-testid="supplier-payment-form">
          <label>Nhà cung cấp<select value={paymentForm.supplierId} required onChange={(event)=>setPaymentForm({ ...paymentForm,supplierId:event.target.value })}><option value="">Chọn nhà cung cấp</option>{suppliers.map((supplier)=><option key={supplier.id} value={supplier.id}>{supplier.code} · {supplier.name}</option>)}</select></label>
          <label>Kho<select value={paymentForm.warehouseId} required onChange={(event)=>setPaymentForm({ ...paymentForm,warehouseId:event.target.value })}><option value="">Chọn kho</option>{warehouses.map((warehouse)=><option key={warehouse.id} value={warehouse.id}>{warehouse.code} · {warehouse.name}</option>)}</select></label>
          <label>Ngày thanh toán<input type="date" required value={paymentForm.paymentDate} onChange={(event)=>setPaymentForm({ ...paymentForm,paymentDate:event.target.value })}/></label>
          <label>Số tiền<input inputMode="decimal" required value={paymentForm.amount} placeholder="0" onChange={(event)=>setPaymentForm({ ...paymentForm,amount:event.target.value })}/></label>
          <label>Phương thức<select value={paymentForm.paymentMethod} onChange={(event)=>setPaymentForm({ ...paymentForm,paymentMethod:event.target.value })}><option value="BANK_TRANSFER">Chuyển khoản</option><option value="CASH">Tiền mặt</option><option value="OTHER">Khác</option></select></label>
          <label>Tham chiếu ngân hàng<input value={paymentForm.externalReference ?? ''} maxLength={256} onChange={(event)=>setPaymentForm({ ...paymentForm,externalReference:event.target.value })}/></label>
          <label className={styles.wide}>Ghi chú<textarea value={paymentForm.note ?? ''} maxLength={4000} onChange={(event)=>setPaymentForm({ ...paymentForm,note:event.target.value })}/></label>
          <button type="submit" disabled={busy}>Ghi nhận thanh toán</button>
        </form>
      </section>

      <div className={styles.columns}>
        <section className={styles.card}>
          <h2>Phiếu thanh toán</h2>
          <div className={styles.tableWrap}><table className={styles.table} data-testid="supplier-payments-table"><thead><tr><th>Số phiếu</th><th>Nhà cung cấp</th><th className={styles.amount}>Số tiền</th><th>Trạng thái</th></tr></thead><tbody>{payments.map((payment)=><tr key={payment.id} className={payment.id===selectedId?styles.selected:undefined}><td><button type="button" className={styles.linkButton} onClick={()=>selectPayment(payment.id)}>{payment.documentNumber}</button><br/><span>{payment.paymentDate}</span></td><td>{payment.supplierCode}<br/><span>{payment.supplierName}</span></td><td className={styles.amount}>{money(payment.originalAmount,payment.currencyCode)}<br/><span>Còn {money(payment.remainingAmount,payment.currencyCode)}</span></td><td>{statusLabel(payment.status)}</td></tr>)}{!payments.length?<tr><td colSpan={4}>Chưa có phiếu thanh toán.</td></tr>:null}</tbody></table></div>
        </section>

        <section className={styles.card} data-testid="supplier-payment-detail">
          <h2>Chi tiết và phân bổ</h2>
          {!selected?<p>Chọn một phiếu thanh toán để xem chi tiết.</p>:<>
            <div className={styles.summary}><strong>{selected.documentNumber}</strong><span>{selected.supplierCode} · {selected.supplierName}</span><span>{money(selected.remainingAmount,selected.currencyCode)} chưa phân bổ</span></div>
            {selected.status!=='reversed'&&Number(selected.remainingAmount)>0?<form className={styles.allocationForm} onSubmit={allocatePayment}>
              <label>Chứng từ phải trả<select value={targetId} required onChange={(event)=>{ setTargetId(event.target.value); setAllocationAmount(''); }}><option value="">Chọn chứng từ</option>{matchingTargets.map((target)=><option key={target.id} value={target.id}>{target.documentNumber} · còn {money(target.remainingAmount,target.currencyCode)}</option>)}</select></label>
              <label>Số tiền phân bổ<input inputMode="decimal" required value={allocationAmount} onChange={(event)=>setAllocationAmount(event.target.value)} placeholder={maximumAllocation?String(maximumAllocation):'0'}/></label>
              <button type="submit" disabled={busy||!selectedTarget||Number(allocationAmount)<=0||Number(allocationAmount)>maximumAllocation}>Phân bổ</button>
            </form>:null}
            <label className={styles.reason}>Lý do đảo<textarea value={reversalReason} maxLength={2000} onChange={(event)=>setReversalReason(event.target.value)} placeholder="Bắt buộc khi đảo phân bổ hoặc phiếu"/></label>
            <div className={styles.actions}><button type="button" disabled={busy||selected.status==='reversed'||selected.allocations.some((item)=>!item.reversed)} onClick={reversePayment}>Đảo phiếu thanh toán</button></div>
            <h3>Lịch sử phân bổ</h3>
            <div className={styles.tableWrap}><table className={styles.table} data-testid="supplier-payment-allocations-table"><thead><tr><th>Chứng từ đích</th><th>Ngày</th><th className={styles.amount}>Số tiền</th><th>Trạng thái</th><th/></tr></thead><tbody>{selected.allocations.map((allocation)=><tr key={allocation.id}><td>{allocation.targetDocumentNumber}</td><td>{allocation.allocationDate}</td><td className={styles.amount}>{money(allocation.amount,selected.currencyCode)}</td><td>{allocation.reversed?'Đã đảo':'Hiệu lực'}</td><td>{!allocation.reversed?<button type="button" disabled={busy} onClick={()=>reverseAllocation(allocation)}>Đảo</button>:null}</td></tr>)}{!selected.allocations.length?<tr><td colSpan={5}>Chưa có phân bổ.</td></tr>:null}</tbody></table></div>
          </>}
        </section>
      </div>
    </div>
  );
}
