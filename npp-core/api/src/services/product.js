import * as categoryRepo from '../db/repositories/product-categories.js';
import * as brandRepo from '../db/repositories/product-brands.js';
import * as productRepo from '../db/repositories/products.js';
import * as variantRepo from '../db/repositories/product-variants.js';

const CODE_PATTERN = /^[A-Z0-9_-]{1,64}$/;
const SKU_PATTERN = /^[A-Z0-9._/-]{1,96}$/;
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const VARIANT_KINDS = new Set(['BASE', 'CARTON', 'OTHER']);
const MAX_IMPORT_PRODUCTS = 500;

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

function invalidResult(code, message) {
  return { ok: false, code, message, retryable: false };
}

function validateSearch(value) {
  if (value === undefined || value === null || value === '') return { ok: true, value: null };
  const normalized = normalizeText(value);
  if (normalized.length > 256) {
    return { ok: false, code: 'INVALID_SEARCH', message: 'Search must not exceed 256 characters' };
  }
  return { ok: true, value: normalized || null };
}

function normalizeBoolean(value, fallback = false) {
  if (value === undefined || value === null) return fallback;
  return Boolean(value);
}

export function validateProductCategoryInput(payload, { codeRequired = true } = {}) {
  if (!payload || typeof payload !== 'object') {
    return invalidResult('INVALID_INPUT', 'Product category data is required');
  }

  const code = normalizeCode(payload.code);
  if (codeRequired && !CODE_PATTERN.test(code)) {
    return invalidResult('INVALID_CODE', 'Code must contain only uppercase letters, digits, hyphens, or underscores');
  }

  const name = normalizeText(payload.name);
  if (!name || name.length > 256) {
    return invalidResult('INVALID_NAME', 'Name is required and must not exceed 256 characters');
  }

  const parentCategoryId = normalizeOptionalUuid(payload.parentCategoryId);
  if (parentCategoryId && !isValidUuid(parentCategoryId)) {
    return invalidResult('INVALID_PARENT_CATEGORY_ID', 'Parent category ID must be a valid UUID');
  }

  const description = normalizeText(payload.description);
  if (description.length > 2000) {
    return invalidResult('INVALID_DESCRIPTION', 'Description must not exceed 2000 characters');
  }

  const sortOrder = payload.sortOrder === undefined || payload.sortOrder === null || payload.sortOrder === '' ? 0 : Number(payload.sortOrder);
  if (!Number.isInteger(sortOrder) || sortOrder < 0 || sortOrder > 1000000) {
    return invalidResult('INVALID_SORT_ORDER', 'Sort order must be an integer between 0 and 1000000');
  }

  const isCatalogVisible = normalizeBoolean(payload.isCatalogVisible, true);
  const isActive = normalizeBoolean(payload.isActive, true);

  return {
    ok: true,
    normalized: {
      code,
      name,
      parentCategoryId,
      description: description || null,
      sortOrder,
      isCatalogVisible,
      isActive,
    },
  };
}

export function validateProductBrandInput(payload, { codeRequired = true } = {}) {
  if (!payload || typeof payload !== 'object') {
    return invalidResult('INVALID_INPUT', 'Product brand data is required');
  }

  const code = normalizeCode(payload.code);
  if (codeRequired && !CODE_PATTERN.test(code)) {
    return invalidResult('INVALID_CODE', 'Code must contain only uppercase letters, digits, hyphens, or underscores');
  }

  const name = normalizeText(payload.name);
  if (!name || name.length > 256) {
    return invalidResult('INVALID_NAME', 'Name is required and must not exceed 256 characters');
  }

  const description = normalizeText(payload.description);
  if (description.length > 2000) {
    return invalidResult('INVALID_DESCRIPTION', 'Description must not exceed 2000 characters');
  }

  const isCatalogVisible = normalizeBoolean(payload.isCatalogVisible, true);
  const isActive = normalizeBoolean(payload.isActive, true);

  return {
    ok: true,
    normalized: {
      code,
      name,
      description: description || null,
      isCatalogVisible,
      isActive,
    },
  };
}

export function validateProductInput(payload, { codeRequired = true } = {}) {
  if (!payload || typeof payload !== 'object') {
    return invalidResult('INVALID_INPUT', 'Product data is required');
  }

  const code = normalizeCode(payload.code);
  if (codeRequired && !CODE_PATTERN.test(code)) {
    return invalidResult('INVALID_CODE', 'Code must contain only uppercase letters, digits, hyphens, or underscores');
  }

  const name = normalizeText(payload.name);
  if (!name || name.length > 256) {
    return invalidResult('INVALID_NAME', 'Name is required and must not exceed 256 characters');
  }

  const catalogName = normalizeText(payload.catalogName);
  if (catalogName.length > 256) {
    return invalidResult('INVALID_CATALOG_NAME', 'Catalog name must not exceed 256 characters');
  }

  const categoryId = normalizeOptionalUuid(payload.categoryId);
  if (categoryId && !isValidUuid(categoryId)) {
    return invalidResult('INVALID_CATEGORY_ID', 'Category ID must be a valid UUID');
  }

  const brandId = normalizeOptionalUuid(payload.brandId);
  if (brandId && !isValidUuid(brandId)) {
    return invalidResult('INVALID_BRAND_ID', 'Brand ID must be a valid UUID');
  }

  const description = normalizeText(payload.description);
  if (description.length > 4000) {
    return invalidResult('INVALID_DESCRIPTION', 'Description must not exceed 4000 characters');
  }

  const notes = normalizeText(payload.notes);
  if (notes.length > 4000) {
    return invalidResult('INVALID_NOTES', 'Notes must not exceed 4000 characters');
  }

  const isCatalogVisible = normalizeBoolean(payload.isCatalogVisible, false);
  const isOrderable = normalizeBoolean(payload.isOrderable, false);
  const isActive = normalizeBoolean(payload.isActive, true);

  return {
    ok: true,
    normalized: {
      code,
      name,
      catalogName: catalogName || null,
      categoryId,
      brandId,
      description: description || null,
      notes: notes || null,
      isCatalogVisible,
      isOrderable,
      isActive,
    },
  };
}

export function validateProductVariantInput(payload, { skuRequired = true } = {}) {
  if (!payload || typeof payload !== 'object') {
    return invalidResult('INVALID_INPUT', 'Product variant data is required');
  }

  const sku = normalizeCode(payload.sku);
  if (skuRequired && !SKU_PATTERN.test(sku)) {
    return invalidResult('INVALID_SKU', 'SKU must contain only uppercase letters, digits, dots, underscores, hyphens or slashes');
  }

  const name = normalizeText(payload.name);
  if (!name || name.length > 256) {
    return invalidResult('INVALID_NAME', 'Variant name is required and must not exceed 256 characters');
  }

  const variantKind = normalizeText(payload.variantKind).toUpperCase() || 'BASE';
  if (!VARIANT_KINDS.has(variantKind)) {
    return invalidResult('INVALID_VARIANT_KIND', 'Variant kind must be BASE, CARTON or OTHER');
  }

  const isInventoryBase = normalizeBoolean(payload.isInventoryBase, false);
  if (isInventoryBase && variantKind !== 'BASE') {
    return invalidResult('INVALID_INVENTORY_BASE', 'Inventory-base variants must use variant_kind BASE');
  }

  const isSellable = normalizeBoolean(payload.isSellable, true);
  const isCatalogVisible = normalizeBoolean(payload.isCatalogVisible, false);
  if (isCatalogVisible && !isSellable) {
    return invalidResult('INVALID_VARIANT_VISIBILITY', 'Catalog-visible variants must be sellable');
  }

  const isActive = normalizeBoolean(payload.isActive, true);

  return {
    ok: true,
    normalized: {
      sku,
      name,
      variantKind,
      isInventoryBase,
      isSellable,
      isCatalogVisible,
      isActive,
    },
  };
}

async function resolveCategory(client, { installationId, categoryId, requireActive }) {
  if (!categoryId) return { ok: true, category: null };
  const category = await categoryRepo.getProductCategoryByIdForInstallationForShare(client, { id: categoryId, installationId });
  if (!category) return invalidResult('CATEGORY_NOT_FOUND', 'Category not found');
  if (requireActive && !category.is_active) return invalidResult('CATEGORY_INACTIVE', 'Assigned category is not active');
  return { ok: true, category };
}

async function resolveBrand(client, { installationId, brandId, requireActive }) {
  if (!brandId) return { ok: true, brand: null };
  const brand = await brandRepo.getProductBrandByIdForInstallationForShare(client, { id: brandId, installationId });
  if (!brand) return invalidResult('BRAND_NOT_FOUND', 'Brand not found');
  if (requireActive && !brand.is_active) return invalidResult('BRAND_INACTIVE', 'Assigned brand is not active');
  return { ok: true, brand };
}

export async function createProductCategory(client, { installationId, payload, createdBy }) {
  const validation = validateProductCategoryInput(payload);
  if (!validation.ok) return validation;

  const { parentCategoryId } = validation.normalized;
  if (parentCategoryId) {
    const parent = await categoryRepo.getProductCategoryByIdForInstallationForShare(client, { id: parentCategoryId, installationId });
    if (!parent) return invalidResult('PARENT_CATEGORY_NOT_FOUND', 'Parent category not found');
  }

  const existing = await categoryRepo.getProductCategoryByCode(client, {
    installationId,
    code: validation.normalized.code,
  });
  if (existing) return invalidResult('DUPLICATE_CODE', 'A product category with this code already exists');

  const category = await categoryRepo.insertProductCategory(client, {
    installationId,
    ...validation.normalized,
    createdBy,
  });
  if (!category) return invalidResult('DUPLICATE_CODE', 'A product category with this code already exists');
  return { ok: true, category };
}

export async function getProductCategory(client, { installationId, id }) {
  if (!isValidUuid(id)) return invalidResult('NOT_FOUND', 'Product category not found');
  const category = await categoryRepo.getProductCategoryByIdForInstallation(client, { id: id.trim(), installationId });
  return category ? { ok: true, category } : invalidResult('NOT_FOUND', 'Product category not found');
}

export async function listProductCategories(client, { installationId, search, active, limit, offset }) {
  const searchValidation = validateSearch(search);
  if (!searchValidation.ok) return searchValidation;
  const categories = await categoryRepo.listProductCategoriesForInstallation(client, {
    installationId,
    search: searchValidation.value,
    active,
    limit,
    offset,
  });
  return { ok: true, categories };
}

export async function updateProductCategory(client, { id, installationId, payload, updatedBy }) {
  if (!isValidUuid(id)) return invalidResult('INVALID_ID', 'Product category ID must be a valid UUID');

  const existing = await categoryRepo.getProductCategoryByIdForInstallationForUpdate(client, { id: id.trim(), installationId });
  if (!existing) return invalidResult('NOT_FOUND', 'Product category not found');

  const expected = validateExpectedUpdatedAt(payload?.expectedUpdatedAt);
  if (!expected.ok) return expected;
  if (normalizeDateTime(existing.updated_at) !== expected.value) return conflictResult('Product category update conflict');

  if (typeof payload?.isActive === 'boolean' && existing.is_active === payload.isActive) {
    // continue validating other fields
  }

  const validation = validateProductCategoryInput({
    code: existing.code,
    name: payload?.name ?? existing.name,
    parentCategoryId: Object.prototype.hasOwnProperty.call(payload ?? {}, 'parentCategoryId') ? payload.parentCategoryId : existing.parent_category_id,
    description: Object.prototype.hasOwnProperty.call(payload ?? {}, 'description') ? payload.description : existing.description ?? '',
    sortOrder: Object.prototype.hasOwnProperty.call(payload ?? {}, 'sortOrder') ? payload.sortOrder : existing.sort_order,
    isCatalogVisible: Object.prototype.hasOwnProperty.call(payload ?? {}, 'isCatalogVisible') ? payload.isCatalogVisible : existing.is_catalog_visible,
    isActive: Object.prototype.hasOwnProperty.call(payload ?? {}, 'isActive') ? payload.isActive : existing.is_active,
  }, { codeRequired: false });
  if (!validation.ok) return validation;

  if (validation.normalized.parentCategoryId === existing.id) {
    return invalidResult('INVALID_PARENT_CATEGORY_ID', 'Category cannot be its own parent');
  }

  if (validation.normalized.parentCategoryId) {
    const parent = await categoryRepo.getProductCategoryByIdForInstallationForShare(client, { id: validation.normalized.parentCategoryId, installationId });
    if (!parent) return invalidResult('PARENT_CATEGORY_NOT_FOUND', 'Parent category not found');
    const createsCycle = await categoryRepo.isProductCategoryDescendantOf(client, {
      installationId,
      categoryId: validation.normalized.parentCategoryId,
      ancestorId: existing.id,
    });
    if (createsCycle) {
      return invalidResult('INVALID_CATEGORY_HIERARCHY', 'Category parent assignment would create a cycle');
    }
  }

  if (validation.normalized.isActive === false) {
    const activeProducts = await categoryRepo.hasActiveProductsForCategory(client, {
      categoryId: existing.id,
      installationId,
    });
    if (activeProducts) {
      return conflictResult('Cannot deactivate category while active products depend on it');
    }
  }

  const category = await categoryRepo.updateProductCategory(client, {
    id: existing.id,
    installationId,
    ...validation.normalized,
    updatedBy,
    expectedUpdatedAt: expected.value,
  });

  if (!category) return conflictResult('Product category update conflict');
  return { ok: true, category, beforeData: existing, changed: true, action: 'update' };
}

export async function createProductBrand(client, { installationId, payload, createdBy }) {
  const validation = validateProductBrandInput(payload);
  if (!validation.ok) return validation;

  const existing = await brandRepo.getProductBrandByCode(client, {
    installationId,
    code: validation.normalized.code,
  });
  if (existing) return invalidResult('DUPLICATE_CODE', 'A product brand with this code already exists');

  const brand = await brandRepo.insertProductBrand(client, {
    installationId,
    ...validation.normalized,
    createdBy,
  });
  if (!brand) return invalidResult('DUPLICATE_CODE', 'A product brand with this code already exists');
  return { ok: true, brand };
}

export async function getProductBrand(client, { installationId, id }) {
  if (!isValidUuid(id)) return invalidResult('NOT_FOUND', 'Product brand not found');
  const brand = await brandRepo.getProductBrandByIdForInstallation(client, { id: id.trim(), installationId });
  return brand ? { ok: true, brand } : invalidResult('NOT_FOUND', 'Product brand not found');
}

export async function listProductBrands(client, { installationId, search, active, limit, offset }) {
  const searchValidation = validateSearch(search);
  if (!searchValidation.ok) return searchValidation;
  const brands = await brandRepo.listProductBrandsForInstallation(client, {
    installationId,
    search: searchValidation.value,
    active,
    limit,
    offset,
  });
  return { ok: true, brands };
}

export async function updateProductBrand(client, { id, installationId, payload, updatedBy }) {
  if (!isValidUuid(id)) return invalidResult('INVALID_ID', 'Product brand ID must be a valid UUID');

  const existing = await brandRepo.getProductBrandByIdForInstallationForUpdate(client, { id: id.trim(), installationId });
  if (!existing) return invalidResult('NOT_FOUND', 'Product brand not found');

  const expected = validateExpectedUpdatedAt(payload?.expectedUpdatedAt);
  if (!expected.ok) return expected;
  if (normalizeDateTime(existing.updated_at) !== expected.value) return conflictResult('Product brand update conflict');

  if (validationIsNoop(existing, payload, ['name', 'description', 'isCatalogVisible', 'isActive'])) {
    return { ok: true, brand: existing, beforeData: existing, changed: false, action: 'update' };
  }

  const validation = validateProductBrandInput({
    code: existing.code,
    name: payload?.name ?? existing.name,
    description: Object.prototype.hasOwnProperty.call(payload ?? {}, 'description') ? payload.description : existing.description ?? '',
    isCatalogVisible: Object.prototype.hasOwnProperty.call(payload ?? {}, 'isCatalogVisible') ? payload.isCatalogVisible : existing.is_catalog_visible,
    isActive: Object.prototype.hasOwnProperty.call(payload ?? {}, 'isActive') ? payload.isActive : existing.is_active,
  }, { codeRequired: false });
  if (!validation.ok) return validation;

  if (validation.normalized.isActive === false) {
    const activeProducts = await brandRepo.hasActiveProductsForBrand(client, {
      brandId: existing.id,
      installationId,
    });
    if (activeProducts) {
      return conflictResult('Cannot deactivate brand while active products depend on it');
    }
  }

  const brand = await brandRepo.updateProductBrand(client, {
    id: existing.id,
    installationId,
    ...validation.normalized,
    updatedBy,
    expectedUpdatedAt: expected.value,
  });

  if (!brand) return conflictResult('Product brand update conflict');
  return { ok: true, brand, beforeData: existing, changed: true, action: 'update' };
}

function validationIsNoop(existing, payload, keys) {
  return keys.every((key) => {
    if (!Object.prototype.hasOwnProperty.call(payload ?? {}, key)) return true;
    const requested = payload[key];
    if (typeof requested === 'boolean') return requested === existing[key];
    return normalizeText(requested) === normalizeText(existing[key] || '');
  });
}

export async function createProduct(client, { installationId, payload, createdBy }) {
  const validation = validateProductInput(payload);
  if (!validation.ok) return validation;

  const existing = await productRepo.getProductByCode(client, {
    installationId,
    code: validation.normalized.code,
  });
  if (existing) return invalidResult('DUPLICATE_CODE', 'A product with this code already exists');

  if (validation.normalized.categoryId) {
    const category = await resolveCategory(client, {
      installationId,
      categoryId: validation.normalized.categoryId,
      requireActive: true,
    });
    if (!category.ok) return category;
  }

  if (validation.normalized.brandId) {
    const brand = await resolveBrand(client, {
      installationId,
      brandId: validation.normalized.brandId,
      requireActive: true,
    });
    if (!brand.ok) return brand;
  }

  if (validation.normalized.isOrderable && !validation.normalized.isActive) {
    return invalidResult('INVALID_ORDERABLE_STATUS', 'A disabled product cannot be orderable');
  }

  const product = await productRepo.insertProduct(client, {
    installationId,
    ...validation.normalized,
    createdBy,
  });
  if (!product) return invalidResult('DUPLICATE_CODE', 'A product with this code already exists');
  return { ok: true, product };
}

export async function getProduct(client, { installationId, id }) {
  if (!isValidUuid(id)) return invalidResult('NOT_FOUND', 'Product not found');
  const product = await productRepo.getProductByIdForInstallation(client, { id: id.trim(), installationId });
  return product ? { ok: true, product } : invalidResult('NOT_FOUND', 'Product not found');
}

export async function listProducts(client, { installationId, search, active, catalogVisible, orderable, categoryId, brandId, limit, offset }) {
  const searchValidation = validateSearch(search);
  if (!searchValidation.ok) return searchValidation;
  const products = await productRepo.listProductsForInstallation(client, {
    installationId,
    search: searchValidation.value,
    active,
    catalogVisible,
    orderable,
    categoryId,
    brandId,
    limit,
    offset,
  });
  return { ok: true, products };
}

export async function updateProduct(client, { id, installationId, payload, updatedBy }) {
  if (!isValidUuid(id)) return invalidResult('INVALID_ID', 'Product ID must be a valid UUID');

  const existing = await productRepo.getProductByIdForInstallationForUpdate(client, { id: id.trim(), installationId });
  if (!existing) return invalidResult('NOT_FOUND', 'Product not found');

  const expected = validateExpectedUpdatedAt(payload?.expectedUpdatedAt);
  if (!expected.ok) return expected;
  if (normalizeDateTime(existing.updated_at) !== expected.value) return conflictResult('Product update conflict');

  const validation = validateProductInput({
    code: existing.code,
    name: payload?.name ?? existing.name,
    catalogName: Object.prototype.hasOwnProperty.call(payload ?? {}, 'catalogName') ? payload.catalogName : existing.catalog_name ?? '',
    categoryId: Object.prototype.hasOwnProperty.call(payload ?? {}, 'categoryId') ? payload.categoryId : existing.category_id,
    brandId: Object.prototype.hasOwnProperty.call(payload ?? {}, 'brandId') ? payload.brandId : existing.brand_id,
    description: Object.prototype.hasOwnProperty.call(payload ?? {}, 'description') ? payload.description : existing.description ?? '',
    notes: Object.prototype.hasOwnProperty.call(payload ?? {}, 'notes') ? payload.notes : existing.notes ?? '',
    isCatalogVisible: Object.prototype.hasOwnProperty.call(payload ?? {}, 'isCatalogVisible') ? payload.isCatalogVisible : existing.is_catalog_visible,
    isOrderable: Object.prototype.hasOwnProperty.call(payload ?? {}, 'isOrderable') ? payload.isOrderable : existing.is_orderable,
    isActive: Object.prototype.hasOwnProperty.call(payload ?? {}, 'isActive') ? payload.isActive : existing.is_active,
  }, { codeRequired: false });
  if (!validation.ok) return validation;

  if (validation.normalized.categoryId) {
    const category = await resolveCategory(client, {
      installationId,
      categoryId: validation.normalized.categoryId,
      requireActive: true,
    });
    if (!category.ok) return category;
  }

  if (validation.normalized.brandId) {
    const brand = await resolveBrand(client, {
      installationId,
      brandId: validation.normalized.brandId,
      requireActive: true,
    });
    if (!brand.ok) return brand;
  }

  if (validation.normalized.isOrderable) {
    const activeSellable = await productRepo.countActiveSellableVariantsForProduct(client, {
      installationId,
      productId: existing.id,
    });
    if (activeSellable === 0) {
      return invalidResult('INVALID_ORDERABLE_STATUS', 'Product cannot be orderable without an active sellable variant');
    }
  }

  if (!validation.normalized.isActive) {
    const activeVariants = await productRepo.countActiveVariantsForProduct(client, {
      installationId,
      productId: existing.id,
    });
    if (activeVariants > 0) {
      return conflictResult('Cannot deactivate product while active variants exist');
    }
  }

  const product = await productRepo.updateProduct(client, {
    id: existing.id,
    installationId,
    ...validation.normalized,
    updatedBy,
    expectedUpdatedAt: expected.value,
  });

  if (!product) return conflictResult('Product update conflict');
  return { ok: true, product, beforeData: existing, changed: true, action: 'update' };
}

export async function createProductVariant(client, { installationId, productId, payload, createdBy }) {
  if (!isValidUuid(productId)) return invalidResult('INVALID_PRODUCT_ID', 'Product ID must be a valid UUID');

  const product = await productRepo.getProductByIdForInstallation(client, { id: productId.trim(), installationId });
  if (!product) return invalidResult('PRODUCT_NOT_FOUND', 'Product not found');

  const validation = validateProductVariantInput(payload);
  if (!validation.ok) return validation;

  const existingSku = await variantRepo.getProductVariantBySku(client, {
    installationId,
    sku: validation.normalized.sku,
  });
  if (existingSku) {
    return invalidResult('DUPLICATE_SKU', 'A product variant with this SKU already exists');
  }

  if (validation.normalized.isInventoryBase) {
    const existingBaseCount = await variantRepo.countActiveInventoryBaseVariantsForProduct(client, {
      installationId,
      productId: product.id,
    });
    if (existingBaseCount > 0) {
      return conflictResult('Only one active inventory-base variant is allowed per product');
    }
  }

  if (validation.normalized.isCatalogVisible && !validation.normalized.isSellable) {
    return invalidResult('INVALID_VARIANT_VISIBILITY', 'Catalog-visible variants must be sellable');
  }

  if (product.is_orderable && !(validation.normalized.isActive && validation.normalized.isSellable)) {
    const activeSellableCount = await variantRepo.countActiveSellableVariantsForProductExcludingVariant(client, {
      installationId,
      productId: product.id,
      excludeVariantId: null,
    });
    if (activeSellableCount === 0) {
      return invalidResult('INVALID_ORDERABLE_STATUS', 'Product cannot be orderable without an active sellable variant');
    }
  }

  const variant = await variantRepo.insertProductVariant(client, {
    installationId,
    productId: product.id,
    ...validation.normalized,
    createdBy,
  });
  if (!variant) return invalidResult('DUPLICATE_SKU', 'A product variant with this SKU already exists');

  return { ok: true, variant };
}

export async function listProductVariants(client, { installationId, productId }) {
  if (!isValidUuid(productId)) return invalidResult('INVALID_PRODUCT_ID', 'Product ID must be a valid UUID');
  const product = await productRepo.getProductByIdForInstallation(client, { id: productId.trim(), installationId });
  if (!product) return invalidResult('PRODUCT_NOT_FOUND', 'Product not found');
  const variants = await variantRepo.listProductVariantsForProduct(client, { installationId, productId: product.id });
  return { ok: true, variants };
}

export async function updateProductVariant(client, { productId, variantId, installationId, payload, updatedBy }) {
  if (!isValidUuid(productId)) return invalidResult('INVALID_PRODUCT_ID', 'Product ID must be a valid UUID');
  if (!isValidUuid(variantId)) return invalidResult('INVALID_VARIANT_ID', 'Variant ID must be a valid UUID');

  const product = await productRepo.getProductByIdForInstallation(client, { id: productId.trim(), installationId });
  if (!product) return invalidResult('PRODUCT_NOT_FOUND', 'Product not found');

  const existing = await variantRepo.getProductVariantByIdForInstallationForUpdate(client, { id: variantId.trim(), installationId });
  if (!existing) return invalidResult('NOT_FOUND', 'Product variant not found');
  if (existing.product_id !== product.id) return invalidResult('VARIANT_NOT_FOUND', 'Product variant not found');

  const expected = validateExpectedUpdatedAt(payload?.expectedUpdatedAt);
  if (!expected.ok) return expected;
  if (normalizeDateTime(existing.updated_at) !== expected.value) return conflictResult('Product variant update conflict');

  if (Object.prototype.hasOwnProperty.call(payload ?? {}, 'sku')) {
    const sku = normalizeCode(payload.sku);
    if (sku !== existing.sku) {
      return invalidResult('IMMUTABLE_SKU', 'SKU is immutable after creation');
    }
  }

  const validation = validateProductVariantInput({
    sku: existing.sku,
    name: payload?.name ?? existing.name,
    variantKind: Object.prototype.hasOwnProperty.call(payload ?? {}, 'variantKind') ? payload.variantKind : existing.variant_kind,
    isInventoryBase: Object.prototype.hasOwnProperty.call(payload ?? {}, 'isInventoryBase') ? payload.isInventoryBase : existing.is_inventory_base,
    isSellable: Object.prototype.hasOwnProperty.call(payload ?? {}, 'isSellable') ? payload.isSellable : existing.is_sellable,
    isCatalogVisible: Object.prototype.hasOwnProperty.call(payload ?? {}, 'isCatalogVisible') ? payload.isCatalogVisible : existing.is_catalog_visible,
    isActive: Object.prototype.hasOwnProperty.call(payload ?? {}, 'isActive') ? payload.isActive : existing.is_active,
  }, { skuRequired: false });
  if (!validation.ok) return validation;

  if (validation.normalized.isInventoryBase) {
    const baseCount = await variantRepo.countActiveInventoryBaseVariantsForProduct(client, {
      installationId,
      productId: product.id,
      excludeVariantId: existing.id,
    });
    if (baseCount > 0) {
      return conflictResult('Only one active inventory-base variant is allowed per product');
    }
  }

  if (product.is_orderable) {
    const willBeActiveSellable = validation.normalized.isActive && validation.normalized.isSellable;
    const remaining = await variantRepo.countActiveSellableVariantsForProductExcludingVariant(client, {
      installationId,
      productId: product.id,
      excludeVariantId: existing.id,
    });
    if (!willBeActiveSellable && remaining === 0) {
      return invalidResult('INVALID_ORDERABLE_STATUS', 'Product cannot remain orderable without an active sellable variant');
    }
  }

  const variant = await variantRepo.updateProductVariant(client, {
    id: existing.id,
    installationId,
    ...validation.normalized,
    updatedBy,
    expectedUpdatedAt: expected.value,
  });
  if (!variant) return conflictResult('Product variant update conflict');
  return { ok: true, variant, beforeData: existing, changed: true, action: 'update' };
}

function normalizeImportProductRow(payload) {
  const categoryId = normalizeOptionalUuid(payload.categoryId);
  const brandId = normalizeOptionalUuid(payload.brandId);
  const id = normalizeOptionalUuid(payload.id);

  const variants = Array.isArray(payload.variants) ? payload.variants : [];

  return {
    id,
    code: normalizeCode(payload.code),
    name: normalizeText(payload.name),
    catalogName: normalizeText(payload.catalogName) || null,
    categoryId,
    brandId,
    description: normalizeText(payload.description) || null,
    notes: normalizeText(payload.notes) || null,
    isCatalogVisible: normalizeBoolean(payload.isCatalogVisible, false),
    isOrderable: normalizeBoolean(payload.isOrderable, false),
    isActive: normalizeBoolean(payload.isActive, true),
    variants: variants.map((variant) => ({
      id: normalizeOptionalUuid(variant.id),
      sku: normalizeCode(variant.sku),
      name: normalizeText(variant.name),
      variantKind: normalizeText(variant.variantKind).toUpperCase() || 'BASE',
      isInventoryBase: normalizeBoolean(variant.isInventoryBase, false),
      isSellable: normalizeBoolean(variant.isSellable, true),
      isCatalogVisible: normalizeBoolean(variant.isCatalogVisible, false),
      isActive: normalizeBoolean(variant.isActive, true),
    })),
  };
}

export async function importProducts(client, { installationId, payload, createdBy }) {
  if (!payload || typeof payload !== 'object' || !Array.isArray(payload.products)) {
    return invalidResult('INVALID_IMPORT_PAYLOAD', 'Import payload must contain a products array');
  }

  if (payload.products.length > MAX_IMPORT_PRODUCTS) {
    return invalidResult('IMPORT_TOO_LARGE', `Import payload cannot contain more than ${MAX_IMPORT_PRODUCTS} products`);
  }

  const importRows = payload.products.map(normalizeImportProductRow);
  const seenCodes = new Set();
  const seenSku = new Set();

  for (const row of importRows) {
    if (!row.code || !CODE_PATTERN.test(row.code)) {
      return invalidResult('INVALID_CODE', 'Each product must have a valid uppercase code');
    }
    if (!row.name) {
      return invalidResult('INVALID_NAME', 'Each product must have a name');
    }
    if (row.id && !isValidUuid(row.id)) {
      return invalidResult('INVALID_PRODUCT_ID', 'Product ID must be a valid UUID');
    }
    if (seenCodes.has(row.code)) {
      return invalidResult('DUPLICATE_CODE', 'Duplicate product code in import payload');
    }
    seenCodes.add(row.code);
    if (row.categoryId && !isValidUuid(row.categoryId)) {
      return invalidResult('INVALID_CATEGORY_ID', 'Category ID must be a valid UUID');
    }
    if (row.brandId && !isValidUuid(row.brandId)) {
      return invalidResult('INVALID_BRAND_ID', 'Brand ID must be a valid UUID');
    }
    for (const variant of row.variants) {
      if (!variant.sku || !SKU_PATTERN.test(variant.sku)) {
        return invalidResult('INVALID_SKU', 'Each variant must have a valid uppercase SKU');
      }
      if (!variant.name) {
        return invalidResult('INVALID_NAME', 'Each variant must have a name');
      }
      if (!VARIANT_KINDS.has(variant.variantKind)) {
        return invalidResult('INVALID_VARIANT_KIND', 'Variant kind must be BASE, CARTON or OTHER');
      }
      if (variant.isInventoryBase && variant.variantKind !== 'BASE') {
        return invalidResult('INVALID_INVENTORY_BASE', 'Inventory-base variants must use variant_kind BASE');
      }
      if (variant.isCatalogVisible && !variant.isSellable) {
        return invalidResult('INVALID_VARIANT_VISIBILITY', 'Catalog-visible variants must be sellable');
      }
      if (variant.id && !isValidUuid(variant.id)) {
        return invalidResult('INVALID_VARIANT_ID', 'Variant ID must be a valid UUID');
      }
      if (seenSku.has(variant.sku)) {
        return invalidResult('DUPLICATE_SKU', 'Duplicate SKU in import payload');
      }
      seenSku.add(variant.sku);
    }
  }

  const productIds = importRows.filter((row) => row.id).map((row) => row.id);
  const productCodes = importRows.map((row) => row.code);
  const existingProducts = await productRepo.getProductsByIdsOrCodes(client, {
    installationId,
    ids: productIds,
    codes: productCodes,
  });
  const productsById = new Map(existingProducts.filter((row) => row.id).map((row) => [row.id, row]));
  const productsByCode = new Map(existingProducts.filter((row) => row.code).map((row) => [row.code, row]));

  const variantIds = [];
  const variantSkus = [];
  for (const row of importRows) {
    for (const variant of row.variants) {
      if (variant.id) variantIds.push(variant.id);
      variantSkus.push(variant.sku);
    }
  }
  const existingVariants = await variantRepo.getProductVariantsByIdsOrSkus(client, {
    installationId,
    ids: variantIds,
    skus: variantSkus,
  });
  const variantsById = new Map(existingVariants.filter((row) => row.id).map((row) => [row.id, row]));
  const variantsBySku = new Map(existingVariants.filter((row) => row.sku).map((row) => [row.sku, row]));

  const categoryIds = Array.from(new Set(importRows.filter((row) => row.categoryId).map((row) => row.categoryId)));
  const brandIds = Array.from(new Set(importRows.filter((row) => row.brandId).map((row) => row.brandId)));
  const categoryById = new Map();
  for (const categoryId of categoryIds) {
    const category = await categoryRepo.getProductCategoryByIdForInstallationForShare(client, { id: categoryId, installationId });
    if (!category) return invalidResult('CATEGORY_NOT_FOUND', 'Assigned category not found');
    categoryById.set(categoryId, category);
  }

  const brandById = new Map();
  for (const brandId of brandIds) {
    const brand = await brandRepo.getProductBrandByIdForInstallationForShare(client, { id: brandId, installationId });
    if (!brand) return invalidResult('BRAND_NOT_FOUND', 'Assigned brand not found');
    brandById.set(brandId, brand);
  }

  const productsToWrite = [];
  for (const row of importRows) {
    const existingByCode = productsByCode.get(row.code);
    const existingById = row.id ? productsById.get(row.id) : null;

    if (existingById && existingByCode && existingById.id !== existingByCode.id) {
      return invalidResult('CONFLICTING_PRODUCT_ID', 'Existing product ID and code do not match');
    }

    const productId = existingById?.id ?? existingByCode?.id ?? row.id;
    if (row.id && existingByCode && existingByCode.id !== row.id) {
      return invalidResult('CONFLICTING_PRODUCT_ID', 'Existing product code is bound to a different product ID');
    }

    if (row.categoryId) {
      const category = categoryById.get(row.categoryId);
      if (!category) return invalidResult('CATEGORY_NOT_FOUND', 'Assigned category not found');
      if (!category.is_active) return invalidResult('CATEGORY_INACTIVE', 'Assigned category is not active');
    }

    if (row.brandId) {
      const brand = brandById.get(row.brandId);
      if (!brand) return invalidResult('BRAND_NOT_FOUND', 'Assigned brand not found');
      if (!brand.is_active) return invalidResult('BRAND_INACTIVE', 'Assigned brand is not active');
    }

    const finalActiveSellableVariants = row.variants.filter((variant) => variant.isActive && variant.isSellable).length;
    if (row.isOrderable && finalActiveSellableVariants === 0) {
      return invalidResult('INVALID_ORDERABLE_STATUS', 'Product cannot be orderable without an active sellable variant');
    }

    if (!row.isActive && row.variants.some((variant) => variant.isActive)) {
      return conflictResult('Cannot deactivate product while active variants exist');
    }

    productsToWrite.push({ ...row, productId });
  }

  const createdProducts = [];
  for (const row of productsToWrite) {
    const existingProduct = row.productId
      ? await productRepo.getProductByIdForInstallation(client, { id: row.productId, installationId })
      : await productRepo.getProductByCode(client, { installationId, code: row.code });

    const product = existingProduct
      ? await productRepo.updateProduct(client, {
          id: existingProduct.id,
          installationId,
          name: row.name,
          catalogName: row.catalogName,
          categoryId: row.categoryId,
          brandId: row.brandId,
          description: row.description,
          notes: row.notes,
          isCatalogVisible: row.isCatalogVisible,
          isOrderable: row.isOrderable,
          isActive: row.isActive,
          updatedBy: createdBy,
        })
      : await productRepo.insertProduct(client, {
          id: row.id,
          installationId,
          code: row.code,
          name: row.name,
          catalogName: row.catalogName,
          categoryId: row.categoryId,
          brandId: row.brandId,
          description: row.description,
          notes: row.notes,
          isCatalogVisible: row.isCatalogVisible,
          isOrderable: row.isOrderable,
          isActive: row.isActive,
          createdBy,
        });

    if (!product) {
      return invalidResult('IMPORT_PRODUCT_FAILED', 'Failed to import product');
    }

    createdProducts.push({ row, product });
  }

  for (const { row, product } of createdProducts) {
    for (const variantRow of row.variants) {
      const existingVariantById = variantRow.id ? variantsById.get(variantRow.id) : null;
      const existingVariantBySku = variantsBySku.get(variantRow.sku);

      if (existingVariantById && existingVariantBySku && existingVariantById.id !== existingVariantBySku.id) {
        return invalidResult('CONFLICTING_VARIANT_ID', 'Existing variant SKU and ID do not match');
      }

      if (existingVariantById && existingVariantById.product_id !== product.id) {
        return invalidResult('VARIANT_PRODUCT_MISMATCH', 'Variant SKU is assigned to a different product');
      }

      if (existingVariantBySku && existingVariantBySku.product_id !== product.id) {
        return invalidResult('VARIANT_PRODUCT_MISMATCH', 'Variant SKU is assigned to a different product');
      }

      if (existingVariantById) {
        const variant = await variantRepo.updateProductVariant(client, {
          id: existingVariantById.id,
          installationId,
          name: variantRow.name,
          variantKind: variantRow.variantKind,
          isInventoryBase: variantRow.isInventoryBase,
          isSellable: variantRow.isSellable,
          isCatalogVisible: variantRow.isCatalogVisible,
          isActive: variantRow.isActive,
          updatedBy: createdBy,
          expectedUpdatedAt: existingVariantById.updated_at,
        });
        if (!variant) return invalidResult('IMPORT_VARIANT_FAILED', 'Failed to import product variant');
      } else {
        const variant = await variantRepo.insertProductVariant(client, {
          installationId,
          productId: product.id,
          sku: variantRow.sku,
          name: variantRow.name,
          variantKind: variantRow.variantKind,
          isInventoryBase: variantRow.isInventoryBase,
          isSellable: variantRow.isSellable,
          isCatalogVisible: variantRow.isCatalogVisible,
          isActive: variantRow.isActive,
          createdBy,
        });
        if (!variant) return invalidResult('IMPORT_VARIANT_FAILED', 'Failed to import product variant');
      }
    }
  }

  return { ok: true, imported: createdProducts.length };
}
