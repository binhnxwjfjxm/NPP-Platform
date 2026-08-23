import 'server-only';

import { randomUUID } from 'node:crypto';
import { readAdminSessionToken } from './internal-auth-client';

const DOWNLOAD_TIMEOUT_MS = 30_000;
const EXPORT_PATH = '/api/reporting/management-export';

export class CoreDownloadError extends Error {
  constructor(
    public readonly code: string,
    public readonly publicMessage: string,
    public readonly statusCode: number,
  ) {
    super(publicMessage);
    this.name = 'CoreDownloadError';
  }
}

function baseUrl(): string {
  const value = process.env.CORE_API_INTERNAL_URL?.trim();
  if (!value) throw new CoreDownloadError('ADMIN_CORE_NOT_CONFIGURED', 'Kết nối với hệ thống Công Ty chưa được cấu hình', 503);
  let url: URL;
  try { url = new URL(value); } catch { throw new CoreDownloadError('ADMIN_CORE_NOT_CONFIGURED', 'Kết nối với hệ thống Công Ty chưa được cấu hình', 503); }
  if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password) throw new CoreDownloadError('ADMIN_CORE_NOT_CONFIGURED', 'Kết nối với hệ thống Công Ty chưa được cấu hình', 503);
  if (process.env.NODE_ENV === 'production' && url.protocol !== 'https:') throw new CoreDownloadError('ADMIN_CORE_NOT_CONFIGURED', 'Kết nối an toàn với hệ thống Công Ty chưa sẵn sàng', 503);
  url.pathname = url.pathname.replace(/\/$/, ''); url.search = ''; url.hash = '';
  return url.toString().replace(/\/$/, '');
}

function safeExportPath(path: string): string {
  if (!path.startsWith(`${EXPORT_PATH}?`) || path.includes('..') || /[\r\n]/.test(path)) throw new CoreDownloadError('ADMIN_CORE_PATH_INVALID', 'Đường xuất báo cáo không hợp lệ', 400);
  return path;
}

export async function requestCoreReportDownload(path: string): Promise<Response> {
  const token = readAdminSessionToken();
  if (!token) throw new CoreDownloadError('UNAUTHORIZED', 'Cần đăng nhập', 401);
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), DOWNLOAD_TIMEOUT_MS);
  try {
    const response = await fetch(`${baseUrl()}${safeExportPath(path)}`, {
      method: 'GET', cache: 'no-store', signal: controller.signal,
      headers: {
        Authorization: `Bearer ${token}`,
        Accept: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
        'x-request-id': `admin_export_${randomUUID()}`,
      },
    });
    if (!response.ok) {
      const payload = await response.json().catch(() => null) as { error?: { code?: string; message?: string } } | null;
      throw new CoreDownloadError(payload?.error?.code || 'ADMIN_REPORT_EXPORT_FAILED', payload?.error?.message || 'Không xuất được báo cáo quản trị', response.status);
    }
    return response;
  } catch (error) {
    if (error instanceof CoreDownloadError) throw error;
    throw new CoreDownloadError('ADMIN_CORE_UNAVAILABLE', 'Hệ thống Công Ty tạm thời chưa sẵn sàng', 503);
  } finally {
    clearTimeout(timeout);
  }
}
