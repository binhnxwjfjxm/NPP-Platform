import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

function source(relative) {
  return readFileSync(new URL(relative, import.meta.url), 'utf8');
}

test('customer onboarding shows business source and requester instead of technical identifiers', () => {
  const page = source('../app/management/customer-onboarding/page.tsx');
  const review = source('../app/management/customer-onboarding/customer-onboarding-review.tsx');

  assert.match(page, /listAllEmployees<Employee>/);
  assert.match(page, /requestedByEmployeeId/);
  assert.match(page, /channelLabel: 'MCP Field'/);
  assert.match(page, /channelLabel: 'Ordering · Khách trực tiếp'/);
  assert.match(review, /<dt>Nguồn<\/dt>/);
  assert.match(review, /<dt>Người đưa về<\/dt>/);
  assert.match(review, /<dt>Điểm bán<\/dt>/);
  assert.match(review, /<dt>Lý do gửi<\/dt>/);
  assert.doesNotMatch(review, /<dt>Điểm bán nguồn<\/dt>/);
  assert.doesNotMatch(review, /<dt>Nhu cầu mua hàng<\/dt>/);
  assert.doesNotMatch(review, /FIELD_PROFILE_VERIFICATION/);
});
