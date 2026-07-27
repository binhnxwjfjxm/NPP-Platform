import * as supplierRepo from '../db/repositories/supplier.js';
import * as employeeRepo from '../db/repositories/employee.js';

const CODE_PATTERN = /^[A-Z0-9_-]{1,64}$/;
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

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

function validatePhone(value) {
  return !value || /^[0-9\s\-+()]{5,20}$/.test(value);
}

function validateEmail(value) {
  return !value || (/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value) && value.length <= 256);
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

function normalizeActiveAndPrimary(payload, defaults = {}) {
  const isActive = payload.isActive === undefined ? (defaults.isActive ?? true) : payload.isActive;
  if (typeof isActive !== 'boolean') return { ok: false, code: 'INVALID_ACTIVE_STATUS', message: 'isActive must be a boolean' };
  const requestedPrimary = payload.isPrimary === undefined ? (defaults.isPrimary ?? false) : payload.isPrimary;
  if (typeof requestedPrimary !== 'boolean') return { ok: false, code: 'INVALID_PRIMARY_STATUS', message: 'isPrimary must be a boolean' };
  return { ok: true, isActive, isPrimary: isActive ? requestedPrimary : false };
}

async function resolveEmployee(client, { installationId, employeeId, requireActive }) {
  if (!employeeId) return { ok: true, employee: null };
  const employee = await employeeRepo.getEmployeeByIdForInstallationForShare(client, { id: employeeId, installationId });
  if (!employee) return { ok: false, code: 'EMPLOYEE_NOT_FOUND', message: 'Purchase owner employee was not found' };
  if (requireActive && !employee.is_active) return { ok: false, code: 'EMPLOYEE_INACTIVE', message: 'Purchase owner employee is not active' };
  return { ok: true, employee };
}

export function validateSupplierInput(payload, { codeRequired = true } = {}) {
  if (!payload || typeof payload !== 'object') {
    return { ok: false, code: 'INVALID_INPUT', message: 'Supplier data is required' };
  }

  const code = normalizeCode(payload.code);
  if (codeRequired && !CODE_PATTERN.test(code)) {
    return { ok: false, code: 'INVALID_CODE', message: 'Code must contain only uppercase letters, digits, hyphens, or underscores' };
  }

  const name = normalizeText(payload.name);
  if (!name || name.length > 256) {
    return { ok: false, code: 'INVALID_NAME', message: 'Name is required and must not exceed 256 characters' };
  }

  const taxId = normalizeText(payload.taxId);
  if (taxId.length > 64) return { ok: false, code: 'INVALID_TAX_ID', message: 'Tax ID must not exceed 64 characters' };

  const bankAccount = normalizeText(payload.bankAccount);
  if (bankAccount.length > 64) return { ok: false, code: 'INVALID_BANK_ACCOUNT', message: 'Bank account must not exceed 64 characters' };

  const bankName = normalizeText(payload.bankName);
  if (bankName.length > 256) return { ok: false, code: 'INVALID_BANK_NAME', message: 'Bank name must not exceed 256 characters' };

  const avgDeliveryDays = payload.avgDeliveryDays === undefined || payload.avgDeliveryDays === null || payload.avgDeliveryDays === ''
    ? null
    : Number(payload.avgDeliveryDays);
  if (avgDeliveryDays !== null && (!Number.isInteger(avgDeliveryDays) || avgDeliveryDays < 0 || avgDeliveryDays > 3650)) {
    return { ok: false, code: 'INVALID_AVG_DELIVERY_DAYS', message: 'Average delivery days must be an integer from 0 through 3650 days' };
  }

  const purchaseOwnerEmployeeId = normalizeOptionalUuid(payload.purchaseOwnerEmployeeId);
  if (purchaseOwnerEmployeeId && !isValidUuid(purchaseOwnerEmployeeId)) {
    return { ok: false, code: 'INVALID_EMPLOYEE_ID', message: 'Purchase owner employee ID must be a valid UUID' };
  }

  return {
    ok: true,
    normalized: {
      code,
      name,
      taxId: taxId || null,
      bankAccount: bankAccount || null,
      bankName: bankName || null,
      avgDeliveryDays,
      purchaseOwnerEmployeeId,
    },
  };
}

export async function createSupplier(client, { installationId, payload, createdBy }) {
  const validation = validateSupplierInput(payload);
  if (!validation.ok) return validation;

  const existing = await supplierRepo.getSupplierByCode(client, {
    installationId,
    code: validation.normalized.code,
  });
  if (existing) return { ok: false, code: 'DUPLICATE_CODE', message: 'A supplier with this code already exists' };

  const employeeResult = await resolveEmployee(client, {
    installationId,
    employeeId: validation.normalized.purchaseOwnerEmployeeId,
    requireActive: true,
  });
  if (!employeeResult.ok) return employeeResult;

  const supplier = await supplierRepo.insertSupplier(client, {
    installationId,
    ...validation.normalized,
    createdBy,
  });
  if (!supplier) return { ok: false, code: 'DUPLICATE_CODE', message: 'A supplier with this code already exists' };
  return { ok: true, supplier };
}

export async function getSupplier(client, { installationId, id }) {
  if (!isValidUuid(id)) return { ok: false, code: 'NOT_FOUND', message: 'Supplier not found' };
  const supplier = await supplierRepo.getSupplierByIdForInstallation(client, { id: id.trim(), installationId });
  return supplier ? { ok: true, supplier } : { ok: false, code: 'NOT_FOUND', message: 'Supplier not found' };
}

export async function listSuppliers(client, { installationId, search, active, limit, offset }) {
  const searchValidation = validateSearch(search);
  if (!searchValidation.ok) return searchValidation;
  const suppliers = await supplierRepo.listSuppliersForInstallation(client, {
    installationId,
    search: searchValidation.value,
    active,
    limit,
    offset,
  });
  return { ok: true, suppliers };
}

export async function updateSupplier(client, { id, installationId, payload, updatedBy }) {
  if (!isValidUuid(id)) return { ok: false, code: 'INVALID_ID', message: 'Supplier ID must be a valid UUID' };
  const existing = await supplierRepo.getSupplierByIdForInstallationForUpdate(client, { id: id.trim(), installationId });
  if (!existing) return { ok: false, code: 'NOT_FOUND', message: 'Supplier not found' };

  const expected = validateExpectedUpdatedAt(payload?.expectedUpdatedAt);
  if (!expected.ok) return expected;
  if (normalizeDateTime(existing.updated_at) !== expected.value) return conflictResult('Supplier update conflict');

  if (typeof payload?.isActive === 'boolean') {
    if (existing.is_active === payload.isActive) {
      const current = await supplierRepo.getSupplierByIdForInstallation(client, { id: existing.id, installationId });
      return { ok: true, supplier: current, beforeData: current, changed: false, action: payload.isActive ? 'activate' : 'deactivate' };
    }
    const supplier = await supplierRepo.updateSupplierActiveStatus(client, {
      id: existing.id,
      installationId,
      isActive: payload.isActive,
      updatedBy,
      expectedUpdatedAt: expected.value,
    });
    if (!supplier) return conflictResult('Supplier status update conflict');
    return { ok: true, supplier, beforeData: existing, changed: true, action: payload.isActive ? 'activate' : 'deactivate' };
  }

  const validation = validateSupplierInput({
    code: existing.code,
    name: payload?.name ?? existing.name,
    taxId: Object.prototype.hasOwnProperty.call(payload ?? {}, 'taxId') ? payload.taxId : existing.tax_id ?? '',
    bankAccount: Object.prototype.hasOwnProperty.call(payload ?? {}, 'bankAccount') ? payload.bankAccount : existing.bank_account ?? '',
    bankName: Object.prototype.hasOwnProperty.call(payload ?? {}, 'bankName') ? payload.bankName : existing.bank_name ?? '',
    avgDeliveryDays: Object.prototype.hasOwnProperty.call(payload ?? {}, 'avgDeliveryDays') ? payload.avgDeliveryDays : existing.avg_delivery_days,
    purchaseOwnerEmployeeId: Object.prototype.hasOwnProperty.call(payload ?? {}, 'purchaseOwnerEmployeeId') ? payload.purchaseOwnerEmployeeId : existing.purchase_owner_employee_id,
  });
  if (!validation.ok) return validation;

  const employeeResult = await resolveEmployee(client, {
    installationId,
    employeeId: validation.normalized.purchaseOwnerEmployeeId,
    requireActive: validation.normalized.purchaseOwnerEmployeeId !== existing.purchase_owner_employee_id,
  });
  if (!employeeResult.ok) return employeeResult;

  const supplier = await supplierRepo.updateSupplier(client, {
    id: existing.id,
    installationId,
    ...validation.normalized,
    updatedBy,
    expectedUpdatedAt: expected.value,
  });
  if (!supplier) return conflictResult('Supplier update conflict');
  return { ok: true, supplier, beforeData: existing, changed: true, action: 'update' };
}

export function validateSupplierContactInput(payload, defaults = {}) {
  if (!payload || typeof payload !== 'object') return { ok: false, code: 'INVALID_INPUT', message: 'Supplier contact data is required' };
  const contactName = normalizeText(payload.contactName ?? defaults.contactName);
  if (!contactName || contactName.length > 256) return { ok: false, code: 'INVALID_CONTACT_NAME', message: 'Contact name is required and must not exceed 256 characters' };
  const contactTitle = normalizeText(Object.prototype.hasOwnProperty.call(payload, 'contactTitle') ? payload.contactTitle : defaults.contactTitle);
  if (contactTitle.length > 128) return { ok: false, code: 'INVALID_CONTACT_TITLE', message: 'Contact title must not exceed 128 characters' };
  const phone = normalizeText(Object.prototype.hasOwnProperty.call(payload, 'phone') ? payload.phone : defaults.phone);
  if (!validatePhone(phone)) return { ok: false, code: 'INVALID_PHONE', message: 'Phone number format is invalid' };
  const email = normalizeText(Object.prototype.hasOwnProperty.call(payload, 'email') ? payload.email : defaults.email);
  if (!validateEmail(email)) return { ok: false, code: 'INVALID_EMAIL', message: 'Email format is invalid' };
  const flags = normalizeActiveAndPrimary(payload, defaults);
  if (!flags.ok) return flags;
  return { ok: true, normalized: { contactName, contactTitle: contactTitle || null, phone: phone || null, email: email || null, isPrimary: flags.isPrimary, isActive: flags.isActive } };
}

export function validateSupplierAddressInput(payload, defaults = {}) {
  if (!payload || typeof payload !== 'object') return { ok: false, code: 'INVALID_INPUT', message: 'Supplier address data is required' };
  const addressType = normalizeText(payload.addressType ?? defaults.addressType) || 'business';
  if (addressType.length > 50) return { ok: false, code: 'INVALID_ADDRESS_TYPE', message: 'Address type must not exceed 50 characters' };
  const street = normalizeText(payload.street ?? defaults.street);
  if (!street || street.length > 512) return { ok: false, code: 'INVALID_ADDRESS', message: 'Street is required and must not exceed 512 characters' };
  const optional = { city: 128, province: 128, postalCode: 32, country: 128 };
  const normalized = {};
  for (const [key, maxLength] of Object.entries(optional)) {
    const value = normalizeText(Object.prototype.hasOwnProperty.call(payload, key) ? payload[key] : defaults[key]);
    if (value.length > maxLength) return { ok: false, code: 'INVALID_ADDRESS', message: `${key} must not exceed ${maxLength} characters` };
    normalized[key] = value || null;
  }
  normalized.country = normalized.country || 'Việt Nam';
  const flags = normalizeActiveAndPrimary(payload, defaults);
  if (!flags.ok) return flags;
  return { ok: true, normalized: { addressType, street, ...normalized, isPrimary: flags.isPrimary, isActive: flags.isActive } };
}

export function validateSupplierPaymentTermInput(payload, defaults = {}) {
  if (!payload || typeof payload !== 'object') return { ok: false, code: 'INVALID_INPUT', message: 'Supplier payment term data is required' };
  const paymentMethod = normalizeText(payload.paymentMethod ?? defaults.paymentMethod);
  if (!paymentMethod || paymentMethod.length > 64) return { ok: false, code: 'INVALID_PAYMENT_METHOD', message: 'Payment method is required and must not exceed 64 characters' };
  const rawTermDays = Object.prototype.hasOwnProperty.call(payload, 'termDays') ? payload.termDays : defaults.termDays;
  const termDays = rawTermDays === undefined || rawTermDays === null || rawTermDays === '' ? null : Number(rawTermDays);
  if (termDays !== null && (!Number.isInteger(termDays) || termDays < 0 || termDays > 3650)) return { ok: false, code: 'INVALID_TERM_DAYS', message: 'Term days must be an integer from 0 through 3650' };
  const description = normalizeText(Object.prototype.hasOwnProperty.call(payload, 'description') ? payload.description : defaults.description);
  if (description.length > 1000) return { ok: false, code: 'INVALID_DESCRIPTION', message: 'Description must not exceed 1000 characters' };
  const flags = normalizeActiveAndPrimary(payload, defaults);
  if (!flags.ok) return flags;
  return { ok: true, normalized: { paymentMethod, termDays, description: description || null, isPrimary: flags.isPrimary, isActive: flags.isActive } };
}

async function resolveSupplierForChildren(client, { installationId, supplierId, requireActive, forUpdate = false }) {
  if (!isValidUuid(supplierId)) return { ok: false, code: 'NOT_FOUND', message: 'Supplier not found' };
  const supplier = forUpdate
    ? await supplierRepo.getSupplierByIdForInstallationForUpdate(client, { id: supplierId.trim(), installationId })
    : await supplierRepo.getSupplierByIdForInstallation(client, { id: supplierId.trim(), installationId });
  if (!supplier) return { ok: false, code: 'NOT_FOUND', message: 'Supplier not found' };
  if (requireActive && !supplier.is_active) return { ok: false, code: 'SUPPLIER_INACTIVE', message: 'Cannot add data to an inactive supplier' };
  return { ok: true, supplier };
}

export async function listSupplierContacts(client, { installationId, supplierId }) {
  const parent = await resolveSupplierForChildren(client, { installationId, supplierId, requireActive: false });
  if (!parent.ok) return parent;
  return { ok: true, contacts: await supplierRepo.listSupplierContacts(client, { installationId, supplierId: parent.supplier.id }) };
}

export async function createSupplierContact(client, { installationId, supplierId, payload, createdBy }) {
  const parent = await resolveSupplierForChildren(client, { installationId, supplierId, requireActive: true, forUpdate: true });
  if (!parent.ok) return parent;
  const validation = validateSupplierContactInput(payload);
  if (!validation.ok) return validation;
  if (validation.normalized.isPrimary) await supplierRepo.clearPrimarySupplierContacts(client, { installationId, supplierId: parent.supplier.id, updatedBy: createdBy });
  const contact = await supplierRepo.insertSupplierContact(client, { installationId, supplierId: parent.supplier.id, ...validation.normalized, createdBy });
  return { ok: true, contact };
}

export async function updateSupplierContact(client, { installationId, supplierId, contactId, payload, updatedBy }) {
  if (!isValidUuid(supplierId) || !isValidUuid(contactId)) return { ok: false, code: 'NOT_FOUND', message: 'Supplier contact not found' };
  const existing = await supplierRepo.getSupplierContactForUpdate(client, { id: contactId.trim(), supplierId: supplierId.trim(), installationId });
  if (!existing) return { ok: false, code: 'NOT_FOUND', message: 'Supplier contact not found' };
  const expected = validateExpectedUpdatedAt(payload?.expectedUpdatedAt);
  if (!expected.ok) return expected;
  if (normalizeDateTime(existing.updated_at) !== expected.value) return conflictResult('Supplier contact update conflict');
  const validation = validateSupplierContactInput(payload, {
    contactName: existing.contact_name,
    contactTitle: existing.contact_title,
    phone: existing.phone,
    email: existing.email,
    isPrimary: existing.is_primary,
    isActive: existing.is_active,
  });
  if (!validation.ok) return validation;
  if (validation.normalized.isPrimary) await supplierRepo.clearPrimarySupplierContacts(client, { installationId, supplierId: existing.supplier_id, exceptId: existing.id, updatedBy });
  const contact = await supplierRepo.updateSupplierContact(client, { id: existing.id, supplierId: existing.supplier_id, installationId, ...validation.normalized, updatedBy, expectedUpdatedAt: expected.value });
  if (!contact) return conflictResult('Supplier contact update conflict');
  return { ok: true, contact, beforeData: existing, changed: true };
}

export async function listSupplierAddresses(client, { installationId, supplierId }) {
  const parent = await resolveSupplierForChildren(client, { installationId, supplierId, requireActive: false });
  if (!parent.ok) return parent;
  return { ok: true, addresses: await supplierRepo.listSupplierAddresses(client, { installationId, supplierId: parent.supplier.id }) };
}

export async function createSupplierAddress(client, { installationId, supplierId, payload, createdBy }) {
  const parent = await resolveSupplierForChildren(client, { installationId, supplierId, requireActive: true, forUpdate: true });
  if (!parent.ok) return parent;
  const validation = validateSupplierAddressInput(payload);
  if (!validation.ok) return validation;
  if (validation.normalized.isPrimary) await supplierRepo.clearPrimarySupplierAddresses(client, { installationId, supplierId: parent.supplier.id, updatedBy: createdBy });
  const address = await supplierRepo.insertSupplierAddress(client, { installationId, supplierId: parent.supplier.id, ...validation.normalized, createdBy });
  return { ok: true, address };
}

export async function updateSupplierAddress(client, { installationId, supplierId, addressId, payload, updatedBy }) {
  if (!isValidUuid(supplierId) || !isValidUuid(addressId)) return { ok: false, code: 'NOT_FOUND', message: 'Supplier address not found' };
  const existing = await supplierRepo.getSupplierAddressForUpdate(client, { id: addressId.trim(), supplierId: supplierId.trim(), installationId });
  if (!existing) return { ok: false, code: 'NOT_FOUND', message: 'Supplier address not found' };
  const expected = validateExpectedUpdatedAt(payload?.expectedUpdatedAt);
  if (!expected.ok) return expected;
  if (normalizeDateTime(existing.updated_at) !== expected.value) return conflictResult('Supplier address update conflict');
  const validation = validateSupplierAddressInput(payload, {
    addressType: existing.address_type,
    street: existing.street,
    city: existing.city,
    province: existing.province,
    postalCode: existing.postal_code,
    country: existing.country,
    isPrimary: existing.is_primary,
    isActive: existing.is_active,
  });
  if (!validation.ok) return validation;
  if (validation.normalized.isPrimary) await supplierRepo.clearPrimarySupplierAddresses(client, { installationId, supplierId: existing.supplier_id, exceptId: existing.id, updatedBy });
  const address = await supplierRepo.updateSupplierAddress(client, { id: existing.id, supplierId: existing.supplier_id, installationId, ...validation.normalized, updatedBy, expectedUpdatedAt: expected.value });
  if (!address) return conflictResult('Supplier address update conflict');
  return { ok: true, address, beforeData: existing, changed: true };
}

export async function listSupplierPaymentTerms(client, { installationId, supplierId }) {
  const parent = await resolveSupplierForChildren(client, { installationId, supplierId, requireActive: false });
  if (!parent.ok) return parent;
  return { ok: true, paymentTerms: await supplierRepo.listSupplierPaymentTerms(client, { installationId, supplierId: parent.supplier.id }) };
}

export async function createSupplierPaymentTerm(client, { installationId, supplierId, payload, createdBy }) {
  const parent = await resolveSupplierForChildren(client, { installationId, supplierId, requireActive: true, forUpdate: true });
  if (!parent.ok) return parent;
  const validation = validateSupplierPaymentTermInput(payload);
  if (!validation.ok) return validation;
  if (validation.normalized.isPrimary) await supplierRepo.clearPrimarySupplierPaymentTerms(client, { installationId, supplierId: parent.supplier.id, updatedBy: createdBy });
  const paymentTerm = await supplierRepo.insertSupplierPaymentTerm(client, { installationId, supplierId: parent.supplier.id, ...validation.normalized, createdBy });
  return { ok: true, paymentTerm };
}

export async function updateSupplierPaymentTerm(client, { installationId, supplierId, paymentTermId, payload, updatedBy }) {
  if (!isValidUuid(supplierId) || !isValidUuid(paymentTermId)) return { ok: false, code: 'NOT_FOUND', message: 'Supplier payment term not found' };
  const existing = await supplierRepo.getSupplierPaymentTermForUpdate(client, { id: paymentTermId.trim(), supplierId: supplierId.trim(), installationId });
  if (!existing) return { ok: false, code: 'NOT_FOUND', message: 'Supplier payment term not found' };
  const expected = validateExpectedUpdatedAt(payload?.expectedUpdatedAt);
  if (!expected.ok) return expected;
  if (normalizeDateTime(existing.updated_at) !== expected.value) return conflictResult('Supplier payment term update conflict');
  const validation = validateSupplierPaymentTermInput(payload, {
    paymentMethod: existing.payment_method,
    termDays: existing.term_days,
    description: existing.description,
    isPrimary: existing.is_primary,
    isActive: existing.is_active,
  });
  if (!validation.ok) return validation;
  if (validation.normalized.isPrimary) await supplierRepo.clearPrimarySupplierPaymentTerms(client, { installationId, supplierId: existing.supplier_id, exceptId: existing.id, updatedBy });
  const paymentTerm = await supplierRepo.updateSupplierPaymentTerm(client, { id: existing.id, supplierId: existing.supplier_id, installationId, ...validation.normalized, updatedBy, expectedUpdatedAt: expected.value });
  if (!paymentTerm) return conflictResult('Supplier payment term update conflict');
  return { ok: true, paymentTerm, beforeData: existing, changed: true };
}
