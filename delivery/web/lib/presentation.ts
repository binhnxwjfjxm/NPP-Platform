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
  const fallback = Object.values(address)
    .filter((value): value is string => typeof value === 'string' && Boolean(value.trim()))
    .map((value) => value.trim());
  return fallback.length > 0 ? [...new Set(fallback)].join(', ') : 'Chưa có địa chỉ';
}

export function safeErrorMessage(error: unknown): string {
  const code = error instanceof Error ? error.message : '';
  if (code === 'DELIVERY_DRIVER_PROFILE_NOT_FOUND') {
    return 'Tài khoản chưa được liên kết với hồ sơ tài xế đang hoạt động.';
  }
  if (code === 'DELIVERY_TRIP_NOT_FOUND') return 'Chuyến không tồn tại hoặc không được giao cho tài khoản này.';
  if (code === 'DELIVERY_CORE_CONFIG_NOT_READY') return 'Kết nối hệ thống giao hàng chưa được cấu hình.';
  return 'Dữ liệu giao hàng tạm thời chưa khả dụng. Vui lòng thử lại sau.';
}
