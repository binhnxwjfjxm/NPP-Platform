import * as customerRepo from '../db/repositories/customer.js';
import { validateCustomerAddressInput } from './customer.js';

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function failure(code, message, statusCode = 400) {
  return Object.freeze({ ok: false, code, message, statusCode, retryable: false });
}

export async function updateCustomerAddressLocation(client, {
  installationId,
  customerId,
  addressId,
  locationUrl,
  updatedBy,
}) {
  if (!UUID_PATTERN.test(String(customerId ?? '')) || !UUID_PATTERN.test(String(addressId ?? ''))) {
    return failure('CUSTOMER_ADDRESS_NOT_FOUND', 'Không tìm thấy địa chỉ khách hàng.', 404);
  }

  const customer = await customerRepo.getCustomerByIdForInstallation(client, {
    id: customerId,
    installationId,
  });
  if (!customer || customer.is_active !== true) {
    return failure('CUSTOMER_ADDRESS_NOT_FOUND', 'Không tìm thấy địa chỉ khách hàng đang hoạt động.', 404);
  }

  const existing = await customerRepo.getCustomerAddressForUpdate(client, {
    id: addressId,
    customerId,
    installationId,
  });
  if (!existing || existing.is_active !== true) {
    return failure('CUSTOMER_ADDRESS_NOT_FOUND', 'Không tìm thấy địa chỉ khách hàng đang hoạt động.', 404);
  }

  const validation = validateCustomerAddressInput({
    label: existing.label,
    recipientName: existing.recipient_name ?? '',
    phone: existing.phone ?? '',
    locationUrl,
    addressLine1: existing.address_line1,
    addressLine2: existing.address_line2 ?? '',
    ward: existing.ward ?? '',
    district: existing.district ?? '',
    province: existing.province ?? '',
    postalCode: existing.postal_code ?? '',
    countryCode: existing.country_code,
    isDefault: existing.is_default,
    isActive: existing.is_active,
  });
  if (!validation.ok) return { ...validation, statusCode: 400 };

  if ((existing.location_url ?? null) === validation.normalized.locationUrl) {
    return Object.freeze({ ok: true, address: existing, beforeData: existing, changed: false });
  }

  const address = await customerRepo.updateCustomerAddress(client, {
    id: existing.id,
    customerId: existing.customer_id,
    installationId,
    ...validation.normalized,
    updatedBy,
    expectedUpdatedAt: existing.updated_at,
  });
  if (!address) {
    return failure('CUSTOMER_ADDRESS_CONFLICT', 'Địa chỉ khách hàng vừa thay đổi. Vui lòng thử lại.', 409);
  }
  return Object.freeze({ ok: true, address, beforeData: existing, changed: true });
}
