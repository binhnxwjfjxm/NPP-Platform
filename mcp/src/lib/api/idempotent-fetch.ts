const RETRYABLE_STATUSES = new Set([502, 503, 504]);
const MUTATION_METHODS = new Set(["POST", "PUT", "PATCH", "DELETE"]);

type IdempotentMutationOptions = {
  operation: string;
  key?: string;
  retries?: number;
};

function operationPrefix(value: string) {
  const normalized = value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9._:-]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80);
  if (!normalized) throw new Error("idempotency_operation_required");
  return normalized;
}

function randomPart() {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return crypto.randomUUID();
  }

  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 14)}`;
}

export function createIdempotencyKey(operation: string) {
  return `${operationPrefix(operation)}:${randomPart()}`.slice(0, 192);
}

function sleep(milliseconds: number) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

export async function idempotentMutationFetch(
  input: RequestInfo | URL,
  init: RequestInit,
  options: IdempotentMutationOptions
) {
  const method = String(init.method || "POST").toUpperCase();
  if (!MUTATION_METHODS.has(method)) throw new Error("idempotency_mutation_method_required");

  const idempotencyKey = options.key || createIdempotencyKey(options.operation);
  const headers = new Headers(init.headers);
  headers.set("Idempotency-Key", idempotencyKey);

  const retries = Math.max(0, Math.min(Math.trunc(options.retries ?? 1), 2));
  let lastError: unknown = null;

  for (let attempt = 0; attempt <= retries; attempt += 1) {
    try {
      const response = await fetch(input, {
        ...init,
        method,
        cache: "no-store",
        headers
      });

      if (RETRYABLE_STATUSES.has(response.status) && attempt < retries) {
        await sleep(100 * (attempt + 1));
        continue;
      }

      return response;
    } catch (error) {
      lastError = error;
      if (attempt >= retries) throw error;
      await sleep(100 * (attempt + 1));
    }
  }

  throw lastError instanceof Error ? lastError : new Error("idempotent_mutation_failed");
}
