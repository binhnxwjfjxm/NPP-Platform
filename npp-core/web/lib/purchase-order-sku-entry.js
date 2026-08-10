export const MIN_PURCHASE_ORDER_SKU_SEARCH_LENGTH = 2;

export const PURCHASE_ORDER_SKU_FILTERS = Object.freeze({
  eligible: 'eligible',
  setup: 'setup',
  all: 'all',
});

export const PURCHASE_ORDER_BULK_TEMPLATE_FILENAME = 'mau-nhap-don-dat-hang.xlsx';
export const PURCHASE_ORDER_BULK_TEMPLATE_MIME = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';

export function normalizePurchaseOrderSkuSearchFailure(error) {
  const code = String(error?.code ?? '').trim();
  const message = String(error?.message ?? '').trim();
  if (code === 'PURCHASE_ORDER_NOT_FOUND') {
    return Object.freeze({
      code: 'PURCHASE_ORDER_SKU_SEARCH_UNAVAILABLE',
      message: 'Chức năng tìm SKU chưa được cập nhật đồng bộ với máy chủ. Vui lòng thử lại sau khi hệ thống hoàn tất cập nhật.',
      statusCode: 503,
      retryable: true,
    });
  }
  return Object.freeze({
    code: code || 'PURCHASE_ORDER_SKU_SEARCH_FAILED',
    message: message || 'Không tải được danh sách SKU mua hàng.',
    statusCode: Number(error?.statusCode) || 500,
    retryable: error?.retryable === true,
  });
}

export function filterPurchaseOrderSkuOptions(options, filter = PURCHASE_ORDER_SKU_FILTERS.eligible) {
  const rows = Array.isArray(options) ? options : [];
  if (filter === PURCHASE_ORDER_SKU_FILTERS.all) return rows;
  if (filter === PURCHASE_ORDER_SKU_FILTERS.setup) return rows.filter((option) => option?.eligibility?.selectable !== true);
  return rows.filter((option) => option?.eligibility?.selectable === true);
}

export function groupPurchaseOrderSkuOptions(options) {
  const groups = new Map();
  for (const option of Array.isArray(options) ? options : []) {
    const key = String(option?.productId ?? option?.productCode ?? 'unknown');
    const current = groups.get(key) ?? {
      productId: option?.productId ?? key,
      productCode: option?.productCode ?? '',
      productName: option?.productName ?? '',
      options: [],
    };
    current.options.push(option);
    groups.set(key, current);
  }
  return [...groups.values()].sort((left, right) => String(left.productCode).localeCompare(String(right.productCode)));
}
