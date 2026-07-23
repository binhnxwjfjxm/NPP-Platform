import {
  apiErrorResponse,
  canonicalizeUpstreamResponse,
  normalizeApiRequestId
} from "@/lib/api/api-contract";

const DEVELOPMENT_BACKEND_API_BASE_URL = "http://127.0.0.1:3001";

function text(value: unknown) {
  return String(value ?? "").trim();
}

function requiredServerEnv(name: string) {
  const value = text(process.env[name]);
  if (!value) throw new Error(`missing_${name.toLowerCase()}`);
  return value;
}

function normalizeHttpBaseUrl(value: string, name: string) {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new Error(`invalid_${name.toLowerCase()}`);
  }
  if (!/^https?:$/.test(url.protocol)) {
    throw new Error(`invalid_${name.toLowerCase()}`);
  }
  return url.toString().replace(/\/+$/, "");
}

export function backendApiBaseUrl() {
  const configured = text(process.env.BACKEND_API_BASE_URL);
  if (configured) return normalizeHttpBaseUrl(configured, "BACKEND_API_BASE_URL");
  if (process.env.NODE_ENV !== "production") return DEVELOPMENT_BACKEND_API_BASE_URL;
  throw new Error("missing_backend_api_base_url");
}

type BackendHeaderOptions = {
  hasBody?: boolean;
  contentType?: string;
  requestId?: string;
  idempotencyKey?: string;
};

export function backendApiRequestHeaders(
  request?: Request,
  options: BackendHeaderOptions = {}
) {
  const requestId = normalizeApiRequestId(
    options.requestId || request?.headers.get("x-request-id")
  );
  const headers: Record<string, string> = {
    Accept: "application/json",
    "X-Backend-Token": requiredServerEnv("BACKEND_API_TOKEN"),
    "X-Request-Id": requestId,
    "X-Actor-Id": requiredServerEnv("MCP_LEGACY_ACTOR_ID"),
    "X-Actor-Type": "service",
    "X-Actor-Authentication": "backend-token"
  };

  if (options.hasBody) {
    headers["Content-Type"] =
      options.contentType || request?.headers.get("content-type") || "application/json";
  }

  const authorization = request?.headers.get("authorization");
  if (authorization) headers.Authorization = authorization;

  const idempotencyKey = options.idempotencyKey || request?.headers.get("idempotency-key");
  if (idempotencyKey) headers["Idempotency-Key"] = idempotencyKey;

  return { headers, requestId };
}

export async function proxyBackendRequest(
  request: Request,
  path: string,
  method = request.method
) {
  const requestId = normalizeApiRequestId(request.headers.get("x-request-id"));

  try {
    const sourceUrl = new URL(request.url);
    const targetUrl = new URL(path, `${backendApiBaseUrl()}/`);

    sourceUrl.searchParams.forEach((value, key) => {
      targetUrl.searchParams.append(key, value);
    });

    const upperMethod = method.toUpperCase();
    const hasBody = upperMethod !== "GET" && upperMethod !== "HEAD";
    const body = hasBody ? await request.text() : undefined;
    const { headers } = backendApiRequestHeaders(request, {
      requestId,
      hasBody: Boolean(body),
      contentType: request.headers.get("content-type") || undefined
    });

    const response = await fetch(targetUrl, {
      method: upperMethod,
      cache: "no-store",
      headers,
      body: body || undefined
    });

    return canonicalizeUpstreamResponse(response, requestId);
  } catch (error) {
    const reason = error instanceof Error ? error.message : "backend_unavailable";
    const configFailure = reason.startsWith("missing_") || reason.startsWith("invalid_");
    return apiErrorResponse(
      configFailure ? "BACKEND_PROXY_CONFIG_INVALID" : "BACKEND_UNAVAILABLE",
      {
        requestId,
        status: configFailure ? 500 : 502,
        retryable: !configFailure
      }
    );
  }
}
