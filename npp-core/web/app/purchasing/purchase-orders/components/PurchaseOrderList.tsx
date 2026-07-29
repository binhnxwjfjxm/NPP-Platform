'use client';

import type { PurchaseOrder } from '../../../../lib/purchase-order-types';
import {
  formatDecimalString,
  formatPurchaseOrderAmount,
  formatPurchaseOrderDate,
  purchaseOrderActionPolicy,
  PURCHASE_ORDER_STATUS_LABELS,
} from '../../../../lib/purchase-order-types';
import styles from '../../../organization/organization.module.css';

type Props = {
  purchaseOrders: PurchaseOrder[];
  permissionKeys: readonly string[];
  onView: (purchaseOrder: PurchaseOrder) => void;
  onEdit: (purchaseOrder: PurchaseOrder) => void;
};

function statusTone(status: PurchaseOrder['status']): string {
  if (status === 'approved' || status === 'fully_received' || status === 'closed') return styles.toneSuccess;
  if (status === 'cancelled') return styles.toneDanger;
  return '';
}

export default function PurchaseOrderList({ purchaseOrders, permissionKeys, onView, onEdit }: Props) {
  if (purchaseOrders.length === 0) {
    return (
      <div className={styles.emptyState} data-testid="purchase-orders-empty-state">
        Chưa có đơn đặt hàng phù hợp với bộ lọc hiện tại.
      </div>
    );
  }

  return (
    <div className={styles.tableWrap}>
      <table className={styles.table} data-testid="purchase-orders-table">
        <thead>
          <tr>
            <th>Số đơn</th>
            <th>Ngày đặt</th>
            <th>Nhà cung cấp</th>
            <th>Kho nhận</th>
            <th>Số dòng</th>
            <th>Tổng giá trị</th>
            <th>Trạng thái</th>
            <th>Người tạo</th>
            <th>Thao tác</th>
          </tr>
        </thead>
        <tbody>
          {purchaseOrders.map((purchaseOrder) => {
            const policy = purchaseOrderActionPolicy(purchaseOrder.status, permissionKeys);
            return (
              <tr key={purchaseOrder.id} data-testid={`purchase-order-row-${purchaseOrder.id}`}>
                <td>
                  <div className={styles.entityStack}>
                    <strong>{purchaseOrder.number || 'Chưa cấp số'}</strong>
                    <span>{purchaseOrder.supplierReference || 'Không có tham chiếu nhà cung cấp'}</span>
                  </div>
                </td>
                <td>{formatPurchaseOrderDate(purchaseOrder.placedAt)}</td>
                <td>{purchaseOrder.supplierName || 'Chưa có tên nhà cung cấp'}</td>
                <td>{purchaseOrder.warehouseName || 'Chưa có tên kho nhận'}</td>
                <td>{formatDecimalString(String(purchaseOrder.lines.length))}</td>
                <td>{formatPurchaseOrderAmount(purchaseOrder.total, purchaseOrder.currency || 'VND')}</td>
                <td>
                  <span className={`${styles.statusPill} ${statusTone(purchaseOrder.status)}`}>
                    {PURCHASE_ORDER_STATUS_LABELS[purchaseOrder.status]}
                  </span>
                </td>
                <td>{purchaseOrder.createdByName || 'Chưa xác định'}</td>
                <td>
                  <div className={styles.rowActions}>
                    {policy.view ? (
                      <button type="button" onClick={() => onView(purchaseOrder)}>
                        Xem chi tiết
                      </button>
                    ) : null}
                    {policy.edit ? (
                      <button type="button" onClick={() => onEdit(purchaseOrder)}>
                        Chỉnh sửa
                      </button>
                    ) : null}
                    {!policy.view && !policy.edit ? <span>Không có quyền thao tác</span> : null}
                  </div>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
