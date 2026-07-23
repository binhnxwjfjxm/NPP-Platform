function object(value) {
  return value && typeof value === "object" && !Array.isArray(value) ? value : {};
}

function providerBusinessCode(error) {
  const normalized = String(error?.providerMessage || "").trim().toLowerCase();
  return /^[a-z][a-z0-9_]{2,127}$/.test(normalized) ? normalized : null;
}

export function normalizeIdempotencyProviderError(error) {
  const code = providerBusinessCode(error);
  if (!code || !code.startsWith("idempotency_")) return false;

  error.code = code;

  if (code === "idempotency_key_required" || code === "idempotency_record_id_required") {
    error.statusCode = 400;
  } else if (code === "idempotency_key_conflict") {
    error.statusCode = 409;
    error.publicRetryable = false;
  } else if (code === "idempotency_in_progress") {
    const parsed = Number.parseInt(String(error?.providerDetails || "2"), 10);
    const retryAfterSeconds = Number.isInteger(parsed) && parsed > 0 ? Math.min(parsed, 300) : 2;
    error.statusCode = 409;
    error.publicRetryable = true;
    error.publicDetails = { retryAfterSeconds };
  } else if (code === "idempotency_response_too_large") {
    error.statusCode = 500;
  } else {
    error.statusCode = Number(error.statusCode || 500);
  }

  return true;
}

export function unwrapIdempotentMutationResult(value) {
  const result = object(value);
  const metadata = object(result.meta);
  const idempotency = object(metadata.idempotency);

  if (!Object.prototype.hasOwnProperty.call(result, "data") || !Object.keys(idempotency).length) {
    return { data: value, meta: null };
  }

  const originalRequestId = String(idempotency.originalRequestId || "").trim();

  return {
    data: result.data,
    meta: {
      idempotency: {
        replayed: idempotency.replayed === true,
        ...(originalRequestId ? { originalRequestId: originalRequestId.slice(0, 128) } : {})
      }
    }
  };
}
