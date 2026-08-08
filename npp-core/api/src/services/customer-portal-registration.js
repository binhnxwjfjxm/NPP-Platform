import { createHash } from 'node:crypto';
import * as portalRepository from '../db/repositories/customer-portal.js';

function failure(code, message, statusCode = 400, retryable = false, details = {}) {
  return Object.freeze({ ok: false, code, message, statusCode, retryable, details });
}

export function createPortalRegistrationRequestContext(createContext, config, subject, { requestId, receivedAt }) {
  const digest = createHash('sha256').update(String(subject ?? '')).digest('hex');
  return createContext({
    config,
    requestId,
    receivedAt,
    principal: {
      actorId: `portal-subject:${digest}`,
      roles: ['customer-portal-registration'],
      permissions: [],
      scopes: { warehouseIds: [] },
      sourceApp: 'customer-ordering',
    },
  });
}

export async function resolvePortalIdentity(client, { installationId, subject, forUpdate = false }) {
  const identity = await portalRepository.getPortalIdentityBySubject(client, {
    installationId,
    provider: 'CLERK',
    providerSubject: subject,
    forUpdate,
  });
  if (!identity) return Object.freeze({ ok: true, identity: null });
  if (identity.portal_user_status !== 'ACTIVE') {
    return failure('CUSTOMER_PORTAL_ACCOUNT_SUSPENDED', 'Tài khoản Customer Portal hiện không hoạt động.', 403);
  }
  return Object.freeze({ ok: true, identity });
}

export async function ensurePortalIdentity(client, {
  requestContext,
  subject,
  displayName,
}) {
  const identity = await portalRepository.ensurePortalIdentity(client, {
    installationId: requestContext.installationId,
    provider: 'CLERK',
    providerSubject: subject,
    displayName,
    actorId: requestContext.actorId,
  });
  if (identity.portal_user_status !== 'ACTIVE') {
    return failure('CUSTOMER_PORTAL_ACCOUNT_SUSPENDED', 'Tài khoản Customer Portal hiện không hoạt động.', 403);
  }
  return Object.freeze({ ok: true, identity });
}

export async function resolvePortalMembershipByUser(client, { installationId, portalUserId }) {
  const membership = await portalRepository.getActiveMembershipByPortalUser(client, {
    installationId,
    portalUserId,
  });
  return Object.freeze({ ok: true, membership });
}

export function registrationState({ identity, membership, request }) {
  if (!identity) return 'unregistered';
  if (membership) return 'active_customer';
  if (!request) return 'unregistered';
  if (request.status === 'approved' || request.status === 'linked_existing') return 'activation_pending';
  return request.status;
}

export function publicRegistration(request) {
  if (!request) return null;
  return Object.freeze({
    id: request.id,
    status: request.status,
    version: request.version,
    proposedCustomer: request.proposedCustomer,
    reviewReason: request.reviewReason ?? null,
    submittedAt: request.submittedAt,
    updatedAt: request.updatedAt,
  });
}
