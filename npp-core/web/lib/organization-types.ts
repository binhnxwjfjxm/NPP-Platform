export type OrganizationResourceKey = 'branches' | 'warehouses' | 'locations';

export type Branch = {
  id: string;
  installation_id: string;
  code: string;
  name: string;
  address: string | null;
  phone: string | null;
  email: string | null;
  is_active: boolean;
  created_at: string;
  updated_at: string;
  created_by: string | null;
  updated_by: string | null;
};

export type Warehouse = {
  id: string;
  installation_id: string;
  branch_id: string;
  code: string;
  name: string;
  warehouse_type: string;
  is_active: boolean;
  created_at: string;
  updated_at: string;
  created_by: string | null;
  updated_by: string | null;
};

export type WarehouseLocation = {
  id: string;
  installation_id: string;
  warehouse_id: string;
  code: string;
  name: string;
  location_type: string;
  is_active: boolean;
  created_at: string;
  updated_at: string;
  created_by: string | null;
  updated_by: string | null;
};

export type OrganizationSnapshot = {
  branches: Branch[];
  warehouses: Warehouse[];
  locations: WarehouseLocation[];
  checkedAt: string;
};

export function createEmptyOrganizationSnapshot(checkedAt = new Date().toISOString()): OrganizationSnapshot {
  return {
    branches: [],
    warehouses: [],
    locations: [],
    checkedAt,
  };
}

export type EntityBase = {
  id: string;
  code: string;
  name: string;
  is_active: boolean;
  updated_at: string;
};

export const organizationNav = [
  { href: '/dashboard', label: 'Tổng quan' },
  { href: '/organization', label: 'Tổ chức' },
  { href: '/organization/branches', label: 'Chi nhánh' },
  { href: '/organization/warehouses', label: 'Kho hàng' },
  { href: '/organization/locations', label: 'Vị trí kho' },
] as const;

export const warehouseTypes = ['main', 'distribution', 'vehicle', 'quarantine', 'returns', 'transit', 'other'] as const;
export const locationTypes = ['storage', 'receiving', 'shipping', 'quarantine', 'returns', 'damaged', 'other'] as const;

export function normalizeSearch(value: string): string {
  return value.trim().toLowerCase();
}

export function formatDateTime(value: string | null | undefined): string {
  if (!value) return 'Chưa có';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return 'Không hợp lệ';
  return new Intl.DateTimeFormat('vi-VN', {
    dateStyle: 'medium',
    timeStyle: 'short',
    timeZone: 'Asia/Ho_Chi_Minh',
  }).format(date);
}

export function formatDateOnly(value: string | null | undefined): string {
  if (!value) return 'Chưa có';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return 'Không hợp lệ';
  return new Intl.DateTimeFormat('vi-VN', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
  }).format(date);
}

export function formatCompactNumber(value: number): string {
  return new Intl.NumberFormat('vi-VN').format(value);
}

export function toUpperCode(value: string): string {
  return value.trim().toUpperCase();
}

export function matchTerm(...parts: Array<string | null | undefined>): string {
  return parts
    .map((part) => part?.trim() ?? '')
    .filter(Boolean)
    .join(' ')
    .toLowerCase();
}
