import { createHash } from 'node:crypto';
import {
  DeleteObjectCommand,
  GetObjectCommand,
  HeadObjectCommand,
  PutObjectCommand,
  S3Client,
} from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import {
  createStorageError,
  isProviderNotFound,
  normalizeProviderError,
  STORAGE_ERROR_CODES,
} from './errors.js';
import {
  assertInstallationScopedObjectKey,
  sanitizeStorageFilename,
} from './object-key.js';

const DEFAULT_CONTENT_TYPE = 'application/octet-stream';
const SECRET_METADATA_KEY_PATTERN = /(?:authorization|secret|token|password|passphrase|database_?url|db_?url|connection_?string|api_?key|private_?key)/i;
const SECRET_METADATA_VALUE_PATTERN = /(?:postgres(?:ql)?:\/\/|bearer\s+[A-Za-z0-9._~-]+|-----BEGIN [A-Z ]+PRIVATE KEY-----)/i;
const METADATA_KEY_PATTERN = /^[a-z0-9][a-z0-9._-]{0,63}$/;
const SHA256_HEX_PATTERN = /^[0-9a-f]{64}$/i;

function configurationError(message) {
  return createStorageError(STORAGE_ERROR_CODES.configuration, message, {
    retryable: false,
    statusCode: 500,
  });
}

function validateR2Config(config) {
  if (!config?.r2Enabled) {
    throw createStorageError(STORAGE_ERROR_CODES.disabled, 'R2 storage is disabled', {
      retryable: false,
      statusCode: 503,
    });
  }

  for (const [field, envName] of [
    ['r2Endpoint', 'R2_ENDPOINT'],
    ['r2Region', 'R2_REGION'],
    ['r2Bucket', 'R2_BUCKET'],
    ['r2AccessKeyId', 'R2_ACCESS_KEY_ID'],
    ['r2SecretAccessKey', 'R2_SECRET_ACCESS_KEY'],
  ]) {
    if (!config[field]) throw configurationError(`${envName} is required when R2_ENABLED=true`);
  }

  if (!Number.isInteger(config.r2MaxObjectBytes) || config.r2MaxObjectBytes < 1) {
    throw configurationError('R2_MAX_OBJECT_BYTES must be a positive integer');
  }
  if (!Number.isInteger(config.r2PresignedUrlMaxSeconds) || config.r2PresignedUrlMaxSeconds < 1) {
    throw configurationError('R2_PRESIGNED_URL_MAX_SECONDS must be a positive integer');
  }
}

function isSupportedBody(body) {
  return Buffer.isBuffer(body)
    || body instanceof Uint8Array
    || Boolean(body && (typeof body.pipe === 'function' || typeof body[Symbol.asyncIterator] === 'function'));
}

function resolveContentLength(body, contentLength) {
  const derived = Buffer.isBuffer(body) || body instanceof Uint8Array ? body.byteLength : null;
  const candidate = contentLength ?? derived;
  if (!Number.isInteger(candidate) || candidate < 0) {
    throw createStorageError(STORAGE_ERROR_CODES.keyInvalid, 'Storage content length must be a non-negative integer', {
      retryable: false,
      statusCode: 400,
    });
  }
  return candidate;
}

export function sanitizeStorageMetadata(metadata = {}) {
  if (!metadata || typeof metadata !== 'object' || Array.isArray(metadata)) return Object.freeze({});
  const entries = [];
  for (const [rawKey, rawValue] of Object.entries(metadata)) {
    const key = String(rawKey).trim().toLowerCase();
    if (!METADATA_KEY_PATTERN.test(key) || SECRET_METADATA_KEY_PATTERN.test(key)) continue;
    if (typeof rawValue !== 'string') continue;
    const value = rawValue.trim();
    if (!value || value.length > 256 || SECRET_METADATA_VALUE_PATTERN.test(value)) continue;
    entries.push([key, value]);
  }
  return Object.freeze(Object.fromEntries(entries));
}

function normalizeEtag(value) {
  const text = String(value ?? '').trim();
  return text ? text.replace(/^"|"$/g, '') : null;
}

function calculateChecksum(body, suppliedChecksum) {
  if (suppliedChecksum !== undefined && suppliedChecksum !== null) {
    const normalized = String(suppliedChecksum).trim().toLowerCase();
    if (!SHA256_HEX_PATTERN.test(normalized)) {
      throw createStorageError(STORAGE_ERROR_CODES.keyInvalid, 'Storage checksum must be a SHA-256 hex digest', {
        retryable: false,
        statusCode: 400,
      });
    }
    return {
      hex: normalized,
      base64: Buffer.from(normalized, 'hex').toString('base64'),
    };
  }

  if (Buffer.isBuffer(body) || body instanceof Uint8Array) {
    const digest = createHash('sha256').update(body).digest();
    return { hex: digest.toString('hex'), base64: digest.toString('base64') };
  }
  return { hex: null, base64: null };
}

function validatePresignTtl(value, maximum) {
  const ttl = value === undefined || value === null ? maximum : Number(value);
  if (!Number.isInteger(ttl) || ttl < 1 || ttl > maximum) {
    throw createStorageError(STORAGE_ERROR_CODES.keyInvalid, `Presigned URL TTL must be between 1 and ${maximum} seconds`, {
      retryable: false,
      statusCode: 400,
    });
  }
  return ttl;
}

export function createOptionalR2StorageAdapter(config, dependencies = {}) {
  if (!config?.r2Enabled) return null;
  return createR2StorageAdapter(config, dependencies);
}

export function createR2StorageAdapter(config, { client, presign = getSignedUrl } = {}) {
  validateR2Config(config);
  const providerClient = client ?? new S3Client({
    region: config.r2Region,
    endpoint: config.r2Endpoint,
    credentials: {
      accessKeyId: config.r2AccessKeyId,
      secretAccessKey: config.r2SecretAccessKey,
    },
  });

  async function putObject({
    installationId,
    key,
    body,
    contentType = DEFAULT_CONTENT_TYPE,
    contentLength,
    metadata = {},
    checksumSha256,
    cacheControl,
  }) {
    const scopedKey = assertInstallationScopedObjectKey({ key, installationId });
    if (!isSupportedBody(body)) {
      throw createStorageError(STORAGE_ERROR_CODES.keyInvalid, 'Storage body must be a Buffer, Uint8Array, or readable stream', {
        retryable: false,
        statusCode: 400,
      });
    }
    const size = resolveContentLength(body, contentLength);
    if (size > config.r2MaxObjectBytes) {
      throw createStorageError(STORAGE_ERROR_CODES.objectTooLarge, 'Storage object exceeds the configured size limit', {
        retryable: false,
        statusCode: 413,
        details: { maxObjectBytes: config.r2MaxObjectBytes },
      });
    }
    const checksum = calculateChecksum(body, checksumSha256);
    const safeMetadata = sanitizeStorageMetadata(metadata);

    try {
      const response = await providerClient.send(new PutObjectCommand({
        Bucket: config.r2Bucket,
        Key: scopedKey,
        Body: body,
        ContentType: String(contentType || DEFAULT_CONTENT_TYPE),
        ContentLength: size,
        Metadata: safeMetadata,
        ...(cacheControl ? { CacheControl: String(cacheControl) } : {}),
        ...(checksum.base64 ? { ChecksumSHA256: checksum.base64 } : {}),
      }));
      return Object.freeze({
        key: scopedKey,
        etag: normalizeEtag(response?.ETag),
        size,
        contentType: String(contentType || DEFAULT_CONTENT_TYPE),
        checksumSha256: checksum.hex,
      });
    } catch (error) {
      throw normalizeProviderError(error, STORAGE_ERROR_CODES.uploadFailed, 'Storage upload failed');
    }
  }

  async function headObject({ installationId, key }) {
    const scopedKey = assertInstallationScopedObjectKey({ key, installationId });
    try {
      const response = await providerClient.send(new HeadObjectCommand({
        Bucket: config.r2Bucket,
        Key: scopedKey,
      }));
      return Object.freeze({
        key: scopedKey,
        etag: normalizeEtag(response?.ETag),
        size: Number.isInteger(response?.ContentLength) ? response.ContentLength : null,
        contentType: response?.ContentType || DEFAULT_CONTENT_TYPE,
        checksumSha256: response?.ChecksumSHA256 || null,
        metadata: sanitizeStorageMetadata(response?.Metadata),
      });
    } catch (error) {
      throw normalizeProviderError(error, STORAGE_ERROR_CODES.downloadFailed, 'Storage metadata lookup failed');
    }
  }

  async function getObject({ installationId, key }) {
    const scopedKey = assertInstallationScopedObjectKey({ key, installationId });
    try {
      const response = await providerClient.send(new GetObjectCommand({
        Bucket: config.r2Bucket,
        Key: scopedKey,
      }));
      return Object.freeze({
        key: scopedKey,
        body: response?.Body,
        etag: normalizeEtag(response?.ETag),
        size: Number.isInteger(response?.ContentLength) ? response.ContentLength : null,
        contentType: response?.ContentType || DEFAULT_CONTENT_TYPE,
        checksumSha256: response?.ChecksumSHA256 || null,
        metadata: sanitizeStorageMetadata(response?.Metadata),
      });
    } catch (error) {
      throw normalizeProviderError(error, STORAGE_ERROR_CODES.downloadFailed, 'Storage download failed');
    }
  }

  async function deleteObject({ installationId, key }) {
    const scopedKey = assertInstallationScopedObjectKey({ key, installationId });
    try {
      await providerClient.send(new DeleteObjectCommand({
        Bucket: config.r2Bucket,
        Key: scopedKey,
      }));
      return Object.freeze({ key: scopedKey, deleted: true });
    } catch (error) {
      if (isProviderNotFound(error)) return Object.freeze({ key: scopedKey, deleted: false });
      throw normalizeProviderError(error, STORAGE_ERROR_CODES.deleteFailed, 'Storage delete failed');
    }
  }

  async function createPresignedGetUrl({
    installationId,
    key,
    expiresIn,
    downloadFilename,
  }) {
    const scopedKey = assertInstallationScopedObjectKey({ key, installationId });
    const ttl = validatePresignTtl(expiresIn, config.r2PresignedUrlMaxSeconds);
    const safeFilename = downloadFilename ? sanitizeStorageFilename(downloadFilename) : null;
    try {
      const command = new GetObjectCommand({
        Bucket: config.r2Bucket,
        Key: scopedKey,
        ...(safeFilename ? { ResponseContentDisposition: `attachment; filename="${safeFilename}"` } : {}),
      });
      const url = await presign(providerClient, command, { expiresIn: ttl });
      return Object.freeze({ url, expiresIn: ttl });
    } catch (error) {
      throw normalizeProviderError(error, STORAGE_ERROR_CODES.presignFailed, 'Storage presign failed');
    }
  }

  return Object.freeze({
    putObject,
    headObject,
    getObject,
    deleteObject,
    createPresignedGetUrl,
  });
}
