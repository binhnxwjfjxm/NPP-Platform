import {
  DeleteObjectCommand,
  HeadObjectCommand,
  ListObjectsV2Command,
  PutObjectCommand,
  S3Client,
} from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import {
  createStorageError,
  normalizeProviderError,
  STORAGE_ERROR_CODES,
} from './errors.js';

export const SHARED_PRODUCT_IMAGE_PREFIX = 'app-customer/products/';
export const PRODUCT_IMAGE_CONTENT_TYPE = 'image/webp';
export const PRODUCT_IMAGE_CACHE_CONTROL = 'no-cache, max-age=0, must-revalidate';

const PRODUCT_CODE_PATTERN = /^[A-Z0-9_-]{1,64}$/;

function configurationError(message) {
  return createStorageError(STORAGE_ERROR_CODES.configuration, message, {
    retryable: false,
    statusCode: 500,
  });
}

function validateConfig(config) {
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
  if (!Number.isInteger(config.r2PresignedUrlMaxSeconds) || config.r2PresignedUrlMaxSeconds < 1) {
    throw configurationError('R2_PRESIGNED_URL_MAX_SECONDS must be a positive integer');
  }
  if (!Number.isInteger(config.r2MaxObjectBytes) || config.r2MaxObjectBytes < 1) {
    throw configurationError('R2_MAX_OBJECT_BYTES must be a positive integer');
  }
}

export function normalizeSharedProductImageCode(value) {
  const code = String(value ?? '').trim();
  if (!PRODUCT_CODE_PATTERN.test(code) || code !== code.toUpperCase()) {
    throw createStorageError(STORAGE_ERROR_CODES.keyInvalid, 'Product image code is invalid', {
      retryable: false,
      statusCode: 400,
    });
  }
  return code;
}

export function sharedProductImageKey(productCode) {
  return `${SHARED_PRODUCT_IMAGE_PREFIX}${normalizeSharedProductImageCode(productCode)}.webp`;
}

export function sharedProductImageCodeFromKey(key) {
  const text = String(key ?? '');
  if (!text.startsWith(SHARED_PRODUCT_IMAGE_PREFIX) || !text.endsWith('.webp')) return null;
  const code = text.slice(SHARED_PRODUCT_IMAGE_PREFIX.length, -'.webp'.length);
  if (!PRODUCT_CODE_PATTERN.test(code) || sharedProductImageKey(code) !== text) return null;
  return code;
}

function publicBase(config) {
  const raw = String(config.r2PublicBaseUrl ?? '').trim();
  if (!raw) throw configurationError('R2_PUBLIC_BASE_URL is required for shared product images');
  return raw.replace(/\/+$/, '');
}

export function createSharedProductImageStorage(config, { client, presign = getSignedUrl } = {}) {
  validateConfig(config);
  const providerClient = client ?? new S3Client({
    region: config.r2Region,
    endpoint: config.r2Endpoint,
    credentials: {
      accessKeyId: config.r2AccessKeyId,
      secretAccessKey: config.r2SecretAccessKey,
    },
  });

  function imageUrl(productCode) {
    return `${publicBase(config)}/${sharedProductImageKey(productCode)}`;
  }

  async function listImageCodes() {
    const codes = [];
    let continuationToken;
    let pages = 0;
    try {
      do {
        const response = await providerClient.send(new ListObjectsV2Command({
          Bucket: config.r2Bucket,
          Prefix: SHARED_PRODUCT_IMAGE_PREFIX,
          MaxKeys: 1000,
          ...(continuationToken ? { ContinuationToken: continuationToken } : {}),
        }));
        for (const object of response?.Contents ?? []) {
          const code = sharedProductImageCodeFromKey(object?.Key);
          if (code) codes.push(code);
        }
        continuationToken = response?.IsTruncated ? response?.NextContinuationToken : undefined;
        pages += 1;
        if (pages > 1000) throw configurationError('Product image listing exceeded the safe page limit');
      } while (continuationToken);
      return Object.freeze([...new Set(codes)].sort());
    } catch (error) {
      if (error?.code === STORAGE_ERROR_CODES.configuration) throw error;
      throw normalizeProviderError(error, STORAGE_ERROR_CODES.downloadFailed, 'Product image listing failed');
    }
  }

  async function createUploadUrl({ productCode, expiresIn = 300 } = {}) {
    const key = sharedProductImageKey(productCode);
    const ttl = Number(expiresIn);
    if (!Number.isInteger(ttl) || ttl < 1 || ttl > config.r2PresignedUrlMaxSeconds) {
      throw createStorageError(STORAGE_ERROR_CODES.keyInvalid, 'Product image upload URL lifetime is invalid', {
        retryable: false,
        statusCode: 400,
      });
    }
    try {
      const command = new PutObjectCommand({
        Bucket: config.r2Bucket,
        Key: key,
        ContentType: PRODUCT_IMAGE_CONTENT_TYPE,
        CacheControl: PRODUCT_IMAGE_CACHE_CONTROL,
      });
      const url = await presign(providerClient, command, { expiresIn: ttl });
      return Object.freeze({
        key,
        url,
        expiresIn: ttl,
        headers: Object.freeze({
          'Content-Type': PRODUCT_IMAGE_CONTENT_TYPE,
          'Cache-Control': PRODUCT_IMAGE_CACHE_CONTROL,
        }),
      });
    } catch (error) {
      throw normalizeProviderError(error, STORAGE_ERROR_CODES.presignFailed, 'Product image upload signing failed');
    }
  }

  async function headImage({ productCode } = {}) {
    const key = sharedProductImageKey(productCode);
    try {
      const response = await providerClient.send(new HeadObjectCommand({
        Bucket: config.r2Bucket,
        Key: key,
      }));
      return Object.freeze({
        key,
        size: Number.isInteger(response?.ContentLength) ? response.ContentLength : null,
        contentType: response?.ContentType || null,
        cacheControl: response?.CacheControl || null,
        etag: String(response?.ETag ?? '').replace(/^"|"$/g, '') || null,
      });
    } catch (error) {
      throw normalizeProviderError(error, STORAGE_ERROR_CODES.downloadFailed, 'Product image lookup failed');
    }
  }

  async function deleteImage({ productCode } = {}) {
    const key = sharedProductImageKey(productCode);
    try {
      await providerClient.send(new DeleteObjectCommand({ Bucket: config.r2Bucket, Key: key }));
      return Object.freeze({ key, deleted: true });
    } catch (error) {
      throw normalizeProviderError(error, STORAGE_ERROR_CODES.deleteFailed, 'Product image deletion failed');
    }
  }

  return Object.freeze({
    imageUrl,
    listImageCodes,
    createUploadUrl,
    headImage,
    deleteImage,
  });
}
