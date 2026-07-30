export const DEACTIVATE_CONFLICT_CODES = Object.freeze({
  activeDependents: 'ACTIVE_DEPENDENTS',
  staleVersion: 'STALE_VERSION',
  domainConflict: 'DOMAIN_CONFLICT',
});

function nonNegativeCount(value) {
  const count = Number(value);
  return Number.isFinite(count) && count > 0 ? Math.trunc(count) : 0;
}

function safeDetails(details) {
  return details && typeof details === 'object' && !Array.isArray(details) ? details : {};
}

function legacyDomainCode(reason) {
  if (reason === 'PARENT_BRANCH_INACTIVE') return 'BRANCH_INACTIVE';
  if (reason === 'PARENT_WAREHOUSE_INACTIVE') return 'WAREHOUSE_INACTIVE';
  return 'CONFLICT';
}

export function activeDependentsConflict({
  code = 'CANNOT_DEACTIVATE',
  message,
  reason,
  dependentType,
  dependentLabel,
  count,
  managementPath,
  action,
}) {
  return Object.freeze({
    ok: false,
    code,
    message,
    retryable: false,
    details: Object.freeze({
      conflictCode: DEACTIVATE_CONFLICT_CODES.activeDependents,
      conflictType: 'active_dependents',
      reason,
      action,
      dependency: Object.freeze({
        entityType: dependentType,
        label: dependentLabel,
        count: nonNegativeCount(count),
        managementPath,
      }),
    }),
  });
}

export function staleVersionConflict({
  code = 'CONFLICT',
  entityLabel,
  managementPath,
} = {}) {
  const label = entityLabel || 'Bản ghi';
  return Object.freeze({
    ok: false,
    code,
    message: `${label} đã được cập nhật bởi phiên khác. Vui lòng tải lại dữ liệu rồi thử lại.`,
    retryable: false,
    details: Object.freeze({
      conflictCode: DEACTIVATE_CONFLICT_CODES.staleVersion,
      conflictType: 'stale_version',
      reason: 'EXPECTED_UPDATED_AT_MISMATCH',
      action: 'refresh_and_retry',
      managementPath: managementPath ?? null,
    }),
  });
}

export function domainConflict({
  code,
  message,
  reason,
  managementPath = null,
  details = {},
}) {
  return Object.freeze({
    ok: false,
    code: code || legacyDomainCode(reason),
    message,
    retryable: false,
    details: Object.freeze({
      conflictCode: DEACTIVATE_CONFLICT_CODES.domainConflict,
      conflictType: 'domain_conflict',
      reason,
      action: 'resolve_domain_conflict',
      managementPath,
      ...safeDetails(details),
    }),
  });
}
