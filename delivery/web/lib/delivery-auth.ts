import type { DeliveryUser } from './types';

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

type StoredUser = DeliveryUser & Readonly<{ password: string }>;

function constantTimeEqual(left: string, right: string): boolean {
  const maxLength = Math.max(left.length, right.length);
  let difference = left.length ^ right.length;
  for (let index = 0; index < maxLength; index += 1) {
    difference |= (left.charCodeAt(index) || 0) ^ (right.charCodeAt(index) || 0);
  }
  return difference === 0;
}

function parseBasicAuthorization(value: string | null): { username: string; password: string } | null {
  if (!value?.startsWith('Basic ')) return null;
  try {
    const decoded = Buffer.from(value.slice(6), 'base64').toString('utf8');
    const separator = decoded.indexOf(':');
    if (separator < 1) return null;
    return { username: decoded.slice(0, separator), password: decoded.slice(separator + 1) };
  } catch {
    return null;
  }
}

function readStoredUsers(raw = process.env.DELIVERY_WEB_USERS_JSON): readonly StoredUser[] {
  if (!raw?.trim()) throw new Error('DELIVERY_WEB_USERS_NOT_CONFIGURED');
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new Error('DELIVERY_WEB_USERS_INVALID_JSON');
  }
  if (!Array.isArray(parsed) || parsed.length === 0 || parsed.length > 500) {
    throw new Error('DELIVERY_WEB_USERS_INVALID');
  }
  const usernames = new Set<string>();
  const employees = new Set<string>();
  const users = parsed.map((entry) => {
    if (!entry || typeof entry !== 'object') throw new Error('DELIVERY_WEB_USER_INVALID');
    const value = entry as Record<string, unknown>;
    const username = String(value.username ?? '').trim();
    const password = String(value.password ?? '');
    const employeeId = String(value.employeeId ?? '').trim();
    const displayName = String(value.displayName ?? '').trim();
    if (!/^[A-Za-z0-9._-]{2,80}$/.test(username)
        || password.length < 12
        || !UUID_PATTERN.test(employeeId)
        || displayName.length < 1
        || displayName.length > 160) {
      throw new Error('DELIVERY_WEB_USER_INVALID');
    }
    if (usernames.has(username) || employees.has(employeeId)) {
      throw new Error('DELIVERY_WEB_USER_DUPLICATE');
    }
    usernames.add(username);
    employees.add(employeeId);
    return Object.freeze({ username, password, employeeId, displayName });
  });
  return Object.freeze(users);
}

export function deliverySetupPending(raw = process.env.DELIVERY_SETUP_MODE): boolean {
  return String(raw || '').trim().toLowerCase() === 'true';
}

export function authenticateDeliveryUser(
  authorization: string | null,
  rawUsers = process.env.DELIVERY_WEB_USERS_JSON,
): DeliveryUser | null {
  const supplied = parseBasicAuthorization(authorization);
  if (!supplied) return null;
  const user = readStoredUsers(rawUsers).find((candidate) => candidate.username === supplied.username);
  if (!user || !constantTimeEqual(user.password, supplied.password)) return null;
  return Object.freeze({
    username: user.username,
    employeeId: user.employeeId,
    displayName: user.displayName,
  });
}

export function deliveryAuthConfigured(rawUsers = process.env.DELIVERY_WEB_USERS_JSON): boolean {
  try {
    readStoredUsers(rawUsers);
    return true;
  } catch {
    return false;
  }
}

export const deliveryAuthInternals = Object.freeze({
  constantTimeEqual,
  parseBasicAuthorization,
  readStoredUsers,
});
