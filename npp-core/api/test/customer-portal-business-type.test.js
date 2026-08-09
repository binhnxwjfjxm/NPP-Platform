import assert from 'node:assert/strict';
import test from 'node:test';
import { validatePortalRegistration } from '../src/services/customer-onboarding.js';
import { publicRegistration } from '../src/services/customer-portal-registration.js';

function payload(businessType) {
  return {
    proposedCustomer: {
      name: 'Quán Mẫu',
      phone: '0901234567',
      businessType,
      address: {
        label: 'Địa chỉ chính',
        addressLine1: '1 Đường Mẫu',
        ward: 'Phường Bến Nghé',
        province: 'Thành phố Hồ Chí Minh',
        countryCode: 'VN',
      },
    },
  };
}

test('portal registration accepts only supported business types', () => {
  const accepted = validatePortalRegistration(payload('Trà sữa / đồ uống'));
  assert.equal(accepted.ok, true);
  assert.equal(accepted.businessType, 'Trà sữa / đồ uống');

  const rejected = validatePortalRegistration(payload('mô hình tự bịa'));
  assert.equal(rejected.ok, false);
  assert.equal(rejected.code, 'INVALID_CUSTOMER_BUSINESS_TYPE');
});

test('public registration returns business type from server-owned source metadata', () => {
  const view = publicRegistration({
    id: '11111111-1111-4111-8111-111111111111',
    status: 'submitted',
    version: 1,
    proposedCustomer: payload('Tiệm bánh').proposedCustomer,
    sourceMetadata: { channel: 'customer-ordering', businessType: 'Tiệm bánh' },
    reviewReason: null,
    submittedAt: '2026-08-09T00:00:00.000Z',
    updatedAt: '2026-08-09T00:00:00.000Z',
  });
  assert.equal(view.proposedCustomer.businessType, 'Tiệm bánh');
});
