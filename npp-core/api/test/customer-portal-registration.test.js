import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { validatePortalRegistration } from '../src/services/customer-onboarding.js';
import {
  createPortalRegistrationRequestContext,
  publicRegistration,
  registrationState,
} from '../src/services/customer-portal-registration.js';

const validRegistration = Object.freeze({
  proposedCustomer: Object.freeze({
    name: 'Điểm bán thử nghiệm',
    phone: '0901234567',
    address: Object.freeze({
      label: 'Địa chỉ chính',
      addressLine1: '1 Đường thử nghiệm',
      district: 'Quận 1',
      province: 'TP HCM',
      countryCode: 'VN',
    }),
  }),
});

test('portal registration accepts customer snapshot but rejects client authority fields', () => {
  const accepted = validatePortalRegistration(validRegistration);
  assert.equal(accepted.ok, true);
  assert.equal(accepted.normalized.proposedName, 'Điểm bán thử nghiệm');

  for (const [field, value] of [
    ['sourceSystem', 'CUSTOMER_PORTAL'],
    ['sourceOutletId', 'forged'],
    ['sourceDemandReference', 'forged'],
    ['orderRequired', false],
    ['requestedByPortalUserId', '11111111-1111-4111-8111-111111111111'],
  ]) {
    const rejected = validatePortalRegistration({ ...validRegistration, [field]: value });
    assert.equal(rejected.ok, false, field);
    assert.equal(rejected.code, 'PORTAL_REGISTRATION_AUTHORITY_FIELD_FORBIDDEN');
  }
});

test('pre-membership request context is stable, least privilege and does not expose raw Clerk subject', () => {
  const createContext = ({ principal, requestId, receivedAt }) => ({
    ...principal,
    requestId,
    receivedAt,
    installationId: 'npp-test',
  });
  const context = createPortalRegistrationRequestContext(
    createContext,
    { installationId: 'npp-test' },
    'user_secret_subject_123',
    { requestId: 'req-test', receivedAt: '2026-08-08T16:00:00Z' },
  );
  assert.match(context.actorId, /^portal-subject:[a-f0-9]{64}$/);
  assert.doesNotMatch(context.actorId, /user_secret_subject_123/);
  assert.deepEqual(context.permissions, []);
  assert.deepEqual(context.scopes.warehouseIds, []);
  assert.equal(context.sourceApp, 'customer-ordering');
});

test('registration state never treats an unusable or unbound membership as active', () => {
  const identity = { portal_user_id: '11111111-1111-4111-8111-111111111111' };
  assert.equal(registrationState({ identity: null, membership: null, request: null }), 'unregistered');
  assert.equal(registrationState({ identity, membership: null, request: { status: 'submitted' } }), 'submitted');
  assert.equal(registrationState({ identity, membership: null, request: { status: 'need_more_info' } }), 'need_more_info');
  assert.equal(registrationState({ identity, membership: null, request: { status: 'approved' } }), 'activation_pending');
  assert.equal(registrationState({ identity, membership: null, membershipUnavailable: true, request: { status: 'approved' } }), 'suspended');
  assert.equal(registrationState({ identity, membership: { id: 'membership' }, request: { status: 'approved' } }), 'active_customer');
});

test('public registration representation excludes internal authority and idempotency fields', () => {
  const value = publicRegistration({
    id: '11111111-1111-4111-8111-111111111111',
    status: 'submitted',
    version: 1,
    proposedCustomer: validRegistration.proposedCustomer,
    reviewReason: null,
    submittedAt: '2026-08-08T16:00:00Z',
    updatedAt: '2026-08-08T16:00:00Z',
    requestedByActorId: 'internal-actor',
    sourceMetadata: { internal: true },
    idempotencyKey: 'internal-idempotency-key',
    payloadHash: 'a'.repeat(64),
  });
  assert.deepEqual(Object.keys(value).sort(), [
    'id',
    'proposedCustomer',
    'reviewReason',
    'status',
    'submittedAt',
    'updatedAt',
    'version',
  ].sort());
  assert.equal('requestedByActorId' in value, false);
  assert.equal('sourceMetadata' in value, false);
  assert.equal('idempotencyKey' in value, false);
  assert.equal('payloadHash' in value, false);
});

test('072 migration generalizes onboarding without weakening MCP source semantics', () => {
  const sql = readFileSync(new URL('../../../database/migrations/sales/072_customer_portal_registration_onboarding.sql', import.meta.url), 'utf8');
  assert.match(sql, /source_system IN \('MCP', 'CUSTOMER_PORTAL'\)/);
  assert.match(sql, /source_system = 'MCP'[\s\S]*order_required = true[\s\S]*OFFICIAL_ORDER_REQUIRED/);
  assert.match(sql, /source_system = 'CUSTOMER_PORTAL'[\s\S]*order_required = false[\s\S]*CUSTOMER_REGISTRATION/);
  assert.match(sql, /requested_by_portal_user_id/);
  assert.match(sql, /REFERENCES shared\.portal_users/);
  assert.match(sql, /customer_onboarding_requests_one_portal_registration_idx/);
});

test('identity lock namespace matches guarded provisioning and active membership truth is separated from usability', () => {
  const repository = readFileSync(new URL('../src/db/repositories/customer-portal.js', import.meta.url), 'utf8');
  const provisioning = readFileSync(new URL('../scripts/phase-9-8-provision-customer-portal.js', import.meta.url), 'utf8');
  assert.match(repository, /`\$\{installationId\}:\$\{provider\}:\$\{providerSubject\}`/);
  assert.match(provisioning, /`\$\{installationId\}:\$\{PROVIDER\}:\$\{input\.providerSubject\}`/);
  assert.match(repository, /getActiveMembershipByPortalUser[\s\S]*FROM sales\.customer_portal_memberships/);
  assert.match(repository, /getUsableMembershipByPortalUser/);
  const migration071 = readFileSync(new URL('../../../database/migrations/sales/071_customer_portal_order_intake.sql', import.meta.url), 'utf8');
  assert.match(migration071, /customer_portal_memberships_one_active_user_idx/);
});

test('registration routes run before membership gate and unsupported registration methods stop at 405', () => {
  const route = readFileSync(new URL('../src/routes/customer-portal.js', import.meta.url), 'utf8');
  const registrationIndex = route.indexOf('const registrationHandled = await handleRegistrationRoutes');
  const membershipIndex = route.indexOf('const portal = await authenticateMembership');
  assert.ok(registrationIndex >= 0);
  assert.ok(membershipIndex > registrationIndex);
  assert.match(route, /CUSTOMER_PORTAL_ALREADY_ACTIVE/);
  assert.match(route, /membershipResult\.hasActiveMembership/);
  assert.match(route, /url\.pathname === REGISTRATION_COLLECTION \|\| url\.pathname === REGISTRATION_CURRENT \|\| resubmitMatch/);
  const conflictIndex = route.indexOf("code.includes('CONFLICT')");
  const membershipStatusIndex = route.indexOf("code.includes('MEMBERSHIP')");
  assert.ok(conflictIndex >= 0 && membershipStatusIndex > conflictIndex);
});

test('reviewer options and NPP UI carry warehouse and sales-channel activation choices', () => {
  const onboardingRoute = readFileSync(new URL('../src/routes/customer-onboarding.js', import.meta.url), 'utf8');
  assert.match(onboardingRoute, /customer-onboarding-portal-options/);
  assert.match(onboardingRoute, /coreCustomerOnboardingReview/);

  const reviewUi = readFileSync(new URL('../../web/app/management/customer-onboarding/customer-onboarding-review.tsx', import.meta.url), 'utf8');
  assert.match(reviewUi, /sourceSystem === 'CUSTOMER_PORTAL'/);
  assert.match(reviewUi, /portalWarehouseId/);
  assert.match(reviewUi, /portalSalesChannelId/);
  assert.match(reviewUi, /Kích hoạt quyền đặt hàng/);
});

test('approval and link-existing keep portal membership binding inside the onboarding transaction', () => {
  const source = readFileSync(new URL('../src/services/customer-onboarding.js', import.meta.url), 'utf8');
  assert.match(source, /activatePortalMembershipForRequest/);
  assert.match(source, /portalMembership: portal\.membership/);
  assert.match(source, /CUSTOMER_PORTAL_MEMBERSHIP_CONFLICT/);
  assert.match(source, /CUSTOMER_PORTAL_WAREHOUSE_SELECTION_REQUIRED/);
  assert.match(source, /CUSTOMER_PORTAL_SALES_CHANNEL_SELECTION_REQUIRED/);
});
