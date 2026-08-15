import { hashSubmission } from './customer-onboarding.js';
import * as repository from '../db/repositories/customer-onboarding.js';

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const PHONE_PATTERN = /^[0-9\s+()\-]{5,20}$/;
export const FIELD_PROFILE_VERIFICATION = 'FIELD_PROFILE_VERIFICATION';

function text(value) {
  return typeof value === 'string' ? value.trim() : '';
}

function optionalText(value, maxLength) {
  const normalized = text(value);
  if (!normalized) return { ok: true, value: null };
  if (normalized.length > maxLength) return { ok: false };
  return { ok: true, value: normalized };
}

function isPlainObject(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function validateSnapshot(payload) {
  if (!isPlainObject(payload?.proposedCustomer)) {
    return { ok: false, code: 'INVALID_CUSTOMER_SNAPSHOT', message: 'proposedCustomer is required' };
  }
  const proposedName = text(payload.proposedCustomer.name);
  if (!proposedName || proposedName.length > 256) {
    return { ok: false, code: 'INVALID_CUSTOMER_NAME', message: 'Customer name is required and must not exceed 256 characters' };
  }
  const proposedPhone = text(payload.proposedCustomer.phone);
  if (proposedPhone && !PHONE_PATTERN.test(proposedPhone)) {
    return { ok: false, code: 'INVALID_CUSTOMER_PHONE', message: 'Customer phone format is invalid' };
  }
  const address = payload.proposedCustomer.address;
  if (!isPlainObject(address)) {
    return { ok: false, code: 'INVALID_ADDRESS_SNAPSHOT', message: 'Customer address snapshot is required' };
  }
  const proposedAddressLine1 = text(address.addressLine1);
  if (!proposedAddressLine1 || proposedAddressLine1.length > 512) {
    return { ok: false, code: 'INVALID_ADDRESS_LINE1', message: 'addressLine1 is required and must not exceed 512 characters' };
  }
  const proposedAddressLabel = text(address.label || 'Điểm bán MCP');
  if (!proposedAddressLabel || proposedAddressLabel.length > 128) {
    return { ok: false, code: 'INVALID_ADDRESS_LABEL', message: 'Address label must not exceed 128 characters' };
  }
  const proposedAddressLine2 = optionalText(address.addressLine2, 512);
  const proposedWard = optionalText(address.ward, 128);
  const proposedDistrict = optionalText(address.district, 128);
  const proposedProvince = optionalText(address.province, 128);
  const proposedPostalCode = optionalText(address.postalCode, 32);
  if (![proposedAddressLine2, proposedWard, proposedDistrict, proposedProvince, proposedPostalCode].every((item) => item.ok)) {
    return { ok: false, code: 'INVALID_ADDRESS_SNAPSHOT', message: 'One or more address fields exceed the allowed length' };
  }
  const proposedCountryCode = text(address.countryCode || 'VN').toUpperCase();
  if (!/^[A-Z]{2}$/.test(proposedCountryCode)) {
    return { ok: false, code: 'INVALID_COUNTRY_CODE', message: 'countryCode must be a two-letter code' };
  }
  return {
    ok: true,
    normalized: {
      proposedName,
      proposedPhone: proposedPhone || null,
      proposedAddressLabel,
      proposedAddressLine1,
      proposedAddressLine2: proposedAddressLine2.value,
      proposedWard: proposedWard.value,
      proposedDistrict: proposedDistrict.value,
      proposedProvince: proposedProvince.value,
      proposedPostalCode: proposedPostalCode.value,
      proposedCountryCode,
    },
  };
}

export function validateFieldProfileSubmission(payload, requestContext) {
  if (!isPlainObject(payload)) {
    return { ok: false, code: 'INVALID_INPUT', message: 'Customer verification payload is required' };
  }
  if (!UUID_PATTERN.test(text(requestContext?.employeeId))) {
    return { ok: false, code: 'TRUSTED_EMPLOYEE_REQUIRED', message: 'Trusted MCP employee identity is required' };
  }
  if (text(payload.sourceSystem || 'MCP').toUpperCase() !== 'MCP') {
    return { ok: false, code: 'INVALID_SOURCE_SYSTEM', message: 'Only MCP submissions are accepted on this endpoint' };
  }
  const sourceOutletId = text(payload.sourceOutletId);
  if (!sourceOutletId || sourceOutletId.length > 128) {
    return { ok: false, code: 'MISSING_SOURCE_OUTLET', message: 'sourceOutletId is required and must not exceed 128 characters' };
  }
  if (text(payload.sourceDemandReference) !== FIELD_PROFILE_VERIFICATION) {
    return { ok: false, code: 'INVALID_FIELD_PROFILE_REFERENCE', message: 'Field profile verification must use the canonical source reference' };
  }
  if (payload.orderRequired !== false || text(payload.triggerReason).toUpperCase() !== FIELD_PROFILE_VERIFICATION) {
    return { ok: false, code: 'INVALID_FIELD_PROFILE_TRIGGER', message: 'Field profile verification must be independent from an order' };
  }
  const snapshot = validateSnapshot(payload);
  if (!snapshot.ok) return snapshot;
  const sourceMetadata = payload.sourceMetadata ?? {};
  if (!isPlainObject(sourceMetadata) || JSON.stringify(sourceMetadata).length > 8000) {
    return { ok: false, code: 'INVALID_SOURCE_METADATA', message: 'sourceMetadata must be an object of at most 8000 characters' };
  }
  return {
    ok: true,
    normalized: {
      sourceSystem: 'MCP',
      sourceOutletId,
      sourceDemandReference: FIELD_PROFILE_VERIFICATION,
      orderRequired: false,
      triggerReason: FIELD_PROFILE_VERIFICATION,
      ...snapshot.normalized,
      sourceMetadata,
    },
  };
}

export async function submitFieldProfileRequest(client, { requestContext, payload, idempotencyKey }) {
  const validation = validateFieldProfileSubmission(payload, requestContext);
  if (!validation.ok) return validation;
  const normalized = validation.normalized;
  const payloadHash = hashSubmission(normalized);
  const lookup = {
    installationId: requestContext.installationId,
    sourceSystem: normalized.sourceSystem,
    sourceOutletId: normalized.sourceOutletId,
    sourceDemandReference: normalized.sourceDemandReference,
  };

  await repository.lockCustomerOnboardingSourceDemand(client, lookup);
  const existing = await repository.getCustomerOnboardingRequestBySourceDemand(client, { ...lookup, forUpdate: true });
  if (existing) {
    if (existing.payloadHash !== payloadHash || existing.requestedByEmployeeId !== requestContext.employeeId) {
      return {
        ok: false,
        code: 'DEMAND_REFERENCE_PAYLOAD_MISMATCH',
        message: 'The field profile verification already exists with different ownership or customer data',
      };
    }
    return { ok: true, request: existing, replayed: true, changed: false };
  }

  const created = await repository.insertCustomerOnboardingRequest(client, {
    installationId: requestContext.installationId,
    ...normalized,
    requestedByActorId: requestContext.actorId,
    requestedByEmployeeId: requestContext.employeeId,
    requestedByPortalUserId: null,
    idempotencyKey,
    payloadHash,
  });
  if (created) return { ok: true, request: created, replayed: false, changed: true };

  const raced = await repository.getCustomerOnboardingRequestBySourceDemand(client, lookup);
  if (raced?.payloadHash === payloadHash && raced.requestedByEmployeeId === requestContext.employeeId) {
    return { ok: true, request: raced, replayed: true, changed: false };
  }
  return {
    ok: false,
    code: 'DEMAND_REFERENCE_CONFLICT',
    message: 'The field profile verification was concurrently created with different data',
  };
}
