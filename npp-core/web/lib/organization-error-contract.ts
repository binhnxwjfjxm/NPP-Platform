export type OrganizationErrorPayload = {
  code?: unknown;
  details?: unknown;
};

function readConflictCode(details: unknown) {
  if (!details || typeof details !== 'object' || Array.isArray(details)) return null;
  const value = (details as Record<string, unknown>).conflictCode;
  return typeof value === 'string' && value.trim() ? value.trim() : null;
}

export function resolveOrganizationErrorCode(
  error: OrganizationErrorPayload | null | undefined,
  fallback = 'ORGANIZATION_REQUEST_FAILED',
) {
  const outerCode = typeof error?.code === 'string' && error.code.trim()
    ? error.code.trim()
    : fallback;
  const conflictCode = readConflictCode(error?.details);
  if (outerCode === 'CONFLICT' && conflictCode === 'STALE_VERSION') return 'STALE_VERSION';
  return outerCode;
}
