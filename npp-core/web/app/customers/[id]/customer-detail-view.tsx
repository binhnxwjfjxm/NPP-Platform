import Link from 'next/link';
import { AppShell } from '../../components/app-shell';
import type { CustomerAddress } from '../../../lib/customer-types';
import type { CustomerDeliveryReturnsHistory } from '../../../lib/customer-delivery-returns-gateway';
import type {
  CustomerProfileOverview,
  CustomerProfilePeriod,
  CustomerPurchasedItemsPage,
} from '../../../lib/customer-profile-gateway';
import {
  CustomerFinanceSection,
  CustomerOrdersSection,
  type CustomerFinanceHistory,
  type CustomerOrdersHistory,
} from './customer-history-sections';
import CustomerDeliveryReturnsSection from './customer-delivery-returns-section';
import styles from './customer-detail.module.css';

type Tab = 'overview' | 'purchased-items' | 'orders' | 'finance' | 'delivery-returns' | 'info';

type Props = Readonly<{
  profile: CustomerProfileOverview;
  addresses: CustomerAddress[];
  activeTab: Tab;
  period: CustomerProfilePeriod;
  addressError?: string | null;
  purchasedItems?: CustomerPurchasedItemsPage | null;
  purchasedItemsSearch?: string;
  purchasedItemsError?: string | null;
  ordersHistory?: CustomerOrdersHistory | null;
  ordersSearch?: string;
  ordersError?: string | null;
  financeHistory?: CustomerFinanceHistory | null;
  deliveryReturnsHistory?: CustomerDeliveryReturnsHistory | null;
  deliveryReturnsError?: string | null;
}>;

const periodLabels: Record<CustomerProfilePeriod, string> = {
  '30d': '30 ngày',
  '90d': '90 ngày',
  '365d': '1 năm',
  all: 'Toàn bộ',
};

function formatVnd(value: string | null | undefined) {
  const normalized = String(value ?? '0').trim();
  const match = /^(-?)(\d+)(?:\.(\d+))?$/.exec(normalized);
  if (!match) return '—';
  const negative = match[1] === '-';
  let whole = BigInt(match[2]);
  const fraction = match[3] ?? '';
  if (fraction && Number(fraction[0]) >= 5) whole += 1n;
  const signed = negative && whole !== 0n ? -whole : whole;
  return `${new Intl.NumberFormat('vi-VN').format(signed)} ₫`;
}

function formatCount(value: string | null | undefined) {
  const normalized = String(value ?? '0').trim();
  return /^\d+$/.test(normalized) ? new Intl.NumberFormat('vi-VN').format(BigInt(normalized)) : '—';
}

function formatQuantity(value: string | null | undefined) {
  const normalized = String(value ?? '0').trim();
  const match = /^(\d+)(?:\.(\d+))?$/.exec(normalized);
  if (!match) return '—';
  const whole = new Intl.NumberFormat('vi-VN').format(BigInt(match[1]));
  const fraction = (match[2] ?? '').replace(/0+$/, '');
  return fraction ? `${whole},${fraction}` : whole;
}

function formatDateTime(value: string | null | undefined) {
  if (!value) return 'Chưa có';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return 'Chưa có';
  return new Intl.DateTimeFormat('vi-VN', {
    dateStyle: 'medium',
    timeStyle: 'short',
    timeZone: 'Asia/Ho_Chi_Minh',
  }).format(date);
}

function addressText(address: CustomerAddress | null | undefined) {
  if (!address) return 'Chưa có địa chỉ';
  return [
    address.address_line1,
    address.address_line2,
    address.ward,
    address.district,
    address.province,
  ].filter(Boolean).join(', ');
}

function tabHref(
  customerId: string,
  tab: Tab,
  period: CustomerProfilePeriod,
  options: Readonly<{ search?: string; offset?: number }> = {},
) {
  const query = new URLSearchParams({ tab, period });
  if (tab === 'purchased-items' || tab === 'orders') {
    const search = String(options.search ?? '').trim();
    if (search) query.set('search', search);
    if ((options.offset ?? 0) > 0) query.set('offset', String(options.offset));
  }
  return `/customers/${customerId}?${query.toString()}`;
}

export default function CustomerDetailView({
  profile,
  addresses,
  activeTab,
  period,
  addressError = null,
  purchasedItems = null,
  purchasedItemsSearch = '',
  purchasedItemsError = null,
  ordersHistory = null,
  ordersSearch = '',
  ordersError = null,
  financeHistory = null,
  deliveryReturnsHistory = null,
  deliveryReturnsError = null,
}: Props) {
  const { customer, sales, receivable, permissions } = profile;
  const defaultAddress = addresses.find((address) => address.is_default && address.is_active)
    ?? addresses.find((address) => address.is_active)
    ?? addresses[0]
    ?? null;
  const actions = (
    <div className={styles.actions}>
      <Link className={styles.actionSecondary} href="/customers">Danh sách khách hàng</Link>
      <Link className={styles.actionPrimary} href={`/customers?edit=${encodeURIComponent(customer.id)}`}>Sửa thông tin</Link>
    </div>
  );
  const purchasedTotal = purchasedItems && /^\d+$/.test(purchasedItems.total)
    ? BigInt(purchasedItems.total)
    : 0n;
  const purchasedHasPrevious = Boolean(purchasedItems && purchasedItems.offset > 0);
  const purchasedHasNext = Boolean(
    purchasedItems
    && BigInt(purchasedItems.offset + purchasedItems.limit) < purchasedTotal,
  );

  return (
    <AppShell
      title="Chi tiết khách hàng"
      subtitle="Theo dõi thông tin, giao dịch và tình hình hiện tại của một khách hàng."
      kicker="Khách hàng"
      actions={actions}
    >
      <section className={styles.page} data-testid="customer-detail-page">
        <section className={styles.hero}>
          <div className={styles.identity}>
            <div className={styles.identityTopline}>
              <span className={styles.code}>{customer.code}</span>
              <span className={customer.is_active ? styles.statusActive : styles.statusInactive}>
                {customer.is_active ? 'Đang hoạt động' : 'Không hoạt động'}
              </span>
            </div>
            <h2>{customer.name}</h2>
            <div className={styles.identityMeta}>
              <span>{customer.group_name || 'Chưa phân nhóm'}</span>
              <span>{customer.responsible_employee_name || 'Chưa giao phụ trách'}</span>
              <span>{customer.phone || 'Chưa có số điện thoại'}</span>
            </div>
          </div>
          <div className={styles.defaultAddress}>
            <small>Địa chỉ giao dịch</small>
            <strong>{defaultAddress?.label || 'Chưa có địa chỉ'}</strong>
            <span>{addressText(defaultAddress)}</span>
          </div>
        </section>

        <nav className={styles.tabs} aria-label="Hồ sơ khách hàng">
          <Link className={activeTab === 'overview' ? styles.tabActive : styles.tab} href={tabHref(customer.id, 'overview', period)} aria-current={activeTab === 'overview' ? 'page' : undefined}>Tổng quan</Link>
          <Link className={activeTab === 'purchased-items' ? styles.tabActive : styles.tab} href={tabHref(customer.id, 'purchased-items', period)} aria-current={activeTab === 'purchased-items' ? 'page' : undefined}>Hàng đã mua</Link>
          <Link className={activeTab === 'orders' ? styles.tabActive : styles.tab} href={tabHref(customer.id, 'orders', period)} aria-current={activeTab === 'orders' ? 'page' : undefined}>Đơn hàng</Link>
          <Link className={activeTab === 'finance' ? styles.tabActive : styles.tab} href={tabHref(customer.id, 'finance', period)} aria-current={activeTab === 'finance' ? 'page' : undefined}>Công nợ &amp; thanh toán</Link>
          <Link className={activeTab === 'delivery-returns' ? styles.tabActive : styles.tab} href={tabHref(customer.id, 'delivery-returns', period)} aria-current={activeTab === 'delivery-returns' ? 'page' : undefined}>Giao hàng / Trả hàng</Link>
          <Link className={activeTab === 'info' ? styles.tabActive : styles.tab} href={tabHref(customer.id, 'info', period)} aria-current={activeTab === 'info' ? 'page' : undefined}>Thông tin &amp; địa chỉ</Link>
        </nav>

        {activeTab === 'overview' ? (
          <>
            <div className={styles.toolbar}>
              <div className={styles.toolbarCopy}>
                <strong>Tình hình khách hàng</strong>
                <span>Doanh số và số đơn tính trên đơn đã chốt/hoàn thành trong khoảng được chọn.</span>
              </div>
              <div className={styles.periods} aria-label="Khoảng thời gian">
                {(Object.keys(periodLabels) as CustomerProfilePeriod[]).map((value) => (
                  <Link key={value} href={tabHref(customer.id, 'overview', value)} className={period === value ? styles.periodActive : styles.period} aria-current={period === value ? 'page' : undefined}>{periodLabels[value]}</Link>
                ))}
              </div>
            </div>

            <section className={styles.summaryGrid} aria-label="Chỉ số khách hàng">
              <article className={styles.summaryCard} data-testid="customer-summary-revenue"><span>Doanh số</span><strong>{permissions.sales && sales ? formatVnd(sales.revenue) : 'Không có quyền xem'}</strong><small>{permissions.sales ? periodLabels[period] : 'Dữ liệu bán hàng được giới hạn theo quyền.'}</small></article>
              <article className={styles.summaryCard} data-testid="customer-summary-orders"><span>Số đơn</span><strong>{permissions.sales && sales ? formatCount(sales.orderCount) : '—'}</strong><small>Đơn đã chốt hoặc hoàn thành</small></article>
              <article className={styles.summaryCard} data-testid="customer-summary-last-purchase"><span>Lần mua gần nhất</span><strong>{permissions.sales && sales ? formatDateTime(sales.lastPurchaseAt) : '—'}</strong><small>Tính trên lịch sử được phép xem</small></article>
              <article className={styles.summaryCard} data-testid="customer-summary-receivable"><span>Công nợ hiện tại</span><strong>{permissions.receivable && receivable ? formatVnd(receivable.balance) : 'Không có quyền xem'}</strong><small>{permissions.receivable && receivable ? `${formatCount(receivable.openDocumentCount)} chứng từ còn mở` : 'Dữ liệu công nợ được giới hạn theo quyền.'}</small></article>
              <article className={styles.summaryCard} data-testid="customer-summary-credit-limit"><span>Hạn mức tín dụng</span><strong>{formatVnd(customer.credit_limit)}</strong><small>Thời hạn thanh toán: {customer.payment_terms_days} ngày</small></article>
            </section>

            <div className={styles.contentGrid}>
              <section className={styles.panel}>
                <div className={styles.panelHeader}><h3>Thông tin nhanh</h3><Link href={tabHref(customer.id, 'info', period)}>Xem đầy đủ</Link></div>
                <div className={styles.factGrid}>
                  <div className={styles.fact}><small>Nhóm khách hàng</small><strong>{customer.group_name || 'Chưa phân nhóm'}</strong></div>
                  <div className={styles.fact}><small>Nhân viên phụ trách</small><strong>{customer.responsible_employee_name || 'Chưa giao phụ trách'}</strong></div>
                  <div className={styles.fact}><small>Điện thoại</small><strong>{customer.phone || 'Chưa có'}</strong></div>
                  <div className={styles.fact}><small>Email</small><strong>{customer.email || 'Chưa có'}</strong></div>
                  <div className={styles.fact}><small>Mã số thuế</small><strong>{customer.tax_code || 'Chưa có'}</strong></div>
                  <div className={styles.fact}><small>Địa chỉ mặc định</small><strong>{addressText(defaultAddress)}</strong></div>
                </div>
                <p className={styles.note}>{customer.notes || 'Chưa có ghi chú cho khách hàng này.'}</p>
              </section>

              <section className={styles.panel}>
                <div className={styles.panelHeader}><h3>Hoạt động gần đây</h3></div>
                <div className={styles.activityList}>
                  <div className={styles.activityItem}><strong>Lần mua gần nhất</strong><span>{permissions.sales && sales ? formatDateTime(sales.lastPurchaseAt) : 'Không có dữ liệu được phép xem.'}</span></div>
                  <div className={styles.activityItem}><strong>Công nợ cập nhật</strong><span>{permissions.receivable && receivable ? formatDateTime(receivable.updatedAt) : 'Không có dữ liệu được phép xem.'}</span></div>
                  <div className={styles.activityItem}><strong>Địa chỉ đang sử dụng</strong><span>{addresses.filter((address) => address.is_active).length} địa chỉ</span></div>
                </div>
              </section>
            </div>
          </>
        ) : activeTab === 'purchased-items' ? (
          <section className={styles.purchasePanel} data-testid="customer-purchased-items">
            <div className={styles.toolbar}>
              <div className={styles.toolbarCopy}><strong>Hàng đã mua</strong><span>Tổng hợp theo từng SKU từ đơn đã chốt/hoàn thành trong khoảng được chọn.</span></div>
              <div className={styles.periods} aria-label="Khoảng thời gian hàng đã mua">
                {(Object.keys(periodLabels) as CustomerProfilePeriod[]).map((value) => (
                  <Link key={value} href={tabHref(customer.id, 'purchased-items', value, { search: purchasedItemsSearch })} className={period === value ? styles.periodActive : styles.period} aria-current={period === value ? 'page' : undefined}>{periodLabels[value]}</Link>
                ))}
              </div>
            </div>

            {permissions.sales ? (
              <>
                <form className={styles.purchaseFilters} method="get">
                  <input type="hidden" name="tab" value="purchased-items" />
                  <input type="hidden" name="period" value={period} />
                  <label className={styles.searchField}><span>Tìm sản phẩm</span><input name="search" defaultValue={purchasedItemsSearch} placeholder="Tên sản phẩm hoặc SKU" maxLength={120} /></label>
                  <button type="submit">Tìm</button>
                  {purchasedItemsSearch ? <Link href={tabHref(customer.id, 'purchased-items', period)}>Xóa tìm kiếm</Link> : null}
                </form>

                {purchasedItemsError ? <div className={styles.errorBox} role="alert">{purchasedItemsError}</div> : null}
                {!purchasedItemsError && purchasedItems ? (
                  <>
                    <div className={styles.purchaseSummary}><strong>{formatCount(purchasedItems.total)} mặt hàng</strong><span>{periodLabels[period]}{purchasedItemsSearch ? ` · Kết quả cho “${purchasedItemsSearch}”` : ''}</span></div>
                    {purchasedItems.items.length > 0 ? (
                      <div className={styles.tableWrap}>
                        <table className={styles.purchaseTable}>
                          <thead><tr><th>Sản phẩm</th><th>ĐVT</th><th className={styles.numeric}>Tổng SL</th><th className={styles.numeric}>Doanh số</th><th className={styles.numeric}>Số lần mua</th><th className={styles.numeric}>Giá mua gần nhất</th><th>Mua gần nhất</th></tr></thead>
                          <tbody>
                            {purchasedItems.items.map((item) => (
                              <tr key={item.variantId}>
                                <td><div className={styles.productCell}><strong>{item.productName || 'Chưa có tên sản phẩm'}</strong><small>{item.sku || 'Chưa có SKU'}</small></div></td>
                                <td>{item.unitCode || '—'}</td>
                                <td className={styles.numeric}>{formatQuantity(item.totalQuantity)}</td>
                                <td className={styles.numeric}>{formatVnd(item.revenue)}</td>
                                <td className={styles.numeric}>{formatCount(item.purchaseCount)}</td>
                                <td className={styles.numeric}>{formatVnd(item.lastUnitPrice)}</td>
                                <td>{formatDateTime(item.lastPurchaseAt)}</td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                    ) : <div className={styles.empty}>Chưa có hàng đã mua trong khoảng thời gian này.</div>}
                    <div className={styles.pagination} aria-label="Phân trang hàng đã mua">
                      <span>{purchasedItems.items.length > 0 ? `Đang xem ${purchasedItems.offset + 1}–${purchasedItems.offset + purchasedItems.items.length}` : 'Không có dữ liệu'}</span>
                      <div>
                        {purchasedHasPrevious ? <Link href={tabHref(customer.id, 'purchased-items', period, { search: purchasedItemsSearch, offset: Math.max(0, purchasedItems.offset - purchasedItems.limit) })}>Trang trước</Link> : null}
                        {purchasedHasNext ? <Link href={tabHref(customer.id, 'purchased-items', period, { search: purchasedItemsSearch, offset: purchasedItems.offset + purchasedItems.limit })}>Trang sau</Link> : null}
                      </div>
                    </div>
                  </>
                ) : null}
              </>
            ) : <div className={styles.empty}>Bạn không có quyền xem lịch sử mua hàng của khách hàng này.</div>}
          </section>
        ) : activeTab === 'orders' ? (
          <CustomerOrdersSection customerId={customer.id} period={period} allowed={permissions.sales} history={ordersHistory ? { ...ordersHistory, search: ordersSearch } : null} error={ordersError} />
        ) : activeTab === 'finance' && financeHistory ? (
          <CustomerFinanceSection customerId={customer.id} period={period} summary={receivable} history={financeHistory} />
        ) : activeTab === 'delivery-returns' ? (
          <CustomerDeliveryReturnsSection customerId={customer.id} period={period} history={deliveryReturnsHistory} error={deliveryReturnsError} />
        ) : (
          <div className={styles.contentGrid}>
            <section className={styles.panel}>
              <div className={styles.panelHeader}><h3>Thông tin khách hàng</h3><Link href={`/customers?edit=${encodeURIComponent(customer.id)}`}>Sửa thông tin</Link></div>
              <div className={styles.factGrid}>
                <div className={styles.fact}><small>Tên khách hàng</small><strong>{customer.name}</strong></div>
                <div className={styles.fact}><small>Mã khách hàng</small><strong>{customer.code}</strong></div>
                <div className={styles.fact}><small>Nhóm khách hàng</small><strong>{customer.group_name || 'Chưa phân nhóm'}</strong></div>
                <div className={styles.fact}><small>Nhân viên phụ trách</small><strong>{customer.responsible_employee_name || 'Chưa giao phụ trách'}</strong></div>
                <div className={styles.fact}><small>Điện thoại</small><strong>{customer.phone || 'Chưa có'}</strong></div>
                <div className={styles.fact}><small>Email</small><strong>{customer.email || 'Chưa có'}</strong></div>
                <div className={styles.fact}><small>Mã số thuế</small><strong>{customer.tax_code || 'Chưa có'}</strong></div>
                <div className={styles.fact}><small>Thời hạn thanh toán</small><strong>{customer.payment_terms_days} ngày</strong></div>
                <div className={styles.fact}><small>Hạn mức tín dụng</small><strong>{formatVnd(customer.credit_limit)}</strong></div>
                <div className={styles.fact}><small>Trạng thái</small><strong>{customer.is_active ? 'Đang hoạt động' : 'Không hoạt động'}</strong></div>
              </div>
              <p className={styles.note}>{customer.notes || 'Chưa có ghi chú cho khách hàng này.'}</p>
            </section>

            <section className={styles.panel}>
              <div className={styles.panelHeader}><h3>Địa chỉ</h3><Link href={`/customers?addresses=${encodeURIComponent(customer.id)}`}>Quản lý địa chỉ</Link></div>
              {addressError ? <div className={styles.errorBox}>{addressError}</div> : null}
              <div className={styles.addressList}>
                {addresses.map((address) => (
                  <article className={styles.addressCard} key={address.id}>
                    <div className={styles.addressTopline}><strong>{address.label}</strong>{address.is_default ? <span className={styles.addressDefault}>Mặc định</span> : null}{!address.is_active ? <span>Ngừng sử dụng</span> : null}</div>
                    <span>{addressText(address)}</span>
                    {address.recipient_name ? <span>Người nhận: {address.recipient_name}</span> : null}
                    {address.phone ? <span>SĐT nhận hàng: {address.phone}</span> : null}
                    {address.location_url ? <a href={address.location_url} target="_blank" rel="noreferrer">Mở link định vị</a> : null}
                  </article>
                ))}
                {addresses.length === 0 && !addressError ? <div className={styles.empty}>Khách hàng chưa có địa chỉ.</div> : null}
              </div>
            </section>
          </div>
        )}
      </section>
    </AppShell>
  );
}
