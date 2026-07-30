import type { Product, ProductVariant } from '../../../lib/product-types';
import type { PurchaseOrderBootstrap } from '../../../lib/purchase-order-bootstrap';

type PurchaseOrderLookupState = Pick<PurchaseOrderBootstrap, 'suppliers' | 'warehouses' | 'products' | 'permissionKeys' | 'errors'>;

export function describePurchaseOrderLookupIssues(state: PurchaseOrderLookupState): string[] {
  const technicalIssues = [
    state.errors.suppliers,
    state.errors.warehouses,
    state.errors.products,
    state.errors.permissions,
  ].filter((value): value is string => Boolean(value));

  if (technicalIssues.length > 0) {
    return technicalIssues;
  }

  const issues: string[] = [];
  if (state.suppliers.length === 0) {
    issues.push('Chưa có nhà cung cấp hoạt động để tạo đơn đặt hàng.');
  }
  if (state.warehouses.length === 0) {
    issues.push('Chưa có kho nhận hoạt động để tạo đơn đặt hàng.');
  }
  if (state.products.length === 0) {
    issues.push('Chưa có sản phẩm mua hàng khả dụng để tạo đơn đặt hàng.');
  }
  if (state.permissionKeys.length === 0) {
    issues.push('Chưa nhận được quyền mua hàng từ backend. Tất cả hành động thay đổi dữ liệu đang bị khóa.');
  }
  return issues;
}

export function describePurchaseOrderSkuIssue(
  product: Pick<Product, 'code' | 'name'> | null,
  availableVariants: ProductVariant[],
  purchasableVariants: ProductVariant[],
): string | null {
  if (!product) return null;
  if (availableVariants.length === 0) {
    return `Sản phẩm ${product.code} — ${product.name} chưa có SKU nào để chọn.`;
  }
  if (purchasableVariants.length === 0) {
    return `Sản phẩm ${product.code} — ${product.name} chưa có SKU mua hàng hợp lệ (đơn vị/quy đổi).`;
  }
  return null;
}
