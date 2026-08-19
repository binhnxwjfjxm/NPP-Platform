'use client';

import { useEffect, useState } from 'react';
import type { SalesOrder, SalesOrderVersion } from '../../../lib/sales-order-types';
import BusinessDocumentPrint from '../../components/business-document-print';
import { collectionLabels, deliveryMethodLabel, formatMoney, formatQuantity } from './sales-order-ui';

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

function isZeroAmount(value: string | number | null | undefined) {
  const normalized = String(value ?? '').trim();
  return /^[-+]?0+(?:\.0+)?$/.test(normalized);
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
  const lines = version.lines ?? [];
  const showDiscount = !isZeroAmount(version.discountTotal)
    || lines.some((line) => !isZeroAmount(line.discountAmount));
  const showTax = !isZeroAmount(version.taxTotal)
    || lines.some((line) => !isZeroAmount(line.taxAmount));
  const printKey = `sales-order:last-print:${order.id}`;
  const printFingerprint = `${order.id}:${version.id}:${version.revision}`;
  const [changedAfterPrint, setChangedAfterPrint] = useState(false);

  useEffect(() => {
    try {
      const previous = window.localStorage.getItem(printKey);
      setChangedAfterPrint(Boolean(previous && previous !== printFingerprint));
    } catch {
      setChangedAfterPrint(false);
    }
  }, [printFingerprint, printKey]);

  function recordPrint() {
    try {
      window.localStorage.setItem(printKey, printFingerprint);
      setChangedAfterPrint(false);
    } catch {
      // Việc lưu dấu lần in chỉ phục vụ nhắc người dùng, không ảnh hưởng nghiệp vụ.
    }
  }

  return (
    <div>
      <BusinessDocumentPrint
        id={`sales-order-${order.id}-${version.id}`}
        documentType="SALES_ORDER"
        actionLabel="In đơn"
        onPrint={recordPrint}
        title="ĐƠN BÁN HÀNG"
        subtitle="Chứng từ bán hàng"
        number={order.number ?? 'BẢN NHÁP'}
        meta={[
          { key: 'customer', label: 'Khách hàng', value: displayCustomer },
          { key: 'customer_code', label: 'Mã khách', value: version.customerCode },
          { key: 'phone', label: 'Điện thoại', value: displayPhone || '—' },
          { key: 'document_date', label: 'Ngày đơn', value: dateText(version.confirmedAt ?? version.createdAt) },
          { key: 'address', label: 'Địa chỉ', value: addressText(version.customerAddress), full: true },
          { key: 'warehouse', label: 'Kho', value: `${version.warehouseCode} — ${version.warehouseName}` },
          { key: 'delivery_method', label: 'Hình thức giao nhận', value: deliveryMethodLabel(version) },
          { key: 'collection_policy', label: 'Thanh toán', value: collectionLabels[version.collectionPolicy] ?? version.collectionPolicy },
          { key: 'requested_delivery_date', label: 'Ngày giao dự kiến', value: dateText(version.requestedDeliveryDate) },
        ]}
        columns={[
          { key: 'no', fieldKey: 'line_no', label: 'STT', align: 'center' },
          { key: 'item', fieldKey: 'line_item', label: 'Sản phẩm / SKU' },
          { key: 'quantity', fieldKey: 'line_quantity', label: 'Số lượng', align: 'right' },
          { key: 'unitPrice', fieldKey: 'line_unit_price', label: 'Đơn giá', align: 'right' },
          ...(showDiscount ? [{ key: 'discount', fieldKey: 'line_discount', label: 'CK', align: 'right' as const }] : []),
          ...(showTax ? [{ key: 'tax', fieldKey: 'line_tax', label: 'Thuế', align: 'right' as const }] : []),
          { key: 'total', fieldKey: 'line_total', label: 'Thành tiền', align: 'right' },
        ]}
        rows={lines.map((line) => ({
          id: line.id,
          cells: {
            no: line.lineNumber,
            item: <><strong>{line.itemName}</strong><br />{line.sku}</>,
            quantity: `${formatQuantity(line.quantity)} ${line.unitCode}`,
            unitPrice: formatMoney(line.unitPrice),
            discount: formatMoney(line.discountAmount),
            tax: formatMoney(line.taxAmount),
            total: <strong>{formatMoney(line.lineTotal)}</strong>,
          },
        }))}
        totals={[
          { key: 'total_subtotal', label: 'Tạm tính', value: `${formatMoney(version.subtotal)} ₫` },
          ...(showDiscount ? [{ key: 'total_discount', label: 'Chiết khấu', value: `${formatMoney(version.discountTotal)} ₫` }] : []),
          ...(showTax ? [{ key: 'total_tax', label: 'Thuế', value: `${formatMoney(version.taxTotal)} ₫` }] : []),
          { key: 'total_total', label: 'TỔNG CỘNG', value: `${formatMoney(version.total)} ₫`, emphasis: true },
        ]}
        note={version.note || undefined}
        signatures={['Người lập', 'Kho giao hàng', 'Khách hàng']}
        testId="sales-order-print-sheet"
      />
      {changedAfterPrint ? <small role="status">Đơn đã thay đổi sau lần in gần nhất. Hãy in lại nếu cần.</small> : null}
    </div>
  );
}
