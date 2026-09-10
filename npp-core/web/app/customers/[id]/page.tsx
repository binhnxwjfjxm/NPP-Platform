import Link from 'next/link';
import { notFound } from 'next/navigation';
import { AppShell } from '../../components/app-shell';
import type { CustomerAddress } from '../../../lib/customer-types';
import { listCustomerAddresses, normalizeCustomerGatewayError, resolveCustomerRequestId } from '../../../lib/customer-gateway';
import {
  CustomerProfileGatewayError,
  getCustomerProfileOverview,
  normalizeCustomerProfilePeriod,
  resolveCustomerProfileRequestId,
} from '../../../lib/customer-profile-gateway';
import CustomerDetailView from './customer-detail-view';
import styles from './customer-detail.module.css';

export const dynamic = 'force-dynamic';

type Params = Promise<{ id: string }>;
type SearchParams = Promise<{ tab?: string; period?: string }>;

export default async function CustomerDetailPage({ params, searchParams }: { params: Params; searchParams: SearchParams }) {
  const [{ id }, query] = await Promise.all([params, searchParams]);
  const period = normalizeCustomerProfilePeriod(query.period);
  const activeTab = query.tab === 'info' ? 'info' : 'overview';
  const profileRequestId = resolveCustomerProfileRequestId(null);
  const addressRequestId = resolveCustomerRequestId(null);

  try {
    const [profile, addressResult] = await Promise.all([
      getCustomerProfileOverview(id, profileRequestId, period),
      listCustomerAddresses<CustomerAddress>(id, addressRequestId)
        .then((addresses) => ({ addresses, error: null as string | null }))
        .catch((error) => ({ addresses: [] as CustomerAddress[], error: normalizeCustomerGatewayError(error).publicMessage })),
    ]);
    return (
      <CustomerDetailView
        profile={profile}
        addresses={addressResult.addresses}
        addressError={addressResult.error}
        activeTab={activeTab}
        period={period}
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
