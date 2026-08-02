import { createRequestFingerprint } from '../idempotency.js';
import * as repository from '../db/repositories/customer-onboarding.js';
import * as customerService from './customer.js';

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const PHONE_PATTERN = /^[0-9\s+()\-]{5,20}$/;
const STATUS_VALUES = new Set([
  'submitted',
  'under_review',
  'need_more_info',
  'approved',
  'linked_existing',
  'rejected',
  'cancelled',
]);
const PRIVILEGED_SUBMISSION_FIELDS = Object.freeze([
  'status',
  'reviewedByActorId',
  'reviewerId',
  'reviewReason',
  'approvedCustomerId',
  'approvedCustomerAddressId',
  'customerId',
  'addressId',
]);

function text(value) {
  return typeof value === 'string' ? value.trim() : '';
}

function optionalText(value, maxLength) {
  const normalized = text(value);
  if (!normalized) return { ok: true, value: null };
  if (normalized.length > maxLength) return { ok: false };
  return { ok: true, value: normalized };
}

function validUuid(value) {
  return typeof value === 'string' && UUID_PATTERN.test(value.trim());
}

function isPlainObject(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function stableSubmissionShape(normalized) {
  return {
    sourceSystem: normalized.sourceSystem,
    sourceOutletId: normalized.sourceOutletId,
    sourceDemandReference: normalized.sourceDemandReference,
    orderRequired: true,
    triggerReason: 'OFFICIAL_ORDER_REQUIRED',
    proposedName: normalized.proposedName,
    proposedPhone: normalized.proposedPhone,
    proposedAddressLabel: normalized.proposedAddressLabel,
    proposedAddressLine1: normalized.proposedAddressLine1,
    proposedAddressLine2: normalized.proposedAddressLine2,
    proposedWard: normalized.proposedWard,
    proposedDistrict: normalized.proposedDistrict,
    proposedProvince: normalized.proposedProvince,
    proposedPostalCode: normalized.proposedPostalCode,
    proposedCountryCode: normalized.proposedCountryCode,
    sourceMetadata: normalized.sourceMetadata,
  };
}

export function hashSubmission(normalized) {
  return createRequestFingerprint(stableSubmissionShape(normalized));
}

export function validateSubmission(payload) {
  if (!isPlainObject(payload)) {
    return { ok: false, code: 'INVALID_INPUT', message: 'Customer verification payload is required' };
  }
  const forbidden = PRIVILEGED_SUBMISSION_FIELDS.find((key) => Object.prototype.hasOwnProperty.call(payload, key));
  if (forbidden) {
    return {
      ok: false,
      code: 'SUBMISSION_PRIVILEGED_FIELD_FORBIDDEN',
      message: `Submission cannot set ${forbidden}`,
    };
  }

  const sourceSystem = text(payload.sourceSystem || 'MCP').toUpperCase();
  if (sourceSystem !== 'MCP') {
    return { ok: false, code: 'INVALID_SOURCE_SYSTEM', message: 'Only MCP submissions are accepted in Phase 6C.1A' };
  }
  const sourceOutletId = text(payload.sourceOutletId);
  if (!sourceOutletId || sourceOutletId.length > 128) {
    return { ok: false, code: 'MISSING_SOURCE_OUTLET', message: 'sourceOutletId is required and must not exceed 128 characters' };
  }
  const sourceDemandReference = text(payload.sourceDemandReference);
  if (!sourceDemandReference || sourceDemandReference.length > 128) {
    return { ok: false, code: 'MISSING_DEMAND_REFERENCE', message: 'sourceDemandReference is required and must not exceed 128 characters' };
  }
  if (payload.orderRequired !== true) {
    return { ok: false, code: 'ORDER_REQUIRED_TRIGGER_MISSING', message: 'An explicit official-order trigger is required' };
  }

  if (!isPlainObject(payload.proposedCustomer)) {
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
  const label = text(address.label || 'Địa chỉ chính');
  if (!label || label.length > 128) {
    return { ok: false, code: 'INVALID_ADDRESS_LABEL', message: 'Address label must not exceed 128 characters' };
  }
  const addressLine2 = optionalText(address.addressLine2, 512);
  const ward = optionalText(address.ward, 128);
  const district = optionalText(address.district, 128);
  const province = optionalText(address.province, 128);
  const postalCode = optionalText(address.postalCode, 32);
  if (![addressLine2, ward, district, province, postalCode].every((item) => item.ok)) {
    return { ok: false, code: 'INVALID_ADDRESS_SNAPSHOT', message: 'One or more address fields exceed the allowed length' };
  }
  const proposedCountryCode = text(address.countryCode || 'VN').toUpperCase();
  if (!/^[A-Z]{2}$/.test(proposedCountryCode)) {
    return { ok: false, code: 'INVALID_COUNTRY_CODE', message: 'countryCode must be a two-letter code' };
  }

  const sourceMetadata = payload.sourceMetadata ?? {};
  if (!isPlainObject(sourceMetadata) || JSON.stringify(sourceMetadata).length > 8000) {
    return { ok: false, code: 'INVALID_SOURCE_METADATA', message: 'sourceMetadata must be an object of at most 8000 characters' };
  }

  return {
    ok: true,
    normalized: {
      sourceSystem,
      sourceOutletId,
      sourceDemandReference,
      proposedName,
      proposedPhone: proposedPhone || null,
      proposedAddressLabel: label,
      proposedAddressLine1,
      proposedAddressLine2: addressLine2.value,
      proposedWard: ward.value,
      proposedDistrict: district.value,
      proposedProvince: province.value,
      proposedPostalCode: postalCode.value,
      proposedCountryCode,
      sourceMetadata,
    },
  };
}

export async function submitRequest(client, {
  requestContext,
  payload,
  idempotencyKey,
}) {
  const validation = validateSubmission(payload);
  if (!validation.ok) return validation;
  const normalized = validation.normalized;
  const payloadHash = hashSubmission(normalized);

  const lookup = {
    installationId: requestContext.installationId,
    sourceSystem: normalized.sourceSystem,
    sourceOutletId: normalized.sourceOutletId,
    sourceDemandReference: normalized.sourceDemandReference,
  };
  const existing = await repository.getCustomerOnboardingRequestBySourceDemand(client, {
    ...lookup,
    forUpdate: true,
  });
  if (existing) {
    if (existing.payloadHash !== payloadHash) {
      return {
        ok: false,
        code: 'DEMAND_REFERENCE_PAYLOAD_MISMATCH',
        message: 'The demand reference already exists with a different customer snapshot',
      };
    }
    return { ok: true, request: existing, replayed: true, changed: false };
  }

  const created = await repository.insertCustomerOnboardingRequest(client, {
    installationId: requestContext.installationId,
    ...normalized,
    requestedByActorId: requestContext.actorId,
    requestedByEmployeeId: requestContext.employeeId,
    idempotencyKey,
    payloadHash,
  });
  if (created) return { ok: true, request: created, replayed: false, changed: true };

  const raced = await repository.getCustomerOnboardingRequestBySourceDemand(client, lookup);
  if (raced?.payloadHash === payloadHash) {
    return { ok: true, request: raced, replayed: true, changed: false };
  }
  return {
    ok: false,
    code: 'DEMAND_REFERENCE_CONFLICT',
    message: 'The demand reference was concurrently created with a different payload',
  };
}

export async function getRequest(client, { requestContext, id, restrictToRequester = false }) {
  if (!validUuid(id)) return { ok: false, code: 'CUSTOMER_ONBOARDING_NOT_FOUND', message: 'Customer verification request not found' };
  const request = await repository.getCustomerOnboardingRequestById(client, {
    installationId: requestContext.installationId,
    id: id.trim(),
  });
  if (!request || (restrictToRequester && request.requestedByActorId !== requestContext.actorId)) {
    return { ok: false, code: 'CUSTOMER_ONBOARDING_NOT_FOUND', message: 'Customer verification request not found' };
  }
  return { ok: true, request };
}

export async function listRequests(client, {
  requestContext,
  status,
  sourceOutletId,
  limit,
  offset,
  restrictToRequester = false,
}) {
  if (status && !STATUS_VALUES.has(status)) {
    return { ok: false, code: 'INVALID_STATUS', message: 'Customer verification status is invalid' };
  }
  const requests = await repository.listCustomerOnboardingRequests(client, {
    installationId: requestContext.installationId,
    status: status || null,
    sourceSystem: restrictToRequester ? 'MCP' : null,
    sourceOutletId: text(sourceOutletId) || null,
    requestedByActorId: restrictToRequester ? requestContext.actorId : null,
    limit,
    offset,
  });
  return { ok: true, requests };
}

async function lockRequest(client, requestContext, id) {
  if (!validUuid(id)) return null;
  return repository.getCustomerOnboardingRequestById(client, {
    installationId: requestContext.installationId,
    id: id.trim(),
    forUpdate: true,
  });
}

function normalizeExpectedVersion(payload) {
  const expectedVersion = Number(payload?.expectedVersion);
  if (!Number.isInteger(expectedVersion) || expectedVersion < 1) {
    return { ok: false, code: 'INVALID_EXPECTED_VERSION', message: 'expectedVersion must be a positive integer' };
  }
  return { ok: true, value: expectedVersion };
}

function normalizeReason(payload, { required = false } = {}) {
  const reason = text(payload?.reason);
  if ((required && !reason) || reason.length > 2000) {
    return { ok: false, code: 'INVALID_REVIEW_REASON', message: required ? 'A review reason is required' : 'Review reason must not exceed 2000 characters' };
  }
  return { ok: true, value: reason || null };
}

async function transition(client, {
  requestContext,
  id,
  payload,
  allowedStatuses,
  nextStatus,
  reasonRequired = false,
  approvedCustomerId = null,
  approvedCustomerAddressId = null,
}) {
  const expected = normalizeExpectedVersion(payload);
  if (!expected.ok) return expected;
  const reason = normalizeReason(payload, { required: reasonRequired });
  if (!reason.ok) return reason;
  const before = await lockRequest(client, requestContext, id);
  if (!before) return { ok: false, code: 'CUSTOMER_ONBOARDING_NOT_FOUND', message: 'Customer verification request not found' };
  if (before.version !== expected.value) {
    return { ok: false, code: 'CUSTOMER_ONBOARDING_VERSION_CONFLICT', message: 'Customer verification request changed; reload and retry' };
  }
  if (!allowedStatuses.includes(before.status)) {
    return {
      ok: false,
      code: 'INVALID_STATUS_TRANSITION',
      message: `Cannot move customer verification request from ${before.status} to ${nextStatus}`,
    };
  }
  const request = await repository.transitionCustomerOnboardingRequest(client, {
    installationId: requestContext.installationId,
    id: before.id,
    expectedVersion: expected.value,
    allowedStatuses,
    nextStatus,
    reviewedByActorId: requestContext.actorId,
    reviewReason: reason.value,
    approvedCustomerId,
    approvedCustomerAddressId,
  });
  if (!request) {
    return { ok: false, code: 'CUSTOMER_ONBOARDING_VERSION_CONFLICT', message: 'Customer verification request changed; reload and retry' };
  }
  return { ok: true, request, beforeData: before, changed: true };
}

export async function startReview(client, args) {
  return transition(client, {
    ...args,
    allowedStatuses: ['submitted', 'need_more_info'],
    nextStatus: 'under_review',
  });
}

export async function requestMoreInfo(client, args) {
  return transition(client, {
    ...args,
    allowedStatuses: ['under_review'],
    nextStatus: 'need_more_info',
    reasonRequired: true,
  });
}

export async function rejectRequest(client, args) {
  return transition(client, {
    ...args,
    allowedStatuses: ['under_review'],
    nextStatus: 'rejected',
    reasonRequired: true,
  });
}

export async function cancelRequest(client, args) {
  return transition(client, {
    ...args,
    allowedStatuses: ['submitted', 'under_review', 'need_more_info'],
    nextStatus: 'cancelled',
    reasonRequired: true,
  });
}

export async function approveNewCustomer(client, { requestContext, id, payload }) {
  const expected = normalizeExpectedVersion(payload);
  if (!expected.ok) return expected;
  const before = await lockRequest(client, requestContext, id);
  if (!before) return { ok: false, code: 'CUSTOMER_ONBOARDING_NOT_FOUND', message: 'Customer verification request not found' };
  if (before.version !== expected.value) {
    return { ok: false, code: 'CUSTOMER_ONBOARDING_VERSION_CONFLICT', message: 'Customer verification request changed; reload and retry' };
  }
  if (before.status !== 'under_review') {
    return { ok: false, code: 'INVALID_STATUS_TRANSITION', message: 'Only requests under review can be approved' };
  }

  const customer = await customerService.createCustomer(client, {
    installationId: requestContext.installationId,
    createdBy: requestContext.actorId,
    payload: {
      code: payload?.customerCode,
      name: before.proposedCustomer.name,
      phone: before.proposedCustomer.phone,
      groupId: payload?.groupId,
      responsibleEmployeeId: payload?.responsibleEmployeeId,
      email: payload?.email,
      taxCode: payload?.taxCode,
      paymentTermsDays: payload?.paymentTermsDays,
      creditLimit: payload?.creditLimit,
      notes: payload?.notes,
    },
  });
  if (!customer.ok) return customer;

  const snapshotAddress = before.proposedCustomer.address;
  const address = await customerService.createCustomerAddress(client, {
    installationId: requestContext.installationId,
    customerId: customer.customer.id,
    createdBy: requestContext.actorId,
    payload: {
      label: snapshotAddress.label,
      recipientName: before.proposedCustomer.name,
      phone: before.proposedCustomer.phone,
      addressLine1: snapshotAddress.addressLine1,
      addressLine2: snapshotAddress.addressLine2,
      ward: snapshotAddress.ward,
      district: snapshotAddress.district,
      province: snapshotAddress.province,
      postalCode: snapshotAddress.postalCode,
      countryCode: snapshotAddress.countryCode,
      isDefault: true,
      isActive: true,
    },
  });
  if (!address.ok) return address;

  return transition(client, {
    requestContext,
    id: before.id,
    payload,
    allowedStatuses: ['under_review'],
    nextStatus: 'approved',
    approvedCustomerId: customer.customer.id,
    approvedCustomerAddressId: address.address.id,
  });
}

export async function linkExistingCustomer(client, { requestContext, id, payload }) {
  const expected = normalizeExpectedVersion(payload);
  if (!expected.ok) return expected;
  if (!validUuid(payload?.customerId) || !validUuid(payload?.addressId)) {
    return { ok: false, code: 'INVALID_CUSTOMER_LINK', message: 'customerId and addressId must be valid UUIDs' };
  }
  const before = await lockRequest(client, requestContext, id);
  if (!before) return { ok: false, code: 'CUSTOMER_ONBOARDING_NOT_FOUND', message: 'Customer verification request not found' };
  if (before.version !== expected.value) {
    return { ok: false, code: 'CUSTOMER_ONBOARDING_VERSION_CONFLICT', message: 'Customer verification request changed; reload and retry' };
  }
  if (before.status !== 'under_review') {
    return { ok: false, code: 'INVALID_STATUS_TRANSITION', message: 'Only requests under review can be linked' };
  }
  const link = await repository.getActiveCustomerAddressForLink(client, {
    installationId: requestContext.installationId,
    customerId: payload.customerId.trim(),
    addressId: payload.addressId.trim(),
  });
  if (!link) return { ok: false, code: 'CUSTOMER_ADDRESS_NOT_FOUND', message: 'Customer/address link was not found in this installation' };
  if (link.address_customer_id !== link.customer_id) {
    return { ok: false, code: 'CUSTOMER_ADDRESS_MISMATCH', message: 'Address does not belong to the selected customer' };
  }
  if (!link.customer_is_active) {
    return { ok: false, code: 'CUSTOMER_INACTIVE', message: 'Selected customer is inactive' };
  }
  if (!link.address_is_active) {
    return { ok: false, code: 'CUSTOMER_ADDRESS_INACTIVE', message: 'Selected customer address is inactive' };
  }
  return transition(client, {
    requestContext,
    id: before.id,
    payload,
    allowedStatuses: ['under_review'],
    nextStatus: 'linked_existing',
    approvedCustomerId: link.customer_id,
    approvedCustomerAddressId: link.address_id,
  });
}
