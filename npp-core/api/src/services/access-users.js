import * as accessService from './access.js';

export function listUsers(client, options) {
  return accessService.listUsers(client, options);
}

export function getUser(client, options) {
  return accessService.getUser(client, options);
}

export function createUser(client, options) {
  const payload = options?.payload;
  if (payload && typeof payload === 'object' && Object.prototype.hasOwnProperty.call(payload, 'roleIds')) {
    return Promise.resolve({
      ok: false,
      code: 'INVALID_INPUT',
      message: 'Vai trò phải được gán qua endpoint chuyên biệt',
      retryable: false,
    });
  }
  return accessService.createUser(client, options);
}

export function updateUserStatus(client, options) {
  return accessService.updateUserStatus(client, options);
}

export function replaceUserRoles(client, options) {
  return accessService.replaceUserRoles(client, options);
}
