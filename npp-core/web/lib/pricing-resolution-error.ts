type PricingErrorPayload = {
  error?: {
    code?: string;
    message?: string;
    retryable?: boolean;
    details?: unknown;
  };
  requestId?: string;
};

const RESOLUTION_MESSAGES: Record<string, string> = {
  BASE_PRICE_NOT_FOUND: 'SKU này chưa có giá nền VND đang hiệu lực. Hãy mở tab Giá theo SKU để thiết lập giá nền rồi kiểm tra lại.',
  CUSTOMER_GROUP_MISMATCH: 'Khách hàng không thuộc nhóm khách đã chọn. Hãy bỏ nhóm khách hoặc chọn nhóm phù hợp.',
  VARIANT_UNIT_MISSING: 'SKU chưa có đơn vị bán hoặc quy đổi hợp lệ. Hãy mở Đơn vị & quy đổi để hoàn tất thiết lập.',
  VARIANT_NOT_PRICEABLE: 'SKU hiện chưa đủ điều kiện bán. Hãy kiểm tra trạng thái bán hàng, đơn vị và quy đổi của SKU.',
  CHANNEL_NOT_FOUND: 'Kênh bán đã chọn không còn hoạt động. Hãy chọn một kênh bán khác.',
  CUSTOMER_NOT_FOUND: 'Khách hàng đã chọn không còn hoạt động hoặc không tồn tại. Hãy chọn lại khách hàng.',
  CUSTOMER_GROUP_NOT_FOUND: 'Nhóm khách đã chọn không còn hoạt động hoặc không tồn tại. Hãy chọn lại nhóm khách.',
};

export function pricingResolutionMessage(code: unknown, fallback: unknown): string {
  const normalizedCode = String(code ?? '').trim().toUpperCase();
  const mapped = RESOLUTION_MESSAGES[normalizedCode];
  if (mapped) return mapped;
  const normalizedFallback = String(fallback ?? '').trim();
  return normalizedFallback || 'Không thể xác định giá áp dụng. Vui lòng kiểm tra lại dữ liệu đã chọn.';
}

export async function normalizePricingResolutionResponse(response: Response): Promise<Response> {
  if (response.ok) return response;

  let payload: PricingErrorPayload;
  try {
    payload = await response.clone().json() as PricingErrorPayload;
  } catch {
    return response;
  }

  if (!payload.error) return response;
  const message = pricingResolutionMessage(payload.error.code, payload.error.message);
  if (message === payload.error.message) return response;

  const headers = new Headers(response.headers);
  headers.delete('content-length');
  headers.set('content-type', 'application/json; charset=utf-8');

  return new Response(JSON.stringify({
    ...payload,
    error: {
      ...payload.error,
      message,
    },
  }), {
    status: response.status,
    statusText: response.statusText,
    headers,
  });
}
