const ADDRESS_METADATA_KEYS = new Set([
  'customerPhone',
  'locationUrl',
  'latitude',
  'longitude',
  'lat',
  'lng',
]);

export function formatDateTime(value: string | null | undefined): string {
  if (!value) return 'Chưa có';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return 'Chưa có';
  return new Intl.DateTimeFormat('vi-VN', {
    timeZone: 'Asia/Ho_Chi_Minh',
    dateStyle: 'short',
    timeStyle: 'short',
  }).format(date);
}

export function formatAddress(address: Record<string, unknown> | null | undefined): string {
  if (!address) return 'Chưa có địa chỉ';
  const preferredKeys = [
    'line1', 'addressLine1', 'street', 'wardName', 'districtName', 'provinceName',
    'ward', 'district', 'province', 'city',
  ];
  const parts = preferredKeys
    .map((key) => address[key])
    .filter((value): value is string => typeof value === 'string' && Boolean(value.trim()))
    .map((value) => value.trim());
  const unique = [...new Set(parts)];
  if (unique.length > 0) return unique.join(', ');
  const fallback = Object.entries(address)
    .filter(([key]) => !ADDRESS_METADATA_KEYS.has(key))
    .map(([, value]) => value)
    .filter((value): value is string => typeof value === 'string' && Boolean(value.trim()))
    .map((value) => value.trim());
  return fallback.length > 0 ? [...new Set(fallback)].join(', ') : 'Chưa có địa chỉ';
}

export function customerPhoneFromSnapshot(address: Record<string, unknown> | null | undefined): string | null {
  const value = address?.customerPhone;
  if (typeof value !== 'string') return null;
  const normalized = value.trim();
  return normalized || null;
}

export function locationUrlFromSnapshot(address: Record<string, unknown> | null | undefined): string | null {
  const value = address?.locationUrl;
  if (typeof value !== 'string') return null;
  const normalized = value.trim();
  if (!normalized) return null;
  try {
    const parsed = new URL(normalized);
    if (parsed.protocol !== 'https:' || parsed.username || parsed.password) return null;
    return normalized;
  } catch {
    return null;
  }
}

export function formatCollectionPolicy(value: string | null | undefined): string {
  switch (value) {
    case 'PREPAID': return 'Đã thanh toán trước';
    case 'COLLECT_ON_DELIVERY': return 'Thu khi giao';
    case 'COLLECT_AFTER_DELIVERY': return 'Thu sau giao';
    case 'CREDIT_TERMS': return 'Công nợ theo hạn';
    case 'NO_COLLECTION': return 'Không thu tại điểm giao';
    default: return 'Theo phiếu giao';
  }
}

export function formatQuantity(value: string | null | undefined): string {
  if (!value) return '0';
  const normalized = value.replace(/\.0+$/, '').replace(/(\.\d*?)0+$/, '$1');
  return normalized || '0';
}

export function safeErrorMessage(error: unknown): string {
  const code = error instanceof Error ? error.message : '';
  if (code === 'DELIVERY_DRIVER_PROFILE_NOT_FOUND') {
    return 'Tài khoản chưa được liên kết với hồ sơ tài xế đang hoạt động.';
  }
  if (code === 'WAREHOUSE_SCOPE_DENIED') {
    return 'Tài khoản chưa được cấp phạm vi kho của chuyến. Quản trị viên cần cấp đúng kho giao hàng rồi đăng nhập lại.';
  }
  if (code === 'PERMISSION_DENIED') {
    return 'Tài khoản chưa có đủ quyền Giao hàng. Quản trị viên cần cấp vai trò Tài xế / Giao hàng rồi đăng nhập lại.';
  }
  if (code === 'DELIVERY_DRIVER_TRIPS_QUERY_FAILED' || code === 'DELIVERY_DRIVER_TRIP_QUERY_FAILED') {
    return 'Hệ thống chưa tải được dữ liệu chuyến từ Core. Vui lòng thử lại; nếu còn lỗi cần kiểm tra backend/migration.';
  }
  if (code === 'DELIVERY_TRIP_NOT_FOUND') return 'Chuyến không tồn tại hoặc không được giao cho tài khoản này.';
  if (code === 'DELIVERY_CORE_CONFIG_NOT_READY') return 'Kết nối hệ thống giao hàng chưa được cấu hình.';
  return 'Dữ liệu giao hàng tạm thời chưa khả dụng. Vui lòng thử lại sau.';
}
