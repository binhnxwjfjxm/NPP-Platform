const FORBIDDEN_DETAIL_KEY = /(authorization|token|secret|password|credential|api[-_]?key|url|table|column|schema|query|sql|stack|provider|supabase|postgres|postgrest)/i;

const ERROR_ALIASES = new Map([
  ["SUPABASE_READ_FAILED", "PROVIDER_UNAVAILABLE"],
  ["SUPABASE_INSERT_FAILED", "PROVIDER_UNAVAILABLE"],
  ["SUPABASE_UPDATE_FAILED", "PROVIDER_UNAVAILABLE"],
  ["SUPABASE_COUNT_FAILED", "PROVIDER_UNAVAILABLE"],
  ["SUPABASE_RPC_FAILED", "PROVIDER_UNAVAILABLE"],
  ["EDGE_FUNCTION_FAILED", "PROVIDER_UNAVAILABLE"],
  ["PROVIDER_REQUEST_FAILED", "PROVIDER_UNAVAILABLE"],
  ["LEGACY_UPSTREAM_TIMEOUT", "UPSTREAM_TIMEOUT"],
  ["LEGACY_BACKEND_NOT_READY", "UPSTREAM_UNAVAILABLE"],
  ["BACKEND_UNAVAILABLE", "UPSTREAM_UNAVAILABLE"]
]);

const PUBLIC_MESSAGES = {
  BACKEND_AUTH_REQUIRED: "Yêu cầu xác thực backend.",
  CORS_ORIGIN_DENIED: "Origin không được phép truy cập.",
  INVALID_JSON_BODY: "Nội dung JSON không hợp lệ.",
  INVALID_IDEMPOTENCY_KEY: "Idempotency-Key không hợp lệ.",
  IDEMPOTENCY_KEY_REQUIRED: "Mutation này yêu cầu Idempotency-Key.",
  IDEMPOTENCY_KEY_CONFLICT: "Idempotency-Key đã được dùng cho nội dung khác.",
  IDEMPOTENCY_IN_PROGRESS: "Yêu cầu cùng Idempotency-Key đang được xử lý.",
  REQUEST_BODY_TOO_LARGE: "Nội dung request vượt quá giới hạn.",
  NOT_FOUND: "Không tìm thấy tài nguyên.",
  METHOD_NOT_ALLOWED: "Phương thức không được hỗ trợ.",
  PROVIDER_UNAVAILABLE: "Dịch vụ dữ liệu tạm thời không khả dụng.",
  UPSTREAM_TIMEOUT: "Dịch vụ xử lý quá thời gian chờ.",
  UPSTREAM_UNAVAILABLE: "Dịch vụ xử lý tạm thời không khả dụng.",
  UPSTREAM_RESPONSE_INVALID: "Dịch vụ xử lý trả về dữ liệu không hợp lệ.",
  INTERNAL_ERROR: "Đã xảy ra lỗi nội bộ."
};

function object(value) {
  return value && typeof value === "object" && !Array.isArray(value) ? value : {};
}

function statusCode(value, fallback = 500) {
  const parsed = Number(value || fallback);
  return Number.isInteger(parsed) && parsed >= 100 && parsed <= 599 ? parsed : fallback;
}

function normalizedCode(value) {
  const candidate = String(value ?? "")
    .trim()
    .replace(/([a-z0-9])([A-Z])/g, "$1_$2")
    .replace(/[^A-Za-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .toUpperCase();
  return candidate.slice(0, 128);
}

function fallbackCode(httpStatus) {
  if (httpStatus === 400) return "BAD_REQUEST";
  if (httpStatus === 401) return "UNAUTHORIZED";
  if (httpStatus === 403) return "FORBIDDEN";
  if (httpStatus === 404) return "NOT_FOUND";
  if (httpStatus === 405) return "METHOD_NOT_ALLOWED";
  if (httpStatus === 409) return "CONFLICT";
  if (httpStatus === 413) return "REQUEST_BODY_TOO_LARGE";
  if (httpStatus === 429) return "RATE_LIMITED";
  if (httpStatus === 502 || httpStatus === 503) return "UPSTREAM_UNAVAILABLE";
  if (httpStatus === 504) return "UPSTREAM_TIMEOUT";
  return "INTERNAL_ERROR";
}

export function canonicalErrorCode(value, httpStatus = 500) {
  const status = statusCode(httpStatus);
  const candidate = normalizedCode(value) || fallbackCode(status);
  const aliased = ERROR_ALIASES.get(candidate) || candidate;

  if (status >= 500) {
    const safeServerCodes = new Set([
      "PROVIDER_UNAVAILABLE",
      "UPSTREAM_TIMEOUT",
      "UPSTREAM_UNAVAILABLE",
      "UPSTREAM_RESPONSE_INVALID"
    ]);
    return safeServerCodes.has(aliased) ? aliased : "INTERNAL_ERROR";
  }

  return aliased;
}

function fallbackMessage(httpStatus) {
  if (httpStatus === 400) return "Yêu cầu không hợp lệ.";
  if (httpStatus === 401) return "Chưa được xác thực.";
  if (httpStatus === 403) return "Không có quyền truy cập.";
  if (httpStatus === 404) return "Không tìm thấy tài nguyên.";
  if (httpStatus === 405) return "Phương thức không được hỗ trợ.";
  if (httpStatus === 409) return "Dữ liệu đang xung đột với trạng thái hiện tại.";
  if (httpStatus === 413) return "Nội dung request vượt quá giới hạn.";
  if (httpStatus === 429) return "Có quá nhiều yêu cầu. Vui lòng thử lại sau.";
  if (httpStatus === 502 || httpStatus === 503) return "Dịch vụ tạm thời không khả dụng.";
  if (httpStatus === 504) return "Dịch vụ xử lý quá thời gian chờ.";
  return PUBLIC_MESSAGES.INTERNAL_ERROR;
}

function sanitizeValue(value, depth) {
  if (depth > 4 || value === undefined) return undefined;
  if (value === null || typeof value === "string" || typeof value === "number" || typeof value === "boolean") {
    return typeof value === "string" ? value.slice(0, 1000) : value;
  }
  if (Array.isArray(value)) {
    return value.slice(0, 50).map((item) => sanitizeValue(item, depth + 1)).filter((item) => item !== undefined);
  }
  if (typeof value !== "object") return undefined;

  const output = {};
  for (const [key, item] of Object.entries(value)) {
    if (FORBIDDEN_DETAIL_KEY.test(key)) continue;
    const safe = sanitizeValue(item, depth + 1);
    if (safe !== undefined) output[key] = safe;
  }
  return output;
}

export function sanitizePublicDetails(value) {
  const safe = sanitizeValue(object(value), 0);
  return safe && typeof safe === "object" && !Array.isArray(safe) ? safe : {};
}

function successMetadata(value) {
  const metadata = object(value);
  const idempotency = object(metadata.idempotency);
  if (!Object.keys(idempotency).length) return undefined;

  const originalRequestId = String(idempotency.originalRequestId || "").trim();
  return {
    idempotency: {
      replayed: idempotency.replayed === true,
      ...(originalRequestId ? { originalRequestId: originalRequestId.slice(0, 128) } : {})
    }
  };
}

export function canonicalSuccessPayload(
  data,
  { requestId, receivedAt = new Date().toISOString(), meta }
) {
  return {
    data,
    ...(meta ? { meta } : {}),
    receivedAt,
    requestId
  };
}

export function canonicalErrorPayload(
  error,
  { requestId, receivedAt = new Date().toISOString(), status: fallbackStatus }
) {
  const source = object(error);
  const nested = object(source.error);
  const httpStatus = statusCode(fallbackStatus || source.statusCode || source.status || nested.statusCode || 500);
  const rawCode = nested.code || source.code || source.message || source.error || fallbackCode(httpStatus);
  const code = canonicalErrorCode(rawCode, httpStatus);
  const explicitMessage = String(source.publicMessage || nested.message || "").trim();
  const mayUseExplicitMessage = httpStatus < 500 && /^[A-Z][A-Z0-9_]{2,127}$/.test(String(nested.code || source.code || ""));
  const message = PUBLIC_MESSAGES[code] || (mayUseExplicitMessage ? explicitMessage : "") || fallbackMessage(httpStatus);
  const details = sanitizePublicDetails(source.publicDetails || nested.details || source.details);
  const retryable =
    typeof source.publicRetryable === "boolean"
      ? source.publicRetryable
      : typeof nested.retryable === "boolean"
        ? nested.retryable
        : [502, 503, 504].includes(httpStatus);

  return {
    statusCode: httpStatus,
    payload: {
      error: { code, message, details, retryable },
      receivedAt,
      requestId
    }
  };
}

function successData(payload) {
  const value = object(payload);
  if (Object.prototype.hasOwnProperty.call(value, "data")) return value.data;
  if (!Object.keys(value).length && payload !== undefined) return payload;

  const output = { ...value };
  delete output.ok;
  delete output.meta;
  delete output.receivedAt;
  delete output.requestId;
  return output;
}

export function normalizeApiPayload(
  payload,
  { status = 200, requestId, receivedAt = new Date().toISOString() }
) {
  const httpStatus = statusCode(status, 200);
  const value = object(payload);
  const isFailure = httpStatus >= 400 || value.ok === false || ("error" in value && !("data" in value));

  if (isFailure) {
    const nested = object(value.error);
    return canonicalErrorPayload(
      {
        statusCode: httpStatus >= 400 ? httpStatus : 500,
        code: nested.code || (typeof value.error === "string" ? value.error : value.message),
        error: nested,
        publicDetails: nested.details,
        publicRetryable: nested.retryable
      },
      { requestId, receivedAt, status: httpStatus >= 400 ? httpStatus : 500 }
    );
  }

  return {
    statusCode: httpStatus === 204 ? 200 : httpStatus,
    payload: canonicalSuccessPayload(successData(payload), {
      requestId,
      receivedAt,
      meta: successMetadata(value.meta)
    })
  };
}

export function parseJsonPayload(text) {
  if (!text) return { ok: true, value: null };
  try {
    return { ok: true, value: JSON.parse(text) };
  } catch {
    return { ok: false, value: null };
  }
}
