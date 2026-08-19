'use client';

import { useState } from 'react';
import type { DeliveryAttemptLine, TripAssignment } from '../../../lib/types';
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
  if (!value) return '0';
  return value.replace(/\.0+$/, '').replace(/(\.\d*?)0+$/, '$1') || '0';
}

function baseUnitLabel(line: DeliveryAttemptLine): string {
  return line.baseUnitCode || 'đơn vị tồn';
}

function unitRelationship(line: DeliveryAttemptLine): string | null {
  if (!line.unitCode || !line.baseUnitCode || !line.conversionToBase) return null;
  const conversion = quantity(line.conversionToBase);
  if (line.unitCode === line.baseUnitCode && conversion === '1') return null;
  return `1 ${line.unitCode} = ${conversion} ${line.baseUnitCode}`;
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
          {assignment.lines.length ? assignment.lines.map((line) => {
            const relationship = unitRelationship(line);
            return (
              <article className={styles.item} key={line.inventoryIssueLineId}>
                <div>
                  <strong>{line.itemName || line.sku || 'Mặt hàng'}</strong>
                  <span>{[line.sku, line.unitCode ? `Bán theo ${line.unitCode}` : null].filter(Boolean).join(' · ')}</span>
                  {relationship ? <span>Quy cách: {relationship}</span> : null}
                </div>
                <div className={styles.price}>
                  {line.issuedUnitQuantity !== null && line.issuedUnitQuantity !== undefined && line.unitCode ? (
                    <span>
                      {quantity(line.issuedUnitQuantity)} {line.unitCode}
                      {line.unitPrice ? ` × ${money(line.unitPrice, assignment.currencyCode)}` : ''}
                    </span>
                  ) : (
                    <span>Đã xuất: {quantity(line.issuedBaseQuantity)} {baseUnitLabel(line)}</span>
                  )}
                  <strong>{line.lineAmount ? money(line.lineAmount, assignment.currencyCode) : '—'}</strong>
                </div>
              </article>
            );
          }) : (
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