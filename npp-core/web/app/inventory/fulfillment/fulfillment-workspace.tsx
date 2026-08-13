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

type OrderGroup = {
  salesOrderId: string;
  orderNumber: string | null;
  customerCode: string;
  customerName: string;
  warehouseCode: string;
  warehouseName: string;
  requestedDeliveryDate: string | null;
  items: WorkItem[];
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

function groupBySalesOrder(items: WorkItem[]): OrderGroup[] {
  const groups = new Map<string, OrderGroup>();
  for (const item of items) {
    const existing = groups.get(item.salesOrderId);
    if (existing) {
      existing.items.push(item);
      continue;
    }
    groups.set(item.salesOrderId, {
      salesOrderId: item.salesOrderId,
      orderNumber: item.orderNumber,
      customerCode: item.customerCode,
      customerName: item.customerName,
      warehouseCode: item.warehouseCode,
      warehouseName: item.warehouseName,
      requestedDeliveryDate: item.requestedDeliveryDate,
      items: [item],
    });
  }
  return Array.from(groups.values()).map((group) => ({
    ...group,
    items: [...group.items].sort((left, right) => left.lineNumber - right.lineNumber),
  }));
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
  const groupedWork = useMemo(() => groupBySalesOrder(work), [work]);
  const filteredGroups = useMemo(() => {
    const term = search.trim().toLocaleLowerCase('vi');
    if (!term) return groupedWork;
    return groupedWork.filter((group) => [
      group.orderNumber,
      group.customerCode,
      group.customerName,
      group.warehouseCode,
      group.warehouseName,
      ...group.items.flatMap((item) => [
        item.sku,
        item.itemName,
        statusLabel(item.fulfillmentStatus),
      ]),
    ].filter(Boolean).join(' ').toLocaleLowerCase('vi').includes(term));
  }, [groupedWork, search]);
  const visibleProductCount = useMemo(
    () => filteredGroups.reduce((total, group) => total + group.items.length, 0),
    [filteredGroups],
  );

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
      setError(loadError instanceof Error ? loadError.message : 'Không tải được vị trí/lô gợi ý.');
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
      setNotice('Đã phân bổ phần hàng còn lại vào vị trí/lô phù hợp.');
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
        ? 'Đã xác nhận soạn phần hàng còn lại.'
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
      subtitle="Theo từng đơn hàng: chọn vị trí/lô, xác nhận soạn và đóng gói phần hàng đã được giữ."
    >
      <div className={styles.page} data-testid="fulfillment-workspace">
        <section className={styles.hero}>
          <div>
            <p className={styles.eyebrow}>Hàng đợi kho</p>
            <h2>Đơn đã xác nhận cần chuẩn bị</h2>
            <p>Chọn một đơn, sau đó chọn từng sản phẩm để xem vị trí/lô và thực hiện phần việc kho.</p>
          </div>
          <button type="button" className={styles.secondaryButton} onClick={() => void loadWork(selectedId)} disabled={loading || busy !== null}>
            {loading ? 'Đang tải...' : 'Làm mới'}
          </button>
        </section>

        <section className={styles.stats} aria-label="Tổng hợp hàng đợi kho">
          <article><strong>{counts.waiting}</strong><span>Chờ phân bổ</span></article>
          <article><strong>{counts.allocating}</strong><span>Đã phân bổ</span></article>
          <article><strong>{counts.picking}</strong><span>Đang soạn</span></article>
          <article><strong>{counts.packing}</strong><span>Đóng gói</span></article>
        </section>

        {error ? <div className={styles.error} role="alert" data-testid="fulfillment-error">{error}</div> : null}
        {notice ? <div className={styles.notice} role="status" data-testid="fulfillment-notice">{notice}</div> : null}

        <div className={styles.layout}>
          <section className={styles.queuePanel}>
            <div className={styles.panelHeader}>
              <div>
                <h3>Đơn cần chuẩn bị</h3>
                <p>{filteredGroups.length} đơn · {visibleProductCount} sản phẩm trong phạm vi kho được cấp.</p>
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
              {filteredGroups.length === 0 ? <p className={styles.empty}>Không có đơn hàng phù hợp.</p> : null}
              {filteredGroups.map((group) => (
                <article
                  key={group.salesOrderId}
                  className={styles.orderGroup}
                  data-testid={`fulfillment-order-${group.salesOrderId}`}
                >
                  <div className={styles.orderGroupHeader}>
                    <div>
                      <strong>{group.orderNumber || 'Đơn chưa có số'}</strong>
                      <span>{group.customerCode} — {group.customerName}</span>
                    </div>
                    <small>{group.items.length} sản phẩm</small>
                  </div>
                  <div className={styles.productList}>
                    {group.items.map((item) => (
                      <button
                        type="button"
                        key={item.fulfillmentDemandId}
                        className={`${styles.queueItem} ${selectedId === item.fulfillmentDemandId ? styles.queueItemActive : ''}`}
                        onClick={() => void loadDetail(item.fulfillmentDemandId)}
                        data-testid={`fulfillment-product-${item.fulfillmentDemandId}`}
                      >
                        <span className={styles.queueTop}>
                          <strong>{item.itemName}</strong>
                          <em>{statusLabel(item.fulfillmentStatus)}</em>
                        </span>
                        <span className={styles.productMeta}>
                          {item.sku} · SL {formatQuantity(item.orderedBaseQuantity)} {item.unitCode}
                        </span>
                        <small>{item.warehouseCode} · Giao {formatDate(item.requestedDeliveryDate)}</small>
                        <span className={styles.quantities}>
                          Giữ {formatQuantity(item.reservedBaseQuantity)} · Phân bổ {formatQuantity(item.allocatedBaseQuantity)} · Soạn {formatQuantity(item.pickedBaseQuantity)} · Gói {formatQuantity(item.packedBaseQuantity)}
                        </span>
                      </button>
                    ))}
                  </div>
                </article>
              ))}
            </div>
          </section>

          <section className={styles.detailPanel}>
            {!selectedWork ? <p className={styles.empty}>Chọn một sản phẩm trong đơn để chuẩn bị hàng.</p> : (
              <>
                <div className={styles.detailHeader}>
                  <div>
                    <p className={styles.eyebrow}>{selectedWork.orderNumber || 'Đơn bán hàng'}</p>
                    <h3>{selectedWork.itemName}</h3>
                    <p>{selectedWork.sku} · SL {formatQuantity(selectedWork.orderedBaseQuantity)} {selectedWork.unitCode} · {selectedWork.customerName}</p>
                  </div>
                  <span className={styles.status}>{statusLabel(selectedWork.fulfillmentStatus)}</span>
                </div>

                <div className={styles.quantityGrid}>
                  <article><span>Đặt</span><strong>{formatQuantity(selectedWork.orderedBaseQuantity)} {selectedWork.unitCode}</strong></article>
                  <article><span>Đã giữ</span><strong>{formatQuantity(selectedWork.reservedBaseQuantity)} {selectedWork.unitCode}</strong></article>
                  <article><span>Còn thiếu</span><strong>{formatQuantity(selectedWork.backorderedBaseQuantity)} {selectedWork.unitCode}</strong></article>
                  <article><span>Đã phân bổ</span><strong>{formatQuantity(selectedWork.allocatedBaseQuantity)} {selectedWork.unitCode}</strong></article>
                  <article><span>Đã soạn</span><strong>{formatQuantity(selectedWork.pickedBaseQuantity)} {selectedWork.unitCode}</strong></article>
                  <article><span>Đã đóng gói</span><strong>{formatQuantity(selectedWork.packedBaseQuantity)} {selectedWork.unitCode}</strong></article>
                </div>

                <div className={styles.actionBar}>
                  <div>
                    <strong>Phân bổ theo hệ thống</strong>
                    <p>Hệ thống tự chọn vị trí/lô phù hợp theo hạn dùng và thứ tự nhập hàng.</p>
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
                    <h4>Vị trí và lô gợi ý</h4>
                    <span>Còn {formatQuantity(detail?.remainingBaseQuantity ?? '0')} {selectedWork.unitCode} cần phân bổ</span>
                  </div>
                  <div className={styles.candidates}>
                    {(detail?.candidates ?? []).slice(0, 12).map((candidate) => (
                      <article key={`${candidate.locationId ?? 'none'}-${candidate.lotId ?? 'none'}`}>
                        <strong>#{candidate.rank} · {candidate.locationCode || 'Chưa có vị trí'}</strong>
                        <span>Lô {candidate.lotCode || 'Không theo lô'}</span>
                        <span>Khả dụng {formatQuantity(candidate.availableBaseQuantity)} {selectedWork.unitCode}</span>
                        <small>{candidate.expiryDate ? `HSD ${formatDate(candidate.expiryDate)}` : `Nhập đầu ${formatDate(candidate.firstReceivedAt)}`}</small>
                      </article>
                    ))}
                    {detail && detail.candidates.length === 0 ? <p className={styles.empty}>Không còn vị trí/lô khả dụng.</p> : null}
                  </div>
                </section>

                <section className={styles.subsection}>
                  <div className={styles.subsectionHeader}>
                    <h4>Vị trí/lô đã chọn</h4>
                    <span>{detail?.allocations.length ?? 0} vị trí/lô</span>
                  </div>
                  <div className={styles.allocations}>
                    {(detail?.allocations ?? []).map((allocation) => {
                      const pickRemaining = quantityDifference(allocation.allocatedBaseQuantity, allocation.pickedBaseQuantity);
                      const packRemaining = quantityDifference(allocation.pickedBaseQuantity, allocation.packedBaseQuantity);
                      return (
                        <article key={allocation.id} data-testid={`fulfillment-allocation-${allocation.id}`}>
                          <div className={styles.allocationHead}>
                            <div>
                              <strong>{allocation.locationCode || 'Chưa có vị trí'} · Lô {allocation.lotCode || 'Không theo lô'}</strong>
                              <span>{allocation.expiryDate ? `HSD ${formatDate(allocation.expiryDate)}` : 'Không theo dõi hạn dùng'}</span>
                            </div>
                            <em>{allocation.state === 'COMPLETED' ? 'Đã đóng gói' : 'Đang xử lý'}</em>
                          </div>
                          <div className={styles.progressRow}>
                            <span>Phân bổ <strong>{formatQuantity(allocation.allocatedBaseQuantity)} {selectedWork.unitCode}</strong></span>
                            <span>Soạn <strong>{formatQuantity(allocation.pickedBaseQuantity)} {selectedWork.unitCode}</strong></span>
                            <span>Gói <strong>{formatQuantity(allocation.packedBaseQuantity)} {selectedWork.unitCode}</strong></span>
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
                    {detail && detail.allocations.length === 0 ? <p className={styles.empty}>Chưa có vị trí/lô đã phân bổ.</p> : null}
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
