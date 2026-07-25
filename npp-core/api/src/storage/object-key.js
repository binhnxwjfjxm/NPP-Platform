import { createStorageError, STORAGE_ERROR_CODES } from './errors.js';

function normalizeSegment(value, name) {
  const text = String(value ?? '').trim();
  if (!text) {
    throw createStorageError(STORAGE_ERROR_CODES.keyInvalid, `${name} is required to generate a storage key`, { statusCode: 400 });
  }
  if (text.includes('..')) {
    throw createStorageError(STORAGE_ERROR_CODES.keyInvalid, `${name} cannot contain path traversal`, { statusCode: 400 });
  }
  return encodeURIComponent(text);
}

export function buildR2ObjectKey({ installationId, namespace, objectName, version, suffix } = {}) {
  const installationSegment = normalizeSegment(installationId, 'installationId');
  const namespaceSegment = normalizeSegment(namespace, 'namespace');
  const objectSegment = normalizeSegment(objectName, 'objectName');

  const segments = [installationSegment, namespaceSegment, objectSegment];
  if (typeof version === 'string' && version.trim()) {
    segments.push(`v${encodeURIComponent(version.trim())}`);
  }

  let key = segments.join('/');
  if (typeof suffix === 'string' && suffix.trim()) {
    const suffixText = suffix.trim().replace(/^\.+/, '');
    if (suffixText) {
      key += `.${encodeURIComponent(suffixText)}`;
    }
  }

  if (key.length > 1024) {
    throw createStorageError(STORAGE_ERROR_CODES.keyInvalid, 'Storage key is too long', { statusCode: 400 });
  }

  return key;
}
