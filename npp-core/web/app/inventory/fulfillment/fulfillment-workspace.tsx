'use client';

import { createIdempotencyKey } from '@npp/contracts';
import { useEffect, useMemo, useRef, useState } from 'react';
import { AppShell } from '../../components/app-shell';
import styles from './fulfillment-workspace.module.css';

type WorkItem = {
  fulfillmentDemandId: string;
  salesOrderId: string;
  orderNumber: string | null;
  fulfillmentStatus: string;
  requestedDeliveryDate: string | null;
  sourceType: string;
  customerCode: string;
  customerName: string;
  warehouseId: string;
  warehouseCode: string;
  warehouseName: string;
  lineNumber: number;
  itemName: string;
  sku: string;
  unitCode: string;
  orderedBaseQuantity: string;
  reservedBaseQuantity: string;
  backorderedBaseQuantity: string;
  allocatedBaseQuantity: string;
  pickedBaseQuantity: string;
  packedBaseQuantity: string;
  allocationCount: number;
};

type Candidate = {
  rank: number;
  locationId: string | null;
  locationCode: string | null;
  locationName: string | null;
  lotId: string | null;
  lotCode: string | null;
  expiryDate: string | null;
  firstReceivedAt: string | null;
  availableBaseQuantity: string;
  allocationPolicy: 'FEFO' | 'FIFO';
};

type Allocation = {
  id: string;
  locationId: string | null;
  locationCode: string | null;
  locationName: string | null;
  lotId: string | null;
  lotCode: string | null;
  expiryDate: string | null;
  allocationPolicy: 'FEFO' | 'FIFO' | 'MANUAL';
  manualOverrideReason: string | null;
  allocatedBaseQuantity: string;
  pickedBaseQuantity: string;
  packedBaseQuantity: string;
  state: 'ACTIVE' | 'COMPLETED';
};

type SuggestionDetail = {
  remainingBaseQuantity: string;
  candidates: Candidate[];
  suggestedPlan: Array<{
    locationId: string | null;
    lotId: string | null;
    allocationPolicy: 'FEFO' | 'FIFO';
    policyRank: number;
    quantity: string;
  }>;
  allocations: Allocation[];
};

type ApiEnvelope<T> = {
  data?: T;
  error?: { message?: string; code?: string };
};

const SCALE = 1_000_000_000_000n;
const IDEMPOTENCY_INTENT_CACHE_LIMIT = 256;
const idempotencyKeys = new Map<string, string>();

function parseQuantity(value: string): bigint {
  const [whole = '0', fraction = ''] = String(value ?? '0').split('.');
  return BigInt(whole || '0') * SCALE + BigInt((fraction || '').padEnd(12, '0').slice(0, 12));
}

function quantityDifference(left: string, right: string): string {
  const result = parseQuantity(left) - parseQuantity(right);
  const safe = result > 0n ? result : 0n;
  const whole = safe / SCALE;
  const fraction = String(safe % SCALE).padStart(12, '0');
  return `${whole}.${fraction}`;
}

function formatQuantity(value: string): string {
  const normalized = String(value ?? '0');
  if (!normalized.includes('.')) return normalized;
  return normalized.replace(/(\.\d*?[1-9])0+$|\.0+$/, '$1');
}

function formatDate(value: string | null): string {
  if (!value) return 'Chưa đặt';
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? value : new Intl.DateTimeFormat('vi-VN').format(date);
}

function statusLabel(value: string): string {
  const labels: Record<string, string> = {
    backordered: 'Chờ hàng',
    partially_reserved: 'Giữ một phần',
    reserved: 'Đã giữ hàng',
    partially_allocated: 'Phân bổ một phần',
    allocated: 'Đã phân bổ',
    partially_picked: 'Đang soạn',
    picked: 'Đã soạn',
    partially_packed: 'Đang đóng gói',
    packed: 'Đã đóng gói',
  };
  return labels[value] ?? value;
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
    throw new Error(envelope.error?.message || 'Không thực hiện được thao tác kho.');
  }
  return envelope.data;
}

function keyFor(prefix: string, id: string, fingerprint: string): string {
  const intent = `${prefix}:${id}:${fingerprint}`;
  const existing = idempotencyKeys.get(intent);
  if (existing) return existing;
  const key = createIdempotencyKey(`fulfillment-${prefix}`);
  if (idempotencyKeys.size >= IDEMPOTENCY_INTENT_CACHE_LIMIT) {
    const oldest = idempotencyKeys.keys().next().value;
    if (oldest) idempotencyKeys.delete(oldest);
  }
  idempotencyKeys.set(intent, key);
  return key;
}

export default function FulfillmentWorkspace() {
  const [work, setWork] = useState<WorkItem[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [detail, setDetail] = useState<SuggestionDetail | null>(null);
  const [search, setSearch] = useState('');
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const detailRequestRef = useRef(0);

  const selectedWork = work.find((item) => item.fulfillmentDemandId === selectedId) ?? null;
  const filteredWork = useMemo(() => {
    const term = search.trim().toLocaleLowerCase('vi');
    if (!term) return work;
    return work.filter((item) => [
      item.orderNumber,
      item.customerCode,
      item.customerName,
      item.warehouseCode,
      item.warehouseName,
      item.sku,
      item.itemName,
      statusLabel(item.fulfillmentStatus),
    ].filter(Boolean).join(' ').toLocaleLowerCase('vi').includes(term));
  }, [search, work]);

  async function loadWork(preferredId?: string | null) {
    setLoading(true);
    setError(null);
    try {
      const next = await requestJson<WorkItem[]>('/api/inventory/fulfillment-work?limit=500');
      setWork(next);
      const target = preferredId && next.some((item) => item.fulfillmentDemandId === preferredId)
        ? preferredId
        : selectedId && next.some((item) => item.fulfillmentDemandId === selectedId)
          ? selectedId
          : next[0]?.fulfillmentDemandId ?? null;
      setSelectedId(target);
      if (target) await loadDetail(target);
      else {
        detailRequestRef.current += 1;
        setDetail(null);
      }
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : 'Không tải được hàng đợi kho.');
    } finally {
      setLoading(false);
    }
  }

  async function loadDetail(demandId: string) {
    const requestNumber = detailRequestRef.current + 1;
    detailRequestRef.current = requestNumber;
    setBusy(`detail-${demandId}`);
    setError(null);
    setSelectedId(demandId);
    try {
      const next = await requestJson<SuggestionDetail>(
        `/api/inventory/fulfillment-demands/${demandId}/suggestions`,
      );
      if (detailRequestRef.current !== requestNumber) return;
      setDetail(next);
    } catch (loadError) {
      if (detailRequestRef.current !== requestNumber) return;
      setError(loadError instanceof Error ? loadError.message : 'Không tải được đề xuất vị trí/lô.');
    } finally {
      if (detailRequestRef.current === requestNumber) setBusy(null);
    }
  }

  async function autoAllocate() {
    if (!selectedId || !detail) return;
    const remainingFingerprint = detail.remainingBaseQuantity;
    setBusy('allocate');
    setError(null);
    setNotice(null);
    try {
      await requestJson(
        `/api/inventory/fulfillment-demands/${selectedId}/allocate`,
        {
          method: 'POST',
          headers: {
            'Idempotency-Key': keyFor('allocate', selectedId, remainingFingerprint),
          },
          body: JSON.stringify({ mode: 'AUTO' }),
        },
      );
      setNotice('Đã phân bổ phần hàng còn lại theo thứ tự FEFO/FIFO.');
      await loadWork(selectedId);
    } catch (operationError) {
      setError(operationError instanceof Error ? operationError.message : 'Không phân bổ được hàng.');
    } finally {
      setBusy(null);
    }
  }

  async function updateProgress(allocation: Allocation, action: 'pick' | 'pack') {
    const currentProgress = action === 'pick'
      ? allocation.pickedBaseQuantity
      : allocation.packedBaseQuantity;
    const quantity = action === 'pick'
      ? quantityDifference(allocation.allocatedBaseQuantity, allocation.pickedBaseQuantity)
      : quantityDifference(allocation.pickedBaseQuantity, allocation.packedBaseQuantity);
    if (parseQuantity(quantity) <= 0n) return;
    setBusy(`${action}-${allocation.id}`);
    setError(null);
    setNotice(null);
    try {
      await requestJson(
        `/api/inventory/fulfillment-allocations/${allocation.id}/${action}`,
        {
          method: 'POST',
          headers: {
            'Idempotency-Key': keyFor(action, allocation.id, `${currentProgress}:${quantity}`),
          },
          body: JSON.stringify({ quantity }),
        },
      );
      setNotice(action === 'pick'
        ? 'Đã xác nhận soạn phần hàng còn lại của dòng phân bổ.'
        : 'Đã xác nhận đóng gói phần hàng đã soạn.');
      await loadWork(selectedId);
    } catch (operationError) {
      setError(operationError instanceof Error ? operationError.message : 'Không cập nhật được tiến độ kho.');
    } finally {
      setBusy(null);
    }
  }

  useEffect(() => {
    void loadWork();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const counts = useMemo(() => ({
    waiting: work.filter((item) => ['backordered', 'partially_reserved', 'reserved'].includes(item.fulfillmentStatus)).length,
    allocating: work.filter((item) => ['partially_allocated', 'allocated'].includes(item.fulfillmentStatus)).length,
    picking: work.filter((item) => ['partially_picked', 'picked'].includes(item.fulfillmentStatus)).length,
    packing: work.filter((item) => ['partially_packed', 'packed'].includes(item.fulfillmentStatus)).length,
  }), [work]);

  return (
    <AppShell
      kicker="Kho và hoàn tất đơn"
      title="Chuẩn bị hàng"
      subtitle="Phân bổ đúng vị trí/lô, xác nhận soạn và đóng gói phần hàng đã được giữ cho đơn bán hàng."
    >
      <div className={styles.page} data-testid="fulfillment-workspace">
        <section className={styles.hero}>
          <div>
            <p className={styles.eyebrow}>Hàng đợi kho</p>
            <h2>Đơn đã xác nhận cần chuẩn bị</h2>
            <p>Kho chỉ thao tác phần đã giữ. FEFO áp dụng cho hàng có hạn dùng; FIFO áp dụng cho hàng không theo dõi hạn dùng.</p>
          </div>
          <button type="button" className={styles.secondaryButton} onClick={() => void loadWork(selectedId)} disabled={loading || busy !== null}>
            {loading ? 'Đang tải...' : 'Làm mới'}
          </button>
        </section>

        <section className={styles.stats} aria-label="Tổng hợp hàng đợi kho">
          <article><strong>{counts.waiting}</strong><span>Chờ phân bổ</span></article>
          <article><strong>{counts.allocating}</strong><span>Đang phân bổ</span></article>
          <article><strong>{counts.picking}</strong><span>Đang soạn</span></article>
          <article><strong>{counts.packing}</strong><span>Đóng gói</span></article>
        </section>

        {error ? <div className={styles.error} role="alert" data-testid="fulfillment-error">{error}</div> : null}
        {notice ? <div className={styles.notice} role="status" data-testid="fulfillment-notice">{notice}</div> : null}

        <div className={styles.layout}>
          <section className={styles.queuePanel}>
            <div className={styles.panelHeader}>
              <div>
                <h3>Đơn và mặt hàng</h3>
                <p>{filteredWork.length} dòng công việc trong phạm vi kho được cấp.</p>
              </div>
              <input
                value={search}
                onChange={(event) => setSearch(event.target.value)}
                placeholder="Tìm đơn, khách, SKU..."
                aria-label="Tìm đơn, khách hàng hoặc SKU"
                className={styles.search}
                data-testid="fulfillment-search"
              />
            </div>
            <div className={styles.queue}>
              {filteredWork.length === 0 ? <p className={styles.empty}>Không có công việc kho phù hợp.</p> : null}
              {filteredWork.map((item) => (
                <button
                  type="button"
                  key={item.fulfillmentDemandId}
                  className={`${styles.queueItem} ${selectedId === item.fulfillmentDemandId ? styles.queueItemActive : ''}`}
                  onClick={() => void loadDetail(item.fulfillmentDemandId)}
                  data-testid={`fulfillment-work-${item.fulfillmentDemandId}`}
                >
                  <span className={styles.queueTop}>
                    <strong>{item.orderNumber || 'Đơn chưa có số'}</strong>
                    <em>{statusLabel(item.fulfillmentStatus)}</em>
                  </span>
                  <span>{item.customerCode} — {item.customerName}</span>
                  <span>{item.sku} — {item.itemName}</span>
                  <small>{item.warehouseCode} · Giao {formatDate(item.requestedDeliveryDate)}</small>
                  <span className={styles.quantities}>
                    Giữ {formatQuantity(item.reservedBaseQuantity)} · Phân bổ {formatQuantity(item.allocatedBaseQuantity)} · Soạn {formatQuantity(item.pickedBaseQuantity)} · Gói {formatQuantity(item.packedBaseQuantity)}
                  </span>
                </button>
              ))}
            </div>
          </section>

          <section className={styles.detailPanel}>
            {!selectedWork ? <p className={styles.empty}>Chọn một dòng công việc để chuẩn bị hàng.</p> : (
              <>
                <div className={styles.detailHeader}>
                  <div>
                    <p className={styles.eyebrow}>{selectedWork.orderNumber || 'Đơn bán hàng'}</p>
                    <h3>{selectedWork.sku} — {selectedWork.itemName}</h3>
                    <p>{selectedWork.customerCode} — {selectedWork.customerName}</p>
                  </div>
                  <span className={styles.status}>{statusLabel(selectedWork.fulfillmentStatus)}</span>
                </div>

                <div className={styles.quantityGrid}>
                  <article><span>Đặt</span><strong>{formatQuantity(selectedWork.orderedBaseQuantity)}</strong></article>
                  <article><span>Đã giữ</span><strong>{formatQuantity(selectedWork.reservedBaseQuantity)}</strong></article>
                  <article><span>Còn thiếu</span><strong>{formatQuantity(selectedWork.backorderedBaseQuantity)}</strong></article>
                  <article><span>Đã phân bổ</span><strong>{formatQuantity(selectedWork.allocatedBaseQuantity)}</strong></article>
                  <article><span>Đã soạn</span><strong>{formatQuantity(selectedWork.pickedBaseQuantity)}</strong></article>
                  <article><span>Đã đóng gói</span><strong>{formatQuantity(selectedWork.packedBaseQuantity)}</strong></article>
                </div>

                <div className={styles.actionBar}>
                  <div>
                    <strong>Phân bổ theo hệ thống</strong>
                    <p>Hệ thống chọn lô gần hết hạn trước hoặc hàng nhập trước theo chính sách SKU.</p>
                  </div>
                  <button
                    type="button"
                    className={styles.primaryButton}
                    onClick={autoAllocate}
                    disabled={!detail || parseQuantity(detail.remainingBaseQuantity) <= 0n || busy !== null}
                    data-testid="fulfillment-auto-allocate"
                  >
                    {busy === 'allocate' ? 'Đang phân bổ...' : 'Phân bổ phần còn lại'}
                  </button>
                </div>

                <section className={styles.subsection}>
                  <div className={styles.subsectionHeader}>
                    <h4>Đề xuất vị trí và lô</h4>
                    <span>Còn {formatQuantity(detail?.remainingBaseQuantity ?? '0')} cần phân bổ</span>
                  </div>
                  <div className={styles.candidates}>
                    {(detail?.candidates ?? []).slice(0, 12).map((candidate) => (
                      <article key={`${candidate.locationId ?? 'none'}-${candidate.lotId ?? 'none'}`}>
                        <strong>#{candidate.rank} · {candidate.locationCode || 'Không vị trí'}</strong>
                        <span>Lô {candidate.lotCode || 'Không lô'} · {candidate.allocationPolicy}</span>
                        <span>Khả dụng {formatQuantity(candidate.availableBaseQuantity)}</span>
                        <small>{candidate.expiryDate ? `HSD ${formatDate(candidate.expiryDate)}` : `Nhập đầu ${formatDate(candidate.firstReceivedAt)}`}</small>
                      </article>
                    ))}
                    {detail && detail.candidates.length === 0 ? <p className={styles.empty}>Không còn vị trí/lô khả dụng.</p> : null}
                  </div>
                </section>

                <section className={styles.subsection}>
                  <div className={styles.subsectionHeader}>
                    <h4>Các dòng đã phân bổ</h4>
                    <span>{detail?.allocations.length ?? 0} dòng</span>
                  </div>
                  <div className={styles.allocations}>
                    {(detail?.allocations ?? []).map((allocation) => {
                      const pickRemaining = quantityDifference(allocation.allocatedBaseQuantity, allocation.pickedBaseQuantity);
                      const packRemaining = quantityDifference(allocation.pickedBaseQuantity, allocation.packedBaseQuantity);
                      return (
                        <article key={allocation.id} data-testid={`fulfillment-allocation-${allocation.id}`}>
                          <div className={styles.allocationHead}>
                            <div>
                              <strong>{allocation.locationCode || 'Không vị trí'} · Lô {allocation.lotCode || 'Không lô'}</strong>
                              <span>{allocation.allocationPolicy}{allocation.expiryDate ? ` · HSD ${formatDate(allocation.expiryDate)}` : ''}</span>
                            </div>
                            <em>{allocation.state === 'COMPLETED' ? 'Đã đóng gói' : 'Đang xử lý'}</em>
                          </div>
                          <div className={styles.progressRow}>
                            <span>Phân bổ <strong>{formatQuantity(allocation.allocatedBaseQuantity)}</strong></span>
                            <span>Soạn <strong>{formatQuantity(allocation.pickedBaseQuantity)}</strong></span>
                            <span>Gói <strong>{formatQuantity(allocation.packedBaseQuantity)}</strong></span>
                          </div>
                          <div className={styles.allocationActions}>
                            <button
                              type="button"
                              className={styles.secondaryButton}
                              disabled={parseQuantity(pickRemaining) <= 0n || busy !== null}
                              onClick={() => void updateProgress(allocation, 'pick')}
                            >
                              {busy === `pick-${allocation.id}` ? 'Đang xác nhận...' : `Soạn ${formatQuantity(pickRemaining)}`}
                            </button>
                            <button
                              type="button"
                              className={styles.primaryButton}
                              disabled={parseQuantity(packRemaining) <= 0n || busy !== null}
                              onClick={() => void updateProgress(allocation, 'pack')}
                            >
                              {busy === `pack-${allocation.id}` ? 'Đang xác nhận...' : `Đóng gói ${formatQuantity(packRemaining)}`}
                            </button>
                          </div>
                        </article>
                      );
                    })}
                    {detail && detail.allocations.length === 0 ? <p className={styles.empty}>Chưa có dòng phân bổ.</p> : null}
                  </div>
                </section>
              </>
            )}
          </section>
        </div>
      </div>
    </AppShell>
  );
}
