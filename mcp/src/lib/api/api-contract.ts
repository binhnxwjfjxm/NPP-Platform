import { randomUUID } from "node:crypto";

const REQUEST_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._:-]{7,127}$/;
const ERROR_CODE_PATTERN = /^[A-Z][A-Z0-9_]{2,127}$/;
const FORBIDDEN_DETAIL_KEY = /(authorization|token|secret|password|credential|api[-_]?key|url|table|column|schema|query|sql|stack|provider|supabase|postgres|postgrest)/i;

const PUBLIC_MESSAGES: Record<string, string> = {
  BACKEND_UNAVAILABLE: "Backend tạm thời không khả dụng.",
  BACKEND_PROXY_CONFIG_INVALID: "Cấu hình kết nối backend chưa hợp lệ.",
  PROVIDER_UNAVAILABLE: "Dịch vụ dữ liệu tạm thời không khả dụng.",
  UPSTREAM_UNAVAILABLE: "Dịch vụ xử lý tạm thời không khả dụng.",
  UPSTREAM_TIMEOUT: "Dịch vụ xử lý quá thời gian chờ.",
  UPSTREAM_RESPONSE_INVALID: "Dịch vụ xử lý trả về dữ liệu không hợp lệ.",
  REPORT_AGENT_UNAVAILABLE: "MCP Report Agent tạm thời không khả dụng.",
  REPORT_AGENT_TIMEOUT: "MCP Report Agent quá thời gian chờ.",
  REPORT_AGENT_REJECTED: "MCP Report Agent không thể hoàn tất phân tích.",
  REPORT_ANALYSIS_FAILED: "Không thể hoàn tất phân tích báo cáo.",
  SESSION_ID_REQUIRED: "Thiếu sessionId để xử lý báo cáo.",
  SESSION_REPORT_SNAPSHOT_REQUIRED: "Báo cáo phiên chưa có snapshot chính thức.",
  INTERNAL_ERROR: "Đã xảy ra lỗi nội bộ."
};

export type CanonicalApiError = {
  code: string;
  message: string;
  details: Record<string, unknown>;
  retryable: boolean;
};

export type CanonicalApiSuccess<T> = {
  data: T;
  receivedAt: string;
  requestId: string;
};

export type CanonicalApiFailure = {
  error: CanonicalApiError;
  receivedAt: string;
  requestId: string;
};

type ResponseOptions = {
  requestId: string;
  status?: number;
  receivedAt?: string;
  headers?: HeadersInit;
};

type ErrorResponseOptions = ResponseOptions & {
  message?: string;
  details?: Record<string, unknown>;
  retryable?: boolean;
};

function text(value: unknown) {
  return String(value ?? "").trim();
}

function object(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function responseHeaders(requestId: string, headers?: HeadersInit) {
  const output = new Headers(headers);
  output.set("Cache-Control", "no-store");
  output.set("X-Request-Id", requestId);
  return output;
}

function statusFallbackMessage(status: number) {
  if (status === 400) return "Yêu cầu không hợp lệ.";
  if (status === 401) return "Chưa được xác thực.";
  if (status === 403) return "Không có quyền truy cập.";
  if (status === 404) return "Không tìm thấy tài nguyên.";
  if (status === 405) return "Phương thức không được hỗ trợ.";
  if (status === 409) return "Dữ liệu đang xung đột với trạng thái hiện tại.";
  if (status === 413) return "Nội dung request vượt quá giới hạn.";
  if (status === 429) return "Có quá nhiều yêu cầu. Vui lòng thử lại sau.";
  if (status === 502 || status === 503) return "Dịch vụ tạm thời không khả dụng.";
  if (status === 504) return "Dịch vụ xử lý quá thời gian chờ.";
  return PUBLIC_MESSAGES.INTERNAL_ERROR;
}

function normalizeErrorCode(value: unknown, status: number) {
  const normalized = text(value)
    .replace(/([a-z0-9])([A-Z])/g, "$1_$2")
    .replace(/[^A-Za-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .toUpperCase()
    .slice(0, 128);

  const aliases: Record<string, string> = {
    SUPABASE_READ_FAILED: "PROVIDER_UNAVAILABLE",
    SUPABASE_INSERT_FAILED: "PROVIDER_UNAVAILABLE",
    SUPABASE_UPDATE_FAILED: "PROVIDER_UNAVAILABLE",
    SUPABASE_COUNT_FAILED: "PROVIDER_UNAVAILABLE",
    SUPABASE_RPC_FAILED: "PROVIDER_UNAVAILABLE",
    PROVIDER_REQUEST_FAILED: "PROVIDER_UNAVAILABLE",
    LEGACY_UPSTREAM_TIMEOUT: "UPSTREAM_TIMEOUT",
    BACKEND_UNAVAILABLE: "BACKEND_UNAVAILABLE"
  };

  const candidate = aliases[normalized] || normalized;
  if (status >= 500) {
    const safe = new Set([
      "BACKEND_UNAVAILABLE",
      "BACKEND_PROXY_CONFIG_INVALID",
      "PROVIDER_UNAVAILABLE",
      "UPSTREAM_UNAVAILABLE",
      "UPSTREAM_TIMEOUT",
      "UPSTREAM_RESPONSE_INVALID",
      "REPORT_AGENT_UNAVAILABLE",
      "REPORT_AGENT_TIMEOUT",
      "REPORT_AGENT_REJECTED",
      "REPORT_ANALYSIS_FAILED"
    ]);
    return safe.has(candidate) ? candidate : "INTERNAL_ERROR";
  }

  if (ERROR_CODE_PATTERN.test(candidate)) return candidate;
  if (status === 400) return "BAD_REQUEST";
  if (status === 401) return "UNAUTHORIZED";
  if (status === 403) return "FORBIDDEN";
  if (status === 404) return "NOT_FOUND";
  if (status === 405) return "METHOD_NOT_ALLOWED";
  if (status === 409) return "CONFLICT";
  return "INTERNAL_ERROR";
}

function sanitizeValue(value: unknown, depth: number): unknown {
  if (depth > 4 || value === undefined) return undefined;
  if (value === null || typeof value === "number" || typeof value === "boolean") return value;
  if (typeof value === "string") return value.slice(0, 1000);
  if (Array.isArray(value)) {
    return value
      .slice(0, 50)
      .map((item) => sanitizeValue(item, depth + 1))
      .filter((item) => item !== undefined);
  }
  if (typeof value !== "object") return undefined;

  const output: Record<string, unknown> = {};
  for (const [key, item] of Object.entries(value as Record<string, unknown>)) {
    if (FORBIDDEN_DETAIL_KEY.test(key)) continue;
    const safe = sanitizeValue(item, depth + 1);
    if (safe !== undefined) output[key] = safe;
  }
  return output;
}

export function sanitizeApiDetails(value: unknown): Record<string, unknown> {
  const result = sanitizeValue(object(value), 0);
  return result && typeof result === "object" && !Array.isArray(result)
    ? (result as Record<string, unknown>)
    : {};
}

export function normalizeApiRequestId(value: unknown) {
  const candidate = text(value);
  return REQUEST_ID_PATTERN.test(candidate) ? candidate : `req_${randomUUID()}`;
}

export function apiSuccessResponse<T>(data: T, options: ResponseOptions) {
  const receivedAt = options.receivedAt || new Date().toISOString();
  const payload: CanonicalApiSuccess<T> = { data, receivedAt, requestId: options.requestId };
  return Response.json(payload, {
    status: options.status || 200,
    headers: responseHeaders(options.requestId, options.headers)
  });
}

export function apiErrorResponse(code: string, options: ErrorResponseOptions) {
  const status = options.status || 500;
  const normalizedCode = normalizeErrorCode(code, status);
  const payload: CanonicalApiFailure = {
    error: {
      code: normalizedCode,
      message: PUBLIC_MESSAGES[normalizedCode] || options.message || statusFallbackMessage(status),
      details: sanitizeApiDetails(options.details),
      retryable: options.retryable ?? [502, 503, 504].includes(status)
    },
    receivedAt: options.receivedAt || new Date().toISOString(),
    requestId: options.requestId
  };

  return Response.json(payload, {
    status,
    headers: responseHeaders(options.requestId, options.headers)
  });
}

export function apiFailureFromPayload(payload: unknown) {
  const value = object(payload);
  const error = object(value.error);
  return {
    code: text(error.code || value.error || value.message),
    message: text(error.message),
    details: sanitizeApiDetails(error.details),
    retryable: typeof error.retryable === "boolean" ? error.retryable : undefined
  };
}

export async function canonicalizeUpstreamResponse(response: Response, fallbackRequestId: string) {
  const requestId = normalizeApiRequestId(
    response.headers.get("x-request-id") || fallbackRequestId
  );
  const rawText = await response.text();
  let payload: unknown = null;

  if (rawText) {
    try {
      payload = JSON.parse(rawText) as unknown;
    } catch {
      return apiErrorResponse("UPSTREAM_RESPONSE_INVALID", {
        requestId,
        status: 502,
        retryable: true
      });
    }
  }

  const value = object(payload);
  const receivedAt = text(value.receivedAt) || new Date().toISOString();
  const failed = response.status >= 400 || value.ok === false || ("error" in value && !("data" in value));

  if (failed) {
    const failure = apiFailureFromPayload(value);
    return apiErrorResponse(failure.code || "UPSTREAM_UNAVAILABLE", {
      requestId,
      receivedAt,
      status: response.status >= 400 ? response.status : 502,
      message: failure.message || undefined,
      details: failure.details,
      retryable: failure.retryable
    });
  }

  const data = Object.prototype.hasOwnProperty.call(value, "data") ? value.data : payload;
  return apiSuccessResponse(data, {
    requestId,
    receivedAt,
    status: response.status === 204 ? 200 : response.status
  });
}
