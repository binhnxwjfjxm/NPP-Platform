import { randomUUID } from 'node:crypto';
import { createStorageError, STORAGE_ERROR_CODES } from './errors.js';

export const DEFAULT_STORAGE_NAMESPACES = Object.freeze([
  '_rehearsal',
  'backups',
  'contracts',
  'documents',
  'exports',
  'images',
  'uploads',
]);

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const INSTALLATION_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/;
const NAMESPACE_PATTERN = /^_?[a-z0-9][a-z0-9_-]{0,63}$/;

function invalid(message) {
  throw createStorageError(STORAGE_ERROR_CODES.keyInvalid, message, {
    retryable: false,
    statusCode: 400,
  });
}

export function normalizeInstallationSegment(value) {
  const normalized = String(value ?? '').trim();
  if (!INSTALLATION_PATTERN.test(normalized) || normalized.includes('..')) {
    invalid('Installation identifier is not valid for storage');
  }
  return normalized;
}

export function normalizeStorageNamespace(value, allowedNamespaces = DEFAULT_STORAGE_NAMESPACES) {
  const normalized = String(value ?? '').trim().toLowerCase();
  if (!NAMESPACE_PATTERN.test(normalized)) invalid('Storage namespace is invalid');
  if (!new Set(allowedNamespaces).has(normalized)) invalid('Storage namespace is not allowed');
  return normalized;
}

export function sanitizeStorageFilename(value) {
  const raw = String(value ?? '').trim();
  if (!raw) invalid('Storage filename is required');
  if (raw.includes('\0') || raw.includes('/') || raw.includes('\\') || raw === '.' || raw === '..') {
    invalid('Storage filename contains an unsafe path component');
  }

  const ascii = raw
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/^\.+/, '')
    .replace(/[^A-Za-z0-9._-]+/g, '-')
    .replace(/-+/g, '-')
    .replace(/\.{2,}/g, '.')
    .replace(/^[-_.]+|[-_.]+$/g, '');

  if (!ascii) invalid('Storage filename is invalid after normalization');
  const limited = ascii.slice(0, 180).replace(/[-_.]+$/g, '');
  if (!limited) invalid('Storage filename is invalid after normalization');
  return limited;
}

export function buildR2ObjectKey({
  installationId,
  namespace,
  filename,
  now = new Date(),
  uuid = randomUUID(),
  allowedNamespaces = DEFAULT_STORAGE_NAMESPACES,
} = {}) {
  const installation = normalizeInstallationSegment(installationId);
  const safeNamespace = normalizeStorageNamespace(namespace, allowedNamespaces);
  const safeFilename = sanitizeStorageFilename(filename);
  const timestamp = now instanceof Date ? now : new Date(now);
  if (Number.isNaN(timestamp.getTime())) invalid('Storage key date is invalid');
  if (!UUID_PATTERN.test(String(uuid))) invalid('Storage key UUID is invalid');

  const year = String(timestamp.getUTCFullYear()).padStart(4, '0');
  const month = String(timestamp.getUTCMonth() + 1).padStart(2, '0');
  const key = `${installation}/${safeNamespace}/${year}/${month}/${String(uuid).toLowerCase()}-${safeFilename}`;
  if (key.length > 1024) invalid('Storage key is too long');
  return key;
}

export function assertInstallationScopedObjectKey({ key, installationId } = {}) {
  const normalizedKey = String(key ?? '').trim();
  const installation = normalizeInstallationSegment(installationId);
  if (!normalizedKey || normalizedKey.length > 1024) invalid('Storage key is invalid');
  if (normalizedKey.startsWith('/') || normalizedKey.includes('\\') || normalizedKey.includes('\0')) {
    invalid('Storage key contains an unsafe path component');
  }
  const segments = normalizedKey.split('/');
  if (segments.some((segment) => !segment || segment === '.' || segment === '..')) {
    invalid('Storage key contains an unsafe path component');
  }

  const coreScoped = segments[0] === installation;
  const legacyMcpScoped = segments.length >= 4
    && segments[0] === 'mcp-plan'
    && segments[1] === 'outlets'
    && segments[2] === installation;
  if (!coreScoped && !legacyMcpScoped) invalid('Storage key is outside the installation scope');
  return normalizedKey;
}
