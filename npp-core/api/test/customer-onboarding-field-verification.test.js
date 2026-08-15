import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { validateFieldProfileSubmission, FIELD_PROFILE_VERIFICATION } from '../src/services/customer-onboarding-field.js';
import { attachTrustedMcpEmployee } from '../src/routes/customer-onboarding.js';

const EMPLOYEE_ID = '11111111-1111-4111-8111-111111111111';

function payload() {
  return {
    sourceSystem: 'MCP',
    sourceOutletId: 'route_customer_1',
    sourceDemandReference: FIELD_PROFILE_VERIFICATION,
    orderRequired: false,
    triggerReason: FIELD_PROFILE_VERIFICATION,
    proposedCustomer: {
      name: 'Điểm bán A',
      phone: '0901234567',
      address: { label: 'Điểm bán MCP', addressLine1: '1 Đường A', province: 'TP.HCM', countryCode: 'VN' },
    },
    sourceMetadata: { channel: 'mcp-field' },
  };
}

test('field profile verification is independent from order and requires trusted employee context', () => {
  const accepted = validateFieldProfileSubmission(payload(), { employeeId: EMPLOYEE_ID });
  assert.equal(accepted.ok, true);
  assert.equal(accepted.normalized.orderRequired, false);
  assert.equal(accepted.normalized.triggerReason, FIELD_PROFILE_VERIFICATION);
  assert.equal(accepted.normalized.sourceDemandReference, FIELD_PROFILE_VERIFICATION);

  const missingEmployee = validateFieldProfileSubmission(payload(), { employeeId: null });
  assert.equal(missingEmployee.ok, false);
  assert.equal(missingEmployee.code, 'TRUSTED_EMPLOYEE_REQUIRED');
});

test('MCP onboarding service token may attach only a valid trusted employee header', () => {
  const principal = Object.freeze({ roles: ['mcp-onboarding-service'], id: 'service:mcp-onboarding' });
  const attached = attachTrustedMcpEmployee({ headers: { 'x-npp-mcp-employee-id': EMPLOYEE_ID } }, principal);
  assert.equal(attached.ok, true);
  assert.equal(attached.principal.employeeId, EMPLOYEE_ID);

  const invalid = attachTrustedMcpEmployee({ headers: { 'x-npp-mcp-employee-id': 'browser-spoof' } }, principal);
  assert.equal(invalid.ok, false);
  assert.equal(invalid.code, 'UNAUTHORIZED');
});

test('migration 084 enforces field verification contract and canonical customer ownership', () => {
  const sql = readFileSync(new URL('../../../database/migrations/sales/084_mcp_field_profile_verification.sql', import.meta.url), 'utf8');
  assert.match(sql, /FIELD_PROFILE_VERIFICATION/);
  assert.match(sql, /requested_by_employee_id IS NOT NULL/);
  assert.match(sql, /responsible_employee_id = NEW\.requested_by_employee_id/);
  assert.match(sql, /customer\.is_active = true/);
});
