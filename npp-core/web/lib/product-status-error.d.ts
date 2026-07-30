export function normalizeProductStatusError(
  error: { code?: string; message?: string; details?: unknown } | null | undefined,
  fallback?: string,
): string;
