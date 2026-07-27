import * as customerRepo from '../db/repositories/customer.js';

const CODE_PATTERN = /^[A-Z0-9_-]{1,64}$/;
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function normalizeCode(code) {
  if (typeof code !== 'string') return '';
  return code.trim().toUpperCase();
}

function normalizeText(text) {
  if (typeof text !== 'string') return '';
  return text.trim();
}

function validateEmail(email) {
  if (!email) return true;
  const pattern = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  return pattern.test(email);
}

function validatePhone(phone) {
  if (!phone) return true;
  const pattern = /^[0-9\s\-+()]{5,20}$/;
  return pattern.test(phone);
}

function validateEntityId(id) {
  return typeof id === 'string' && UUID_PATTERN.test(id.trim());
}

function validateExpectedUpdatedAt(value) {
  if (value === undefined || value === null) {
    return { ok: false, code: 'MISSING_EXPECTED_UPDATED_AT', message: 'expectedUpdatedAt is required' };
  }

  if (value instanceof Date) {
    if (Number.isNaN(value.getTime())) {
      return { ok: false, code: 'INVALID_EXPECTED_UPDATED_AT', message: 'expectedUpdatedAt must be a valid date-time' };
    }
    return { ok: true, value: value.toISOString() };
  }

  if (typeof value !== 'string' || !value.trim()) {
    return { ok: false, code: 'INVALID_EXPECTED_UPDATED_AT', message: 'expectedUpdatedAt must be a non-empty string' };
  }

  const parsed = new Date(value.trim());
  if (Number.isNaN(parsed.getTime())) {
    return { ok: false, code: 'INVALID_EXPECTED_UPDATED_AT', message: 'expectedUpdatedAt must be a valid date-time' };
  }

  return { ok: true, value: parsed.toISOString() };
}

export function validateCustomerInput(payload) {
  if (!payload || typeof payload !== 'object') {
    return { ok: false, code: 'INVALID_INPUT', message: 'Customer data is required' };
  }

  const code = normalizeCode(payload.code);
  if (!CODE_PATTERN.test(code)) {
    return { ok: false, code: 'INVALID_CODE', message: 'Code must be 1-64 characters and contain only uppercase letters, digits, hyphens, or underscores' };
  }

  const name = normalizeText(payload.name);
  if (!name || name.length > 256) {
    return { ok: false, code: 'INVALID_NAME', message: 'Name is required and must be 1-256 characters' };
  }

  const address = normalizeText(payload.address);
  if (address && address.length > 512) {
    return { ok: false, code: 'INVALID_ADDRESS', message: 'Address must be 0-512 characters' };
  }

  const phone = normalizeText(payload.phone);
  if (phone && !validatePhone(phone)) {
    return { ok: false, code: 'INVALID_PHONE', message: 'Phone must be a valid format' };
  }

  const email = normalizeText(payload.email);
  if (email && !validateEmail(email)) {
    return { ok: false, code: 'INVALID_EMAIL', message: 'Email must be a valid format' };
  }

  return {
    ok: true,
    normalized: {
      code,
      name,
      address: address || null,
      phone: phone || null,
      email: email || null,
    },
  };
}

export async function createCustomer(client, { installationId, payload, createdBy }) {
  const validation = validateCustomerInput(payload);
  if (!validation.ok) return { ok: false, code: validation.code, message: validation.message };

  const existing = await customerRepo.getCustomerByCode(client, { installationId, code: validation.normalized.code });
  if (existing) {
    return { ok: false, code: 'DUPLICATE_CODE', message: 'A customer with this code already exists', retryable: false };
  }

  const customer = await customerRepo.insertCustomer(client, {
    installationId,
    code: validation.normalized.code,
    name: validation.normalized.name,
    address: validation.normalized.address,
    phone: validation.normalized.phone,
    email: validation.normalized.email,
    createdBy,
  });

  return { ok: true, customer };
}

export async function getCustomer(client, { installationId, id }) {
  if (!validateEntityId(id)) {
    return { ok: false, code: 'NOT_FOUND', message: 'Customer not found' };
  }

  const customer = await customerRepo.getCustomerByIdForInstallation(client, { id: id.trim(), installationId });
  if (!customer) {
    return { ok: false, code: 'NOT_FOUND', message: 'Customer not found' };
  }

  return { ok: true, customer };
}

export async function listCustomers(client, { installationId, active, limit, offset }) {
  const customers = await customerRepo.listCustomersForInstallation(client, { installationId, active, limit, offset });
  return { ok: true, customers };
}

export async function updateCustomer(client, { id, installationId, payload, updatedBy }) {
  if (!validateEntityId(id)) {
    return { ok: false, code: 'INVALID_ID', message: 'Customer ID must be a valid UUID' };
  }

  const normalizedId = id.trim();
  const existing = await customerRepo.getCustomerByIdForInstallation(client, { id: normalizedId, installationId });
  if (!existing) {
    return { ok: false, code: 'NOT_FOUND', message: 'Customer not found' };
  }

  const validation = validateCustomerInput({ code: existing.code, ...payload });
  if (!validation.ok) return { ok: false, code: validation.code, message: validation.message };

  const expectedUpdatedAtValidation = validateExpectedUpdatedAt(payload.expectedUpdatedAt);
  if (expectedUpdatedAtValidation && !expectedUpdatedAtValidation.ok) {
    return { ok: false, code: expectedUpdatedAtValidation.code, message: expectedUpdatedAtValidation.message };
  }

  const updated = await customerRepo.updateCustomer(client, {
    id: normalizedId,
    installationId,
    name: validation.normalized.name,
    address: validation.normalized.address,
    phone: validation.normalized.phone,
    email: validation.normalized.email,
    updatedBy,
    expectedUpdatedAt: expectedUpdatedAtValidation?.value ?? null,
  });

  if (!updated) {
    return { ok: false, code: 'CONFLICT', message: 'Customer update conflict: expectedUpdatedAt does not match current record', retryable: false };
  }

  return { ok: true, customer: updated, beforeData: existing };
}

export async function updateCustomerStatus(client, { id, installationId, isActive, updatedBy, expectedUpdatedAt }) {
  if (!validateEntityId(id)) {
    return { ok: false, code: 'INVALID_ID', message: 'Customer ID must be a valid UUID' };
  }

  const normalizedId = id.trim();
  const existing = await customerRepo.getCustomerByIdForInstallationForUpdate(client, { id: normalizedId, installationId });
  if (!existing) {
    return { ok: false, code: 'NOT_FOUND', message: 'Customer not found' };
  }

  const expectedUpdatedAtValidation = validateExpectedUpdatedAt(expectedUpdatedAt);
  if (expectedUpdatedAtValidation && !expectedUpdatedAtValidation.ok) {
    return { ok: false, code: expectedUpdatedAtValidation.code, message: expectedUpdatedAtValidation.message };
  }

  if (typeof isActive !== 'boolean') {
    return { ok: false, code: 'INVALID_ACTIVE_STATUS', message: 'isActive must be a boolean' };
  }

  if (existing.is_active === isActive) {
    return { ok: true, customer: existing, beforeData: existing };
  }

  const updated = await customerRepo.updateCustomerActiveStatus(client, {
    id: normalizedId,
    installationId,
    isActive,
    updatedBy,
    expectedUpdatedAt: expectedUpdatedAtValidation?.value ?? null,
  });

  if (!updated) {
    return { ok: false, code: 'CONFLICT', message: 'Customer status update conflict: expectedUpdatedAt does not match current record', retryable: false };
  }

  return { ok: true, customer: updated, beforeData: existing };
}
