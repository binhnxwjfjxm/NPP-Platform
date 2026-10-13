'use client';

import { useEffect, useRef, useState } from 'react';
import type { SalesOrder } from '../../../lib/sales-order-types';
import { apiRequest, formatQuantity, mutationKey } from './sales-order-ui';
import styles from './sales-orders.module.css';
import returnStyles from './manual-sales-order-returns.module.css';

type ReturnLine = {
  salesOrderLineId: string;
  lineNumber: number;
  sku: string;
  itemName: string;
  unitCode: string;
  issuedBaseQuantity: string;
  returnedBaseQuantity: string;
  remainingBaseQuantity: string;
};
type ReturnEligibility = {
  orderRevision: string;
  canReceive: boolean;
  canReturnAll: boolean;
  lines: ReturnLine[];
};
type StableRequest = { fingerprint: string; key: string };
const DECIMAL = /^(0|[1-9][0-9]*)(?:\.([0-9]{1,6}))?$/;
const SCALE = 1000000000000n;

function quantity(value: string): bigint | null {
  const matched = DECIMAL.exec(value.trim());
  if (!matched) return null;
  return BigInt(matched[1]) * SCALE + BigInt((matched[2] ?? '').padEnd(12, '0'));
}

export default function ManualSalesOrderReturns({
  order, canReceive, onUpdated,
}: {
  order: SalesOrder;
  canReceive: boolean;
  onUpdated: (value: SalesOrder) => void;
}) {
  const [eligibility, setEligibility] = useState<ReturnEligibility | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [open, setOpen] = useState(false);
  const [quantities, setQuantities] = useState<Record<string, string>>({});
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const keyRef = useRef<StableRequest | null>(null);

  useEffect(() => {
    const abort = new AbortController();
    setEligibility(null);
    setLoading(true);
    setError(null);
    setOpen(false);
    keyRef.current = null;
    void apiRequest<ReturnEligibility>(
      '/api/sales-orders/' + order.id + '/manual-return',
      { signal: abort.signal },
    ).then((data) => {
      if (abort.signal.aborted) return;
      setEligibility(data);
    }).catch((caught) => {
      if (abort.signal.aborted) return;
      setError(caught instanceof Error ? caught.message : 'Không đọc được số hàng trả');
    }).finally(() => {
      if (!abort.signal.aborted) setLoading(false);
    });
    return () => abort.abort();
  }, [order.id, order.revision]);

  const availableLines = eligibility?.lines.filter((line) =>
    (quantity(line.remainingBaseQuantity) ?? 0n) > 0n) ?? [];

  function openPartial() {
    setError(null);
    setNotice(null);
    setQuantities(Object.fromEntries(availableLines.map(line => [line.salesOrderLineId, '0'])));
    setOpen(true);
  }

  async function submit(mode: 'ALL' | 'PARTIAL') {
    if (!eligibility || busy) return;
    const selected = mode === 'PARTIAL'
      ? availableLines
        .map(line => ({ salesOrderLineId: line.salesOrderLineId, quantity: (quantities[line.salesOrderLineId] ?? '0').trim() }))
        .filter(line => (quantity(line.quantity) ?? 0n) > 0n)
      : [];
    if (mode === 'PARTIAL') {
      if (!selected.length) {
        setError('Hãy nhập số lượng cần trả ở ít nhất một mã hàng.');
        return;
      }
      if (selected.some((line) => {
        const source = availableLines.find(row => row.salesOrderLineId === line.salesOrderLineId);
        const count = quantity(line.quantity);
        return !source || count === null || count > (quantity(source.remainingBaseQuantity) ?? 0n);
      })) {
        setError('Số lượng nhập trả không hợp lệ hoặc vượt số hàng còn có thể trả.');
        return;
      }
    } else if (!eligibility.canReturnAll || !availableLines.length) {
      return;
    } else if (!window.confirm('Kho đã thực nhận hàng? Nhập trả toàn bộ hàng chưa giao về kho?')) {
      return;
    }

    const payload = {
      expectedRevision: order.revision,
      mode,
      ...(mode === 'PARTIAL' ? { lines: selected } : {}),
    };
    const fingerprint = JSON.stringify({ id: order.id, payload });
    if (keyRef.current?.fingerprint !== fingerprint) {
      keyRef.current = { fingerprint, key: mutationKey('manual-delivery-return') };
    }
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      const updated = await apiRequest<SalesOrder>(
        '/api/sales-orders/' + order.id + '/manual-return',
        {
          method: 'POST',
          headers: { 'Idempotency-Key': keyRef.current.key },
          body: JSON.stringify(payload),
        },
      );
      keyRef.current = null;
      setOpen(false);
      onUpdated(updated);
      setNotice(mode === 'ALL' ? 'Đã nhập trả toàn bộ hàng về kho.' : 'Đã nhập trả số hàng đã chọn về kho.');
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Không thể nhập trả hàng');
    } finally {
      setBusy(false);
    }
  }

  const canAct = canReceive && !busy && !loading && eligibility?.canReceive === true;
  return (
    <section className={returnStyles.panel} aria-label="Nhập trả hàng chưa giao">
      <div className={returnStyles.heading}>
        <div>
          <strong>Nhập trả hàng chưa giao</strong>
          <small>Chỉ xác nhận khi kho đã nhận lại hàng thực tế.</small>
        </div>
        {availableLines.length > 0 ? <small>{availableLines.length} mã còn có thể trả</small> : null}
      </div>
      <div className={returnStyles.actions}>
        <button type="button" disabled={!canAct || !eligibility?.canReturnAll || !availableLines.length}
          onClick={() => void submit('ALL')}>
          {busy ? 'Đang nhập trả…' : 'Trả nguyên đơn'}
        </button>
        <button type="button" disabled={!canAct || !availableLines.length}
          onClick={openPartial}>
          Trả một phần
        </button>
      </div>
      {loading ? <small>Đang kiểm tra số lượng xuất kho…</small> : null}
      {!loading && eligibility && !availableLines.length
        ? <small>Không còn hàng đã xuất để nhập trả.</small> : null}
      {!loading && eligibility && !eligibility.canReturnAll && availableLines.length > 0
        ? <small>Đơn có dòng không theo dõi tồn kho: chọn Trả một phần để xác định mã hàng thực nhận.</small> : null}
      {notice ? <div className={styles.banner + ' ' + styles.bannerSuccess} role="status">{notice}</div> : null}
      {error && !open ? <div className={styles.banner + ' ' + styles.bannerError} role="alert">{error}</div> : null}

      {open && eligibility ? (
        <div className={styles.modalBackdrop} role="presentation">
          <div className={returnStyles.dialog} role="dialog" aria-modal="true"
            aria-labelledby="manual-return-heading">
            <div className={returnStyles.dialogHeader}>
              <div>
                <h3 id="manual-return-heading">Nhập trả một phần</h3>
                <small>Chọn mã hàng và nhập đúng số lượng kho đã nhận.</small>
              </div>
              <button type="button" aria-label="Đóng cửa sổ" onClick={() => setOpen(false)}
                disabled={busy}>Đóng</button>
            </div>
            <div className={returnStyles.tableScroll}>
              <table className={returnStyles.table}>
                <thead>
                  <tr><th>Mã hàng / sản phẩm</th><th>Đã xuất</th><th>Đã trả</th><th>Còn trả được</th><th>Số lượng trả</th></tr>
                </thead>
                <tbody>
                  {availableLines.map((line) => (
                    <tr key={line.salesOrderLineId}>
                      <td><strong>{line.sku}</strong><small>{line.itemName}</small></td>
                      <td>{formatQuantity(line.issuedBaseQuantity)} {line.unitCode}</td>
                      <td>{formatQuantity(line.returnedBaseQuantity)}</td>
                      <td>{formatQuantity(line.remainingBaseQuantity)}</td>
                      <td>
                        <label className={returnStyles.quantityLabel}>
                          <span className={returnStyles.visuallyHidden}>Số lượng trả {line.sku}</span>
                          <input type="text" inputMode="decimal" aria-label={'Số lượng trả ' + line.sku}
                            value={quantities[line.salesOrderLineId] ?? '0'} disabled={busy}
                            onChange={(event) => setQuantities(current => ({
                              ...current, [line.salesOrderLineId]: event.target.value,
                            }))}/>
                        </label>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            {error ? <div className={styles.banner + ' ' + styles.bannerError} role="alert">{error}</div> : null}
            <div className={returnStyles.dialogActions}>
              <button type="button" onClick={() => setOpen(false)} disabled={busy}>Hủy</button>
              <button type="button" className={styles.primaryButton} disabled={!canAct}
                onClick={() => void submit('PARTIAL')}>
                {busy ? 'Đang nhập kho…' : 'Xác nhận nhập trả'}
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </section>
  );
}
