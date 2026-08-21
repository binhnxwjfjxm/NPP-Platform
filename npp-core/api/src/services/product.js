import * as categoryRepo from '../db/repositories/product-categories.js';
import * as brandRepo from '../db/repositories/product-brands.js';
import * as productRepo from '../db/repositories/products.js';
import * as variantRepo from '../db/repositories/product-variants.js';
import { activeDependentsConflict, domainConflict, staleVersionConflict } from './deactivate-conflict-contract.js';

const CODE_PATTERN = /^[A-Z0-9_-]{1,64}$/;
const SKU_PATTERN = /^[A-Z0-9._/-]{1,96}$/;
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const VARIANT_KINDS = new Set(['BASE', 'CARTON', 'OTHER']);
const MAX_IMPORT_PRODUCTS = 500;

function invalid(code, message, retryable = false) {
  return { ok: false, code, message, retryable };
}

function conflict(message, reason = 'DOMAIN_CONFLICT') {
  return domainConflict({ message, reason });
}

function text(value) {
  return typeof value === 'string' ? value.trim() : '';
}

function code(value) {
  return text(value).toUpperCase();
}

function optionalUuid(value) {
  if (value === undefined || value === null || value === '') return null;
  return text(value);
}

function validUuid(value) {
  return typeof value === 'string' && UUID_PATTERN.test(value.trim());
}

function dateTime(value) {
  if (value instanceof Date) return Number.isNaN(value.getTime()) ? null : value.toISOString();
  if (typeof value !== 'string' || !value.trim()) return null;
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? null : parsed.toISOString();
}

function expectedUpdatedAt(value) {
  const normalized = dateTime(value);
  if (!normalized) {
    return invalid(
      value === undefined || value === null || value === '' ? 'MISSING_EXPECTED_UPDATED_AT' : 'INVALID_EXPECTED_UPDATED_AT',
      'expectedUpdatedAt is required and must be a valid date-time',
    );
  }
  return { ok: true, value: normalized };
}

function booleanField(payload, key, fallback) {
  if (!Object.prototype.hasOwnProperty.call(payload, key)) return { ok: true, value: fallback };
  if (typeof payload[key] !== 'boolean') return invalid('INVALID_BOOLEAN', `${key} must be a boolean`);
  return { ok: true, value: payload[key] };
}

function optionalText(payload, key, maxLength) {
  const normalized = text(payload[key]);
  if (normalized.length > maxLength) return invalid('INVALID_TEXT', `${key} must not exceed ${maxLength} characters`);
  return { ok: true, value: normalized || null };
}

function searchValue(value) {
  if (value === undefined || value === null || value === '') return { ok: true, value: null };
  const normalized = text(value);
  if (normalized.length > 256) return invalid('INVALID_SEARCH', 'Search must not exceed 256 characters');
  return { ok: true, value: normalized || null };
}

export function validateProductCategoryInput(payload, { codeRequired = true, defaults = {} } = {}) {
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) return invalid('INVALID_INPUT', 'Product category data is required');
  const normalizedCode = code(payload.code ?? defaults.code);
  if (codeRequired && !CODE_PATTERN.test(normalizedCode)) return invalid('INVALID_CODE', 'Category code is invalid');
  const name = text(payload.name ?? defaults.name);
  if (!name || name.length > 256) return invalid('INVALID_NAME', 'Category name is required and must not exceed 256 characters');
  const parentCategoryId = optionalUuid(Object.prototype.hasOwnProperty.call(payload, 'parentCategoryId') ? payload.parentCategoryId : defaults.parentCategoryId);
  if (parentCategoryId && !validUuid(parentCategoryId)) return invalid('INVALID_PARENT_CATEGORY_ID', 'Parent category ID must be a valid UUID');
  const description = optionalText({ description: Object.prototype.hasOwnProperty.call(payload, 'description') ? payload.description : defaults.description }, 'description', 2000);
  if (!description.ok) return description;
  const sortOrder = Number(Object.prototype.hasOwnProperty.call(payload, 'sortOrder') ? payload.sortOrder : (defaults.sortOrder ?? 0));
  if (!Number.isInteger(sortOrder) || sortOrder < 0 || sortOrder > 1_000_000) return invalid('INVALID_SORT_ORDER', 'Sort order must be an integer between 0 and 1000000');
  const visible = booleanField(payload, 'isCatalogVisible', defaults.isCatalogVisible ?? true);
  if (!visible.ok) return visible;
  const active = booleanField(payload, 'isActive', defaults.isActive ?? true);
  if (!active.ok) return active;
  return { ok: true, normalized: { code: normalizedCode, name, parentCategoryId, description: description.value, sortOrder, isCatalogVisible: visible.value, isActive: active.value } };
}

export function validateProductBrandInput(payload, { codeRequired = true, defaults = {} } = {}) {
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) return invalid('INVALID_INPUT', 'Product brand data is required');
  const normalizedCode = code(payload.code ?? defaults.code);
  if (codeRequired && !CODE_PATTERN.test(normalizedCode)) return invalid('INVALID_CODE', 'Brand code is invalid');
  const name = text(payload.name ?? defaults.name);
  if (!name || name.length > 256) return invalid('INVALID_NAME', 'Brand name is required and must not exceed 256 characters');
  const description = optionalText({ description: Object.prototype.hasOwnProperty.call(payload, 'description') ? payload.description : defaults.description }, 'description', 2000);
  if (!description.ok) return description;
  const visible = booleanField(payload, 'isCatalogVisible', defaults.isCatalogVisible ?? true);
  if (!visible.ok) return visible;
  const active = booleanField(payload, 'isActive', defaults.isActive ?? true);
  if (!active.ok) return active;
  return { ok: true, normalized: { code: normalizedCode, name, description: description.value, isCatalogVisible: visible.value, isActive: active.value } };
}

export function validateProductInput(payload, { codeRequired = true, defaults = {} } = {}) {
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) return invalid('INVALID_INPUT', 'Product data is required');
  const normalizedCode = code(payload.code ?? defaults.code);
  if (codeRequired && !CODE_PATTERN.test(normalizedCode)) return invalid('INVALID_CODE', 'Product code is invalid');
  const name = text(payload.name ?? defaults.name);
  if (!name || name.length > 256) return invalid('INVALID_NAME', 'Product name is required and must not exceed 256 characters');
  const catalogName = optionalText({ catalogName: Object.prototype.hasOwnProperty.call(payload, 'catalogName') ? payload.catalogName : defaults.catalogName }, 'catalogName', 256);
  if (!catalogName.ok) return catalogName;
  const categoryId = optionalUuid(Object.prototype.hasOwnProperty.call(payload, 'categoryId') ? payload.categoryId : defaults.categoryId);
  if (categoryId && !validUuid(categoryId)) return invalid('INVALID_CATEGORY_ID', 'Category ID must be a valid UUID');
  const brandId = optionalUuid(Object.prototype.hasOwnProperty.call(payload, 'brandId') ? payload.brandId : defaults.brandId);
  if (brandId && !validUuid(brandId)) return invalid('INVALID_BRAND_ID', 'Brand ID must be a valid UUID');
  const description = optionalText({ description: Object.prototype.hasOwnProperty.call(payload, 'description') ? payload.description : defaults.description }, 'description', 4000);
  if (!description.ok) return description;
  const notes = optionalText({ notes: Object.prototype.hasOwnProperty.call(payload, 'notes') ? payload.notes : defaults.notes }, 'notes', 4000);
  if (!notes.ok) return notes;
  const visible = booleanField(payload, 'isCatalogVisible', defaults.isCatalogVisible ?? false);
  if (!visible.ok) return visible;
  const orderable = booleanField(payload, 'isOrderable', defaults.isOrderable ?? false);
  if (!orderable.ok) return orderable;
  const active = booleanField(payload, 'isActive', defaults.isActive ?? true);
  if (!active.ok) return active;
  return { ok: true, normalized: { code: normalizedCode, name, catalogName: catalogName.value, categoryId, brandId, description: description.value, notes: notes.value, isCatalogVisible: visible.value, isOrderable: orderable.value, isActive: active.value } };
}

export function validateProductVariantInput(payload, { skuRequired = true, defaults = {} } = {}) {
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) return invalid('INVALID_INPUT', 'Product variant data is required');
  const sku = code(payload.sku ?? defaults.sku);
  if (skuRequired && !SKU_PATTERN.test(sku)) return invalid('INVALID_SKU', 'SKU is invalid');
  const name = text(payload.name ?? defaults.name);
  if (!name || name.length > 256) return invalid('INVALID_NAME', 'Variant name is required and must not exceed 256 characters');
  const variantKind = text(payload.variantKind ?? defaults.variantKind ?? 'BASE').toUpperCase();
  if (!VARIANT_KINDS.has(variantKind)) return invalid('INVALID_VARIANT_KIND', 'Variant kind must be BASE, CARTON or OTHER');
  const inventoryBase = booleanField(payload, 'isInventoryBase', defaults.isInventoryBase ?? false);
  if (!inventoryBase.ok) return inventoryBase;
  const sellable = booleanField(payload, 'isSellable', defaults.isSellable ?? true);
  if (!sellable.ok) return sellable;
  const visible = booleanField(payload, 'isCatalogVisible', defaults.isCatalogVisible ?? false);
  if (!visible.ok) return visible;
  const active = booleanField(payload, 'isActive', defaults.isActive ?? true);
  if (!active.ok) return active;
  if (inventoryBase.value && variantKind !== 'BASE') return invalid('INVALID_INVENTORY_BASE', 'Inventory-base variants must use BASE kind');
  if (visible.value && !sellable.value) return invalid('INVALID_VARIANT_VISIBILITY', 'Catalog-visible variants must be sellable');
  return { ok: true, normalized: { sku, name, variantKind, isInventoryBase: inventoryBase.value, isSellable: sellable.value, isCatalogVisible: visible.value, isActive: active.value } };
}

async function resolveCategory(client, { installationId, categoryId, requireActive = true }) {
  if (!categoryId) return { ok: true, category: null };
  const category = await categoryRepo.getProductCategoryByIdForInstallationForShare(client, { id: categoryId, installationId });
  if (!category) return invalid('CATEGORY_NOT_FOUND', 'Category not found');
  if (requireActive && !category.is_active) return invalid('CATEGORY_INACTIVE', 'Assigned category is inactive');
  return { ok: true, category };
}

async function resolveBrand(client, { installationId, brandId, requireActive = true }) {
  if (!brandId) return { ok: true, brand: null };
  const brand = await brandRepo.getProductBrandByIdForInstallationForShare(client, { id: brandId, installationId });
  if (!brand) return invalid('BRAND_NOT_FOUND', 'Brand not found');
  if (requireActive && !brand.is_active) return invalid('BRAND_INACTIVE', 'Assigned brand is inactive');
  return { ok: true, brand };
}

function aliases(key, entity, extras = {}) {
  return { ok: true, [key]: entity, [`product_${key}`]: entity, ...extras };
}

export async function createProductCategory(client, { installationId, payload, createdBy }) {
  const validation = validateProductCategoryInput(payload);
  if (!validation.ok) return validation;
  if (validation.normalized.parentCategoryId) {
    const parent = await resolveCategory(client, { installationId, categoryId: validation.normalized.parentCategoryId });
    if (!parent.ok) return parent.code === 'CATEGORY_NOT_FOUND' ? invalid('PARENT_CATEGORY_NOT_FOUND', 'Parent category not found') : invalid('PARENT_CATEGORY_INACTIVE', 'Parent category is inactive');
  }
  if (await categoryRepo.getProductCategoryByCode(client, { installationId, code: validation.normalized.code })) return invalid('DUPLICATE_CODE', 'Category code already exists');
  const category = await categoryRepo.insertProductCategory(client, { installationId, ...validation.normalized, createdBy });
  if (!category) return invalid('DUPLICATE_CODE', 'Category code already exists');
  return aliases('category', category);
}

export async function getProductCategory(client, { installationId, id }) {
  if (!validUuid(id)) return invalid('NOT_FOUND', 'Product category not found');
  const category = await categoryRepo.getProductCategoryByIdForInstallation(client, { id: id.trim(), installationId });
  return category ? { ok: true, category } : invalid('NOT_FOUND', 'Product category not found');
}

export async function listProductCategories(client, { installationId, search, active, limit, offset }) {
  const validatedSearch = searchValue(search);
  if (!validatedSearch.ok) return validatedSearch;
  const categories = await categoryRepo.listProductCategoriesForInstallation(client, { installationId, search: validatedSearch.value, active, limit, offset });
  return { ok: true, categories };
}

export async function updateProductCategory(client, { id, installationId, payload, updatedBy }) {
  if (!validUuid(id)) return invalid('INVALID_ID', 'Category ID must be a valid UUID');
  const existing = await categoryRepo.getProductCategoryByIdForInstallationForUpdate(client, { id: id.trim(), installationId });
  if (!existing) return invalid('NOT_FOUND', 'Product category not found');
  if (Object.prototype.hasOwnProperty.call(payload ?? {}, 'code') && code(payload.code) !== existing.code) return invalid('IMMUTABLE_CODE', 'Category code is immutable');
  const expected = expectedUpdatedAt(payload?.expectedUpdatedAt);
  if (!expected.ok) return expected;
  if (dateTime(existing.updated_at) !== expected.value) return staleVersionConflict({ entityLabel: 'Nhóm sản phẩm', managementPath: '/products' });
  const validation = validateProductCategoryInput(payload ?? {}, { codeRequired: false, defaults: {
    code: existing.code, name: existing.name, parentCategoryId: existing.parent_category_id, description: existing.description,
    sortOrder: existing.sort_order, isCatalogVisible: existing.is_catalog_visible, isActive: existing.is_active,
  } });
  if (!validation.ok) return validation;
  const next = validation.normalized;
  if (next.parentCategoryId === existing.id) return invalid('INVALID_PARENT_CATEGORY_ID', 'Category cannot be its own parent');
  if (next.parentCategoryId) {
    const parent = await resolveCategory(client, { installationId, categoryId: next.parentCategoryId });
    if (!parent.ok) return parent.code === 'CATEGORY_NOT_FOUND' ? invalid('PARENT_CATEGORY_NOT_FOUND', 'Parent category not found') : invalid('PARENT_CATEGORY_INACTIVE', 'Parent category is inactive');
    const cycle = await categoryRepo.isProductCategoryDescendantOf(client, { installationId, categoryId: next.parentCategoryId, ancestorId: existing.id });
    if (cycle) return invalid('INVALID_CATEGORY_HIERARCHY', 'Category parent assignment would create a cycle');
  }
  if (!next.isActive && existing.is_active) {
    if (await categoryRepo.hasActiveProductsForCategory(client, { categoryId: existing.id, installationId })) return domainConflict({ message: 'Không thể ngưng hoạt động nhóm sản phẩm vì còn sản phẩm đang hoạt động phụ thuộc. Hãy chuyển hoặc ngưng các sản phẩm trước rồi thử lại.', reason: 'CATEGORY_HAS_ACTIVE_PRODUCTS', managementPath: '/products' });
    if (await categoryRepo.hasActiveChildCategories(client, { categoryId: existing.id, installationId })) return domainConflict({ message: 'Không thể ngưng hoạt động nhóm sản phẩm vì còn nhóm con đang hoạt động. Hãy ngưng hoặc chuyển nhóm con trước rồi thử lại.', reason: 'CATEGORY_HAS_ACTIVE_CHILDREN', managementPath: '/products' });
  }
  const category = await categoryRepo.updateProductCategory(client, { id: existing.id, installationId, ...next, updatedBy, expectedUpdatedAt: expected.value });
  if (!category) return staleVersionConflict({ entityLabel: 'Nhóm sản phẩm', managementPath: '/products' });
  return aliases('category', category, { beforeData: existing, changed: true, action: next.isActive === existing.is_active ? 'update' : (next.isActive ? 'activate' : 'deactivate') });
}

export async function createProductBrand(client, { installationId, payload, createdBy }) {
  const validation = validateProductBrandInput(payload);
  if (!validation.ok) return validation;
  if (await brandRepo.getProductBrandByCode(client, { installationId, code: validation.normalized.code })) return invalid('DUPLICATE_CODE', 'Brand code already exists');
  const brand = await brandRepo.insertProductBrand(client, { installationId, ...validation.normalized, createdBy });
  if (!brand) return invalid('DUPLICATE_CODE', 'Brand code already exists');
  return aliases('brand', brand);
}

export async function getProductBrand(client, { installationId, id }) {
  if (!validUuid(id)) return invalid('NOT_FOUND', 'Product brand not found');
  const brand = await brandRepo.getProductBrandByIdForInstallation(client, { id: id.trim(), installationId });
  return brand ? { ok: true, brand } : invalid('NOT_FOUND', 'Product brand not found');
}

export async function listProductBrands(client, { installationId, search, active, limit, offset }) {
  const validatedSearch = searchValue(search);
  if (!validatedSearch.ok) return validatedSearch;
  const brands = await brandRepo.listProductBrandsForInstallation(client, { installationId, search: validatedSearch.value, active, limit, offset });
  return { ok: true, brands };
}

export async function updateProductBrand(client, { id, installationId, payload, updatedBy }) {
  if (!validUuid(id)) return invalid('INVALID_ID', 'Brand ID must be a valid UUID');
  const existing = await brandRepo.getProductBrandByIdForInstallationForUpdate(client, { id: id.trim(), installationId });
  if (!existing) return invalid('NOT_FOUND', 'Product brand not found');
  if (Object.prototype.hasOwnProperty.call(payload ?? {}, 'code') && code(payload.code) !== existing.code) return invalid('IMMUTABLE_CODE', 'Brand code is immutable');
  const expected = expectedUpdatedAt(payload?.expectedUpdatedAt);
  if (!expected.ok) return expected;
  if (dateTime(existing.updated_at) !== expected.value) return staleVersionConflict({ entityLabel: 'Nhãn hàng', managementPath: '/products' });
  const validation = validateProductBrandInput(payload ?? {}, { codeRequired: false, defaults: {
    code: existing.code, name: existing.name, description: existing.description,
    isCatalogVisible: existing.is_catalog_visible, isActive: existing.is_active,
  } });
  if (!validation.ok) return validation;
  const next = validation.normalized;
  if (!next.isActive && existing.is_active && await brandRepo.hasActiveProductsForBrand(client, { brandId: existing.id, installationId })) return domainConflict({ message: 'Không thể ngưng hoạt động nhãn hàng vì còn sản phẩm đang hoạt động phụ thuộc. Hãy chuyển hoặc ngưng các sản phẩm trước rồi thử lại.', reason: 'BRAND_HAS_ACTIVE_PRODUCTS', managementPath: '/products' });
  const brand = await brandRepo.updateProductBrand(client, { id: existing.id, installationId, ...next, updatedBy, expectedUpdatedAt: expected.value });
  if (!brand) return staleVersionConflict({ entityLabel: 'Nhãn hàng', managementPath: '/products' });
  return aliases('brand', brand, { beforeData: existing, changed: true, action: next.isActive === existing.is_active ? 'update' : (next.isActive ? 'activate' : 'deactivate') });
}

export async function createProduct(client, { installationId, payload, createdBy }) {
  const validation = validateProductInput(payload);
  if (!validation.ok) return validation;
  const next = validation.normalized;
  if (next.isOrderable) return invalid('INVALID_ORDERABLE_STATUS', 'Create the product and an active sellable SKU before enabling ordering');
  const category = await resolveCategory(client, { installationId, categoryId: next.categoryId });
  if (!category.ok) return category;
  const brand = await resolveBrand(client, { installationId, brandId: next.brandId });
  if (!brand.ok) return brand;
  if (await productRepo.getProductByCode(client, { installationId, code: next.code })) return invalid('DUPLICATE_CODE', 'Product code already exists');
  const product = await productRepo.insertProduct(client, { installationId, ...next, createdBy });
  if (!product) return invalid('DUPLICATE_CODE', 'Product code already exists');
  return { ok: true, product };
}

export async function getProduct(client, { installationId, id }) {
  if (!validUuid(id)) return invalid('NOT_FOUND', 'Product not found');
  const product = await productRepo.getProductByIdForInstallation(client, { id: id.trim(), installationId });
  return product ? { ok: true, product } : invalid('NOT_FOUND', 'Product not found');
}

export async function listProducts(client, { installationId, search, active, catalogVisible, orderable, categoryId, brandId, limit, offset }) {
  const validatedSearch = searchValue(search);
  if (!validatedSearch.ok) return validatedSearch;
  if (categoryId && !validUuid(categoryId)) return invalid('INVALID_CATEGORY_ID', 'Category ID must be a valid UUID');
  if (brandId && !validUuid(brandId)) return invalid('INVALID_BRAND_ID', 'Brand ID must be a valid UUID');
  const products = await productRepo.listProductsForInstallation(client, { installationId, search: validatedSearch.value, active, catalogVisible, orderable, categoryId, brandId, limit, offset });
  return { ok: true, products };
}

export async function updateProduct(client, { id, installationId, payload, updatedBy }) {
  if (!validUuid(id)) return invalid('INVALID_ID', 'Product ID must be a valid UUID');
  const existing = await productRepo.getProductByIdForInstallationForUpdate(client, { id: id.trim(), installationId });
  if (!existing) return invalid('NOT_FOUND', 'Product not found');
  if (Object.prototype.hasOwnProperty.call(payload ?? {}, 'code') && code(payload.code) !== existing.code) return invalid('IMMUTABLE_CODE', 'Product code is immutable');
  const expected = expectedUpdatedAt(payload?.expectedUpdatedAt);
  if (!expected.ok) return expected;
  if (dateTime(existing.updated_at) !== expected.value) return staleVersionConflict({ entityLabel: 'Sản phẩm', managementPath: '/products' });
  const validation = validateProductInput(payload ?? {}, { codeRequired: false, defaults: {
    code: existing.code, name: existing.name, catalogName: existing.catalog_name, categoryId: existing.category_id,
    brandId: existing.brand_id, description: existing.description, notes: existing.notes,
    isCatalogVisible: existing.is_catalog_visible, isOrderable: existing.is_orderable, isActive: existing.is_active,
  } });
  if (!validation.ok) return validation;
  const next = validation.normalized;
  const category = await resolveCategory(client, { installationId, categoryId: next.categoryId });
  if (!category.ok) return category;
  const brand = await resolveBrand(client, { installationId, brandId: next.brandId });
  if (!brand.ok) return brand;
  if (next.isOrderable) {
    if (!next.isActive) return invalid('INVALID_ORDERABLE_STATUS', 'Inactive products cannot be orderable');
    if (await productRepo.countActiveSellableVariantsForProduct(client, { productId: existing.id, installationId }) === 0) return invalid('INVALID_ORDERABLE_STATUS', 'Product cannot be orderable without an active sellable SKU');
  }
  if (!next.isActive && existing.is_active) {
    const activeSkuCount = await productRepo.countActiveVariantsForProduct(client, { productId: existing.id, installationId });
    if (activeSkuCount > 0) {
      return activeDependentsConflict({
        message: 'Không thể ngưng hoạt động sản phẩm vì còn SKU đang hoạt động. Hãy ngưng hoạt động các SKU của sản phẩm trước rồi thử lại.',
        reason: 'PRODUCT_HAS_ACTIVE_SKUS',
        dependentType: 'product_variant',
        dependentLabel: 'SKU đang hoạt động',
        count: activeSkuCount,
        managementPath: '/products',
        action: 'deactivate_skus_first',
      });
    }
  }
  const product = await productRepo.updateProduct(client, { id: existing.id, installationId, ...next, updatedBy, expectedUpdatedAt: expected.value });
  if (!product) return staleVersionConflict({ entityLabel: 'Sản phẩm', managementPath: '/products' });
  return { ok: true, product, beforeData: existing, changed: true, action: next.isActive === existing.is_active ? 'update' : (next.isActive ? 'activate' : 'deactivate') };
}

export async function createProductVariant(client, { installationId, productId, payload, createdBy }) {
  if (!validUuid(productId)) return invalid('INVALID_PRODUCT_ID', 'Product ID must be a valid UUID');
  const product = await productRepo.getProductByIdForInstallationForUpdate(client, { id: productId.trim(), installationId });
  if (!product) return invalid('PRODUCT_NOT_FOUND', 'Product not found');
  const validation = validateProductVariantInput(payload);
  if (!validation.ok) return validation;
  const next = validation.normalized;
  if (next.isActive && !product.is_active) return invalid('PRODUCT_INACTIVE', 'Cannot create an active SKU under an inactive product');
  if (await variantRepo.getProductVariantBySku(client, { installationId, sku: next.sku })) return invalid('DUPLICATE_SKU', 'SKU already exists');
  if (next.isInventoryBase && next.isActive && await variantRepo.countActiveInventoryBaseVariantsForProduct(client, { installationId, productId: product.id }) > 0) return domainConflict({ message: 'Mỗi sản phẩm chỉ được có một SKU gốc tồn kho đang hoạt động.', reason: 'ACTIVE_INVENTORY_BASE_SKU_EXISTS', managementPath: '/products' });
  const variant = await variantRepo.insertProductVariant(client, { installationId, productId: product.id, ...next, createdBy });
  if (!variant) return next.isInventoryBase ? domainConflict({ message: 'Mỗi sản phẩm chỉ được có một SKU gốc tồn kho đang hoạt động.', reason: 'ACTIVE_INVENTORY_BASE_SKU_EXISTS', managementPath: '/products' }) : invalid('DUPLICATE_SKU', 'SKU already exists');
  return aliases('variant', variant);
}

export async function listProductVariants(client, { installationId, productId }) {
  if (!validUuid(productId)) return invalid('INVALID_PRODUCT_ID', 'Product ID must be a valid UUID');
  const product = await productRepo.getProductByIdForInstallation(client, { id: productId.trim(), installationId });
  if (!product) return invalid('PRODUCT_NOT_FOUND', 'Product not found');
  return { ok: true, variants: await variantRepo.listProductVariantsForProduct(client, { installationId, productId: product.id }) };
}

export async function updateProductVariant(client, { productId, variantId, installationId, payload, updatedBy }) {
  if (!validUuid(productId) || !validUuid(variantId)) return invalid('INVALID_ID', 'Product and variant IDs must be valid UUIDs');
  const product = await productRepo.getProductByIdForInstallationForUpdate(client, { id: productId.trim(), installationId });
  if (!product) return invalid('PRODUCT_NOT_FOUND', 'Product not found');
  const existing = await variantRepo.getProductVariantByIdForInstallationForUpdate(client, { id: variantId.trim(), installationId });
  if (!existing || existing.product_id !== product.id) return invalid('VARIANT_NOT_FOUND', 'Product variant not found');
  if (Object.prototype.hasOwnProperty.call(payload ?? {}, 'sku') && code(payload.sku) !== existing.sku) return invalid('IMMUTABLE_SKU', 'SKU is immutable');
  const expected = expectedUpdatedAt(payload?.expectedUpdatedAt);
  if (!expected.ok) return expected;
  if (dateTime(existing.updated_at) !== expected.value) return staleVersionConflict({ entityLabel: 'SKU', managementPath: '/products' });
  const validation = validateProductVariantInput(payload ?? {}, { skuRequired: false, defaults: {
    sku: existing.sku, name: existing.name, variantKind: existing.variant_kind,
    isInventoryBase: existing.is_inventory_base, isSellable: existing.is_sellable,
    isCatalogVisible: existing.is_catalog_visible, isActive: existing.is_active,
  } });
  if (!validation.ok) return validation;
  const next = validation.normalized;
  if (next.isActive && !product.is_active) return invalid('PRODUCT_INACTIVE', 'Cannot activate an SKU under an inactive product');
  if (next.isInventoryBase && next.isActive && await variantRepo.countActiveInventoryBaseVariantsForProduct(client, { installationId, productId: product.id, excludeVariantId: existing.id }) > 0) return domainConflict({ message: 'Mỗi sản phẩm chỉ được có một SKU gốc tồn kho đang hoạt động.', reason: 'ACTIVE_INVENTORY_BASE_SKU_EXISTS', managementPath: '/products' });
  if (product.is_orderable && !(next.isActive && next.isSellable)) {
    const remaining = await variantRepo.countActiveSellableVariantsForProductExcludingVariant(client, { installationId, productId: product.id, excludeVariantId: existing.id });
    if (remaining === 0) return invalid('INVALID_ORDERABLE_STATUS', 'Product cannot remain orderable without an active sellable SKU');
  }
  const variant = await variantRepo.updateProductVariant(client, { id: existing.id, installationId, ...next, updatedBy, expectedUpdatedAt: expected.value });
  if (!variant) return staleVersionConflict({ entityLabel: 'SKU', managementPath: '/products' });
  return aliases('variant', variant, { beforeData: existing, changed: true, action: next.isActive === existing.is_active ? 'update' : (next.isActive ? 'activate' : 'deactivate') });
}

function requireExplicitImportBooleans(row, keys, label) {
  for (const key of keys) {
    if (typeof row[key] !== 'boolean') return invalid('INVALID_IMPORT_PAYLOAD', `${label}.${key} must be an explicit boolean`);
  }
  return { ok: true };
}

export async function importProducts(client, { installationId, payload, createdBy }) {
  if (!payload || typeof payload !== 'object' || !Array.isArray(payload.products)) return invalid('INVALID_IMPORT_PAYLOAD', 'Import payload must contain a products array');
  if (payload.products.length > MAX_IMPORT_PRODUCTS) return invalid('IMPORT_TOO_LARGE', `Import cannot exceed ${MAX_IMPORT_PRODUCTS} products`);

  const rows = [];
  const seenCodes = new Set();
  const seenSkus = new Set();
  for (const raw of payload.products) {
    if (!raw || typeof raw !== 'object' || Array.isArray(raw) || !Array.isArray(raw.variants)) return invalid('INVALID_IMPORT_PAYLOAD', 'Every import product must include a variants array');
    const productBooleans = requireExplicitImportBooleans(raw, ['isCatalogVisible', 'isOrderable', 'isActive'], 'product');
    if (!productBooleans.ok) return productBooleans;
    const productValidation = validateProductInput(raw);
    if (!productValidation.ok) return productValidation;
    const row = { id: optionalUuid(raw.id), ...productValidation.normalized, variants: [] };
    if (row.id && !validUuid(row.id)) return invalid('INVALID_PRODUCT_ID', 'Import product ID must be a valid UUID');
    if (seenCodes.has(row.code)) return invalid('DUPLICATE_CODE', 'Duplicate product code in import payload');
    seenCodes.add(row.code);
    for (const rawVariant of raw.variants) {
      const variantBooleans = requireExplicitImportBooleans(rawVariant, ['isInventoryBase', 'isSellable', 'isCatalogVisible', 'isActive'], 'variant');
      if (!variantBooleans.ok) return variantBooleans;
      const variantValidation = validateProductVariantInput(rawVariant);
      if (!variantValidation.ok) return variantValidation;
      const variant = { id: optionalUuid(rawVariant.id), ...variantValidation.normalized };
      if (variant.id && !validUuid(variant.id)) return invalid('INVALID_VARIANT_ID', 'Import variant ID must be a valid UUID');
      if (seenSkus.has(variant.sku)) return invalid('DUPLICATE_SKU', 'Duplicate SKU in import payload');
      seenSkus.add(variant.sku);
      row.variants.push(variant);
    }
    if (row.variants.filter((variant) => variant.isActive && variant.isInventoryBase).length > 1) return domainConflict({ message: 'Mỗi sản phẩm chỉ được có một SKU gốc tồn kho đang hoạt động.', reason: 'ACTIVE_INVENTORY_BASE_SKU_EXISTS', managementPath: '/products' });
    if (row.isOrderable && (!row.isActive || !row.variants.some((variant) => variant.isActive && variant.isSellable))) return invalid('INVALID_ORDERABLE_STATUS', 'Orderable import products require an active sellable SKU');
    if (!row.isActive && row.variants.some((variant) => variant.isActive)) return activeDependentsConflict({ message: 'Không thể import sản phẩm ngưng hoạt động khi còn SKU đang hoạt động trong cùng payload.', reason: 'IMPORT_PRODUCT_HAS_ACTIVE_SKUS', dependentType: 'product_variant', dependentLabel: 'SKU đang hoạt động', count: 1, managementPath: '/products', action: 'deactivate_skus_first' });
    rows.push(row);
  }

  const existingProducts = await productRepo.getProductsByIdsOrCodes(client, {
    installationId,
    ids: rows.filter((row) => row.id).map((row) => row.id),
    codes: rows.map((row) => row.code),
  });
  const productsById = new Map(existingProducts.map((item) => [item.id, item]));
  const productsByCode = new Map(existingProducts.map((item) => [item.code, item]));
  const existingProductIds = [];
  for (const row of rows) {
    const byId = row.id ? productsById.get(row.id) : null;
    const byCode = productsByCode.get(row.code);
    if (byId && byId.code !== row.code) return invalid('IMMUTABLE_CODE', 'Import product code does not match its immutable ID');
    if (row.id && byCode && byCode.id !== row.id) return invalid('CONFLICTING_PRODUCT_ID', 'Product code is bound to a different ID');
    row.existingProductId = byId?.id ?? byCode?.id ?? null;
    if (row.existingProductId) existingProductIds.push(row.existingProductId);
  }

  const incomingVariantIds = rows.flatMap((row) => row.variants.filter((variant) => variant.id).map((variant) => variant.id));
  const incomingSkus = rows.flatMap((row) => row.variants.map((variant) => variant.sku));
  const existingVariants = await variantRepo.getProductVariantsByIdsOrSkus(client, { installationId, ids: incomingVariantIds, skus: incomingSkus });
  const variantsById = new Map(existingVariants.map((item) => [item.id, item]));
  const variantsBySku = new Map(existingVariants.map((item) => [item.sku, item]));
  const productVariants = await variantRepo.listProductVariantsForProducts(client, { installationId, productIds: existingProductIds });
  const activeExistingByProduct = new Map();
  for (const variant of productVariants) {
    if (!variant.is_active) continue;
    const list = activeExistingByProduct.get(variant.product_id) ?? [];
    list.push(variant);
    activeExistingByProduct.set(variant.product_id, list);
  }

  for (const row of rows) {
    const incomingSkuSet = new Set(row.variants.map((variant) => variant.sku));
    for (const existing of activeExistingByProduct.get(row.existingProductId) ?? []) {
      if (!incomingSkuSet.has(existing.sku)) return invalid('IMPORT_VARIANT_SNAPSHOT_INCOMPLETE', 'Import must include every active SKU for an existing product');
    }
    for (const variant of row.variants) {
      const byId = variant.id ? variantsById.get(variant.id) : null;
      const bySku = variantsBySku.get(variant.sku);
      if (byId && byId.sku !== variant.sku) return invalid('IMMUTABLE_SKU', 'Import SKU does not match its immutable ID');
      if (variant.id && bySku && bySku.id !== variant.id) return invalid('CONFLICTING_VARIANT_ID', 'SKU is bound to a different variant ID');
      const existing = byId ?? bySku ?? null;
      if (existing && row.existingProductId && existing.product_id !== row.existingProductId) return invalid('VARIANT_PRODUCT_MISMATCH', 'SKU belongs to a different product');
      variant.existing = existing;
    }
  }

  let imported = 0;
  let created = 0;
  let updated = 0;
  for (const row of rows) {
    let existing = row.existingProductId
      ? await productRepo.getProductByIdForInstallationForUpdate(client, { id: row.existingProductId, installationId })
      : null;
    const category = await resolveCategory(client, { installationId, categoryId: row.categoryId });
    if (!category.ok) return category;
    const brand = await resolveBrand(client, { installationId, brandId: row.brandId });
    if (!brand.ok) return brand;

    let product;
    if (existing) {
      product = await productRepo.updateProduct(client, {
        ...row,
        id: existing.id,
        installationId,
        isOrderable: existing.is_orderable,
        isActive: existing.is_active,
        updatedBy: createdBy,
        expectedUpdatedAt: existing.updated_at,
      });
      if (!product) return staleVersionConflict({ entityLabel: 'Sản phẩm import', managementPath: '/products' });
      updated += 1;
    } else {
      product = await productRepo.insertProduct(client, {
        id: row.id,
        installationId,
        ...row,
        isOrderable: false,
        isActive: true,
        createdBy,
      });
      if (!product) return invalid('DUPLICATE_CODE', 'Product code or ID already exists');
      created += 1;
    }

    for (const variantRow of row.variants) {
      const current = variantRow.existing;
      if (current) {
        if (current.product_id !== product.id) return invalid('VARIANT_PRODUCT_MISMATCH', 'SKU belongs to a different product');
        const variant = await variantRepo.updateProductVariant(client, {
          ...variantRow,
          id: current.id,
          installationId,
          updatedBy: createdBy,
          expectedUpdatedAt: current.updated_at,
        });
        if (!variant) return staleVersionConflict({ entityLabel: 'SKU import', managementPath: '/products' });
      } else {
        const variant = await variantRepo.insertProductVariant(client, {
          id: variantRow.id,
          installationId,
          productId: product.id,
          ...variantRow,
          createdBy,
        });
        if (!variant) return invalid('DUPLICATE_SKU', 'SKU or variant ID already exists');
      }
    }

    existing = await productRepo.getProductByIdForInstallationForUpdate(client, { id: product.id, installationId });
    const finalized = await productRepo.updateProduct(client, {
      ...row,
      id: product.id,
      installationId,
      updatedBy: createdBy,
      expectedUpdatedAt: existing.updated_at,
    });
    if (!finalized) return staleVersionConflict({ entityLabel: 'Sản phẩm import', managementPath: '/products' });
    imported += 1;
  }

  return { ok: true, imported, created, updated };
}
