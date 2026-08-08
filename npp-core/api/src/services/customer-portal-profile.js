import * as customerService from './customer.js';

function failure(code, message, statusCode = 400, details = {}) {
  return Object.freeze({ ok: false, code, message, statusCode, retryable: false, details });
}

function mapEditableAddress(row) {
  if (!row) return null;
  return Object.freeze({
    id: row.id,
    label: row.label ?? '',
    recipientName: row.recipient_name ?? '',
    phone: row.phone ?? '',
    addressLine1: row.address_line1 ?? '',
    addressLine2: row.address_line2 ?? '',
    ward: row.ward ?? '',
    district: row.district ?? '',
    province: row.province ?? '',
    postalCode: row.postal_code ?? '',
    countryCode: row.country_code ?? 'VN',
    isDefault: row.is_default === true,
    updatedAt: row.updated_at,
  });
}

function mapProfile(membership, customer, addresses) {
  const activeAddresses = addresses.filter((row) => row.is_active === true);
  const address = activeAddresses.find((row) => row.is_default === true) ?? activeAddresses[0] ?? null;
  return Object.freeze({
    customerCode: customer.code,
    displayName: membership.portal_display_name ?? customer.name,
    outletName: customer.name,
    phone: customer.phone ?? '',
    customerUpdatedAt: customer.updated_at,
    address: mapEditableAddress(address),
  });
}

function mapCustomerFailure(result) {
  if (result.code === 'NOT_FOUND') {
    return failure('CUSTOMER_PORTAL_PROFILE_NOT_FOUND', 'Không tìm thấy thông tin điểm bán.', 404);
  }
  if (result.code === 'CONFLICT') {
    return failure('CUSTOMER_PORTAL_PROFILE_CONFLICT', 'Thông tin điểm bán đã thay đổi. Vui lòng tải lại trước khi lưu.', 409);
  }
  return failure(result.code ?? 'CUSTOMER_PORTAL_PROFILE_INVALID', result.message ?? 'Thông tin điểm bán không hợp lệ.', result.statusCode ?? 400, result.details ?? {});
}

export async function getPortalProfile(client, { requestContext, membership }) {
  const customerResult = await customerService.getCustomer(client, {
    installationId: requestContext.installationId,
    id: membership.customer_id,
  });
  if (!customerResult.ok) return mapCustomerFailure(customerResult);
  if (customerResult.customer.is_active !== true) {
    return failure('CUSTOMER_PORTAL_PROFILE_NOT_FOUND', 'Không tìm thấy thông tin điểm bán đang hoạt động.', 404);
  }
  const addressResult = await customerService.listCustomerAddresses(client, {
    installationId: requestContext.installationId,
    customerId: membership.customer_id,
  });
  if (!addressResult.ok) return mapCustomerFailure(addressResult);
  return Object.freeze({ ok: true, profile: mapProfile(membership, customerResult.customer, addressResult.addresses) });
}

export async function updatePortalProfile(client, { requestContext, membership, payload }) {
  const before = await getPortalProfile(client, { requestContext, membership });
  if (!before.ok) return before;
  if (!before.profile.address) {
    return failure('CUSTOMER_PORTAL_PROFILE_ADDRESS_NOT_FOUND', 'Điểm bán chưa có địa chỉ đang hoạt động để chỉnh sửa.', 404);
  }

  const outletName = typeof payload?.outletName === 'string' ? payload.outletName.trim() : '';
  if (!outletName || outletName.length > 256) {
    return failure('INVALID_NAME', 'Tên điểm bán là bắt buộc và không được vượt quá 256 ký tự.');
  }
  const expectedCustomerUpdatedAt = typeof payload?.expectedCustomerUpdatedAt === 'string' ? payload.expectedCustomerUpdatedAt.trim() : '';
  const expectedAddressUpdatedAt = typeof payload?.expectedAddressUpdatedAt === 'string' ? payload.expectedAddressUpdatedAt.trim() : '';
  if (!expectedCustomerUpdatedAt || !expectedAddressUpdatedAt) {
    return failure('MISSING_EXPECTED_UPDATED_AT', 'Phiên bản thông tin điểm bán là bắt buộc.');
  }

  const addressInput = payload?.address && typeof payload.address === 'object' ? payload.address : null;
  const addressId = typeof addressInput?.id === 'string' ? addressInput.id.trim() : '';
  if (!addressId || addressId !== before.profile.address.id) {
    return failure('CUSTOMER_PORTAL_PROFILE_CONFLICT', 'Địa chỉ điểm bán đã thay đổi. Vui lòng tải lại trước khi lưu.', 409);
  }

  const customerResult = await customerService.updateCustomer(client, {
    id: membership.customer_id,
    installationId: requestContext.installationId,
    updatedBy: requestContext.actorId,
    payload: {
      expectedUpdatedAt: expectedCustomerUpdatedAt,
      name: outletName,
      phone: Object.prototype.hasOwnProperty.call(payload ?? {}, 'phone') ? payload.phone : before.profile.phone,
    },
  });
  if (!customerResult.ok) return mapCustomerFailure(customerResult);

  const currentAddress = before.profile.address;
  const addressResult = await customerService.updateCustomerAddress(client, {
    installationId: requestContext.installationId,
    customerId: membership.customer_id,
    addressId,
    updatedBy: requestContext.actorId,
    payload: {
      expectedUpdatedAt: expectedAddressUpdatedAt,
      addressLine1: addressInput.addressLine1 ?? currentAddress.addressLine1,
      addressLine2: Object.prototype.hasOwnProperty.call(addressInput, 'addressLine2') ? addressInput.addressLine2 : currentAddress.addressLine2,
      ward: Object.prototype.hasOwnProperty.call(addressInput, 'ward') ? addressInput.ward : currentAddress.ward,
      district: Object.prototype.hasOwnProperty.call(addressInput, 'district') ? addressInput.district : currentAddress.district,
      province: Object.prototype.hasOwnProperty.call(addressInput, 'province') ? addressInput.province : currentAddress.province,
      postalCode: Object.prototype.hasOwnProperty.call(addressInput, 'postalCode') ? addressInput.postalCode : currentAddress.postalCode,
      countryCode: addressInput.countryCode ?? currentAddress.countryCode,
    },
  });
  if (!addressResult.ok) return mapCustomerFailure(addressResult);

  const after = await getPortalProfile(client, { requestContext, membership });
  if (!after.ok) return after;
  return Object.freeze({ ok: true, beforeProfile: before.profile, profile: after.profile });
}
