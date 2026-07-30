import 'server-only';

import type { PurchaseOrder } from './purchase-order-types';
import type { Supplier } from './supplier-types';
import type { Product } from './product-types';
import type { Warehouse } from './organization-types';
import {
  listPurchaseOrders,
  normalizePurchaseOrderGatewayError,
  resolvePurchaseOrderRequestId,
} from './purchase-order-gateway';
import { listAllSuppliers, normalizeSupplierGatewayError } from './supplier-gateway';
import { loadOrganizationSnapshot } from './organization-snapshot';
import { loadPurchaseOrderPermissionKeys } from './purchase-order-context';

export type PurchaseOrderBootstrapErrors = {
  orders: string | null;
  suppliers: string | null;
  warehouses: string | null;
  products: string | null;
  permissions: string | null;
};

export type PurchaseOrderBootstrap = {
  purchaseOrders: PurchaseOrder[];
  suppliers: Supplier[];
  warehouses: Warehouse[];
  products: Product[];
  permissionKeys: string[];
  errors: PurchaseOrderBootstrapErrors;
  checkedAt: string;
  lookupError: string | null;
};

function joinLabels(labels: string[]) {
  if (labels.length === 0) return '';
  if (labels.length === 1) return labels[0];
  if (labels.length === 2) return `${labels[0]} vÃ  ${labels[1]}`;
  return `${labels.slice(0, -1).join(', ')} vÃ  ${labels[labels.length - 1]}`;
}

function lookupErrorMessage(labels: string[]) {
  return labels.length
    ? `KhÃ´ng táº£i Ä‘Æ°á»£c dá»¯ liá»‡u ${joinLabels(labels)}. HÃ£y cáº­p nháº­t dá»¯ liá»‡u trÆ°á»›c khi thao tÃ¡c.`
    : null;
}

export async function loadPurchaseOrderBootstrap(requestId?: string | null): Promise<PurchaseOrderBootstrap> {
  const normalizedRequestId = resolvePurchaseOrderRequestId(requestId);
  const [
    ordersResult,
    suppliersResult,
    organizationResult,
    permissionsResult,
  ] = await Promise.allSettled([
    listPurchaseOrders<PurchaseOrder>(normalizedRequestId, { limit: 1000 }),
    listAllSuppliers<Supplier>(normalizedRequestId, new URLSearchParams({ active: 'true', limit: '1000' })),
    loadOrganizationSnapshot(),
    loadPurchaseOrderPermissionKeys(normalizedRequestId),
  ]);

  const lookupLabels = [
    suppliersResult.status === 'rejected' ? 'nhÃ  cung cáº¥p' : null,
    organizationResult.status === 'rejected' ? 'kho nháº­n' : null,
    permissionsResult.status === 'rejected' ? 'quyá»n mua hÃ ng' : null,
  ].filter((value): value is string => Boolean(value));

  return {
    purchaseOrders: ordersResult.status === 'fulfilled' ? ordersResult.value : [],
    suppliers: suppliersResult.status === 'fulfilled' ? suppliersResult.value : [],
    warehouses: organizationResult.status === 'fulfilled'
      ? organizationResult.value.warehouses.filter((warehouse) => warehouse.is_active)
      : [],
    products: [],
    permissionKeys: permissionsResult.status === 'fulfilled' ? permissionsResult.value : [],
    errors: {
      orders: ordersResult.status === 'rejected'
        ? normalizePurchaseOrderGatewayError(ordersResult.reason).publicMessage
        : null,
      suppliers: suppliersResult.status === 'rejected'
        ? normalizeSupplierGatewayError(suppliersResult.reason).publicMessage
        : null,
      warehouses: organizationResult.status === 'rejected'
        ? 'KhÃ´ng táº£i Ä‘Æ°á»£c dá»¯ liá»‡u kho nháº­n'
        : null,
      products: null,
      permissions: permissionsResult.status === 'rejected'
        ? 'KhÃ´ng táº£i Ä‘Æ°á»£c dá»¯ liá»‡u quyá»n mua hÃ ng'
        : null,
    },
    checkedAt: new Date().toISOString(),
    lookupError: lookupErrorMessage(lookupLabels),
  };
}
