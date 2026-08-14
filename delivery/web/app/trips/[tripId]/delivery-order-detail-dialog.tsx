'use client';

import { useState } from 'react';
import type { TripAssignment } from '../../../lib/types';
import MobileActionDialog from './mobile-action-dialog';
import styles from './delivery-order-detail-dialog.module.css';

type Props = Readonly<{ assignment: TripAssignment }>;

function money(value: string | null | undefined, currencyCode: string | null | undefined) {
  const number = Number(value ?? 0);
  const currency = currencyCode || 'VND';
  if (!Number.isFinite(number)) return `${value ?? '0'} ${currency}`;
  return new Intl.NumberFormat('vi-VN', {
    style: 'currency',
    currency,
    maximumFractionDigits: 0,
  }).format(number);
}

function quantity(value: string | null | undefined) {
  const number = Number(value ?? 0);
  return Number.isFinite(number)
    ? new Intl.NumberFormat('vi-VN', { maximumFractionDigits: 3 }).format(number)
    : value || '0';
}

export default function DeliveryOrderDetailDialog({ assignment }: Props) {
  const [open, setOpen] = useState(false);
  const priced = assignment.totalAmount !== null && assignment.totalAmount !== undefined;

  return (
    <>
      <button className={styles.trigger} type="button" onClick={() => setOpen(true)}>Chi tiết đơn</button>
      <MobileActionDialog
        open={open}
        onClose={() => setOpen(false)}
        eyebrow="Chi tiết đơn giao"
        title={assignment.deliveryOrderNumber || 'Phiếu giao'}
      >
        <section className={styles.totalCard}>
          <span>Giá trị đơn</span>
          <strong>{priced ? money(assignment.totalAmount, assignment.currencyCode) : 'Chưa có dữ liệu giá'}</strong>
          <small>{assignment.lines.length} mặt hàng · chỉ đọc để tài xế đối chiếu</small>
        </section>

        <div className={styles.items}>
          {assignment.lines.length ? assignment.lines.map((line) => (
            <article className={styles.item} key={line.inventoryIssueLineId}>
              <div>
                <strong>{line.itemName || line.sku || 'Mặt hàng'}</strong>
                <span>{[line.sku, line.unitCode].filter(Boolean).join(' · ')}</span>
              </div>
              <div className={styles.price}>
                <span>
                  {quantity(line.issuedUnitQuantity ?? line.issuedBaseQuantity)} {line.unitCode || ''}
                  {line.unitPrice ? ` × ${money(line.unitPrice, assignment.currencyCode)}` : ''}
                </span>
                <strong>{line.lineAmount ? money(line.lineAmount, assignment.currencyCode) : '—'}</strong>
              </div>
            </article>
          )) : (
            <p className={styles.empty}>Chưa có dữ liệu hàng xuất kho để đối chiếu.</p>
          )}
        </div>

        <dl className={styles.meta}>
          <div><dt>Khách hàng</dt><dd>{assignment.customerName || assignment.customerCode || 'Chưa có'}</dd></div>
          <div><dt>Ngày yêu cầu</dt><dd>{assignment.requestedDeliveryDate || 'Chưa có'}</dd></div>
        </dl>
      </MobileActionDialog>
    </>
  );
}
