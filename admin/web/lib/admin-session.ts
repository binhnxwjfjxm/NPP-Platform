export const ADMIN_SESSION_COOKIE = 'hp_admin_session';

export function adminSessionCookieOptions(expiresAt?: string) {
  const parsed = expiresAt ? new Date(expiresAt) : null;
  const expires = parsed && !Number.isNaN(parsed.getTime()) ? parsed : undefined;
  return Object.freeze({
    httpOnly: true,
    sameSite: 'lax' as const,
    secure: process.env.NODE_ENV === 'production',
    path: '/',
    ...(expires ? { expires } : {}),
  });
}

export function safeAdminReturnTo(value: string | null | undefined): string {
  const candidate = String(value || '').trim();
  return candidate.startsWith('/') && !candidate.startsWith('//') ? candidate : '/';
}
