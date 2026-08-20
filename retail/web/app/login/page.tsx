'use client';

import { FormEvent, useState } from 'react';

function message(error?: string) {
  if (error === 'invalid_credentials') return 'Tên đăng nhập hoặc mật khẩu chưa đúng.';
  if (error === 'owner_challenge_required') return 'Tài khoản này cần xác minh bổ sung tại ứng dụng Văn phòng.';
  if (error === 'company_unavailable') return 'Hệ thống Công Ty đang tạm thời chưa sẵn sàng.';
  return null;
}

export default function LoginPage({ searchParams }: { searchParams?: { error?: string; returnTo?: string } }) {
  const [busy, setBusy] = useState(false);
  const error = message(searchParams?.error);
  const returnTo = searchParams?.returnTo?.startsWith('/') && !searchParams.returnTo.startsWith('//') ? searchParams.returnTo : '/';
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true);
    const response = await fetch('/api/auth/login', { method: 'POST', body: new FormData(event.currentTarget) }).catch(() => null);
    if (response?.redirected) window.location.assign(response.url);
    else setBusy(false);
  }
  return <main className="login-page"><form className="login-card" onSubmit={submit} action="/api/auth/login" method="post">
    <p className="brand-kicker">HƯNG PHÁT</p><h1>Bán tại quầy</h1><p>Đăng nhập bằng tài khoản nhân viên được Công Ty cấp.</p>
    {error ? <p className="form-error" role="alert">{error}</p> : null}
    <input type="hidden" name="returnTo" value={returnTo} />
    <label>Tên đăng nhập<input name="username" autoComplete="username" required disabled={busy} /></label>
    <label>Mật khẩu<input name="password" type="password" autoComplete="current-password" required disabled={busy} /></label>
    <button className="primary-action" type="submit" disabled={busy}>{busy ? 'Đang đăng nhập…' : 'Đăng nhập'}</button>
  </form></main>;
}
