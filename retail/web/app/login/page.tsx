'use client';

import { FormEvent, useState } from 'react';

export default function LoginPage({ searchParams }: { searchParams?: { returnTo?: string } }) {
  const [loginName, setLoginName] = useState('');
  const [password, setPassword] = useState('');
  const [ownerCode, setOwnerCode] = useState('');
  const [challenge, setChallenge] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const returnTo = searchParams?.returnTo?.startsWith('/') && !searchParams.returnTo.startsWith('//') ? searchParams.returnTo : '/';

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true);
    setError(null);
    const form = new FormData();
    form.set('username', loginName);
    form.set('password', password);
    form.set('returnTo', returnTo);
    if (challenge) form.set('ownerCode', ownerCode);
    try {
      const response = await fetch('/api/auth/login', { method: 'POST', body: form, cache: 'no-store' });
      const payload = await response.json().catch(() => null) as { data?: { redirectTo?: string }; error?: { message?: string; challengeRequired?: boolean } } | null;
      if (payload?.error?.challengeRequired) {
        setChallenge(true);
        setOwnerCode('');
        setError(payload.error.message ?? 'Hãy nhập mã xác minh để tiếp tục.');
        return;
      }
      if (!response.ok || !payload?.data?.redirectTo) {
        setError(payload?.error?.message ?? 'Chưa thể đăng nhập.');
        return;
      }
      window.location.assign(payload.data.redirectTo);
    } catch {
      setError('Hệ thống Công Ty đang tạm thời chưa sẵn sàng.');
    } finally {
      setBusy(false);
    }
  }

  function changeAccount() {
    setChallenge(false);
    setOwnerCode('');
    setPassword('');
    setError(null);
  }

  return <main className="login-page retail-login-page"><form className="login-card retail-login-card" onSubmit={submit}>
    <img
      className="company-login-logo"
      src="/logo-transparent.png?v=20260822"
      alt="Hưng Phát"
      onError={(event) => {
        if (!event.currentTarget.src.includes('pwa-icon-retail.png')) event.currentTarget.src = '/pwa-icon-retail.png?v=3';
      }}
    />
    <h1>Bán tại quầy</h1>
    {!challenge ? <>
      <p>Đăng nhập bằng tài khoản nhân viên được Công Ty cấp.</p>
      {error ? <p className="form-error" role="alert">{error}</p> : null}
      <label>Tên đăng nhập<input name="username" autoComplete="username" value={loginName} onChange={(event) => setLoginName(event.target.value)} required disabled={busy} /></label>
      <label>Mật khẩu<input name="password" type="password" autoComplete="current-password" value={password} onChange={(event) => setPassword(event.target.value)} required disabled={busy} /></label>
      <button className="primary-action" type="submit" disabled={busy}>{busy ? 'Đang đăng nhập…' : 'Đăng nhập'}</button>
    </> : <>
      <p>Mã xác minh đã được gửi về địa chỉ đã đăng ký. Chỉ cần nhập mã để tiếp tục.</p>
      {error ? <p className="form-error" role="status">{error}</p> : null}
      <label>Mã xác minh<input name="ownerCode" inputMode="numeric" autoComplete="one-time-code" value={ownerCode} onChange={(event) => setOwnerCode(event.target.value.replace(/\D/g, '').slice(0, 6))} required autoFocus disabled={busy} /></label>
      <button className="primary-action" type="submit" disabled={busy || ownerCode.length < 6}>{busy ? 'Đang xác minh…' : 'Xác minh'}</button>
      <button className="login-change-account" type="button" disabled={busy} onClick={changeAccount}>Đổi tài khoản</button>
    </>}
  </form></main>;
}
