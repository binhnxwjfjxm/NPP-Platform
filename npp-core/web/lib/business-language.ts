export const COMPANY_LABEL = 'Công Ty';

export function salesOrderSourceLabel(sourceType?: string | null, sourceId?: string | null): string {
  const normalizedType = String(sourceType ?? '').trim().toUpperCase();
  const normalizedId = String(sourceId ?? '').trim().toUpperCase();
  if (normalizedType === 'MCP') return 'Nhân viên thị trường';
  if (normalizedType === 'API' && normalizedId.startsWith('CUSTOMER_PORTAL')) return 'Khách hàng';
  return COMPANY_LABEL;
}

const PRICING_RESOLUTION_REASON_LABELS: Readonly<Record<string, string>> = Object.freeze({
  LOWER_PRIORITY_EXCLUSIVE: 'Đã có mức ưu tiên cao hơn được áp dụng',
  OUTSIDE_EFFECTIVE_WINDOW: 'Chưa đến hoặc đã qua thời gian áp dụng',
  QUANTITY_NOT_ELIGIBLE: 'Số lượng chưa đáp ứng điều kiện áp dụng',
  CUSTOMER_NOT_ELIGIBLE: 'Khách hàng chưa thuộc phạm vi áp dụng',
  CHANNEL_NOT_ELIGIBLE: 'Kênh bán chưa thuộc phạm vi áp dụng',
});

export function pricingResolutionReasonLabel(reason?: string | null): string {
  const normalized = String(reason ?? '').trim().toUpperCase();
  if (!normalized) return '';
  return PRICING_RESOLUTION_REASON_LABELS[normalized] ?? 'Không áp dụng do điều kiện giá hiện tại';
}

export function pricingPolicyLabel(code?: string | null, type?: string | null): string {
  const normalizedCode = String(code ?? '').trim();
  if (normalizedCode) return normalizedCode;
  const normalizedType = String(type ?? '').trim().toUpperCase();
  if (normalizedType === 'BASE') return 'Giá nền';
  if (normalizedType === 'PROMOTION') return 'Khuyến mãi';
  if (normalizedType === 'CHANNEL') return 'Giá theo kênh';
  if (normalizedType === 'CUSTOMER_GROUP') return 'Giá theo nhóm khách';
  if (normalizedType === 'CUSTOMER') return 'Giá theo khách hàng';
  return 'Chính sách giá';
}
