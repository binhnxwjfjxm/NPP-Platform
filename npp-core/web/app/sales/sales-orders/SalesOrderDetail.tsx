'use client';

import type { SalesOrder, SalesOrderFulfillmentLine } from '../../../lib/sales-order-types';
import { StockHoldBreakdown } from '../../components/stock-hold-breakdown';
import ManualSalesOrderSettlement from './ManualSalesOrderSettlement';
import SalesOrderPrintSheet from './SalesOrderPrintSheet';
import {
  activeVersion,
  collectionLabels,
  deliveryLabels,
  deliveryMethodLabel,
  formatMoney,
  formatQuantity,
  fulfillmentLabels,
  orderLabels,
  pendingVersion,
  settlementLabels,
} from './sales-order-ui';
import styles from './sales-orders.module.css';

type Props = {
  order: SalesOrder | null;
  busy: boolean;
  canUpdate: boolean;
  canConfirm: boolean;
  canAmend: boolean;
  canCancel: boolean;
  canIssueStock: boolean;
  canSettle: boolean;
  amendmentReason: string;
  cancellationReason: string;
  onAmendmentReason: (value: string) => void;
  onCancellationReason: (value: string) => void;
  onEditDraft: () => void;
  onEditAmendment: () => void;
  onEditManual: () => void;
  onConfirm: () => void;
  onCreateAmendment: () => void;
  onConfirmAmendment: () => void;
  onIssueStock: () => void;
  onManualOrderUpdated: (order: SalesOrder) => void;
  onCancel: () => void;
};

function hasIssuedQuantity(value: string | null | undefined): boolean {
  const normalized = String(value ?? '0').trim();
  return !/^[+-]?0+(?:\.0+)?$/.test(normalized || '0');
}

function stockValue(
  line: SalesOrderFulfillmentLine | undefined,
  value: string | null | undefined,
): string {
  if (!line || value === null || value === undefined) return '—';
  return `${formatQuantity(value)} ${line.baseUnitCode}`;
}

export default function SalesOrderDetail(props: Props) {
  const { order } = props;
  if (!order) {
    return (
      <section className={styles.detailPanel}>
        <div className={styles.emptyDetail}>
          <h2>Chọn một đơn để xem chi tiết</h2>
          <p>Trạng thái đơn, chuẩn bị hàng, giao hàng và thanh toán được theo dõi riêng.</p>
        </div>
      </section>
    );
  }

  const current = activeVersion(order);
  const amendment = pendingVersion(order);
  const fulfillment = order.fulfillment;
  const stockBySalesOrderLineId = new Map(
    (fulfillment?.lines ?? []).map((line) => [line.salesOrderLineId, line] as const),
  );
  const isManual = current?.deliveryMode === 'DELIVERY'
    && current.deliveryExecutionMode === 'MANUAL';
  const hasIssued = hasIssuedQuantity(fulfillment?.totals.issuedBaseQuantity);
  const lineGrid = {
    gridTemplateColumns: 'minmax(180px,1.45fr) minmax(84px,.55fr) repeat(3,minmax(116px,.72fr)) minmax(100px,.7fr) minmax(110px,.75fr)',
    minWidth: '980px',
  } as const;

  return (
    <section className={styles.detailPanel}>
      <header className={styles.panelHeading}>
        <div>
          <p className={styles.eyebrow}>{order.number ?? 'Đơn nháp chưa cấp số'}</p>
          <h2>{order.customerName}</h2>
          <p>{order.customerCode} · Kho {order.warehouseName}</p>
        </div>
        <div className={styles.inlineActions}>
          {current && order.number && ['confirmed', 'closed'].includes(order.status)
            ? <SalesOrderPrintSheet order={order} version={current} />
            : null}
          <span className={styles.statusPill} data-sales-order-tone={order.status}>{orderLabels[order.status] ?? order.status}</span>
        </div>
      </header>

      {isManual ? (
        <div className={styles.statusGrid}>
          <article><span>Đơn hàng</span><strong>{orderLabels[order.status] ?? order.status}</strong></article>
          <article><span>Hình thức giao nhận</span><strong>Giao thủ công</strong></article>
          <article><span>Xuất kho</span><strong>{hasIssued ? 'Đã xuất kho' : 'Chưa xuất kho'}</strong></article>
          <article><span>Thanh toán</span><strong>{settlementLabels[order.settlementStatus] ?? order.settlementStatus}</strong></article>
        </div>
      ) : (
        <div className={styles.statusGrid}>
          <article><span>Đơn hàng</span><strong>{orderLabels[order.status] ?? order.status}</strong></article>
          <article><span>Chuẩn bị hàng</span><strong>{fulfillmentLabels[order.fulfillmentStatus] ?? order.fulfillmentStatus}</strong></article>
          <article><span>Giao hàng</span><strong>{deliveryLabels[order.deliveryStatus] ?? order.deliveryStatus}</strong></article>
          <article><span>Thanh toán</span><strong>{settlementLabels[order.settlementStatus] ?? order.settlementStatus}</strong></article>
        </div>
      )}

      {!isManual && fulfillment && fulfillment.lines.length > 0 && (
        <article className={styles.versionCard}>
          <div className={styles.versionHeading}>
            <div>
              <h3>Tình trạng giữ hàng</h3>
              <p>
                {fulfillmentLabels[fulfillment.status] ?? fulfillment.status}
                {' · '}
                {fulfillment.allowBackorder
                  ? 'Cho phép xác nhận phần còn chờ hàng'
                  : 'Phải đủ toàn bộ hàng mới được xác nhận'}
              </p>
            </div>
            <strong>{formatQuantity(fulfillment.totals.reservedBaseQuantity)} đã giữ</strong>
          </div>
          <div className={styles.moneyGrid}>
            <span>Nhu cầu quy đổi <b>{formatQuantity(fulfillment.totals.orderedBaseQuantity)}</b></span>
            <span>Đã giữ <b>{formatQuantity(fulfillment.totals.reservedBaseQuantity)}</b></span>
            <span>Còn chờ hàng <b>{formatQuantity(fulfillment.totals.backorderedBaseQuantity)}</b></span>
          </div>
          <div className={styles.linesTable}>
            <div className={styles.lineHeader}>
              <span>SKU</span><span>Nhu cầu</span><span>Đã giữ</span><span>Còn thiếu</span>
            </div>
            {fulfillment.lines.map((line) => (
              <div className={styles.lineRow} key={line.id}>
                <span><b>{line.sku}</b><small>Dòng đơn {line.lineNumber}</small></span>
                <span>{formatQuantity(line.orderedBaseQuantity)}</span>
                <span>{formatQuantity(line.reservedBaseQuantity)}</span>
                <span>{formatQuantity(line.backorderedBaseQuantity)}</span>
              </div>
            ))}
          </div>
        </article>
      )}

      {current && (
        <article className={styles.versionCard}>
          <div className={styles.versionHeading}>
            <div>
              <h3>{isManual ? 'Chi tiết đơn hàng' : `Phiên bản đang hiệu lực: ${current.versionNumber}`}</h3>
              <p>{collectionLabels[current.collectionPolicy]} · {deliveryMethodLabel(current)}</p>
            </div>
            <strong>{formatMoney(current.total)} ₫</strong>
          </div>
          <div className={styles.moneyGrid}>
            <span>Tạm tính <b>{formatMoney(current.subtotal)} ₫</b></span>
            <span>Chiết khấu <b>{formatMoney(current.discountTotal)} ₫</b></span>
            <span>Thuế <b>{formatMoney(current.taxTotal)} ₫</b></span>
          </div>
          <div className={styles.linesTable} data-testid="sales-order-stock-observation">
            <div className={styles.lineHeader} style={lineGrid}>
              <span>SKU</span><span>SL</span><span>Tồn thực tế</span><span>Đơn khác đang giữ</span><span>Khả dụng cho đơn này</span><span>Đơn giá</span><span>Thành tiền</span>
            </div>
            {(current.lines ?? []).map((line) => {
              const stock = stockBySalesOrderLineId.get(line.id);
              return (
                <div className={styles.lineRow} style={lineGrid} key={line.id}>
                  <span><b>{line.sku}</b><small>{line.itemName}</small></span>
                  <span>{formatQuantity(line.quantity)} {line.unitCode}</span>
                  <span>{stockValue(stock, stock?.warehouseOnHandBaseQuantity)}</span>
                  <span>
                    {stockValue(stock, stock?.warehouseHeldByOthersBaseQuantity)}
                    {stock?.warehouseId && stock?.baseVariantId ? (
                      <StockHoldBreakdown
                        warehouseId={stock.warehouseId}
                        baseVariantId={stock.baseVariantId}
                        excludeSalesOrderId={order.id}
                        displayedHeldQuantity={stock.warehouseHeldByOthersBaseQuantity}
                        baseUnitCode={stock.baseUnitCode}
                        title="Xem các đơn khác đang giữ hàng"
                      />
                    ) : null}
                  </span>
                  <span>{stockValue(stock, stock?.warehouseAvailableBaseQuantity)}</span>
                  <span>{formatMoney(line.unitPrice)} ₫</span>
                  <span>{formatMoney(line.lineTotal)} ₫</span>
                </div>
              );
            })}
          </div>
        </article>
      )}

      {!isManual && amendment && order.status === 'confirmed' && (
        <div className={styles.pendingAmendment}>
          <div><strong>Bản điều chỉnh {amendment.versionNumber} đang nháp</strong><p>{amendment.amendmentReason}</p></div>
          <div className={styles.inlineActions}>
            {props.canAmend && <button type="button" onClick={props.onEditAmendment}>Sửa bản điều chỉnh</button>}
            {props.canAmend && <button type="button" className={styles.primaryButton} disabled={props.busy} onClick={props.onConfirmAmendment}>Xác nhận điều chỉnh</button>}
          </div>
        </div>
      )}

      <div className={styles.actionSection}>
        {order.status === 'draft' && (
          <div className={styles.inlineActions}>
            {props.canUpdate && <button type="button" onClick={props.onEditDraft}>Sửa đơn nháp</button>}
            {props.canConfirm && <button type="button" className={styles.primaryButton} disabled={props.busy} onClick={props.onConfirm}>Xác nhận &amp; cấp số</button>}
          </div>
        )}
        {order.status === 'confirmed' && isManual && !amendment && (props.canAmend || props.canIssueStock) && (
          <div>
            <div className={styles.inlineActions}>
              {props.canAmend && (
                <button type="button" disabled={props.busy || hasIssued} onClick={props.onEditManual}>Sửa đơn</button>
              )}
              {props.canIssueStock && (
                <button
                  type="button"
                  className={styles.primaryButton}
                  disabled={props.busy || hasIssued}
                  onClick={props.onIssueStock}
                >
                  {hasIssued ? 'Đã xuất kho' : 'Xuất kho'}
                </button>
              )}
            </div>
            {hasIssued ? <small>Đơn đã Xuất kho nên không thể sửa hoặc xuất lại.</small> : null}
          </div>
        )}
        {isManual && hasIssued && ['confirmed', 'closed'].includes(order.status) && (
          <ManualSalesOrderSettlement
            order={order}
            canComplete={props.canConfirm}
            canSettle={props.canSettle}
            onUpdated={props.onManualOrderUpdated}
          />
        )}
        {order.status === 'confirmed' && !isManual && !amendment && props.canAmend && (
          <div className={styles.reasonRow}>
            <input value={props.amendmentReason} onChange={(event) => props.onAmendmentReason(event.target.value)} placeholder="Lý do điều chỉnh" />
            <button type="button" disabled={props.busy} onClick={props.onCreateAmendment}>Tạo bản điều chỉnh</button>
          </div>
        )}
        {['draft', 'confirmed'].includes(order.status) && props.canCancel && (!isManual || !hasIssued) && (
          <div className={styles.reasonRow}>
            <input value={props.cancellationReason} onChange={(event) => props.onCancellationReason(event.target.value)} placeholder="Lý do hủy đơn" />
            <button type="button" className={styles.dangerButton} disabled={props.busy} onClick={props.onCancel}>Hủy đơn</button>
          </div>
        )}
      </div>

      {!isManual && order.versions && order.versions.length > 1 && (
        <details className={styles.history}>
          <summary>Lịch sử phiên bản ({order.versions.length})</summary>
          {order.versions.map((version) => (
            <div key={version.id}>
              <b>Phiên bản {version.versionNumber}</b>
              <span>{version.status}</span>
              <span>{formatMoney(version.total)} ₫</span>
              <small>{version.amendmentReason ?? 'Phiên bản gốc'}</small>
            </div>
          ))}
        </details>
      )}
    </section>
  );
}