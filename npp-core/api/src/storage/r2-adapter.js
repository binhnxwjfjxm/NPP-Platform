import { S3Client, PutObjectCommand, HeadObjectCommand, GetObjectCommand, DeleteObjectCommand } from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { createStorageError, normalizeProviderError, STORAGE_ERROR_CODES } from './errors.js';

const DEFAULT_PRESIGN_SECONDS = 900;
const DEFAULT_CONTENT_TYPE = 'application/octet-stream';

function validateR2Config(config) {
  if (!config.r2StorageEnabled) {
    return createStorageError(STORAGE_ERROR_CODES.disabled, 'R2 storage is disabled', { statusCode: 503 });
  }

  const requiredValues = [
    ['r2BucketName', 'R2_BUCKET_NAME'],
    ['r2Region', 'R2_REGION'],
    ['r2EndpointUrl', 'R2_ENDPOINT_URL'],
    ['r2AccessKeyId', 'R2_ACCESS_KEY_ID'],
    ['r2SecretAccessKey', 'R2_SECRET_ACCESS_KEY'],
  ];

  for (const [field, envName] of requiredValues) {
    if (!config[field]) {
      return createStorageError(STORAGE_ERROR_CODES.configuration, `${envName} is required when R2 storage is enabled`, { statusCode: 500 });
    }
  }

  return null;
}

export function createOptionalR2StorageAdapter(config) {
  if (!config.r2StorageEnabled) {
    return null;
  }
  return createR2StorageAdapter(config);
}

export function createR2StorageAdapter(config) {
  const validationError = validateR2Config(config);
  if (validationError) {
    throw validationError;
  }

  const client = new S3Client({
    region: config.r2Region,
    endpoint: config.r2EndpointUrl,
    credentials: {
      accessKeyId: config.r2AccessKeyId,
      secretAccessKey: config.r2SecretAccessKey,
    },
    forcePathStyle: config.r2ForcePathStyle,
  });

  async function uploadObject({ key, body, contentType }) {
    try {
      await client.send(new PutObjectCommand({
        Bucket: config.r2BucketName,
        Key: key,
        Body: body,
        ContentType: contentType || DEFAULT_CONTENT_TYPE,
      }));
      return { key };
    } catch (error) {
      throw normalizeProviderError(error, STORAGE_ERROR_CODES.uploadFailed, 'Failed to upload storage object');
    }
  }

  async function headObject({ key }) {
    try {
      const response = await client.send(new HeadObjectCommand({
        Bucket: config.r2BucketName,
        Key: key,
      }));
      return {
        contentType: response.ContentType || DEFAULT_CONTENT_TYPE,
        contentLength: response.ContentLength ?? null,
        metadata: response.Metadata ?? {},
      };
    } catch (error) {
      throw normalizeProviderError(error, STORAGE_ERROR_CODES.objectNotFound, 'Failed to head storage object');
    }
  }

  async function getObject({ key }) {
    try {
      const response = await client.send(new GetObjectCommand({
        Bucket: config.r2BucketName,
        Key: key,
      }));
      return {
        body: response.Body,
        contentType: response.ContentType || DEFAULT_CONTENT_TYPE,
        metadata: response.Metadata ?? {},
      };
    } catch (error) {
      throw normalizeProviderError(error, STORAGE_ERROR_CODES.objectNotFound, 'Failed to get storage object');
    }
  }

  async function deleteObject({ key }) {
    try {
      await client.send(new DeleteObjectCommand({
        Bucket: config.r2BucketName,
        Key: key,
      }));
      return { key };
    } catch (error) {
      throw normalizeProviderError(error, STORAGE_ERROR_CODES.deleteFailed, 'Failed to delete storage object');
    }
  }

  async function getPresignedPutUrl({ key, contentType, expiresIn = DEFAULT_PRESIGN_SECONDS }) {
    try {
      const command = new PutObjectCommand({
        Bucket: config.r2BucketName,
        Key: key,
        ContentType: contentType || DEFAULT_CONTENT_TYPE,
      });
      const url = await getSignedUrl(client, command, { expiresIn });
      return { url, expiresIn };
    } catch (error) {
      throw normalizeProviderError(error, STORAGE_ERROR_CODES.presignFailed, 'Failed to generate presigned upload URL');
    }
  }

  async function getPresignedGetUrl({ key, expiresIn = DEFAULT_PRESIGN_SECONDS }) {
    try {
      const command = new GetObjectCommand({
        Bucket: config.r2BucketName,
        Key: key,
      });
      const url = await getSignedUrl(client, command, { expiresIn });
      return { url, expiresIn };
    } catch (error) {
      throw normalizeProviderError(error, STORAGE_ERROR_CODES.presignFailed, 'Failed to generate presigned download URL');
    }
  }

  return Object.freeze({
    uploadObject,
    headObject,
    getObject,
    deleteObject,
    getPresignedPutUrl,
    getPresignedGetUrl,
  });
}
