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
  auditFailed: 'STORAGE_AUDIT_FAILED',
  auditCleanupFailed: 'STORAGE_AUDIT_CLEANUP_FAILED',
});

export class StorageError extends Error {
  constructor(code, publicMessage, {
    retryable = false,
    statusCode = 500,
    details = {},
  } = {}) {
    super(publicMessage);
    this.name = 'StorageError';
    this.code = code;
    this.publicMessage = publicMessage;
    this.retryable = retryable;
    this.statusCode = statusCode;
    this.details = Object.freeze({ ...details });
  }
}

export function createStorageError(code, publicMessage, options = {}) {
  return new StorageError(code, publicMessage, options);
}

export function isProviderNotFound(error) {
  const statusCode = Number(error?.$metadata?.httpStatusCode ?? error?.statusCode ?? 0);
  const name = String(error?.name ?? error?.code ?? '');
  return statusCode === 404 || /^(NotFound|NoSuchKey|NoSuchObject)$/i.test(name);
}

export function normalizeProviderError(error, fallbackCode, fallbackMessage) {
  const statusCode = Number(error?.$metadata?.httpStatusCode ?? error?.statusCode ?? 0);
  const name = String(error?.name ?? error?.code ?? '');

  if (isProviderNotFound(error)) {
    return createStorageError(STORAGE_ERROR_CODES.objectNotFound, 'Storage object not found', {
      retryable: false,
      statusCode: 404,
    });
  }

  if (statusCode === 400 || /^(InvalidObjectState|InvalidArgument|InvalidRequest)$/i.test(name)) {
    return createStorageError(STORAGE_ERROR_CODES.keyInvalid, 'Storage request was invalid', {
      retryable: false,
      statusCode: 400,
    });
  }

  if (
    statusCode >= 500
    || /^(ServiceUnavailable|TimeoutError|RequestTimeout|UnknownEndpoint|NetworkingError)$/i.test(name)
  ) {
    return createStorageError(STORAGE_ERROR_CODES.providerUnavailable, 'Storage provider unavailable', {
      retryable: true,
      statusCode: 503,
    });
  }

  return createStorageError(fallbackCode, fallbackMessage, {
    retryable: false,
    statusCode: statusCode >= 400 && statusCode <= 599 ? statusCode : 500,
  });
}
