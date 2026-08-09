import { PERMISSIONS } from '../access/permissions.js';
import { listTrackingPolicyCandidates } from '../db/repositories/inventory-tracking-policy-candidates.js';

function failure(code, message) {
  return Object.freeze({ ok: false, code, message, retryable: false });
}

export async function listInventoryTrackingPolicyCandidates(client, {
  requestContext,
  search = null,
  limit = 500,
  offset = 0,
}) {
  if (!Array.isArray(requestContext?.permissions)
      || !requestContext.permissions.includes(PERMISSIONS.coreInventoryTrackingPolicyRead)) {
    return failure('PERMISSION_DENIED', 'Permission core.inventory.tracking-policy.read is required');
  }
  const candidates = await listTrackingPolicyCandidates(client, {
    installationId: requestContext.installationId,
    search,
    limit,
    offset,
  });
  return Object.freeze({ ok: true, candidates: Object.freeze(candidates) });
}
