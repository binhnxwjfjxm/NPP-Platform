import Link from 'next/link';
import { headers } from 'next/headers';
import { authenticateDeliveryUser, deliverySetupPending } from '../../lib/delivery-auth';
import { deliveryCapabilitiesFromHeaders } from '../../lib/delivery-capabilities';
import {
  getPickingCloseState,
  listPickingWork,
  type PickingCloseState,
  type PickingWorkItem,
} from '../../lib/fulfillment-api';
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

function warehouseLabel(lines: readonly PickingWorkItem[]) {
  const labels = [...new Set(lines.map((line) => line.warehouseName || line.warehouseCode || line.warehouseId))];
  return labels.join(' · ');
}

function progressPercent(picked: number, allocated: number) {
  if (!Number.isFinite(picked) || !Number.isFinite(allocated) || allocated <= 0) return 0;
  return Math.max(0, Math.min(100, Math.round((picked / allocated) * 100)));
}

function statusLabel(picked: number, allocated: number, closeState: PickingCloseState | null) {
  if (allocated > 0 && picked >= allocated) return 'Đã đủ';
  if ((closeState?.shortageCount ?? 0) > 0) return 'Soạn thiếu';
  if (picked > 0) return 'Đang soạn';
  return 'Chưa soạn';
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
    const closeStateEntries = await Promise.all(orders.map(async (lines) => {
      const salesOrderId = lines[0].salesOrderId;
      try {
        return [salesOrderId, await getPickingCloseState(user, salesOrderId)] as const;
      } catch {
        return [salesOrderId, null] as const;
      }
    }));
    const closeStates = new Map<string, PickingCloseState | null>(closeStateEntries);

    return (
      <main className="pageShell">
        <header className="appHeader deliveryPageHeader">
          <div>
            <p className="eyebrow">Core Fulfillment</p>
            <h1>Soạn hàng</h1>
            <p className="welcome">Mở một đơn để soạn theo đúng allocation, vị trí và lô từ Core.</p>
          </div>
        </header>

        {orders.length ? (
          <div className={styles.orderList}>
            {orders.map((lines) => {
              const first = lines[0];
              const allocated = lines.reduce((sum, line) => sum + Number(line.allocatedBaseQuantity || 0), 0);
              const picked = lines.reduce((sum, line) => sum + Number(line.pickedBaseQuantity || 0), 0);
              const progress = progressPercent(picked, allocated);
              const closeState = closeStates.get(first.salesOrderId) ?? null;
              const status = statusLabel(picked, allocated, closeState);
              const complete = status === 'Đã đủ';
              return (
                <article className={styles.orderCard} key={first.salesOrderId} data-testid="picking-order-card">
                  <div className={styles.cardTop}>
                    <div>
                      <small>Đơn hàng</small>
                      <h2>{first.orderNumber}</h2>
                    </div>
                    <span className={complete ? styles.doneBadge : styles.statusBadge}>{status}</span>
                  </div>

                  <p className={styles.customer}>{first.customerName || first.customerCode || 'Khách hàng'}</p>
                  <p className={styles.orderWarehouse}>{warehouseLabel(lines)}</p>

                  <div className={styles.progressHeader}>
                    <span>Tiến độ</span>
                    <strong>{quantity(String(picked))} / {quantity(String(allocated || 0))}</strong>
                  </div>
                  <div className={styles.progressTrack} aria-label={`Tiến độ soạn ${progress}%`}>
                    <span className={styles.progressFill} style={{ width: `${progress}%` }} />
                  </div>

                  <div className={styles.cardMetrics}>
                    <div><small>Số mã</small><strong>{lines.length}</strong></div>
                    <div><small>Đã soạn</small><strong>{progress}%</strong></div>
                    <div><small>Thiếu</small><strong>{closeState ? closeState.shortageCount : '—'}</strong></div>
                  </div>

                  {first.requestedDeliveryDate ? (
                    <p className={styles.muted}>Ngày giao dự kiến: {new Date(first.requestedDeliveryDate).toLocaleDateString('vi-VN')}</p>
                  ) : null}

                  <Link className={styles.primaryAction} href={`/picking/orders/${encodeURIComponent(first.salesOrderId)}`}>
                    Mở soạn hàng
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
