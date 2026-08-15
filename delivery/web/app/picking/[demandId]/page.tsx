import Link from 'next/link';
import { headers } from 'next/headers';
import { authenticateDeliveryUser, deliverySetupPending } from '../../../lib/delivery-auth';
import { deliveryCapabilitiesFromHeaders } from '../../../lib/delivery-capabilities';
import { getPickingDemand } from '../../../lib/fulfillment-api';
import { safeErrorMessage } from '../../../lib/presentation';
import PickAllocationPanel from './pick-allocation-panel';
import styles from '../picking.module.css';

export const dynamic = 'force-dynamic';

function quantity(value: string) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? new Intl.NumberFormat('vi-VN', { maximumFractionDigits: 3 }).format(parsed) : value;
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
    const { demand, allocations } = detail;
    const fullyPicked = allocations.length > 0 && allocations.every((allocation) => Number(allocation.pickedBaseQuantity) >= Number(allocation.allocatedBaseQuantity));
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
          <section className={styles.readyBanner}><strong>Đã soạn đủ</strong><p>Dữ liệu đã nằm trong Core Fulfillment. Bước đóng gói/hoàn tất tiếp tục theo state machine canonical, Delivery không tạo trạng thái riêng.</p></section>
        ) : null}

        {allocations.length ? (
          <div className={styles.allocationList}>
            {allocations.map((allocation) => (
              <PickAllocationPanel
                allocation={allocation}
                demandId={demand.fulfillmentDemandId}
                unitCode={demand.unitCode}
                key={allocation.id}
              />
            ))}
          </div>
        ) : (
          <section className="stateCard"><strong>Chưa có phân bổ kho để soạn</strong><p>NPP Core cần tạo Fulfillment allocation trước. Delivery không tự tạo bảng, trạng thái hoặc phân bổ thay Core.</p></section>
        )}

        <Link className={styles.secondaryAction} href="/picking">Về danh sách soạn hàng</Link>
      </main>
    );
  } catch (error) {
    return <main className="pageShell"><section className="stateCard errorCard"><strong>Không mở được việc soạn hàng</strong><p>{safeErrorMessage(error)}</p><Link href="/picking">Về danh sách</Link></section></main>;
  }
}
