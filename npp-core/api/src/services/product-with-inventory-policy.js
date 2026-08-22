import * as productService from './product.js';
import * as inventoryPolicyService from './product-inventory-policy.js';

function invalidPolicy() {
  return Object.freeze({
    ok: false,
    code: 'INVALID_INVENTORY_POLICY',
    message: 'Quản lý tồn kho phải được chọn hoặc bỏ chọn rõ ràng',
    retryable: false,
    details: {},
  });
}

function requestedPolicy(payload, fallback = true) {
  if (!Object.prototype.hasOwnProperty.call(payload ?? {}, 'isInventoryManaged')) {
    return Object.freeze({ ok: true, present: false, value: fallback });
  }
  if (typeof payload.isInventoryManaged !== 'boolean') return invalidPolicy();
  return Object.freeze({ ok: true, present: true, value: payload.isInventoryManaged });
}

function mergeProduct(product, policy, updatedAt = product?.updated_at) {
  return Object.freeze({
    ...product,
    is_inventory_managed: policy === true,
    updated_at: updatedAt ?? product?.updated_at,
  });
}

export async function listProducts(client, args) {
  const base = await productService.listProducts(client, args);
  if (!base.ok) return base;
  const policies = await inventoryPolicyService.listProductInventoryPolicies(client, {
    installationId: args.installationId,
  });
  if (!policies.ok) return policies;
  const byId = new Map(policies.products.map((product) => [product.id, product]));
  return Object.freeze({
    ...base,
    products: Object.freeze(base.products.map((product) => {
      const policy = byId.get(product.id);
      return mergeProduct(product, policy?.isInventoryManaged ?? true, product.updated_at);
    })),
  });
}

export async function getProduct(client, args) {
  const base = await productService.getProduct(client, args);
  if (!base.ok) return base;
  const policy = await inventoryPolicyService.getProductInventoryPolicy(client, {
    installationId: args.installationId,
    id: args.id,
  });
  if (!policy.ok) return policy;
  return Object.freeze({
    ...base,
    product: mergeProduct(base.product, policy.product.isInventoryManaged, base.product.updated_at),
  });
}

export async function createProduct(client, { installationId, payload, createdBy }) {
  const requested = requestedPolicy(payload, true);
  if (!requested.ok) return requested;

  const base = await productService.createProduct(client, { installationId, payload, createdBy });
  if (!base.ok) return base;

  let policyManaged = true;
  let finalUpdatedAt = base.product.updated_at;
  if (requested.present && requested.value === false) {
    const policy = await inventoryPolicyService.updateProductInventoryPolicy(client, {
      installationId,
      id: base.product.id,
      payload: {
        isInventoryManaged: false,
        expectedUpdatedAt: base.product.updated_at,
      },
      updatedBy: createdBy,
    });
    if (!policy.ok) return policy;
    policyManaged = policy.product.isInventoryManaged;
    finalUpdatedAt = policy.product.updatedAt;
  }

  const product = mergeProduct(base.product, policyManaged, finalUpdatedAt);
  return Object.freeze({ ...base, product, afterData: product });
}

export async function updateProduct(client, { id, installationId, payload, updatedBy }) {
  const currentPolicy = await inventoryPolicyService.getProductInventoryPolicy(client, { installationId, id });
  if (!currentPolicy.ok) return currentPolicy;
  const requested = requestedPolicy(payload, currentPolicy.product.isInventoryManaged);
  if (!requested.ok) return requested;

  const base = await productService.updateProduct(client, { id, installationId, payload, updatedBy });
  if (!base.ok) return base;

  let finalManaged = currentPolicy.product.isInventoryManaged;
  let finalUpdatedAt = base.product.updated_at;
  let policyChanged = false;
  if (requested.value !== currentPolicy.product.isInventoryManaged) {
    const policy = await inventoryPolicyService.updateProductInventoryPolicy(client, {
      installationId,
      id,
      payload: {
        isInventoryManaged: requested.value,
        expectedUpdatedAt: base.product.updated_at,
      },
      updatedBy,
    });
    if (!policy.ok) return policy;
    finalManaged = policy.product.isInventoryManaged;
    finalUpdatedAt = policy.product.updatedAt;
    policyChanged = policy.changed === true;
  }

  const product = mergeProduct(base.product, finalManaged, finalUpdatedAt);
  const beforeData = mergeProduct(base.beforeData, currentPolicy.product.isInventoryManaged, base.beforeData?.updated_at);
  return Object.freeze({
    ...base,
    product,
    beforeData,
    afterData: product,
    changed: base.changed !== false || policyChanged,
  });
}

export const productWithInventoryPolicyInternals = Object.freeze({
  requestedPolicy,
  mergeProduct,
});