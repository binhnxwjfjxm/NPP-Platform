import Link from 'next/link';
import { headers } from 'next/headers';
import { authenticateDeliveryUser, deliverySetupPending } from '../../../lib/delivery-auth';
import { deliveryCapabilitiesFromHeaders } from '../../../lib/delivery-capabilities';
import {
  getPickingCloseState,
  getPickingDemand,
  type PickingAllocation,
  type PickingCandidate,
} from '../../../lib/fulfillment-api';
import { safeErrorMessage } from '../../../lib/presentation';
import PickAllocationPanel from './pick-allocation-panel';
import PickingClosePanel from './picking-close-panel';
import styles from '../picking.module.css';

export const dynamic = 'force-dynamic';

function quantity(value: string) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? new Intl.NumberFormat('vi-VN', { maximumFractionDigits: 3 }).format(parsed) : value;
}

function sameScope(
  left: Readonly<{ locationId: string | null; lotId: string | null }>,
  right: Readonly<{ locationId: string | null; lotId: string | null }>,
) {
  return left.locationId === right.locationId && left.lotId === right.lotId;
}

function remainingAllocation(allocation: PickingAllocation) {
  return Math.max(
    Number(allocation.allocatedBaseQuantity || 0) - Number(allocation.pickedBaseQuantity || 0),
    0,
  );
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

export default async function PickingDetailPage({ params }: Readonly<{ params: { demandId: string } }>) {
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

  try {
    const detail = await getPickingDemand(user, params.demandId);
    const closeState = await getPickingCloseState(user, detail.demand.salesOrderId);
    const { demand, allocations, candidates } = detail;
    const fullyPicked = allocations.length > 0 && allocations.every(
      (allocation) => Number(allocation.pickedBaseQuantity) >= Number(allocation.allocatedBaseQuantity),
    );
    return (
      <main className="pageShell">
        <header className="appHeader deliveryPageHeader">
          <div>
            <p className="eyebrow">{demand.orderNumber} · dòng {demand.lineNumber}</p>
            <h1>{demand.itemName || demand.sku || 'Chi tiết soạn hàng'}</h1>
            <p className="welcome">{demand.customerName || demand.customerCode || 'Khách hàng'} · {demand.warehouseName || demand.warehouseCode}</p>
          </div>
        </header>

        <section className={styles.detailSummary}>
          <div><small>SKU</small><strong>{demand.sku || '—'}</strong></div>
          <div><small>Cần soạn</small><strong>{quantity(demand.allocatedBaseQuantity)} {demand.unitCode || ''}</strong></div>
          <div><small>Đã soạn</small><strong>{quantity(demand.pickedBaseQuantity)} {demand.unitCode || ''}</strong></div>
          <div><small>Người thao tác</small><strong>{user.displayName}</strong></div>
        </section>

        {fullyPicked ? (
          <section className={styles.readyBanner}><strong>Đã soạn đủ mã này</strong><p>Dữ liệu pick đã nằm trong Core Fulfillment.</p></section>
        ) : null}

        {allocations.length ? (
          <div className={styles.allocationList}>
            {allocations.map((allocation) => (
              <PickAllocationPanel
                allocation={allocation}
                demandId={demand.fulfillmentDemandId}
                unitCode={demand.unitCode}
                alternativeSources={alternativeSources(allocation, allocations, candidates)}
                key={allocation.id}
              />
            ))}
          </div>
        ) : (
          <section className="stateCard"><strong>Chưa có phân bổ kho để soạn</strong><p>NPP Core cần tạo Fulfillment allocation trước. Delivery không tự tạo bảng, trạng thái hoặc phân bổ thay Core.</p></section>
        )}

        <PickingClosePanel salesOrderId={demand.salesOrderId} state={closeState} />
        <Link className={styles.secondaryAction} href="/picking">Về danh sách soạn hàng</Link>
      </main>
    );
  } catch (error) {
    return <main className="pageShell"><section className="stateCard errorCard"><strong>Không mở được việc soạn hàng</strong><p>{safeErrorMessage(error)}</p><Link href="/picking">Về danh sách</Link></section></main>;
  }
}
