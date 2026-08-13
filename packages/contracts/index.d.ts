export const IDEMPOTENCY_KEY_MAX_LENGTH: 128;
export const IDEMPOTENCY_KEY_PATTERN: RegExp;

export function normalizeIdempotencyKey(value: unknown): string | null;
export function isValidIdempotencyKey(value: unknown): boolean;
export function normalizeIdempotencyOperation(value: unknown): string;
export function createIdempotencyKey(operation: unknown, uuid?: string): string;

export function createSuccessEnvelope<T>(
  data: T,
  requestId: string,
  receivedAt: string,
): { data: T; requestId: string; receivedAt: string };

export function createErrorEnvelope(
  error: {
    code: string;
    message: string;
    details?: unknown;
    retryable?: boolean;
  },
  requestId: string,
  receivedAt: string,
): {
  error: { code: string; message: string; details: unknown; retryable: boolean };
  requestId: string;
  receivedAt: string;
};
