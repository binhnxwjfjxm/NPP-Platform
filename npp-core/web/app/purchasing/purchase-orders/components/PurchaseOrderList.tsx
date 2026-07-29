"use client";

import React from 'react';
import type { PurchaseOrder } from '../../../../lib/purchase-order-types';

export default function PurchaseOrderList({ purchaseOrders }: { purchaseOrders: PurchaseOrder[]; }) {
  if (!purchaseOrders || purchaseOrders.length === 0) {
    return <div>Không có đơn đặt hàng</div>;
  }

  return (
    <table style={{ width: '100%', borderCollapse: 'collapse' }}>
      <thead>
        <tr>
          <th>Số PO</th>
          <th>Ngày đặt</th>
          <th>Nhà cung cấp</th>
          <th>Kho nhận</th>
          <th>Tổng dòng</th>
          <th>Tổng giá trị</th>
          <th>Trạng thái</th>
          <th>Người tạo</th>
          <th>Hành động</th>
        </tr>
      </thead>
      <tbody>
        {purchaseOrders.map((po) => (
          <tr key={po.id} style={{ borderTop: '1px solid #eee' }}>
            <td>{po.number ?? '(Nháp)'}</td>
            <td>{new Date(po.placedAt).toLocaleDateString('vi-VN')}</td>
            <td>{po.supplierName ?? po.supplierId}</td>
            <td>{po.warehouseId}</td>
            <td>{po.lines?.length ?? 0}</td>
            <td>{Number(po.total).toLocaleString('vi-VN')}</td>
            <td>{po.status}</td>
            <td>{po.createdBy ?? ''}</td>
            <td>
              <button type="button">Xem</button>
              {' '}
              {po.status === 'draft' && <button type="button">Sửa</button>}
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}
