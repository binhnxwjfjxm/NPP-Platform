import type { DeliveryUser } from './types';

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const LOGIN_PATTERN = /^[A-Za-z0-9._-]{2,128}$/;
const INTERNAL_IDENTITY_VERSION = 'v2';

export function encodeDeliveryInternalAuthorization(user: DeliveryUser): string {
  if (!LOGIN_PATTERN.test(user.username) || !UUID_PATTERN.test(user.employeeId) || !user.displayName.trim()) {
    throw new Error('DELIVERY_USER_INVALID');
  }
  const payload = [
    INTERNAL_IDENTITY_VERSION,
    user.username,
    user.employeeId,
    encodeURIComponent(user.displayName.trim()),
  ].join('|');
  return `Basic ${btoa(payload)}`;
}

export function authenticateDeliveryUser(authorization: string | null): DeliveryUser | null {
  if (!authorization?.startsWith('Basic ')) return null;
  try {
    const decoded = atob(authorization.slice(6));
    const [version, username, employeeId, encodedDisplayName, ...extra] = decoded.split('|');
    if (version !== INTERNAL_IDENTITY_VERSION || extra.length || !LOGIN_PATTERN.test(username) || !UUID_PATTERN.test(employeeId)) {
      return null;
    }
    const displayName = decodeURIComponent(encodedDisplayName || '').trim();
    if (!displayName || displayName.length > 160) return null;
    return Object.freeze({ username, employeeId, displayName });
  } catch {
    return null;
  }
}

// Phase 9.9 removes the legacy setup/user JSON path. Driver provisioning is now
// canonical Core user/employee/role/scope data and is evaluated by Core on every request.
export function deliverySetupPending(): boolean {
  return false;
}

export function deliveryAuthConfigured(): boolean {
  return Boolean(process.env.CORE_API_INTERNAL_URL?.trim());
}
