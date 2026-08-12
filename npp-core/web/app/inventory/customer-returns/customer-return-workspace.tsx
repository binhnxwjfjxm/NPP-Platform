'use client';

import Link from 'next/link';
import { useEffect, useMemo, useRef, useState } from 'react';
import { AppShell } from '../../components/app-shell';
import { WorkspaceTabPanel, WorkspaceTabs, type WorkspaceTabOption } from '../../components/workspace-tabs';
import styles from '../delivery-orders/delivery-order-workspace.module.css';

type ReturnEligibility = {
  issueLineId: string;
  issueId: string;
  inventoryMovementId: string;
  inventoryMovementLineId: string;
  deliveryOrderId: string;
  deliveryOrderNumber: string | null;
  salesOrderId: string;
  salesOrderNumber: string | null;
  deliveryOrderLineId: string;
  salesOrderLineId: string;
  customerId: string;
  customerCode: string;
  customerName: string;
  warehouseId: string;
  warehouseCode: string;
  warehouseName: string;
  locationId: string | null;
  locationCode: string | null;
  baseVariantId: string;
  lotId: string | null;
  lotCode: string | null;
  sku: string;
  itemName: string;
  unitCode: string;
  issuedBaseQuantity: string;
  claimedReturnBaseQuantity: string;
  availableReturnBaseQuantity: string;
};

type CustomerReturnLine = {
  id: string;
  lineNumber: number;
  deliveryOrderNumber: string | null;
  salesOrderNumber: string | null;
  locationCode: string | null;
  lotCode: string | null;
  sku: string;
  itemName: string;
  unitCode: string;
  requestedBaseQuantity: string;
  acceptedBaseQuantity: string;
  reasonCode: string;
  reasonNote: string;
};

type CustomerReturn = {
  id: string;
  number: string | null;
  customerCode: string;
  customerName: string;
  warehouseCode: string;
  warehouseName: string;
  status: 'draft' | 'received' | 'cancelled';
  note: string | null;
  revision: string;
  lineCount?: number;
  requestedBaseQuantity?: string;
  acceptedBaseQuantity?: string;
  inventoryMovementId?: string | null;
  cancellationReason?: string | null;
  lines?: CustomerReturnLine[];
};

type ApiEnvelope<T> = { data?: T; error?: { message?: string } };
type CustomerReturnTab = 'create' | 'process';

const CUSTOMER_RETURN_TABS: readonly WorkspaceTabOption<CustomerReturnTab>[] = [
  { id: 'create', label: 'Lập phiếu trả' },
  { id: 'process', label: 'Nhận & xử lý' },
];

const SCALE = 1_000_000_000_000n;

function parseQuantity(value: string): bigint {
  const normalized = String(value ?? '').trim();
  if (!/^(0|[1-9]\d*)(?:\.\d{1,12})?$/.test(normalized)) return -1n;
  const [whole = '0', fraction = ''] = normalized.split('.');
  return BigInt(whole) * SCALE + BigInt(fraction.padEnd(12, '0'));
}

function formatQuantity(value: string | null | undefined): string {
  const normalized = String(value ?? '0');
  return normalized.includes('.') ? normalized.replace(/(\.\d*?[1-9])0+$|\.0+$/, '$1') : normalized;
}

function localDate(): string {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Ho_Chi_Minh', year: 'numeric', month: '2-digit', day: '2-digit',
  }).formatToParts(new Date());
  return `${parts.find((part) => part.type === 'year')?.value}-${parts.find((part) => part.type === 'month')?.value}-${parts.find((part) => part.type === 'day')?.value}`;
}

function statusLabel(value: CustomerReturn['status']): string {
  return { draft: 'Nháp chờ nhận', received: 'Đã nhận vào kho', cancelled: 'Đã hủy' }[value];
}

function keyFor(prefix: string, ...parts: string[]): string {
  return `${prefix}-${parts.join('-')}`.replace(/[^A-Za-z0-9._:-]/g, '_').slice(0, 128);
}

async function requestJson<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(path, {
    cache: 'no-store',
    ...init,
    headers: {
      Accept: 'application/json',
      ...(init?.body ? { 'Content-Type': 'application/json' } : {}),
      ...(init?.headers ?? {}),
    },
  });
  const envelope = await response.json().catch(() => ({})) as ApiEnvelope<T>;
  if (!response.ok || envelope.data === undefined) {
    throw new Error(envelope.error?.message || 'Không thực hiện được thao tác hàng khách trả.');
  }
  return envelope.data;
}

export default function CustomerReturnWorkspace() {
  const [activeTab, setActiveTab] = useState<CustomerReturnTab>('create');
  const [eligibility, setEligibility] = useState<ReturnEligibility[]>([]);
  const [returns, setReturns] = useState<CustomerReturn[]>([]);
  const [selectedEligibilityId, setSelectedEligibilityId] = useState<string | null>(null);
  const [selectedReturnId, setSelectedReturnId] = useState<string | null>(null);
  const [selectedReturn, setSelectedReturn] = useState<CustomerReturn | null>(null);
  const [quantity, setQuantity] = useState('');
  const [reasonCode, setReasonCode] = useState('DAMAGED_OR_UNWANTED');
  const [reasonNote, setReasonNote] = useState('');
  const [note, setNote] = useState('');
  const [accepted, setAccepted] = useState<Record<string, string>>({});
  const [cancelReason, setCancelReason] = useState('');
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const requestRef = useRef(0);

  const selectedEligibility = eligibility.find((row) => row.issueLineId === selectedEligibilityId) ?? null;
  const counts = useMemo(() => ({
    eligible: eligibility.length,
    draft: returns.filter((item) => item.status === 'draft').length,
    received: returns.filter((item) => item.status === 'received').length,
    cancelled: returns.filter((item) => item.status === 'cancelled').length,
  }), [eligibility, returns]);

  function seedAccepted(detail: CustomerReturn | null) {
    setAccepted(detail ? Object.fromEntries(
      (detail.lines ?? []).map((line) => [line.id, line.requestedBaseQuantity]),
    ) : {});
  }

  async function loadAll(preferredReturnId?: string | null) {
    const requestNumber = requestRef.current + 1;
    requestRef.current = requestNumber;
    setLoading(true); setError(null);
    try {
      const [nextEligibility, nextReturns] = await Promise.all([
        requestJson<ReturnEligibility[]>('/api/customer-returns/eligibility?limit=1000'),
        requestJson<CustomerReturn[]>('/api/customer-returns?limit=500'),
      ]);
      if (requestRef.current !== requestNumber) return;
      setEligibility(nextEligibility);
      setReturns(nextReturns);
      const source = nextEligibility.find((row) => row.issueLineId === selectedEligibilityId) ?? nextEligibility[0] ?? null;
      setSelectedEligibilityId(source?.issueLineId ?? null);
      setQuantity(source?.availableReturnBaseQuantity ?? '');
      const target = preferredReturnId && nextReturns.some((item) => item.id === preferredReturnId)
        ? preferredReturnId
        : selectedReturnId && nextReturns.some((item) => item.id === selectedReturnId)
          ? selectedReturnId
          : nextReturns[0]?.id ?? null;
      setSelectedReturnId(target);
      if (target) await loadDetail(target, requestNumber);
      else { setSelectedReturn(null); seedAccepted(null); }
    } catch (loadError) {
      if (requestRef.current === requestNumber) setError(loadError instanceof Error ? loadError.message : 'Không tải được hàng khách trả.');
    } finally {
      if (requestRef.current === requestNumber) setLoading(false);
    }
  }

  async function loadDetail(customerReturnId: string, parentRequest?: number) {
    const requestNumber = parentRequest ?? requestRef.current + 1;
    if (parentRequest === undefined) requestRef.current = requestNumber;
    setBusy(`detail-${customerReturnId}`); setError(null); setSelectedReturnId(customerReturnId);
    try {
      const detail = await requestJson<CustomerReturn>(`/api/customer-returns/${customerReturnId}`);
      if (requestRef.current !== requestNumber) return;
      setSelectedReturn(detail); seedAccepted(detail); setCancelReason('');
    } catch (loadError) {
      if (requestRef.current === requestNumber) setError(loadError instanceof Error ? loadError.message : 'Không tải được chi tiết phiếu trả.');
    } finally {
      if (requestRef.current === requestNumber) setBusy(null);
    }
  }

  async function createReturn() {
    if (!selectedEligibility) return;
    const quantityScaled = parseQuantity(quantity);
    if (quantityScaled <= 0n || quantityScaled > parseQuantity(selectedEligibility.availableReturnBaseQuantity)) {
      setError('Số lượng trả phải lớn hơn 0 và không vượt phần còn có thể trả.');
      return;
    }
    if (!reasonNote.trim()) { setError('Nhập lý do chi tiết của hàng khách trả.'); return; }
    const fingerprint = `${selectedEligibility.issueLineId}:${quantity}:${reasonCode}:${reasonNote.trim()}`;
    setBusy('create'); setError(null); setNotice(null);
    try {
      const result = await requestJson<{ customerReturn: CustomerReturn }>('/api/customer-returns', {
        method: 'POST',
        headers: { 'Idempotency-Key': keyFor('create-return', fingerprint) },
        body: JSON.stringify({
          note: note.trim() || undefined,
          lines: [{ issueLineId: selectedEligibility.issueLineId, quantity, reasonCode, reasonNote: reasonNote.trim() }],
        }),
      });
      setNotice('Đã tạo phiếu hàng khách trả nháp; tồn kho chưa thay đổi.');
      setReasonNote(''); setNote('');
      setActiveTab('process');
      await loadAll(result.customerReturn.id);
    } catch (operationError) {
      setError(operationError instanceof Error ? operationError.message : 'Không tạo được phiếu hàng khách trả.');
    } finally { setBusy(null); }
  }

  async function transition(action: 'receive' | 'cancel') {
    if (!selectedReturn) return;
    let body: Record<string, unknown>;
    let fingerprint: string;
    if (action === 'receive') {
      const lines = (selectedReturn.lines ?? []).map((line) => ({
        customerReturnLineId: line.id,
        acceptedQuantity: String(accepted[line.id] ?? '0').trim(),
      }));
      if (lines.some((line) => {
        const source = selectedReturn.lines?.find((item) => item.id === line.customerReturnLineId);
        const value = parseQuantity(line.acceptedQuantity);
        return !source || value < 0n || value > parseQuantity(source.requestedBaseQuantity);
      }) || !lines.some((line) => parseQuantity(line.acceptedQuantity) > 0n)) {
        setError('Số lượng thực nhận không hợp lệ hoặc tất cả đều bằng 0.');
        return;
      }
      body = { documentDate: localDate(), expectedRevision: selectedReturn.revision, lines };
      fingerprint = `${selectedReturn.revision}:${lines.map((line) => `${line.customerReturnLineId}:${line.acceptedQuantity}`).join('|')}`;
    } else {
      if (!cancelReason.trim()) { setError('Nhập lý do hủy phiếu nháp.'); return; }
      body = { reason: cancelReason.trim() };
      fingerprint = `${selectedReturn.revision}:${cancelReason.trim()}`;
    }
    setBusy(action); setError(null); setNotice(null);
    try {
      await requestJson(`/api/customer-returns/${selectedReturn.id}/${action}`, {
        method: 'POST',
        headers: { 'Idempotency-Key': keyFor(`return-${action}`, selectedReturn.id, fingerprint) },
        body: JSON.stringify(body),
      });
      setNotice(action === 'receive'
        ? 'Đã xác nhận thực nhận và ghi Inventory IN theo đúng movement nguồn.'
        : 'Đã hủy phiếu nháp; số lượng nguồn được mở lại để lập phiếu khác.');
      await loadAll(selectedReturn.id);
    } catch (operationError) {
      setError(operationError instanceof Error ? operationError.message : 'Không cập nhật được phiếu hàng khách trả.');
    } finally { setBusy(null); }
  }

  useEffect(() => { void loadAll(); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, []);

  return (
    <AppShell kicker="Kho và bán hàng" title="Hàng khách trả" subtitle="Lập phiếu từ đúng dòng đã xuất; chỉ xác nhận thực nhận mới tăng tồn kho.">
      <div className={styles.page} data-testid="customer-return-workspace">
        <section className={styles.hero}>
          <div><p className={styles.eyebrow}>Nguồn trả bất biến</p><h2>Nhận hàng khách trả có đối chiếu</h2><p>Yêu cầu trả hoặc giao thất bại không tự hoàn kho. Kho phải xác nhận số lượng thực nhận.</p></div>
          <div className={styles.actions}>
            <Link href="/inventory/delivery-orders" className={styles.secondaryButton}>Bàn giao giao nhận</Link>
            <button type="button" className={styles.secondaryButton} onClick={() => void loadAll(selectedReturnId)} disabled={loading || busy !== null}>{loading ? 'Đang tải...' : 'Làm mới'}</button>
          </div>
        </section>

        <section className={styles.stats} aria-label="Tổng hợp hàng khách trả">
          <article><strong>{counts.eligible}</strong><span>Dòng còn có thể trả</span></article>
          <article><strong>{counts.draft}</strong><span>Phiếu nháp</span></article>
          <article><strong>{counts.received}</strong><span>Đã nhận kho</span></article>
          <article><strong>{counts.cancelled}</strong><span>Đã hủy</span></article>
        </section>
        {error ? <div className={styles.error} role="alert" data-testid="customer-return-error">{error}</div> : null}
        {notice ? <div className={styles.notice} role="status" data-testid="customer-return-notice">{notice}</div> : null}

        <WorkspaceTabs
          tabs={CUSTOMER_RETURN_TABS}
          activeTab={activeTab}
          onChange={setActiveTab}
          idPrefix="customer-return-workflow"
          label="Nghiệp vụ hàng khách trả"
        />

        <WorkspaceTabPanel tabId="create" activeTab={activeTab} idPrefix="customer-return-workflow">
          <section className={styles.panel}>
            <div className={styles.panelHeader}><div><h3>Dòng hàng đã xuất</h3><p>Chọn đúng movement line còn số lượng có thể trả.</p></div></div>
            <div className={styles.queue}>
              {eligibility.length === 0 ? <p className={styles.empty}>Không có dòng đã xuất nào còn có thể lập phiếu trả.</p> : null}
              {eligibility.map((row) => (
                <button type="button" key={row.issueLineId} className={`${styles.queueItem} ${selectedEligibilityId === row.issueLineId ? styles.active : ''}`} onClick={() => { setSelectedEligibilityId(row.issueLineId); setQuantity(row.availableReturnBaseQuantity); }} data-testid={`return-eligible-${row.issueLineId}`}>
                  <span className={styles.queueTop}><strong>{row.deliveryOrderNumber || 'Delivery Order'}</strong><em>Còn {formatQuantity(row.availableReturnBaseQuantity)}</em></span>
                  <span>{row.customerCode} — {row.customerName}</span>
                  <span>{row.sku} — {row.itemName}</span>
                  <small>{row.warehouseCode} · {row.locationCode || 'Không vị trí'} · Lô {row.lotCode || 'Không lô'}</small>
                </button>
              ))}
            </div>
            {selectedEligibility ? (
              <div className={styles.builder}>
                <div className={styles.detailHeader}><div><p className={styles.eyebrow}>{selectedEligibility.deliveryOrderNumber || 'Delivery Order'}</p><h3>{selectedEligibility.sku} — {selectedEligibility.itemName}</h3><p>{selectedEligibility.customerCode} — {selectedEligibility.customerName}</p></div><span className={styles.status}>Đã xuất {formatQuantity(selectedEligibility.issuedBaseQuantity)}</span></div>
                <div className={styles.actions}>
                  <label className={styles.cancelField}>Số lượng khách trả<input inputMode="decimal" value={quantity} onChange={(event) => setQuantity(event.target.value)} aria-label="Số lượng khách trả" /><small>Tối đa {formatQuantity(selectedEligibility.availableReturnBaseQuantity)} {selectedEligibility.unitCode}</small></label>
                  <label className={styles.cancelField}>Mã lý do<select value={reasonCode} onChange={(event) => setReasonCode(event.target.value)} aria-label="Mã lý do trả hàng"><option value="DAMAGED_OR_UNWANTED">Hư hỏng / không nhận</option><option value="WRONG_ITEM">Sai hàng</option><option value="QUALITY_COMPLAINT">Khiếu nại chất lượng</option><option value="OTHER">Khác</option></select></label>
                  <label className={styles.cancelField}>Lý do chi tiết<input value={reasonNote} onChange={(event) => setReasonNote(event.target.value)} maxLength={2000} aria-label="Lý do chi tiết" /></label>
                  <label className={styles.cancelField}>Ghi chú phiếu<input value={note} onChange={(event) => setNote(event.target.value)} maxLength={4000} aria-label="Ghi chú phiếu trả" /></label>
                  <button type="button" className={styles.primaryButton} onClick={() => void createReturn()} disabled={busy !== null} data-testid="customer-return-create">{busy === 'create' ? 'Đang tạo...' : 'Tạo phiếu trả nháp'}</button>
                </div>
              </div>
            ) : null}
          </section>
        </WorkspaceTabPanel>

        <WorkspaceTabPanel tabId="process" activeTab={activeTab} idPrefix="customer-return-workflow">
          <section className={styles.panel}>
            <div className={styles.panelHeader}><div><h3>Phiếu hàng khách trả</h3><p>Phiếu nháp chưa làm tăng tồn kho.</p></div></div>
            <div className={styles.queue}>
              {returns.length === 0 ? <p className={styles.empty}>Chưa có phiếu hàng khách trả.</p> : null}
              {returns.map((item) => (
                <button type="button" key={item.id} className={`${styles.queueItem} ${selectedReturnId === item.id ? styles.active : ''}`} onClick={() => void loadDetail(item.id)} data-testid={`customer-return-${item.id}`}>
                  <span className={styles.queueTop}><strong>{item.number || 'Phiếu nháp'}</strong><em>{statusLabel(item.status)}</em></span>
                  <span>{item.customerCode} — {item.customerName}</span>
                  <small>{item.warehouseCode} · {item.lineCount ?? 0} dòng · Yêu cầu {formatQuantity(item.requestedBaseQuantity)}</small>
                </button>
              ))}
            </div>
            {selectedReturn ? (
              <div className={styles.builder}>
                <div className={styles.detailHeader}><div><p className={styles.eyebrow}>{selectedReturn.number || 'Phiếu hàng khách trả nháp'}</p><h3>{selectedReturn.customerCode} — {selectedReturn.customerName}</h3><p>{selectedReturn.warehouseCode} — {selectedReturn.warehouseName}</p></div><span className={styles.status}>{statusLabel(selectedReturn.status)}</span></div>
                <div className={styles.lines}>
                  {(selectedReturn.lines ?? []).map((line) => (
                    <article key={line.id}><div><strong>{line.sku} — {line.itemName}</strong><span>{line.deliveryOrderNumber} · {line.locationCode || 'Không vị trí'} · Lô {line.lotCode || 'Không lô'}</span><small>{line.reasonCode}: {line.reasonNote}</small></div>{selectedReturn.status === 'draft' ? <label>Thực nhận<input inputMode="decimal" value={accepted[line.id] ?? ''} onChange={(event) => setAccepted((current) => ({ ...current, [line.id]: event.target.value }))} aria-label={`Thực nhận ${line.sku}`} /><small>Tối đa {formatQuantity(line.requestedBaseQuantity)} {line.unitCode}</small></label> : <strong>Nhận {formatQuantity(line.acceptedBaseQuantity)} {line.unitCode}</strong>}</article>
                  ))}
                </div>
                {selectedReturn.status === 'draft' ? (
                  <div className={styles.actions}>
                    <button type="button" className={styles.primaryButton} onClick={() => void transition('receive')} disabled={busy !== null} data-testid="customer-return-receive">{busy === 'receive' ? 'Đang nhận kho...' : 'Xác nhận thực nhận và nhập kho'}</button>
                    <label className={styles.cancelField}>Lý do hủy nháp<input value={cancelReason} onChange={(event) => setCancelReason(event.target.value)} maxLength={1000} aria-label="Lý do hủy phiếu trả" /></label>
                    <button type="button" className={styles.dangerButton} onClick={() => void transition('cancel')} disabled={busy !== null} data-testid="customer-return-cancel">{busy === 'cancel' ? 'Đang hủy...' : 'Hủy phiếu nháp'}</button>
                  </div>
                ) : null}
                {selectedReturn.inventoryMovementId ? <p>Movement nhập kho: {selectedReturn.inventoryMovementId}</p> : null}
                {selectedReturn.cancellationReason ? <p className={styles.cancelled}>Lý do hủy: {selectedReturn.cancellationReason}</p> : null}
              </div>
            ) : null}
          </section>
        </WorkspaceTabPanel>
      </div>
    </AppShell>
  );
}
