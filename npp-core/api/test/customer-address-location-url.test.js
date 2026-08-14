import test from 'node:test';
import assert from 'node:assert/strict';
import { CORE_API_MIGRATIONS } from '../src/migrations/index.js';
import { validateCustomerAddressInput } from '../src/services/customer.js';

const baseAddress = Object.freeze({
  label: 'Kho chính',
  recipientName: 'Người nhận',
  phone: '0901234567',
  addressLine1: '1 Đường A',
  province: 'TP.HCM',
  countryCode: 'VN',
  isDefault: true,
});

test('customer address location migration remains ordered immediately before customer media', () => {
  const locationIndex = CORE_API_MIGRATIONS.findIndex((migration) => migration.id === '078_customer_address_location_url');
  const mediaIndex = CORE_API_MIGRATIONS.findIndex((migration) => migration.id === '079_customer_media');
  assert.notEqual(locationIndex, -1);
  assert.equal(mediaIndex, locationIndex + 1);
});

test('customer address location URL is optional, trimmed and provider-neutral HTTPS', () => {
  const withoutLocation = validateCustomerAddressInput(baseAddress);
  assert.equal(withoutLocation.ok, true);
  assert.equal(withoutLocation.normalized.locationUrl, null);

  const google = validateCustomerAddressInput({
    ...baseAddress,
    locationUrl: '  https://maps.app.goo.gl/AbCdEf123  ',
  });
  assert.equal(google.ok, true);
  assert.equal(google.normalized.locationUrl, 'https://maps.app.goo.gl/AbCdEf123');

  const otherProvider = validateCustomerAddressInput({
    ...baseAddress,
    locationUrl: 'https://maps.apple.com/?q=10.1,106.1',
  });
  assert.equal(otherProvider.ok, true);
  assert.equal(otherProvider.normalized.locationUrl, 'https://maps.apple.com/?q=10.1,106.1');
});

test('customer address location URL rejects non-HTTPS, malformed, credentialed and oversized values', () => {
  const invalidValues = [
    'http://maps.example.com/place/1',
    'javascript:alert(1)',
    'not-a-url',
    'https://user:pass@maps.example.com/place/1',
    `https://maps.example.com/${'a'.repeat(2048)}`,
  ];

  for (const locationUrl of invalidValues) {
    const result = validateCustomerAddressInput({ ...baseAddress, locationUrl });
    assert.equal(result.ok, false, locationUrl);
    assert.equal(result.code, 'INVALID_LOCATION_URL', locationUrl);
  }
});
