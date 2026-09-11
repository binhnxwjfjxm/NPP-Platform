import Link from 'next/link';
import { notFound } from 'next/navigation';
import { AppShell } from '../../components/app-shell';
import type { CustomerAddress } from '../../../lib/customer-types';
import { listCustomerAddresses, normalizeCustomerGatewayError, resolveCustomerRequestId } from '../../../lib/customer-gateway';
import {
  CustomerProfileGatewayError,
  getCustomerProfileOverview,
  getCustomerPurchasedItems,
  normalizeCustomerProfilePeriod,
  resolveCustomerProfileRequestId,
  type CustomerPurchasedItemsPage,
} from '../../../lib/customer-profile-gateway';
import {
  listSalesOrders,
  normalizeSalesOrderGatewayError,
  resolveSalesOrderRequestId,
} from '../../../lib/sales-order-gateway';
import type { SalesOrder } from '../../../lib/sales-order-types';
import {
  listReceivables,
  resolveReceivableRequestId,
} from '../../../lib/receivable-gateway';
import type { ReceivableDocument } from '../../../lib/receivable-types';
import {
  CustomerPaymentGatewayError,
  listCustomerPayments,
  normalizeCustomerPaymentGatewayError,
  resolveCustomerPaymentRequestId,
} from '../../../lib/customer-payment-gateway';
import type { CustomerPayment } from '../../../lib/customer-payment-types';
import CustomerDetailView from './customer-detail-view';
import type {
  CustomerFinanceHistory,
  CustomerOrderListItem,
  CustomerOrdersHistory,
} from './customer-history-sections';
import styles from './customer-detail.module.css';

export const dynamic = 'force-dynamic';

type Params = Promise<{ id: string }>;
type SearchParams = Promise<{
  tab?: string;
  period?: string;
  search?: string;
  offset?: string;
  debtOffset?: string;
  paymentOffset?: string;
}>;

type CustomerDetailTab = 'overview' | 'purchased-items' | 'orders' | 'finance' | 'info';

function normalizeTab(value?: string): CustomerDetailTab {
  if (value === 'purchased-items') return 'purchased-items';
  if (value === 'orders') return 'orders';
  if (value === 'finance') return 'finance';
  if (value === 'info') return 'info';
  return 'overview';
}

function normalizeOffset(value?: string) {
  const parsed = Number(value ?? '0');
  return Number.isSafeInteger(parsed) && parsed >= 0 && parsed <= 1_000_000 ? parsed : 0;
}

export default async function CustomerDetailPage({ params, searchParams }: { params: Params; searchParams: SearchParams }) {
  const [{ id }, query] = await Promise.all([params, searchParams]);
  const period = normalizeCustomerProfilePeriod(query.period);
  const activeTab = normalizeTab(query.tab);
  const search = String(query.search ?? '').trim().slice(0, 120);
  const listOffset = normalizeOffset(query.offset);
  const debtOffset = normalizeOffset(query.debtOffset);
  const paymentOffset = normalizeOffset(query.paymentOffset);
  const profileRequestId = resolveCustomerProfileRequestId(null);
  const addressRequestId = resolveCustomerRequestId(null);

  try {
    const [profile, addressResult] = await Promise.all([
      getCustomerProfileOverview(id, profileRequestId, period),
      listCustomerAddresses<CustomerAddress>(id, addressRequestId)
        .then((addresses) => ({ addresses, error: null as string | null }))
        .catch((error) => ({ addresses: [] as CustomerAddress[], error: normalizeCustomerGatewayError(error).publicMessage })),
    ]);

    let purchasedItems: CustomerPurchasedItemsPage | null = null;
    let purchasedItemsError: string | null = null;
    if (activeTab === 'purchased-items' && profile.permissions.sales) {
      try {
        purchasedItems = await getCustomerPurchasedItems(id, resolveCustomerProfileRequestId(null), {
          period,
          search,
          limit: 50,
          offset: listOffset,
        });
      } catch (error) {
        purchasedItemsError = error instanceof CustomerProfileGatewayError
          ? error.publicMessage
          : 'Chưa tải được hàng đã mua.';
      }
    }

    let ordersHistory: CustomerOrdersHistory | null = null;
    let ordersError: string | null = null;
    if (activeTab === 'orders' && profile.permissions.sales) {
      try {
        const pageSize = 25;
        const rows = await listSalesOrders<CustomerOrderListItem>(resolveSalesOrderRequestId(null), {
          customerId: id,
          search,
          limit: pageSize + 1,
          offset: listOffset,
        });
        ordersHistory = Object.freeze({
          items: Object.freeze(rows.slice(0, pageSize)),
          search,
          offset: listOffset,
          limit: pageSize,
          hasPrevious: listOffset > 0,
          hasNext: rows.length > pageSize,
        });
      } catch (error) {
        ordersError = normalizeSalesOrderGatewayError(error).publicMessage;
      }
    }

    let financeHistory: CustomerFinanceHistory | null = null;
    if (activeTab === 'finance') {
      const pageSize = 20;
      let receivables: ReceivableDocument[] = [];
      let receivableError: string | null = null;
      let receivableHasNext = false;
      if (profile.permissions.receivable) {
        try {
          const rows = await listReceivables<ReceivableDocument>(resolveReceivableRequestId(null), {
            customerId: id,
            limit: pageSize + 1,
            offset: debtOffset,
          });
          receivableHasNext = rows.length > pageSize;
          receivables = rows.slice(0, pageSize);
        } catch {
          receivableError = 'Chưa tải được chứng từ công nợ của khách hàng.';
        }
      }

      let payments: CustomerPayment[] = [];
      let paymentAccess: CustomerFinanceHistory['paymentAccess'] = 'allowed';
      let paymentError: string | null = null;
      let paymentHasNext = false;
      try {
        const rows = await listCustomerPayments<CustomerPayment>(resolveCustomerPaymentRequestId(null), {
          customerId: id,
          limit: pageSize + 1,
          offset: paymentOffset,
        });
        paymentHasNext = rows.length > pageSize;
        payments = rows.slice(0, pageSize);
      } catch (error) {
        const normalized = normalizeCustomerPaymentGatewayError(error);
        if (error instanceof CustomerPaymentGatewayError && error.statusCode === 403) {
          paymentAccess = 'forbidden';
        } else {
          paymentAccess = 'error';
          paymentError = normalized.publicMessage || 'Chưa tải được lịch sử thu tiền của khách hàng.';
        }
      }

      financeHistory = Object.freeze({
        receivableAllowed: profile.permissions.receivable,
        receivables: Object.freeze(receivables),
        receivableOffset: debtOffset,
        receivableLimit: pageSize,
        receivableHasPrevious: debtOffset > 0,
        receivableHasNext,
        receivableError,
        paymentAccess,
        payments: Object.freeze(payments),
        paymentOffset,
        paymentLimit: pageSize,
        paymentHasPrevious: paymentOffset > 0,
        paymentHasNext,
        paymentError,
      });
    }

    return (
      <CustomerDetailView
        profile={profile}
        addresses={addressResult.addresses}
        addressError={addressResult.error}
        activeTab={activeTab}
        period={period}
        purchasedItems={purchasedItems}
        purchasedItemsSearch={activeTab === 'purchased-items' ? search : ''}
        purchasedItemsError={purchasedItemsError}
        ordersHistory={ordersHistory}
        ordersSearch={activeTab === 'orders' ? search : ''}
        ordersError={ordersError}
        financeHistory={financeHistory}
      />
    );
  } catch (error) {
    if (error instanceof CustomerProfileGatewayError && error.statusCode === 404) notFound();
    const message = error instanceof CustomerProfileGatewayError
      ? error.publicMessage
      : 'Chưa tải được hồ sơ khách hàng.';
    return (
      <AppShell
        title="Chi tiết khách hàng"
        subtitle="Thông tin tập trung của một khách hàng."
        kicker="Khách hàng"
        actions={<Link className={styles.actionSecondary} href="/customers">Danh sách khách hàng</Link>}
      >
        <div className={styles.errorBox} role="alert">{message}</div>
      </AppShell>
    );
  }
}
