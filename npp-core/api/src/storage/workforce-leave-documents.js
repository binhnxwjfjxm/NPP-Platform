import { randomUUID } from 'node:crypto';
import { createR2StorageAdapter } from './r2-adapter.js';
import { normalizeInstallationSegment, sanitizeStorageFilename } from './object-key.js';
import { createStorageError, STORAGE_ERROR_CODES } from './errors.js';

export const WORKFORCE_LEAVE_DOCUMENT_MAX_BYTES = 10 * 1024 * 1024;
export const WORKFORCE_LEAVE_DOCUMENT_MIME_TYPES = Object.freeze(new Set([
  'image/jpeg',
  'image/png',
  'image/webp',
  'application/pdf',
]));

const LEAVE_DOCUMENT_PATH = 'Tai-lieu/Nhan-su/Phieu-nghi';

function configurationError(message) {
  return createStorageError(STORAGE_ERROR_CODES.configuration, message, {
    retryable: false,
    statusCode: 503,
  });
}

function businessFolder(now = new Date()) {
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat('en-US', {
      timeZone: 'Asia/Ho_Chi_Minh',
      year: 'numeric',
      month: '2-digit',
    }).formatToParts(now).map((part) => [part.type, part.value]),
  );
  return { year: parts.year, month: parts.month };
}

export function workforceLeaveDocumentPrefix(installationId) {
  return `${normalizeInstallationSegment(installationId)}/${LEAVE_DOCUMENT_PATH}/`;
}

export function buildWorkforceLeaveDocumentKey({ installationId, fileName, now = new Date(), uuid = randomUUID() }) {
  const safeFileName = sanitizeStorageFilename(fileName);
  const folder = businessFolder(now);
  return `${workforceLeaveDocumentPrefix(installationId)}${folder.year}/${folder.month}/${uuid}-${safeFileName}`;
}

export function isWorkforceLeaveDocumentKey({ installationId, key }) {
  const value = String(key ?? '').trim();
  return Boolean(value) && value.startsWith(workforceLeaveDocumentPrefix(installationId)) && !value.includes('..');
}

function publicUrl(config, key) {
  const base = String(config?.r2PublicBaseUrl ?? '').trim().replace(/\/+$/, '');
  if (!base) throw configurationError('R2_PUBLIC_BASE_URL is required for workforce leave documents');
  return `${base}/${key}`;
}

export function createWorkforceLeaveDocumentStorage(config, { adapter } = {}) {
  const storage = adapter ?? createR2StorageAdapter(config);

  async function putDocument({ installationId, fileName, mimeType, body }) {
    const normalizedMimeType = String(mimeType ?? '').trim().toLowerCase();
    if (!WORKFORCE_LEAVE_DOCUMENT_MIME_TYPES.has(normalizedMimeType)) {
      throw createStorageError(STORAGE_ERROR_CODES.keyInvalid, 'Định dạng chứng từ nghỉ không được hỗ trợ', {
        retryable: false,
        statusCode: 400,
      });
    }
    const bytes = Buffer.isBuffer(body) ? body : Buffer.from(body ?? []);
    const maximum = Math.min(
      WORKFORCE_LEAVE_DOCUMENT_MAX_BYTES,
      Number(config?.r2MaxObjectBytes || WORKFORCE_LEAVE_DOCUMENT_MAX_BYTES),
    );
    if (bytes.length < 1 || bytes.length > maximum) {
      throw createStorageError(STORAGE_ERROR_CODES.objectTooLarge, 'Dung lượng chứng từ nghỉ không hợp lệ', {
        retryable: false,
        statusCode: bytes.length > maximum ? 413 : 400,
        details: { maxBytes: maximum },
      });
    }
    const key = buildWorkforceLeaveDocumentKey({ installationId, fileName });
    const saved = await storage.putObject({
      installationId,
      key,
      body: bytes,
      contentType: normalizedMimeType,
      contentLength: bytes.length,
      cacheControl: 'private, no-cache, max-age=0',
      metadata: { domain: 'workforce-leave', original_filename: sanitizeStorageFilename(fileName) },
    });
    return Object.freeze({
      objectKey: saved.key,
      publicUrl: publicUrl(config, saved.key),
      fileName: sanitizeStorageFilename(fileName),
      mimeType: normalizedMimeType,
      byteSize: saved.size,
      checksumSha256: saved.checksumSha256,
    });
  }

  return Object.freeze({ putDocument });
}
