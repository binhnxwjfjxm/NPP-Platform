'use client';

import { useRouter } from 'next/navigation';
import { useRef, useState } from 'react';
import { createIdempotencyKey } from '@npp/contracts';
import { BusinessSequenceNumber } from '../../components/business-table-sequence';
import type {
  CustomerOnboardingAction,
  CustomerOnboardingRequestSummary,
  CustomerPortalActivationOptions,
} from '../../../lib/customer-onboarding-gateway';
import type { Customer, CustomerAddress } from '../../../lib/customer-types';
import styles from './customer-onboarding-review.module.css';

export type CustomerOnboardingSourcePresentation = {
  channelLabel: string;
  broughtByLabel: string;
  outletLabel: string | null;
  reasonLabel: string;
};

type Props = {
  requests: CustomerOnboardingRequestSummary[];
  customers: Customer[];
  portalOptions: CustomerPortalActivationOptions;
  sourcePresentationByRequest: Record<string, CustomerOnboardingSourcePresentation>;
};

type Feedback = { kind: 'success' | 'error'; text: string } | null;

type ActionResponse = {
  data?: CustomerOnboardingRequestSummary;
  error?: { message?: string; retryable?: boolean };
};

const UPDATED_AT_FORMATTER = new Intl.DateTimeFormat('vi-VN', {
  dateStyle: 'short',
  timeStyle: 'medium',
  timeZone: 'Asia/Ho_Chi_Minh',
});

function formatUpdatedAt(value: string): string {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? value : UPDATED_AT_FORMATTER.format(date);
}

function portalBusinessType(request: CustomerOnboardingRequestSummary): string {
  const metadata = (request as CustomerOnboardingRequestSummary & { sourceMetadata?: unknown }).sourceMetadata;
  if (!metadata || typeof metadata !== 'object' || Array.isArray(metadata)) return '';
  const value = (metadata as Record<string, unknown>).businessType;
  return typeof value === 'string' ? value : '';
}

function statusLabel(status: string): string {
  if (status === 'submitted') return 'Mới gửi';
  if (status === 'under_review') return 'Đang xem xét';
  if (status === 'need_more_info') return 'Chờ bổ sung';
  if (status === 'approved') return 'Đã tạo khách mới';
  if (status === 'linked_existing') return 'Đã liên kết khách có sẵn';
  if (status === 'rejected') return 'Đã từ chối';
  if (status === 'cancelled') return 'Đã hủy';
  return status;
}

function actionSuccess(action: CustomerOnboardingAction): string {
  if (action === 'review') return 'Đã chuyển đề nghị sang bước xem xét.';
  if (action === 'need-more-info') return 'Đã yêu cầu bổ sung thông tin.';
  if (action === 'approve') return 'Đã duyệt và tạo mã khách hàng mới.';
  if (action === 'link-existing') return 'Đã liên kết đề nghị với khách hàng có sẵn.';
  if (action === 'reject') return 'Đã từ chối đề nghị.';
  return 'Đã hủy đề nghị.';
}

function fullAddress(address: CustomerAddress): string {
  return [address.address_line1, address.ward, address.district, address.province]
    .filter(Boolean)
    .join(', ');
}

function defaultWarehouseId(options: CustomerPortalActivationOptions): string {
  return options.warehouses.length === 1 ? options.warehouses[0].id : '';
}

function defaultSalesChannelId(options: CustomerPortalActivationOptions): string {
  const canonical = options.salesChannels.filter((item) => item.code === 'CUSTOMER_PORTAL');
  if (canonical.length === 1) return canonical[0].id;
  return options.salesChannels.length === 1 ? options.salesChannels[0].id : '';
}

export default function CustomerOnboardingReview({
  requests,
  customers,
  portalOptions,
  sourcePresentationByRequest,
}: Props) {
  const router = useRouter();
  const actionKeys = useRef<Record<string, string>>({});
  const busyRequests = useRef<Set<string>>(new Set());
  const addressRequestVersions = useRef<Record<string, number>>({});
  const [busyByRequest, setBusyByRequest] = useState<Record<string, boolean>>({});
  const [feedback, setFeedback] = useState<Feedback>(null);
  const [reasonByRequest, setReasonByRequest] = useState<Record<string, string>>({});
  const [codeByRequest, setCodeByRequest] = useState<Record<string, string>>({});
  const [customerByRequest, setCustomerByRequest] = useState<Record<string, string>>({});
  const [addressByRequest, setAddressByRequest] = useState<Record<string, string>>({});
  const [warehouseByRequest, setWarehouseByRequest] = useState<Record<string, string>>({});
  const [salesChannelByRequest, setSalesChannelByRequest] = useState<Record<string, string>>({});
  const [addressesByRequest, setAddressesByRequest] = useState<Record<string, CustomerAddress[]>>({});
  const [addressLoadingByRequest, setAddressLoadingByRequest] = useState<Record<string, boolean>>({});

  function stableActionKey(request: CustomerOnboardingRequestSummary, action: CustomerOnboardingAction): {
    cacheKey: string;
    value: string;
  } {
    const cacheKey = `${request.id}:${action}:${request.version}`;
    const value = actionKeys.current[cacheKey] || createIdempotencyKey('customer-onboarding-action');
    actionKeys.current[cacheKey] = value;
    return { cacheKey, value };
  }

  async function performAction(
    request: CustomerOnboardingRequestSummary,
    action: CustomerOnboardingAction,
    extra: Record<string, unknown> = {},
  ) {
    if (busyRequests.current.has(request.id)) return;
    busyRequests.current.add(request.id);
    setBusyByRequest((current) => ({ ...current, [request.id]: true }));
    const idempotency = stableActionKey(request, action);
    setFeedback(null);
    try {
      const response = await fetch(`/api/customer-onboarding-requests/${request.id}/${action}`, {
        method: 'POST',
        cache: 'no-store',
        headers: {
          'Content-Type': 'application/json',
          'Idempotency-Key': idempotency.value,
        },
        body: JSON.stringify({ expectedVersion: request.version, ...extra }),
      });
      const payload = await response.json().catch(() => null) as ActionResponse | null;
      if (!response.ok) {
        if (response.status < 500 && payload?.error?.retryable !== true) {
          delete actionKeys.current[idempotency.cacheKey];
        }
        throw new Error(payload?.error?.message || 'Không thực hiện được thao tác.');
      }
      if (!payload?.data) {
        throw new Error('Phản hồi xử lý chưa đầy đủ. Có thể bấm lại để kiểm tra kết quả.');
      }
      delete actionKeys.current[idempotency.cacheKey];
      setFeedback({ kind: 'success', text: actionSuccess(action) });
      router.refresh();
    } catch (error) {
      setFeedback({
        kind: 'error',
        text: error instanceof Error ? error.message : 'Không thực hiện được thao tác.',
      });
    } finally {
      busyRequests.current.delete(request.id);
      setBusyByRequest((current) => ({ ...current, [request.id]: false }));
    }
  }

  async function chooseCustomer(requestId: string, customerId: string) {
    const requestVersion = (addressRequestVersions.current[requestId] || 0) + 1;
    addressRequestVersions.current[requestId] = requestVersion;
    setCustomerByRequest((current) => ({ ...current, [requestId]: customerId }));
    setAddressByRequest((current) => ({ ...current, [requestId]: '' }));
    setAddressesByRequest((current) => ({ ...current, [requestId]: [] }));
    if (!customerId) {
      setAddressLoadingByRequest((current) => ({ ...current, [requestId]: false }));
      return;
    }
    setAddressLoadingByRequest((current) => ({ ...current, [requestId]: true }));
    try {
      const response = await fetch(`/api/customers/${customerId}/addresses`, { cache: 'no-store' });
      const payload = await response.json().catch(() => null) as {
        data?: CustomerAddress[];
        error?: { message?: string };
      } | null;
      const addresses = payload?.data;
      if (!response.ok || !Array.isArray(addresses)) {
        throw new Error(payload?.error?.message || 'Không tải được địa chỉ khách hàng.');
      }
      if (addressRequestVersions.current[requestId] !== requestVersion) return;
      setAddressesByRequest((current) => ({
        ...current,
        [requestId]: addresses.filter((address) => address.is_active),
      }));
    } catch (error) {
      if (addressRequestVersions.current[requestId] !== requestVersion) return;
      setAddressesByRequest((current) => ({ ...current, [requestId]: [] }));
      setFeedback({
        kind: 'error',
        text: error instanceof Error ? error.message : 'Không tải được địa chỉ khách hàng.',
      });
    } finally {
      if (addressRequestVersions.current[requestId] === requestVersion) {
        setAddressLoadingByRequest((current) => ({ ...current, [requestId]: false }));
      }
    }
  }

  function requireReason(request: CustomerOnboardingRequestSummary, action: 'need-more-info' | 'reject') {
    const reason = reasonByRequest[request.id]?.trim() || '';
    if (!reason) {
      setFeedback({ kind: 'error', text: 'Cần nhập lý do trước khi thực hiện.' });
      return;
    }
    void performAction(request, action, { reason });
  }

  function portalActivationPayload(request: CustomerOnboardingRequestSummary): Record<string, string> | null {
    if (request.sourceSystem !== 'CUSTOMER_PORTAL') return {};
    const portalWarehouseId = warehouseByRequest[request.id] ?? defaultWarehouseId(portalOptions);
    const portalSalesChannelId = salesChannelByRequest[request.id] ?? defaultSalesChannelId(portalOptions);
    if (!portalWarehouseId || !portalSalesChannelId) {
      setFeedback({ kind: 'error', text: 'Cần chọn kho mặc định và kênh bán cho tài khoản khách hàng.' });
      return null;
    }
    return { portalWarehouseId, portalSalesChannelId };
  }

  function approveNewCustomer(request: CustomerOnboardingRequestSummary) {
    const customerCode = codeByRequest[request.id]?.trim().toUpperCase() || '';
    if (!/^[A-Z0-9_-]{1,64}$/.test(customerCode)) {
      setFeedback({
        kind: 'error',
        text: 'Mã khách chỉ gồm chữ in hoa, số, dấu gạch ngang hoặc gạch dưới.',
      });
      return;
    }
    const activation = portalActivationPayload(request);
    if (activation === null) return;
    void performAction(request, 'approve', { customerCode, ...activation });
  }

  function linkExistingCustomer(request: CustomerOnboardingRequestSummary) {
    const customerId = customerByRequest[request.id] || '';
    const addressId = addressByRequest[request.id] || '';
    if (!customerId || !addressId) {
      setFeedback({ kind: 'error', text: 'Cần chọn khách hàng và địa chỉ cần liên kết.' });
      return;
    }
    const activation = portalActivationPayload(request);
    if (activation === null) return;
    void performAction(request, 'link-existing', { customerId, addressId, ...activation });
  }

  return (
    <div className={styles.workspace} data-testid="customer-onboarding-review-workspace">
      {feedback ? (
        <p className={feedback.kind === 'success' ? styles.success : styles.error} role="status">
          {feedback.text}
        </p>
      ) : null}

      {requests.length === 0 ? (
        <p className={styles.empty}>Hiện không có đề nghị nào đang chờ xử lý.</p>
      ) : null}

      <div className={styles.list}>
        {requests.map((request, rowIndex) => {
          const reason = reasonByRequest[request.id] || '';
          const selectedCustomer = customerByRequest[request.id] || '';
          const selectedAddress = addressByRequest[request.id] || '';
          const selectedWarehouse = warehouseByRequest[request.id] ?? defaultWarehouseId(portalOptions);
          const selectedSalesChannel = salesChannelByRequest[request.id] ?? defaultSalesChannelId(portalOptions);
          const addresses = addressesByRequest[request.id] || [];
          const address = request.proposedCustomer.address;
          const isPortal = request.sourceSystem === 'CUSTOMER_PORTAL';
          const businessType = isPortal ? portalBusinessType(request) : '';
          const sourcePresentation = sourcePresentationByRequest[request.id] || {
            channelLabel: isPortal ? 'Ordering · Khách trực tiếp' : 'MCP Field',
            broughtByLabel: isPortal ? 'Khách tự đăng ký' : 'Nhân viên MCP',
            outletLabel: isPortal ? null : request.proposedCustomer.name,
            reasonLabel: isPortal ? 'Đăng ký tài khoản đặt hàng' : 'Đề nghị mở / liên kết mã khách hàng',
          };
          const isBusy = busyByRequest[request.id] === true;
          const addressLoading = addressLoadingByRequest[request.id] === true;
          return (
            <article className={styles.card} key={request.id}>
              <header className={styles.cardHeader}>
                <div>
                  <h2><BusinessSequenceNumber rowIndex={rowIndex} /> {request.proposedCustomer.name}</h2>
                  <p>{request.proposedCustomer.phone || 'Chưa có số điện thoại'}</p>
                </div>
                <span className={styles.badge}>{statusLabel(request.status)}</span>
              </header>

              <dl className={styles.details}>
                <div><dt>Địa chỉ</dt><dd>{[address.addressLine1, address.ward, address.district, address.province].filter(Boolean).join(', ')}</dd></div>
                <div><dt>Nguồn</dt><dd>{sourcePresentation.channelLabel}</dd></div>
                <div><dt>Người đưa về</dt><dd>{sourcePresentation.broughtByLabel}</dd></div>
                {sourcePresentation.outletLabel ? <div><dt>Điểm bán</dt><dd>{sourcePresentation.outletLabel}</dd></div> : null}
                <div><dt>Lý do gửi</dt><dd>{sourcePresentation.reasonLabel}</dd></div>
                {businessType ? <div><dt>Mô hình quán</dt><dd>{businessType}</dd></div> : null}
                <div><dt>Cập nhật</dt><dd>{formatUpdatedAt(request.updatedAt)}</dd></div>
                {request.reviewReason ? <div><dt>Lý do gần nhất</dt><dd>{request.reviewReason}</dd></div> : null}
              </dl>

              {request.status === 'submitted' || request.status === 'need_more_info' ? (
                <div className={styles.actions}>
                  <button
                    type="button"
                    disabled={isBusy}
                    onClick={() => void performAction(request, 'review')}
                  >
                    Bắt đầu xem xét
                  </button>
                </div>
              ) : null}

              {request.status === 'under_review' ? (
                <div className={styles.reviewGrid}>
                  {isPortal ? (
                    <section className={styles.actionPanel}>
                      <h3>Kích hoạt quyền đặt hàng</h3>
                      <label>
                        Kho mặc định
                        <select
                          value={selectedWarehouse}
                          onChange={(event) => setWarehouseByRequest((current) => ({
                            ...current,
                            [request.id]: event.target.value,
                          }))}
                        >
                          <option value="">Chọn kho</option>
                          {portalOptions.warehouses.map((warehouse) => (
                            <option value={warehouse.id} key={warehouse.id}>{warehouse.code} — {warehouse.name}</option>
                          ))}
                        </select>
                      </label>
                      <label>
                        Kênh bán
                        <select
                          value={selectedSalesChannel}
                          onChange={(event) => setSalesChannelByRequest((current) => ({
                            ...current,
                            [request.id]: event.target.value,
                          }))}
                        >
                          <option value="">Chọn kênh bán</option>
                          {portalOptions.salesChannels.map((channel) => (
                            <option value={channel.id} key={channel.id}>{channel.code} — {channel.name}</option>
                          ))}
                        </select>
                      </label>
                      <p>Chính sách thu mặc định: thu khi giao hàng.</p>
                    </section>
                  ) : null}

                  <section className={styles.actionPanel}>
                    <h3>Tạo khách mới từ đăng ký</h3>
                    <p>Tên khách sẽ tạo: <strong>{request.proposedCustomer.name}</strong></p>
                    <p>Tên này lấy từ ô “Tên quán / điểm bán” khách đã nhập, không lấy từ tên tài khoản đăng nhập.</p>
                    <label>
                      Mã khách hàng
                      <input
                        value={codeByRequest[request.id] || ''}
                        maxLength={64}
                        placeholder="VD: KH_TAN_PHAT"
                        onChange={(event) => setCodeByRequest((current) => ({
                          ...current,
                          [request.id]: event.target.value.toUpperCase(),
                        }))}
                      />
                    </label>
                    <button type="button" disabled={isBusy} onClick={() => approveNewCustomer(request)}>
                      Tạo khách mới & kích hoạt
                    </button>
                  </section>

                  <section className={styles.actionPanel}>
                    <h3>Liên kết khách đã có</h3>
                    <p>Chỉ dùng nhánh này khi điểm bán đã có mã khách Công Ty.</p>
                    <label>
                      Khách hàng
                      <select value={selectedCustomer} onChange={(event) => void chooseCustomer(request.id, event.target.value)}>
                        <option value="">Chọn khách hàng</option>
                        {customers.map((customer) => (
                          <option value={customer.id} key={customer.id}>{customer.code} — {customer.name}</option>
                        ))}
                      </select>
                    </label>
                    <label>
                      Địa chỉ
                      <select
                        value={selectedAddress}
                        disabled={!selectedCustomer || addressLoading}
                        onChange={(event) => setAddressByRequest((current) => ({
                          ...current,
                          [request.id]: event.target.value,
                        }))}
                      >
                        <option value="">{addressLoading ? 'Đang tải địa chỉ...' : 'Chọn địa chỉ'}</option>
                        {addresses.map((item) => (
                          <option value={item.id} key={item.id}>{item.label} — {fullAddress(item)}</option>
                        ))}
                      </select>
                    </label>
                    <button type="button" disabled={isBusy || addressLoading} onClick={() => linkExistingCustomer(request)}>
                      Liên kết khách đã có
                    </button>
                  </section>

                  <section className={`${styles.actionPanel} ${styles.reasonPanel}`}>
                    <h3>Yêu cầu bổ sung hoặc từ chối</h3>
                    <label>
                      Lý do
                      <textarea
                        value={reason}
                        maxLength={2000}
                        rows={3}
                        onChange={(event) => setReasonByRequest((current) => ({
                          ...current,
                          [request.id]: event.target.value,
                        }))}
                      />
                    </label>
                    <div className={styles.actions}>
                      <button type="button" disabled={isBusy} onClick={() => requireReason(request, 'need-more-info')}>
                        Yêu cầu bổ sung
                      </button>
                      <button className={styles.dangerButton} type="button" disabled={isBusy} onClick={() => requireReason(request, 'reject')}>
                        Từ chối
                      </button>
                    </div>
                  </section>
                </div>
              ) : null}
            </article>
          );
        })}
      </div>
    </div>
  );
}
