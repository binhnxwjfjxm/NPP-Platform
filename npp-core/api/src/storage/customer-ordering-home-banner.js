import {
  HeadObjectCommand,
  PutObjectCommand,
  S3Client,
} from '@aws-sdk/client-s3';
import {
  createStorageError,
  normalizeProviderError,
  STORAGE_ERROR_CODES,
} from './errors.js';

export const CUSTOMER_ORDERING_HOME_BANNER_KEY = 'app-customer/home/banner.webp';
export const CUSTOMER_ORDERING_HOME_BANNER_CONTENT_TYPE = 'image/webp';
export const CUSTOMER_ORDERING_HOME_BANNER_CACHE_CONTROL = 'public, max-age=300, must-revalidate';

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
}

function publicBase(config) {
  const raw = String(config?.r2PublicBaseUrl ?? '').trim();
  if (!raw) return null;
  return raw.replace(/\/+$/, '');
}

export function customerOrderingHomeBannerUrl(config, version = null) {
  const base = publicBase(config);
  if (!base) return null;
  const url = `${base}/${CUSTOMER_ORDERING_HOME_BANNER_KEY}`;
  return version === null || version === undefined
    ? url
    : `${url}?v=${encodeURIComponent(String(version))}`;
}

export function createCustomerOrderingHomeBannerStorage(config, { client } = {}) {
  validateConfig(config);
  const providerClient = client ?? new S3Client({
    region: config.r2Region,
    endpoint: config.r2Endpoint,
    credentials: {
      accessKeyId: config.r2AccessKeyId,
      secretAccessKey: config.r2SecretAccessKey,
    },
  });

  async function putBanner(body) {
    const bytes = Buffer.isBuffer(body)
      ? body
      : body instanceof Uint8Array
        ? Buffer.from(body)
        : body instanceof ArrayBuffer
          ? Buffer.from(body)
          : null;
    if (!bytes || bytes.length < 1 || bytes.length > config.r2MaxObjectBytes) {
      throw createStorageError(STORAGE_ERROR_CODES.keyInvalid, 'Customer ordering banner size is invalid', {
        retryable: false,
        statusCode: 400,
      });
    }
    try {
      await providerClient.send(new PutObjectCommand({
        Bucket: config.r2Bucket,
        Key: CUSTOMER_ORDERING_HOME_BANNER_KEY,
        Body: bytes,
        ContentType: CUSTOMER_ORDERING_HOME_BANNER_CONTENT_TYPE,
        CacheControl: CUSTOMER_ORDERING_HOME_BANNER_CACHE_CONTROL,
      }));
      return Object.freeze({ key: CUSTOMER_ORDERING_HOME_BANNER_KEY, size: bytes.length });
    } catch (error) {
      throw normalizeProviderError(error, STORAGE_ERROR_CODES.uploadFailed, 'Customer ordering banner upload failed');
    }
  }

  async function headBanner() {
    try {
      const response = await providerClient.send(new HeadObjectCommand({
        Bucket: config.r2Bucket,
        Key: CUSTOMER_ORDERING_HOME_BANNER_KEY,
      }));
      return Object.freeze({
        key: CUSTOMER_ORDERING_HOME_BANNER_KEY,
        size: Number.isInteger(response?.ContentLength) ? response.ContentLength : null,
        contentType: response?.ContentType ?? null,
      });
    } catch (error) {
      throw normalizeProviderError(error, STORAGE_ERROR_CODES.downloadFailed, 'Customer ordering banner lookup failed');
    }
  }

  return Object.freeze({ putBanner, headBanner });
}
