import * as customerRepo from '../db/repositories/customer.js';
import * as employeeRepo from '../db/repositories/employee.js';

const CODE_PATTERN = /^[A-Z0-9_-]{1,64}$/;
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const MONEY_PATTERN = /^\d{1,16}(?:\.\d{1,2})?$/;

function normalizeText(value) {
  return typeof value === 'string' ? value.trim() : '';
}

function normalizeCode(value) {
  return normalizeText(value).toUpperCase();
}

function normalizeOptionalUuid(value) {
  if (value === undefined || value === null || value === '') return null;
  return normalizeText(value);
}

function isValidUuid(value) {
  return typeof value === 'string' && UUID_PATTERN.test(value.trim());
}

function validateEmail(value) {
  return !value || /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value);
}

function validatePhone(value) {
  return !value || /^[0-9\s\-+()]{5,20}$/.test(value);
}

function normalizeDateTime(value) {
  if (value instanceof Date) return Number.isNaN(value.getTime()) ? null : value.toISOString();
  if (typeof value !== 'string' || !value.trim()) return null;
  const parsed = new Date(value.trim());
  return Number.isNaN(parsed.getTime()) ? null : parsed.toISOString();
}

function validateExpectedUpdatedAt(value) {
  if (value === undefined || value === null || value === '') {
    return { ok: false, code: 'MISSING_EXPECTED_UPDATED_AT', message: 'expectedUpdatedAt is required' };
  }
  const normalized = normalizeDateTime(value);
  if (!normalized) {
    return { ok: false, code: 'INVALID_EXPECTED_UPDATED_AT', message: 'expectedUpdatedAt must be a valid date-time' };
  }
  return { ok: true, value: normalized };
}

function conflictResult(message) {
  return { ok: false, code: 'CONFLICT', message, retryable: false };
}

function validateSearch(value) {
  if (value === undefined || value === null || value === '') return { ok: true, value: null };
  const normalized = normalizeText(value);
  if (normalized.length > 256) {
    return { ok: false, code: 'INVALID_SEARCH', message: 'Search must not exceed 256 characters' };
  }
  return { ok: true, value: normalized || null };
}

function normalizeMoney(value, fallback = '0') {
  if (value === undefined || value === null || value === '') return { ok: true, value: fallback };
  const normalized = typeof value === 'number' ? String(value) : normalizeText(value);
  if (!MONEY_PATTERN.test(normalized)) {
    return { ok: false, code: 'INVALID_CREDIT_LIMIT', message: 'Credit limit must be a non-negative amount with at most two decimals' };
  }
  return { ok: true, value: normalized };
}

export function validateCustomerGroupInput(payload, { codeRequired = true } = {}) {
  if (!payload || typeof payload !== 'object') {
    return { ok: false, code: 'INVALID_INPUT', message: 'Customer group data is required' };
  }

  const code = normalizeCode(payload.code);
  if (codeRequired && !CODE_PATTERN.test(code)) {
    return { ok: false, code: 'INVALID_CODE', message: 'Code must contain only uppercase letters, digits, hyphens, or underscores' };
  }

  const name = normalizeText(payload.name);
  if (!name || name.length > 256) {
    return { ok: false, code: 'INVALID_NAME', message: 'Name is required and must not exceed 256 characters' };
  }

  const description = normalizeText(payload.description);
  if (description.length > 1000) {
    return { ok: false, code: 'INVALID_DESCRIPTION', message: 'Description must not exceed 1000 characters' };
  }

  return {
    ok: true,
    normalized: { code, name, description: description || null },
  };
}

export async function createCustomerGroup(client, { installationId, payload, createdBy }) {
  const validation = validateCustomerGroupInput(payload);
  if (!validation.ok) return validation;

  const existing = await customerRepo.getCustomerGroupByCode(client, {
    installationId,
    code: validation.normalized.code,
  });
  if (existing) return { ok: false, code: 'DUPLICATE_CODE', message: 'A customer group with this code already exists' };

  const group = await customerRepo.insertCustomerGroup(client, {
    installationId,
    ...validation.normalized,
    createdBy,
  });
  if (!group) return { ok: false, code: 'DUPLICATE_CODE', message: 'A customer group with this code already exists' };
  return { ok: true, group };
}

export async function getCustomerGroup(client, { installationId, id }) {
  if (!isValidUuid(id)) return { ok: false, code: 'NOT_FOUND', message: 'Customer group not found' };
  const group = await customerRepo.getCustomerGroupByIdForInstallation(client, { id: id.trim(), installationId });
  return group ? { ok: true, group } : { ok: false, code: 'NOT_FOUND', message: 'Customer group not found' };
}

export async function listCustomerGroups(client, { installationId, search, active, limit, offset }) {
  const searchValidation = validateSearch(search);
  if (!searchValidation.ok) return searchValidation;
  const groups = await customerRepo.listCustomerGroupsForInstallation(client, {
    installationId,
    search: searchValidation.value,
    active,
    limit,
    offset,
  });
  return { ok: true, groups };
}

export async function updateCustomerGroup(client, { id, installationId, payload, updatedBy }) {
  if (!isValidUuid(id)) return { ok: false, code: 'INVALID_ID', message: 'Customer group ID must be a valid UUID' };
  const existing = await customerRepo.getCustomerGroupByIdForInstallationForUpdate(client, {
    id: id.trim(),
    installationId,
  });
  if (!existing) return { ok: false, code: 'NOT_FOUND', message: 'Customer group not found' };

  const expected = validateExpectedUpdatedAt(payload?.expectedUpdatedAt);
  if (!expected.ok) return expected;
  if (normalizeDateTime(existing.updated_at) !== expected.value) return conflictResult('Customer group update conflict');

  if (typeof payload?.isActive === 'boolean') {
    if (existing.is_active === payload.isActive) {
      return { ok: true, group: existing, beforeData: existing, changed: false, action: payload.isActive ? 'activate' : 'deactivate' };
    }
    const group = await customerRepo.updateCustomerGroupActiveStatus(client, {
      id: existing.id,
      installationId,
      isActive: payload.isActive,
      updatedBy,
      expectedUpdatedAt: expected.value,
    });
    if (!group) return conflictResult('Customer group status update conflict');
    return { ok: true, group, beforeData: existing, changed: true, action: payload.isActive ? 'activate' : 'deactivate' };
  }

  const validation = validateCustomerGroupInput({
    code: existing.code,
    name: payload?.name ?? existing.name,
    description: Object.prototype.hasOwnProperty.call(payload ?? {}, 'description')
      ? payload.description
      : existing.description ?? '',
  });
  if (!validation.ok) return validation;

  const group = await customerRepo.updateCustomerGroup(client, {
    id: existing.id,
    installationId,
    name: validation.normalized.name,
    description: validation.normalized.description,
    updatedBy,
    expectedUpdatedAt: expected.value,
  });
  if (!group) return conflictResult('Customer group update conflict');
  return { ok: true, group, beforeData: existing, changed: true, action: 'update' };
}

async function resolveGroup(client, { installationId, groupId, requireActive }) {
  if (!groupId) return { ok: true, group: null };
  const group = await customerRepo.getCustomerGroupByIdForInstallationForShare(client, { id: groupId, installationId });
  if (!group) return { ok: false, code: 'GROUP_NOT_FOUND', message: 'Assigned customer group was not found' };
  if (requireActive && !group.is_active) return { ok: false, code: 'GROUP_INACTIVE', message: 'Assigned customer group is not active' };
  return { ok: true, group };
}

async function resolveEmployee(client, { installationId, employeeId, requireActive }) {
  if (!employeeId) return { ok: true, employee: null };
  const employee = await employeeRepo.getEmployeeByIdForInstallationForShare(client, { id: employeeId, installationId });
  if (!employee) return { ok: false, code: 'EMPLOYEE_NOT_FOUND', message: 'Responsible employee was not found' };
  if (requireActive && !employee.is_active) return { ok: false, code: 'EMPLOYEE_INACTIVE', message: 'Responsible employee is not active' };
  return { ok: true, employee };
}

export function validateCustomerInput(payload, { codeRequired = true } = {}) {
  if (!payload || typeof payload !== 'object') {
    return { ok: false, code: 'INVALID_INPUT', message: 'Customer data is required' };
  }

  const code = normalizeCode(payload.code);
  if (codeRequired && !CODE_PATTERN.test(code)) {
    return { ok: false, code: 'INVALID_CODE', message: 'Code must contain only uppercase letters, digits, hyphens, or underscores' };
  }

  const name = normalizeText(payload.name);
  if (!name || name.length > 256) {
    return { ok: false, code: 'INVALID_NAME', message: 'Name is required and must not exceed 256 characters' };
  }

  const groupId = normalizeOptionalUuid(payload.groupId);
  if (groupId && !isValidUuid(groupId)) {
    return { ok: false, code: 'INVALID_GROUP_ID', message: 'Customer group ID must be a valid UUID' };
  }

  const responsibleEmployeeId = normalizeOptionalUuid(payload.responsibleEmployeeId);
  if (responsibleEmployeeId && !isValidUuid(responsibleEmployeeId)) {
    return { ok: false, code: 'INVALID_EMPLOYEE_ID', message: 'Responsible employee ID must be a valid UUID' };
  }

  const phone = normalizeText(payload.phone);
  if (!validatePhone(phone)) return { ok: false, code: 'INVALID_PHONE', message: 'Phone number format is invalid' };

  const email = normalizeText(payload.email).toLowerCase();
  if (email.length > 256 || !validateEmail(email)) {
    return { ok: false, code: 'INVALID_EMAIL', message: 'Email address format is invalid' };
  }

  const taxCode = normalizeText(payload.taxCode);
  if (taxCode.length > 64) return { ok: false, code: 'INVALID_TAX_CODE', message: 'Tax code must not exceed 64 characters' };

  const paymentTermsDays = payload.paymentTermsDays === undefined || payload.paymentTermsDays === null || payload.paymentTermsDays === ''
    ? 0
    : Number(payload.paymentTermsDays);
  if (!Number.isInteger(paymentTermsDays) || paymentTermsDays < 0 || paymentTermsDays > 3650) {
    return { ok: false, code: 'INVALID_PAYMENT_TERMS', message: 'Payment terms must be an integer from 0 through 3650 days' };
  }

  const creditLimit = normalizeMoney(payload.creditLimit);
  if (!creditLimit.ok) return creditLimit;

  const notes = normalizeText(payload.notes);
  if (notes.length > 2000) return { ok: false, code: 'INVALID_NOTES', message: 'Notes must not exceed 2000 characters' };

  return {
    ok: true,
    normalized: {
      code,
      name,
      groupId,
      responsibleEmployeeId,
      phone: phone || null,
      email: email || null,
      taxCode: taxCode || null,
      paymentTermsDays,
      creditLimit: creditLimit.value,
      notes: notes || null,
    },
  };
}

export async function createCustomer(client, { installationId, payload, createdBy }) {
  const validation = validateCustomerInput(payload);
  if (!validation.ok) return validation;

  const existing = await customerRepo.getCustomerByCode(client, {
    installationId,
    code: validation.normalized.code,
  });
  if (existing) return { ok: false, code: 'DUPLICATE_CODE', message: 'A customer with this code already exists' };

  const groupResult = await resolveGroup(client, {
    installationId,
    groupId: validation.normalized.groupId,
    requireActive: true,
  });
  if (!groupResult.ok) return groupResult;

  const employeeResult = await resolveEmployee(client, {
    installationId,
    employeeId: validation.normalized.responsibleEmployeeId,
    requireActive: true,
  });
  if (!employeeResult.ok) return employeeResult;

  const customer = await customerRepo.insertCustomer(client, {
    installationId,
    ...validation.normalized,
    createdBy,
  });
  if (!customer) return { ok: false, code: 'DUPLICATE_CODE', message: 'A customer with this code already exists' };
  return { ok: true, customer };
}

export async function getCustomer(client, { installationId, id }) {
  if (!isValidUuid(id)) return { ok: false, code: 'NOT_FOUND', message: 'Customer not found' };
  const customer = await customerRepo.getCustomerByIdForInstallation(client, { id: id.trim(), installationId });
  return customer ? { ok: true, customer } : { ok: false, code: 'NOT_FOUND', message: 'Customer not found' };
}

export async function listCustomers(client, { installationId, search, active, groupId, limit, offset }) {
  const searchValidation = validateSearch(search);
  if (!searchValidation.ok) return searchValidation;
  const normalizedGroupId = normalizeOptionalUuid(groupId);
  if (normalizedGroupId && !isValidUuid(normalizedGroupId)) {
    return { ok: false, code: 'INVALID_GROUP_ID', message: 'Customer group ID must be a valid UUID' };
  }
  const customers = await customerRepo.listCustomersForInstallation(client, {
    installationId,
    search: searchValidation.value,
    active,
    groupId: normalizedGroupId,
    limit,
    offset,
  });
  return { ok: true, customers };
}

export async function updateCustomer(client, { id, installationId, payload, updatedBy }) {
  if (!isValidUuid(id)) return { ok: false, code: 'INVALID_ID', message: 'Customer ID must be a valid UUID' };
  const existing = await customerRepo.getCustomerByIdForInstallationForUpdate(client, { id: id.trim(), installationId });
  if (!existing) return { ok: false, code: 'NOT_FOUND', message: 'Customer not found' };

  const expected = validateExpectedUpdatedAt(payload?.expectedUpdatedAt);
  if (!expected.ok) return expected;
  if (normalizeDateTime(existing.updated_at) !== expected.value) return conflictResult('Customer update conflict');

  if (typeof payload?.isActive === 'boolean') {
    if (existing.is_active === payload.isActive) {
      const current = await customerRepo.getCustomerByIdForInstallation(client, { id: existing.id, installationId });
      return { ok: true, customer: current, beforeData: current, changed: false, action: payload.isActive ? 'activate' : 'deactivate' };
    }
    const customer = await customerRepo.updateCustomerActiveStatus(client, {
      id: existing.id,
      installationId,
      isActive: payload.isActive,
      updatedBy,
      expectedUpdatedAt: expected.value,
    });
    if (!customer) return conflictResult('Customer status update conflict');
    return { ok: true, customer, beforeData: existing, changed: true, action: payload.isActive ? 'activate' : 'deactivate' };
  }

  const validation = validateCustomerInput({
    code: existing.code,
    name: payload?.name ?? existing.name,
    groupId: Object.prototype.hasOwnProperty.call(payload ?? {}, 'groupId') ? payload.groupId : existing.group_id,
    responsibleEmployeeId: Object.prototype.hasOwnProperty.call(payload ?? {}, 'responsibleEmployeeId')
      ? payload.responsibleEmployeeId
      : existing.responsible_employee_id,
    phone: Object.prototype.hasOwnProperty.call(payload ?? {}, 'phone') ? payload.phone : existing.phone ?? '',
    email: Object.prototype.hasOwnProperty.call(payload ?? {}, 'email') ? payload.email : existing.email ?? '',
    taxCode: Object.prototype.hasOwnProperty.call(payload ?? {}, 'taxCode') ? payload.taxCode : existing.tax_code ?? '',
    paymentTermsDays: Object.prototype.hasOwnProperty.call(payload ?? {}, 'paymentTermsDays')
      ? payload.paymentTermsDays
      : existing.payment_terms_days,
    creditLimit: Object.prototype.hasOwnProperty.call(payload ?? {}, 'creditLimit') ? payload.creditLimit : existing.credit_limit,
    notes: Object.prototype.hasOwnProperty.call(payload ?? {}, 'notes') ? payload.notes : existing.notes ?? '',
  });
  if (!validation.ok) return validation;

  const groupResult = await resolveGroup(client, {
    installationId,
    groupId: validation.normalized.groupId,
    requireActive: validation.normalized.groupId !== existing.group_id,
  });
  if (!groupResult.ok) return groupResult;

  const employeeResult = await resolveEmployee(client, {
    installationId,
    employeeId: validation.normalized.responsibleEmployeeId,
    requireActive: validation.normalized.responsibleEmployeeId !== existing.responsible_employee_id,
  });
  if (!employeeResult.ok) return employeeResult;

  const customer = await customerRepo.updateCustomer(client, {
    id: existing.id,
    installationId,
    ...validation.normalized,
    updatedBy,
    expectedUpdatedAt: expected.value,
  });
  if (!customer) return conflictResult('Customer update conflict');
  return { ok: true, customer, beforeData: existing, changed: true, action: 'update' };
}

export function validateCustomerAddressInput(payload) {
  if (!payload || typeof payload !== 'object') {
    return { ok: false, code: 'INVALID_INPUT', message: 'Customer address data is required' };
  }

  const label = normalizeText(payload.label);
  if (!label || label.length > 128) return { ok: false, code: 'INVALID_LABEL', message: 'Address label is required and must not exceed 128 characters' };

  const recipientName = normalizeText(payload.recipientName);
  if (recipientName.length > 256) return { ok: false, code: 'INVALID_RECIPIENT_NAME', message: 'Recipient name must not exceed 256 characters' };

  const phone = normalizeText(payload.phone);
  if (!validatePhone(phone)) return { ok: false, code: 'INVALID_PHONE', message: 'Phone number format is invalid' };

  const addressLine1 = normalizeText(payload.addressLine1);
  if (!addressLine1 || addressLine1.length > 512) return { ok: false, code: 'INVALID_ADDRESS', message: 'Address line 1 is required and must not exceed 512 characters' };

  const optionalFields = {
    addressLine2: [payload.addressLine2, 512],
    ward: [payload.ward, 128],
    district: [payload.district, 128],
    province: [payload.province, 128],
    postalCode: [payload.postalCode, 32],
  };
  const normalizedOptional = {};
  for (const [key, [value, maxLength]] of Object.entries(optionalFields)) {
    const normalized = normalizeText(value);
    if (normalized.length > maxLength) return { ok: false, code: 'INVALID_ADDRESS', message: `${key} must not exceed ${maxLength} characters` };
    normalizedOptional[key] = normalized || null;
  }

  const countryCode = (normalizeText(payload.countryCode) || 'VN').toUpperCase();
  if (!/^[A-Z]{2}$/.test(countryCode)) return { ok: false, code: 'INVALID_COUNTRY_CODE', message: 'Country code must contain two uppercase letters' };

  const isDefault = payload.isDefault === true;
  const isActive = payload.isActive === undefined ? true : payload.isActive;
  if (typeof isActive !== 'boolean') return { ok: false, code: 'INVALID_ACTIVE_STATUS', message: 'isActive must be a boolean' };

  return {
    ok: true,
    normalized: {
      label,
      recipientName: recipientName || null,
      phone: phone || null,
      addressLine1,
      ...normalizedOptional,
      countryCode,
      isDefault: isActive ? isDefault : false,
      isActive,
    },
  };
}

export async function listCustomerAddresses(client, { installationId, customerId }) {
  if (!isValidUuid(customerId)) return { ok: false, code: 'NOT_FOUND', message: 'Customer not found' };
  const customer = await customerRepo.getCustomerByIdForInstallation(client, { id: customerId.trim(), installationId });
  if (!customer) return { ok: false, code: 'NOT_FOUND', message: 'Customer not found' };
  const addresses = await customerRepo.listCustomerAddresses(client, { installationId, customerId: customer.id });
  return { ok: true, addresses };
}

export async function createCustomerAddress(client, { installationId, customerId, payload, createdBy }) {
  if (!isValidUuid(customerId)) return { ok: false, code: 'NOT_FOUND', message: 'Customer not found' };
  const customer = await customerRepo.getCustomerByIdForInstallationForUpdate(client, { id: customerId.trim(), installationId });
  if (!customer) return { ok: false, code: 'NOT_FOUND', message: 'Customer not found' };
  if (!customer.is_active) return { ok: false, code: 'CUSTOMER_INACTIVE', message: 'Cannot add an address to an inactive customer' };

  const validation = validateCustomerAddressInput(payload);
  if (!validation.ok) return validation;
  if (validation.normalized.isDefault) {
    await customerRepo.clearDefaultCustomerAddresses(client, {
      installationId,
      customerId: customer.id,
      updatedBy: createdBy,
    });
  }
  const address = await customerRepo.insertCustomerAddress(client, {
    installationId,
    customerId: customer.id,
    ...validation.normalized,
    createdBy,
  });
  return { ok: true, address };
}

export async function updateCustomerAddress(client, {
  installationId,
  customerId,
  addressId,
  payload,
  updatedBy,
}) {
  if (!isValidUuid(customerId) || !isValidUuid(addressId)) {
    return { ok: false, code: 'NOT_FOUND', message: 'Customer address not found' };
  }

  const existing = await customerRepo.getCustomerAddressForUpdate(client, {
    id: addressId.trim(),
    customerId: customerId.trim(),
    installationId,
  });
  if (!existing) return { ok: false, code: 'NOT_FOUND', message: 'Customer address not found' };

  const expected = validateExpectedUpdatedAt(payload?.expectedUpdatedAt);
  if (!expected.ok) return expected;
  if (normalizeDateTime(existing.updated_at) !== expected.value) return conflictResult('Customer address update conflict');

  const validation = validateCustomerAddressInput({
    label: payload?.label ?? existing.label,
    recipientName: Object.prototype.hasOwnProperty.call(payload ?? {}, 'recipientName') ? payload.recipientName : existing.recipient_name ?? '',
    phone: Object.prototype.hasOwnProperty.call(payload ?? {}, 'phone') ? payload.phone : existing.phone ?? '',
    addressLine1: payload?.addressLine1 ?? existing.address_line1,
    addressLine2: Object.prototype.hasOwnProperty.call(payload ?? {}, 'addressLine2') ? payload.addressLine2 : existing.address_line2 ?? '',
    ward: Object.prototype.hasOwnProperty.call(payload ?? {}, 'ward') ? payload.ward : existing.ward ?? '',
    district: Object.prototype.hasOwnProperty.call(payload ?? {}, 'district') ? payload.district : existing.district ?? '',
    province: Object.prototype.hasOwnProperty.call(payload ?? {}, 'province') ? payload.province : existing.province ?? '',
    postalCode: Object.prototype.hasOwnProperty.call(payload ?? {}, 'postalCode') ? payload.postalCode : existing.postal_code ?? '',
    countryCode: payload?.countryCode ?? existing.country_code,
    isDefault: Object.prototype.hasOwnProperty.call(payload ?? {}, 'isDefault') ? payload.isDefault : existing.is_default,
    isActive: Object.prototype.hasOwnProperty.call(payload ?? {}, 'isActive') ? payload.isActive : existing.is_active,
  });
  if (!validation.ok) return validation;

  if (validation.normalized.isDefault) {
    await customerRepo.clearDefaultCustomerAddresses(client, {
      installationId,
      customerId: existing.customer_id,
      exceptId: existing.id,
      updatedBy,
    });
  }

  const address = await customerRepo.updateCustomerAddress(client, {
    id: existing.id,
    customerId: existing.customer_id,
    installationId,
    ...validation.normalized,
    updatedBy,
    expectedUpdatedAt: expected.value,
  });
  if (!address) return conflictResult('Customer address update conflict');
  return { ok: true, address, beforeData: existing, changed: true };
}
