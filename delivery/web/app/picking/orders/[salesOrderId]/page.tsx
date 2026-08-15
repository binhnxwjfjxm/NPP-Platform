import Link from 'next/link';
import { headers } from 'next/headers';
import { authenticateDeliveryUser, deliverySetupPending } from '../../../../lib/delivery-auth';
import { deliveryCapabilitiesFromHeaders } from '../../../../lib/delivery-capabilities';
import {
  getPickingCloseState,
  getPickingDemand,
  listPickingWork,
  type PickingAllocation,
  type PickingCandidate,
  type PickingDemandDetail,
  type PickingWorkItem,
} from '../../../../lib/fulfillment-api';
import { safeErrorMessage } from '../../../../lib/presentation';
import PickAllocationPanel from '../../[demandId]/pick-allocation-panel';
import PickingClosePanel from '../../[demandId]/picking-close-panel';
import styles from '../../picking.module.css';

export const dynamic = 'force-dynamic';
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function quantity(value: string | number) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? new Intl.NumberFormat('vi-VN', { maximumFractionDigits: 3 }).format(parsed) : String(value);
}

function sameScope(
  left: Readonly<{ locationId: string | null; lotId: string | null }>,
  right: Readonly<{ locationId: string | null; lotId: string | null }>,
) {
  return left.locationId === right.locationId && left.lotId === right.lotId;
}

function remainingAllocation(allocation: PickingAllocation) {
  return Math.max(Number(allocation.allocatedBaseQuantity || 0) - Number(allocation.pickedBaseQuantity || 0), 0);
}

function alternativeSources(
  current: PickingAllocation,
  allocations: readonly PickingAllocation[],
  candidates: readonly PickingCandidate[],
) {
  const fromAllocations = allocations
    .filter((allocation) => allocation.id !== current.id && remainingAllocation(allocation) > 0)
    .map((allocation) => ({
      key: `allocation:${allocation.id}`,
      locationLabel: allocation.locationCode || allocation.locationName || 'Không bắt buộc vị trí',
      lotLabel: allocation.lotCode,
      availableBaseQuantity: String(remainingAllocation(allocation)),
    }));
  const fromStock = candidates
    .filter((candidate) => Number(candidate.availableBaseQuantity || 0) > 0)
    .filter((candidate) => !sameScope(candidate, current))
    .filter((candidate) => !allocations.some((allocation) => sameScope(candidate, allocation)))
    .map((candidate) => ({
      key: `stock:${candidate.locationId ?? 'none'}:${candidate.lotId ?? 'none'}`,
      locationLabel: candidate.locationCode || candidate.locationName || 'Không bắt buộc vị trí',
      lotLabel: candidate.lotCode,
      availableBaseQuantity: candidate.availableBaseQuantity,
    }));
  return [...fromAllocations, ...fromStock];
}

function itemStatus(line: PickingWorkItem) {
  const allocated = Number(line.allocatedBaseQuantity || 0);
  const picked = Number(line.pickedBaseQuantity || 0);
  if (allocated > 0 && picked >= allocated) return 'Đã đủ';
  if (picked > 0) return 'Đang soạn';
  return 'Chưa soạn';
}

function warehouses(lines: readonly PickingWorkItem[]) {
  return [...new Set(lines.map((line) => line.warehouseName || line.warehouseCode || line.warehouseId))].join(' · ');
}

export default async function PickingOrderPage({ params }: Readonly<{ params: { salesOrderId: string } }>) {
  if (deliverySetupPending()) {
    return <main className="pageShell"><section className="stateCard"><strong>Soạn hàng chưa sẵn sàng</strong><p>Ứng dụng đang chờ phiên nhân viên thật.</p></section></main>;
  }

  const headerStore = headers();
  const user = authenticateDeliveryUser(headerStore.get('authorization'));
  const capabilities = deliveryCapabilitiesFromHeaders(headerStore);
  if (!user) {
    return <main className="pageShell"><section className="stateCard errorCard"><strong>Không xác định được nhân viên</strong><p>Vui lòng đăng nhập lại.</p></section></main>;
  }
  if (!capabilities.canPickWithWarehouse) {
    return <main className="pageShell"><section className="stateCard errorCard"><strong>Không có quyền soạn hàng</strong><p>Phạm vi kho và quyền pick do NPP Core kiểm soát.</p></section></main>;
  }
  if (!UUID_PATTERN.test(params.salesOrderId)) {
    return <main className="pageShell"><section className="stateCard errorCard"><strong>Đơn soạn hàng không hợp lệ</strong><Link href="/picking">Về danh sách</Link></section></main>;
  }

  try {
    const work = await listPickingWork(user);
    const orderLines = work.filter((line) => line.salesOrderId === params.salesOrderId);
    if (!orderLines.length) {
      return <main className="pageShell"><section className="stateCard"><strong>Không còn việc soạn cho đơn này</strong><p>Core Fulfillment không trả về dòng soạn nào trong phạm vi kho hiện tại.</p><Link href="/picking">Về danh sách</Link></section></main>;
    }

    const [details, closeState] = await Promise.all([
      Promise.all(orderLines.map((line) => getPickingDemand(user, line.fulfillmentDemandId))),
      getPickingCloseState(user, params.salesOrderId),
    ]);
    const detailByDemand = new Map<string, PickingDemandDetail>(
      details.map((detail) => [detail.demand.fulfillmentDemandId, detail]),
    );
    const first = orderLines[0];
    const allocated = orderLines.reduce((sum, line) => sum + Number(line.allocatedBaseQuantity || 0), 0);
    const picked = orderLines.reduce((sum, line) => sum + Number(line.pickedBaseQuantity || 0), 0);
    const remaining = Math.max(allocated - picked, 0);

    return (
      <main className="pageShell">
        <Link className={styles.backLink} href="/picking">← Danh sách soạn hàng</Link>
        <header className="appHeader deliveryPageHeader">
          <div>
            <p className="eyebrow">Đơn {first.orderNumber}</p>
            <h1>{first.customerName || first.customerCode || 'Soạn hàng'}</h1>
            <p className="welcome">{warehouses(orderLines)}</p>
          </div>
        </header>

        <section className={styles.orderSummary} data-testid="picking-order-summary">
          <div><small>Số mã</small><strong>{orderLines.length}</strong></div>
          <div><small>Đã soạn</small><strong>{quantity(picked)} / {quantity(allocated)}</strong></div>
          <div><small>Còn lại</small><strong>{quantity(remaining)}</strong></div>
          <div><small>Thiếu</small><strong>{closeState.shortageCount}</strong></div>
        </section>

        <div className={styles.itemList}>
          {orderLines.map((line) => {
            const detail = detailByDemand.get(line.fulfillmentDemandId);
            if (!detail) return null;
            const lineRemaining = Math.max(Number(line.allocatedBaseQuantity || 0) - Number(line.pickedBaseQuantity || 0), 0);
            const status = itemStatus(line);
            return (
              <section className={styles.itemCard} key={line.fulfillmentDemandId} data-testid="picking-item-card">
                <div className={styles.itemHeader}>
                  <div>
                    <small>{line.sku || `Dòng ${line.lineNumber}`}</small>
                    <h2>{line.itemName || line.sku || 'Mã hàng'}</h2>
                  </div>
                  <span className={status === 'Đã đủ' ? styles.doneBadge : styles.statusBadge}>{status}</span>
                </div>

                <div className={styles.itemMetrics}>
                  <div><small>Cần soạn</small><strong>{quantity(line.allocatedBaseQuantity)} {line.unitCode || ''}</strong></div>
                  <div><small>Đã soạn</small><strong>{quantity(line.pickedBaseQuantity)} {line.unitCode || ''}</strong></div>
                  <div><small>Còn lại</small><strong>{quantity(lineRemaining)} {line.unitCode || ''}</strong></div>
                </div>

                {detail.allocations.length ? (
                  <div className={styles.allocationList}>
                    {detail.allocations.map((allocation) => (
                      <PickAllocationPanel
                        allocation={allocation}
                        demandId={line.fulfillmentDemandId}
                        unitCode={line.unitCode}
                        alternativeSources={alternativeSources(allocation, detail.allocations, detail.candidates)}
                        key={allocation.id}
                      />
                    ))}
                  </div>
                ) : (
                  <div className={styles.emptyAllocation}>
                    <strong>Chưa có allocation</strong>
                    <p>Core cần phân bổ kho/vị trí/lô trước khi Delivery có thể thao tác.</p>
                  </div>
                )}
              </section>
            );
          })}
        </div>

        <PickingClosePanel salesOrderId={params.salesOrderId} state={closeState} />
      </main>
    );
  } catch (error) {
    return <main className="pageShell"><section className="stateCard errorCard"><strong>Không mở được đơn soạn hàng</strong><p>{safeErrorMessage(error)}</p><Link href="/picking">Về danh sách</Link></section></main>;
  }
}
