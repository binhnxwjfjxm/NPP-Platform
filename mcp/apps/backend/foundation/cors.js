export function resolveCorsOrigin(req, allowedOrigins) {
  const value = req.headers.origin;
  const origin = Array.isArray(value) ? value[0] : String(value ?? "").trim();
  if (!origin) return null;
  if (!allowedOrigins.includes(origin)) {
    const error = new Error("cors_origin_denied");
    error.statusCode = 403;
    throw error;
  }
  return origin;
}

export function corsHeaders(origin) {
  const headers = {
    Vary: "Origin",
    "Access-Control-Allow-Methods": "GET, POST, PATCH, DELETE, OPTIONS",
    "Access-Control-Allow-Headers": "Accept, Authorization, Content-Type, Idempotency-Key, X-Request-Id",
    "Access-Control-Max-Age": "600"
  };
  if (origin) headers["Access-Control-Allow-Origin"] = origin;
  return headers;
}
