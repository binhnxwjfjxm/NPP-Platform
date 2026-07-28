export type InventoryTrackingPolicy = {
  installation_id: string;
  base_variant_id: string;
  lot_tracking_mode: 'NONE' | 'REQUIRED';
  expiry_tracking_mode: 'NONE' | 'OPTIONAL' | 'REQUIRED';
  location_required: boolean;
  version: number;
  created_at: string;
  created_by: string | null;
  updated_at: string;
  updated_by: string | null;
  base_sku: string;
  base_variant_name: string | null;
  base_variant_active: boolean;
  is_inventory_base: boolean;
  product_code: string;
  product_name: string;
};

export type InventoryLot = {
  id: string;
  installation_id: string;
  base_variant_id: string;
  lot_code: string;
  normalized_lot_code: string;
  manufactured_date: string | null;
  expiry_date: string | null;
  supplier_lot_reference: string | null;
  metadata: Record<string, unknown>;
  created_at: string;
  created_by: string | null;
  base_sku: string;
  base_variant_name: string | null;
  base_variant_active: boolean;
  is_inventory_base: boolean;
  product_code: string;
  product_name: string;
};

export type InventoryBalance = {
  installation_id: string;
  warehouse_id: string;
  warehouse_code: string;
  warehouse_name: string;
  location_id: string | null;
  location_code: string | null;
  location_name: string | null;
  base_variant_id: string;
  base_sku: string;
  base_variant_name: string | null;
  lot_id: string | null;
  lot_code: string | null;
  expiry_date: string | null;
  on_hand_quantity: string;
  reserved_quantity: string;
  available_quantity: string;
  movement_count?: number | string | null;
};

export type InventoryMovementLine = {
  id?: string;
  movement_id?: string;
  warehouse_id: string;
  location_id: string | null;
  base_variant_id: string;
  base_sku?: string | null;
  lot_id: string | null;
  lot_code: string | null;
  expiry_date: string | null;
  direction: 'IN' | 'OUT';
  source_quantity: string;
  base_quantity_delta: string;
  source_line_reference: string | null;
};

export type OpeningBalanceImportRow = {
  id?: string;
  import_id?: string;
  line_number: number;
  warehouse_id: string;
  location_id: string | null;
  source_variant_id: string;
  source_sku: string | null;
  source_unit_id: string | null;
  source_unit_code: string | null;
  source_quantity: string;
  conversion_to_base: string;
  base_variant_id: string;
  base_sku: string | null;
  base_quantity: string;
  lot_id: string | null;
  lot_code: string | null;
  expiry_date: string | null;
  source_line_reference: string | null;
  metadata: Record<string, unknown>;
};

export type OpeningBalanceImport = {
  id: string;
  installation_id: string;
  source_key: string;
  source_filename: string | null;
  content_checksum: string;
  payload_hash: string;
  status: string;
  document_date: string;
  movement_id: string | null;
  row_count: number;
  source_quantity_total: string;
  base_quantity_total: string;
  created_at: string;
  created_by: string | null;
  request_id: string;
  metadata: Record<string, unknown>;
};

export type InventorySnapshot = {
  trackingPolicies: InventoryTrackingPolicy[];
  lots: InventoryLot[];
  balances: InventoryBalance[];
  openingBalances: OpeningBalanceImport[];
  checkedAt: string;
};

export const INVENTORY_Lot_TRACKING_MODES = ['NONE', 'REQUIRED'] as const;
export const INVENTORY_EXPIRY_TRACKING_MODES = ['NONE', 'OPTIONAL', 'REQUIRED'] as const;

export const inventoryTabs = [
  { href: '/inventory/balances', label: 'Tra cứu tồn kho', hint: 'Số lượng hiện tại, đang giữ, khả dụng và vị trí hàng' },
  { href: '/inventory/tracking-policies', label: 'Chính sách quản lý lô', hint: 'Quy định lô, hạn sử dụng và vị trí hàng' },
  { href: '/inventory/lots', label: 'Lô hàng', hint: 'Mã lô, ngày sản xuất và hạn sử dụng' },
  { href: '/inventory/opening-balances', label: 'Thiết lập tồn đầu kỳ', hint: 'Dùng một lần khi bắt đầu hoặc chuyển dữ liệu cũ' },
] as const;

export function createEmptyInventorySnapshot(checkedAt = new Date().toISOString()): InventorySnapshot {
  return {
    trackingPolicies: [],
    lots: [],
    balances: [],
    openingBalances: [],
    checkedAt,
  };
}

export function normalizeSearch(value: string): string {
  return value.trim().toLowerCase().replace(/\s+/g, ' ');
}

export function matchTerm(...values: Array<string | null | undefined>): string {
  return values
    .flatMap((value) => (value ? String(value).split(/\s+/g) : []))
    .join(' ')
    .toLowerCase();
}

export function upperCode(value: string): string {
  return String(value ?? '').trim().toUpperCase();
}

export function formatDate(value: string | null | undefined): string {
  if (!value) return 'Không có';
  const date = new Date(`${value}T00:00:00Z`);
  if (Number.isNaN(date.getTime())) return value;
  return new Intl.DateTimeFormat('vi-VN', { dateStyle: 'medium', timeZone: 'UTC' }).format(date);
}

export function formatDateTime(value: string | null | undefined): string {
  if (!value) return 'Không có';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return new Intl.DateTimeFormat('vi-VN', { dateStyle: 'medium', timeStyle: 'short', timeZone: 'Asia/Ho_Chi_Minh' }).format(date);
}

export function formatCompactNumber(value: number): string {
  return new Intl.NumberFormat('vi-VN', { maximumFractionDigits: 0 }).format(value);
}

export function formatQuantity(value: string | null | undefined): string {
  return value ?? '0';
}
