import Link from 'next/link';
import { headers } from 'next/headers';
import { authenticateDeliveryUser, deliverySetupPending } from '../../lib/delivery-auth';
import { deliveryCapabilitiesFromHeaders } from '../../lib/delivery-capabilities';
import { listPickingWork, type PickingWorkItem } from '../../lib/fulfillment-api';
import { safeErrorMessage } from '../../lib/presentation';
import styles from './picking.module.css';

export const dynamic = 'force-dynamic';

function quantity(value: string) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? new Intl.NumberFormat('vi-VN', { maximumFractionDigits: 3 }).format(parsed) : value;
}

function groupOrders(work: readonly PickingWorkItem[]) {
  const byOrder = new Map<string, PickingWorkItem[]>();
  for (const item of work) {
    const group = byOrder.get(item.salesOrderId) ?? [];
    group.push(item);
    byOrder.set(item.salesOrderId, group);
  }
  return [...byOrder.values()];
}

export default async function PickingPage() {
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
    return <main className="pageShell"><section className="stateCard errorCard"><strong>Không có quyền soạn hàng</strong><p>Cần quyền Core Fulfillment pick và phạm vi kho được cấp.</p></section></main>;
  }

  try {
    const work = await listPickingWork(user);
    const orders = groupOrders(work);
    return (
      <main className="pageShell">
        <header className="appHeader deliveryPageHeader">
          <div>
            <p className="eyebrow">Core Fulfillment</p>
            <h1>Soạn hàng</h1>
            <p className="welcome">Danh sách chỉ gồm kho nằm trong phạm vi tài khoản hiện tại.</p>
          </div>
        </header>

        {orders.length ? (
          <div className={styles.orderList}>
            {orders.map((lines) => {
              const first = lines[0];
              const allocated = lines.reduce((sum, line) => sum + Number(line.allocatedBaseQuantity || 0), 0);
              const picked = lines.reduce((sum, line) => sum + Number(line.pickedBaseQuantity || 0), 0);
              const actionable = lines.find((line) => Number(line.allocatedBaseQuantity) > Number(line.pickedBaseQuantity));
              const target = actionable ?? first;
              const complete = allocated > 0 && picked >= allocated;
              return (
                <article className={styles.orderCard} key={first.salesOrderId}>
                  <div className={styles.cardTop}>
                    <div><small>Đơn hàng</small><h2>{first.orderNumber}</h2></div>
                    <span className={complete ? styles.doneBadge : styles.statusBadge}>{complete ? 'Đã soạn' : first.fulfillmentStatus}</span>
                  </div>
                  <p className={styles.customer}>{first.customerName || first.customerCode || 'Khách hàng'}</p>
                  <dl className={styles.metaGrid}>
                    <div><dt>Kho</dt><dd>{first.warehouseName || first.warehouseCode || first.warehouseId}</dd></div>
                    <div><dt>Người soạn</dt><dd>{user.displayName}</dd></div>
                    <div><dt>Tiến độ</dt><dd>{quantity(String(picked))} / {quantity(String(allocated || 0))}</dd></div>
                    <div><dt>Số dòng</dt><dd>{lines.length}</dd></div>
                  </dl>
                  {first.requestedDeliveryDate ? <p className={styles.muted}>Ngày giao dự kiến: {new Date(first.requestedDeliveryDate).toLocaleDateString('vi-VN')}</p> : null}
                  <Link className={styles.primaryAction} href={`/picking/${target.fulfillmentDemandId}`}>
                    {complete ? 'Xem chi tiết' : actionable ? 'Bắt đầu' : 'Xem chờ phân bổ'}
                  </Link>
                </article>
              );
            })}
          </div>
        ) : (
          <section className="stateCard"><strong>Không có việc soạn hàng</strong><p>Core Fulfillment chưa có nhu cầu trong các kho được cấp cho tài khoản này.</p></section>
        )}
      </main>
    );
  } catch (error) {
    return <main className="pageShell"><section className="stateCard errorCard"><strong>Không tải được danh sách soạn hàng</strong><p>{safeErrorMessage(error)}</p></section></main>;
  }
}
