export const NPP_SESSION_COOKIE = 'hp_npp_session';

export function nppSessionCookieOptions(expiresAt?: string) {
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

export function safeNppReturnTo(value: string | null | undefined): string {
  const candidate = String(value || '').trim();
  return candidate.startsWith('/') && !candidate.startsWith('//') ? candidate : '/';
}
