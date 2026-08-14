'use client';

import type { SalesOrder, SalesOrderVersion } from '../../../lib/sales-order-types';
import { PrintAction, PrintSurface } from '../../components/print-document';
import { collectionLabels, formatMoney } from './sales-order-ui';
import styles from './sales-order-print.module.css';

function textValue(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

function addressText(address: Record<string, unknown> | null): string {
  if (!address) return '—';
  const parts = [
    textValue(address.addressLine1 ?? address.address_line1),
    textValue(address.addressLine2 ?? address.address_line2),
    textValue(address.ward),
    textValue(address.district),
    textValue(address.province),
  ].filter(Boolean);
  return parts.length ? parts.join(', ') : '—';
}

function dateText(value: string | null | undefined): string {
  if (!value) return '—';
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime())
    ? value
    : new Intl.DateTimeFormat('vi-VN', { timeZone: 'Asia/Ho_Chi_Minh' }).format(parsed);
}

export default function SalesOrderPrintSheet({
  order,
  version,
}: {
  order: SalesOrder;
  version: SalesOrderVersion;
}) {
  const displayCustomer = version.customerMode === 'WALK_IN'
    ? version.walkInDisplayName || version.customerName
    : version.customerName;
  const displayPhone = version.customerMode === 'WALK_IN'
    ? version.walkInPhone
    : textValue(version.customerAddress?.phone);

  return (
    <>
      <PrintAction label="In đơn" />
      <PrintSurface>
        <article className={styles.sheet} data-testid="sales-order-print-sheet">
          <header className={styles.header}>
            <div>
              <strong className={styles.brand}>HƯNG PHÁT</strong>
              <p>Chứng từ bán hàng</p>
            </div>
            <div className={styles.titleBlock}>
              <h1>ĐƠN BÁN HÀNG</h1>
              <p>Số: <strong>{order.number ?? 'BẢN NHÁP'}</strong></p>
            </div>
          </header>

          <section className={styles.metaGrid}>
            <div><span>Khách hàng</span><strong>{displayCustomer}</strong></div>
            <div><span>Mã khách</span><strong>{version.customerCode}</strong></div>
            <div><span>Điện thoại</span><strong>{displayPhone || '—'}</strong></div>
            <div><span>Ngày đơn</span><strong>{dateText(version.confirmedAt ?? version.createdAt)}</strong></div>
            <div className={styles.full}><span>Địa chỉ</span><strong>{addressText(version.customerAddress)}</strong></div>
            <div><span>Kho</span><strong>{version.warehouseCode} — {version.warehouseName}</strong></div>
            <div><span>Hình thức giao</span><strong>{version.deliveryMode === 'PICKUP' ? 'Khách nhận tại kho' : 'Giao đến khách'}</strong></div>
            <div><span>Thanh toán</span><strong>{collectionLabels[version.collectionPolicy] ?? version.collectionPolicy}</strong></div>
            <div><span>Ngày giao dự kiến</span><strong>{dateText(version.requestedDeliveryDate)}</strong></div>
          </section>

          <table className={styles.table}>
            <thead>
              <tr>
                <th>STT</th>
                <th>Sản phẩm / SKU</th>
                <th className={styles.right}>Số lượng</th>
                <th className={styles.right}>Đơn giá</th>
                <th className={styles.right}>CK</th>
                <th className={styles.right}>Thuế</th>
                <th className={styles.right}>Thành tiền</th>
              </tr>
            </thead>
            <tbody>
              {(version.lines ?? []).map((line) => (
                <tr key={line.id}>
                  <td>{line.lineNumber}</td>
                  <td><strong>{line.itemName}</strong><small>{line.sku}</small></td>
                  <td className={styles.right}>{line.quantity} {line.unitCode}</td>
                  <td className={styles.right}>{formatMoney(line.unitPrice)}</td>
                  <td className={styles.right}>{formatMoney(line.discountAmount)}</td>
                  <td className={styles.right}>{formatMoney(line.taxAmount)}</td>
                  <td className={styles.right}><strong>{formatMoney(line.lineTotal)}</strong></td>
                </tr>
              ))}
            </tbody>
          </table>

          <section className={styles.summary}>
            <div><span>Tạm tính</span><strong>{formatMoney(version.subtotal)} ₫</strong></div>
            <div><span>Chiết khấu</span><strong>{formatMoney(version.discountTotal)} ₫</strong></div>
            <div><span>Thuế</span><strong>{formatMoney(version.taxTotal)} ₫</strong></div>
            <div className={styles.total}><span>TỔNG CỘNG</span><strong>{formatMoney(version.total)} ₫</strong></div>
          </section>

          {version.note ? <section className={styles.note}><strong>Ghi chú:</strong> {version.note}</section> : null}

          <footer className={styles.signatures}>
            <div><strong>Người lập</strong><span>(Ký, ghi rõ họ tên)</span></div>
            <div><strong>Kho giao hàng</strong><span>(Ký, ghi rõ họ tên)</span></div>
            <div><strong>Khách hàng</strong><span>(Ký, ghi rõ họ tên)</span></div>
          </footer>
        </article>
      </PrintSurface>
    </>
  );
}
