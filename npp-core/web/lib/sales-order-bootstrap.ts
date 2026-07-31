import 'server-only';

import type { Customer } from './customer-types';
import type { Product } from './product-types';
import type { Warehouse } from './organization-types';
import type { SalesOrder } from './sales-order-types';
import { listAllCustomers, normalizeCustomerGatewayError } from './customer-gateway';
import { loadOrganizationSnapshot } from './organization-snapshot';
import { listProducts, normalizeProductGatewayError } from './product-gateway';
import {
  listSalesOrders,
  normalizeSalesOrderGatewayError,
  resolveSalesOrderRequestId,
} from './sales-order-gateway';
import { loadSalesOrderPermissionKeys } from './sales-order-context';

export type SalesOrderBootstrap = {
  salesOrders: SalesOrder[];
  customers: Customer[];
  warehouses: Warehouse[];
  products: Product[];
  permissionKeys: string[];
  errors: {
    orders: string | null;
    customers: string | null;
    warehouses: string | null;
    products: string | null;
    permissions: string | null;
  };
  checkedAt: string;
};

export async function loadSalesOrderBootstrap(requestId?: string | null): Promise<SalesOrderBootstrap> {
  const normalizedRequestId = resolveSalesOrderRequestId(requestId);
  const [orders, customers, organization, products, permissions] = await Promise.allSettled([
    listSalesOrders<SalesOrder>(normalizedRequestId, { limit: 1000 }),
    listAllCustomers<Customer>(normalizedRequestId, new URLSearchParams({ active: 'true', limit: '1000' })),
    loadOrganizationSnapshot(),
    listProducts<Product>(normalizedRequestId, new URLSearchParams({ active: 'true', orderable: 'true', limit: '1000' })),
    loadSalesOrderPermissionKeys(normalizedRequestId),
  ]);

  return {
    salesOrders: orders.status === 'fulfilled' ? orders.value : [],
    customers: customers.status === 'fulfilled' ? customers.value : [],
    warehouses: organization.status === 'fulfilled'
      ? organization.value.warehouses.filter((warehouse) => warehouse.is_active)
      : [],
    products: products.status === 'fulfilled'
      ? products.value.filter((product) => product.is_active && product.is_orderable)
      : [],
    permissionKeys: permissions.status === 'fulfilled' ? permissions.value : [],
    errors: {
      orders: orders.status === 'rejected' ? normalizeSalesOrderGatewayError(orders.reason).publicMessage : null,
      customers: customers.status === 'rejected' ? normalizeCustomerGatewayError(customers.reason).publicMessage : null,
      warehouses: organization.status === 'rejected' ? 'Không tải được danh sách kho bán hàng' : null,
      products: products.status === 'rejected' ? normalizeProductGatewayError(products.reason).publicMessage : null,
      permissions: permissions.status === 'rejected' ? 'Không tải được quyền bán hàng' : null,
    },
    checkedAt: new Date().toISOString(),
  };
}
