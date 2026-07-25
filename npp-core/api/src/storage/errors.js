export const STORAGE_ERROR_CODES = Object.freeze({
  disabled: 'STORAGE_DISABLED',
  configuration: 'STORAGE_CONFIGURATION_INVALID',
  keyInvalid: 'STORAGE_KEY_INVALID',
  objectTooLarge: 'STORAGE_OBJECT_TOO_LARGE',
  objectNotFound: 'STORAGE_OBJECT_NOT_FOUND',
  uploadFailed: 'STORAGE_UPLOAD_FAILED',
  downloadFailed: 'STORAGE_DOWNLOAD_FAILED',
  deleteFailed: 'STORAGE_DELETE_FAILED',
  presignFailed: 'STORAGE_PRESIGN_FAILED',
  providerUnavailable: 'STORAGE_PROVIDER_UNAVAILABLE',
  auditCleanupFailed: 'STORAGE_AUDIT_CLEANUP_FAILED',
});

export class StorageError extends Error {
  constructor(code, publicMessage, { retryable = false, statusCode = 500, cause = null } = {}) {
    super(publicMessage);
    this.name = 'StorageError';
    this.code = code;
    this.publicMessage = publicMessage;
    this.retryable = retryable;
    this.statusCode = statusCode;
    if (cause) this.cause = cause;
  }
}

export function createStorageError(code, publicMessage, options = {}) {
  return new StorageError(code, publicMessage, options);
}

export function normalizeProviderError(error, fallbackCode, fallbackMessage) {
  if (!error) {
    return createStorageError(fallbackCode, fallbackMessage, { retryable: true, statusCode: 503 });
  }

  const statusCode = error?.$metadata?.httpStatusCode;
  if (statusCode === 404 || /NotFound|NoSuchKey/i.test(error.name) || /Not Found|404/.test(String(error?.message))) {
    return createStorageError(STORAGE_ERROR_CODES.objectNotFound, 'Storage object not found', { retryable: false, statusCode: 404, cause: error });
  }

  if (statusCode === 400 || /InvalidObjectState|InvalidArgument/i.test(error.name)) {
    return createStorageError(STORAGE_ERROR_CODES.keyInvalid, 'Storage request was invalid', { retryable: false, statusCode: 400, cause: error });
  }

  if (statusCode >= 500 || /ServiceUnavailable|Timeout|RequestTimeout|UnknownEndpoint/i.test(error.name) || /503|504/i.test(String(error?.message))) {
    return createStorageError(STORAGE_ERROR_CODES.providerUnavailable, 'Storage provider unavailable', { retryable: true, statusCode: 503, cause: error });
  }

  return createStorageError(fallbackCode, fallbackMessage, { retryable: false, statusCode: statusCode || 500, cause: error });
}
