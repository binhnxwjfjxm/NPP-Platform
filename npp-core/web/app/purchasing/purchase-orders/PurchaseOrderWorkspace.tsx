'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { AppShell } from '../../components/app-shell';
import shellStyles from '../../components/app-shell.module.css';
import styles from '../../organization/organization.module.css';
import type { PurchaseOrder, PurchaseOrderStatus } from '../../../lib/purchase-order-types';
import {
  formatDecimalString,
  formatPurchaseOrderAmount,
  formatPurchaseOrderDate,
  purchaseOrderActionPolicy,
  PURCHASE_ORDER_STATUS_LABELS,
} from '../../../lib/purchase-order-types';
import PurchaseOrderList from './components/PurchaseOrderList';

type Props = {
  initialPurchaseOrders: PurchaseOrder[];
  initialError: string | null;
  initialPermissionKeys?: string[];
};

type StatusFilter = PurchaseOrderStatus | 'all';

export default function PurchaseOrderWorkspace({
  initialPurchaseOrders,
  initialError,
  initialPermissionKeys = [],
}: Props) {
  const [items] = useState<PurchaseOrder[]>(initialPurchaseOrders);
  const [error] = useState<string | null>(initialError);
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState<StatusFilter>('all');
  const [selectedPurchaseOrder, setSelectedPurchaseOrder] = useState<PurchaseOrder | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const closeButtonRef = useRef<HTMLButtonElement>(null);

  const normalizedSearch = search.trim().toLocaleLowerCase('vi-VN');
  const visibleItems = useMemo(() => items.filter((purchaseOrder) => {
    const matchesStatus = statusFilter === 'all' || purchaseOrder.status === statusFilter;
    const searchable = [
      purchaseOrder.number,
      purchaseOrder.supplierName,
      purchaseOrder.warehouseName,
      purchaseOrder.supplierReference,
      ...purchaseOrder.lines.flatMap((line) => [line.skuCode, line.skuName]),
    ]
      .filter(Boolean)
      .join(' ')
      .toLocaleLowerCase('vi-VN');
    return matchesStatus && (!normalizedSearch || searchable.includes(normalizedSearch));
  }), [items, normalizedSearch, statusFilter]);

  const counts = useMemo(() => ({
    total: items.length,
    draft: items.filter((item) => item.status === 'draft').length,
    pending: items.filter((item) => item.status === 'pending_approval').length,
  }), [items]);

  const createPolicy = purchaseOrderActionPolicy('draft', initialPermissionKeys);

  useEffect(() => {
    if (!selectedPurchaseOrder) return;
    closeButtonRef.current?.focus();
  }, [selectedPurchaseOrder]);

  function openReadOnlyNotice(message: string) {
    setNotice(message);
  }

  const shellActions = (
    <>
      <button
        type="button"
        className={shellStyles.actionButton}
        onClick={() => window.location.reload()}
      >
        Cập nhật dữ liệu
      </button>
      {createPolicy.create ? (
        <button
          type="button"
          className={`${shellStyles.actionButton} ${shellStyles.actionButtonPrimary}`}
          onClick={() => openReadOnlyNotice('Biểu mẫu tạo đơn sẽ được bật sau khi API P5.1 xác nhận quyền, idempotency và dữ liệu tra cứu.')}
          data-testid="purchase-order-create-button"
        >
          Tạo đơn đặt hàng
        </button>
      ) : null}
    </>
  );

  return (
    <AppShell
      title="Đơn đặt hàng"
      subtitle="Theo dõi nhu cầu mua, trạng thái duyệt và phần hàng dự kiến nhận từ nhà cung cấp."
      kicker="Mua hàng"
      actions={shellActions}
    >
      <section className={styles.page} data-testid="purchase-orders-page">
        {error ? (
          <div className={`${styles.banner} ${styles.bannerError}`} role="alert">
            {error}
          </div>
        ) : null}
        {notice ? (
          <div className={`${styles.banner} ${styles.bannerSuccess}`} role="status">
            {notice}
          </div>
        ) : null}
        {initialPermissionKeys.length === 0 ? (
          <div className={`${styles.banner} ${styles.bannerError}`} role="status">
            Chưa nhận được quyền mua hàng từ backend. Các hành động thay đổi dữ liệu đang được khóa theo nguyên tắc từ chối mặc định.
          </div>
        ) : null}

        <section className={styles.summaryGrid} aria-label="Số liệu đơn đặt hàng">
          <article className={styles.summaryCard}>
            <span>Tổng đơn</span>
            <strong>{formatDecimalString(String(counts.total))}</strong>
            <small>Toàn bộ đơn trong dữ liệu hiện tại</small>
          </article>
          <article className={styles.summaryCard}>
            <span>Đơn nháp</span>
            <strong>{formatDecimalString(String(counts.draft))}</strong>
            <small>Chưa gửi duyệt</small>
          </article>
          <article className={styles.summaryCard}>
            <span>Chờ duyệt</span>
            <strong>{formatDecimalString(String(counts.pending))}</strong>
            <small>Đang chờ người có thẩm quyền xử lý</small>
          </article>
        </section>

        <section className={styles.toolbar} aria-label="Bộ lọc đơn đặt hàng">
          <div className={styles.toolbarSearch}>
            <label htmlFor="purchase-order-search">Tìm kiếm</label>
            <input
              id="purchase-order-search"
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              placeholder="Số đơn, nhà cung cấp, kho nhận hoặc mã hàng…"
              data-testid="purchase-order-search"
            />
          </div>
          <div className={styles.toolbarFilter}>
            <label htmlFor="purchase-order-status">Trạng thái</label>
            <select
              id="purchase-order-status"
              value={statusFilter}
              onChange={(event) => setStatusFilter(event.target.value as StatusFilter)}
              data-testid="purchase-order-status-filter"
            >
              <option value="all">Tất cả trạng thái</option>
              {Object.entries(PURCHASE_ORDER_STATUS_LABELS).map(([value, label]) => (
                <option key={value} value={value}>{label}</option>
              ))}
            </select>
          </div>
        </section>

        <section className={styles.tableSection}>
          <div className={styles.sectionHeader}>
            <div>
              <p className={styles.panelKicker}>Danh sách mua hàng</p>
              <h2>Đơn đặt hàng nhà cung cấp</h2>
            </div>
            <span className={styles.panelChip}>{formatDecimalString(String(visibleItems.length))} đơn</span>
          </div>
          <PurchaseOrderList
            purchaseOrders={visibleItems}
            permissionKeys={initialPermissionKeys}
            onView={setSelectedPurchaseOrder}
            onEdit={(purchaseOrder) => {
              setSelectedPurchaseOrder(purchaseOrder);
              openReadOnlyNotice('Chỉnh sửa đang được khóa cho đến khi API P5.1 cung cấp revision và idempotency đầy đủ.');
            }}
          />
        </section>
      </section>

      {selectedPurchaseOrder ? (
        <div
          className={styles.modalBackdrop}
          role="presentation"
          onMouseDown={(event) => {
            if (event.currentTarget === event.target) setSelectedPurchaseOrder(null);
          }}
          onKeyDown={(event) => {
            if (event.key === 'Escape') setSelectedPurchaseOrder(null);
          }}
        >
          <section
            className={styles.modal}
            role="dialog"
            aria-modal="true"
            aria-labelledby="purchase-order-detail-title"
          >
            <div className={styles.modalHeader}>
              <div>
                <p className={styles.panelKicker}>Chi tiết đơn đặt hàng</p>
                <h3 id="purchase-order-detail-title">{selectedPurchaseOrder.number || 'Đơn chưa cấp số'}</h3>
              </div>
              <button
                ref={closeButtonRef}
                type="button"
                className={styles.modalClose}
                onClick={() => setSelectedPurchaseOrder(null)}
                aria-label="Đóng chi tiết đơn đặt hàng"
              >
                Đóng
              </button>
            </div>
            <div className={styles.form}>
              <label>
                Nhà cung cấp
                <input value={selectedPurchaseOrder.supplierName || 'Chưa có tên nhà cung cấp'} readOnly />
              </label>
              <label>
                Kho nhận
                <input value={selectedPurchaseOrder.warehouseName || 'Chưa có tên kho nhận'} readOnly />
              </label>
              <label>
                Ngày đặt hàng
                <input value={formatPurchaseOrderDate(selectedPurchaseOrder.placedAt)} readOnly />
              </label>
              <label>
                Trạng thái
                <input value={PURCHASE_ORDER_STATUS_LABELS[selectedPurchaseOrder.status]} readOnly />
              </label>
              <label>
                Tổng giá trị
                <input value={formatPurchaseOrderAmount(selectedPurchaseOrder.total, selectedPurchaseOrder.currency || 'VND')} readOnly />
              </label>
              <label>
                Tiến độ nhận hàng
                <input value="Chưa có phiếu nhập trong P5.1" readOnly />
              </label>
            </div>
          </section>
        </div>
      ) : null}
    </AppShell>
  );
}
