'use client';

import { useState, type FormEvent } from 'react';
import { safeNppReturnTo } from '../../lib/workforce-session';
import styles from './login.module.css';

type VerificationState = 'owner_code_required' | 'machine_code_required';
type LoginMode = 'credentials' | VerificationState;
type SubmitState = 'idle' | 'loading' | 'success';

type LoginPageProps = Readonly<{
  searchParams?: Readonly<{ error?: string; state?: string; returnTo?: string }>;
}>;

function parseVerificationState(value?: string | null): VerificationState | null {
  return value === 'owner_code_required' || value === 'machine_code_required' ? value : null;
}

function errorMessage(error?: string | null): string | null {
  if (!error || error === 'owner_challenge_required') return null;
  if (error === 'invalid_owner_code') return 'Mã xác minh chưa đúng. Vui lòng thử lại.';
  if (error === 'owner_challenge_unavailable') return 'Chưa thể gửi mã xác minh cho tài khoản này.';
  if (error === 'core_unavailable') return 'Hệ thống xác thực đang tạm thời chưa sẵn sàng.';
  if (error === 'core_response_invalid') return 'Phản hồi xác thực chưa hợp lệ. Vui lòng thử lại.';
  return 'Tên đăng nhập/email hoặc mật khẩu chưa đúng.';
}

function isCodeError(error?: string | null): boolean {
  return error === 'invalid_owner_code' || error === 'owner_code_invalid';
}

export default function LoginPage({ searchParams }: LoginPageProps) {
  const returnTo = safeNppReturnTo(searchParams?.returnTo);
  const initialVerification = parseVerificationState(searchParams?.state);
  const [mode, setMode] = useState<LoginMode>(initialVerification || 'credentials');
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [code, setCode] = useState('');
  const [error, setError] = useState<string | null>(() => errorMessage(searchParams?.error));
  const [submitState, setSubmitState] = useState<SubmitState>('idle');
  const [leavingCredentials, setLeavingCredentials] = useState(false);
  const [codeAttempt, setCodeAttempt] = useState(0);
  const appLogoUrl = process.env.NEXT_PUBLIC_APP_LOGO_URL?.trim()
    || '/logo-transparent.png';

  function enterVerification(nextState: VerificationState, errorKey: string | null) {
    const nextError = errorMessage(errorKey);
    if (mode === 'credentials') {
      setLeavingCredentials(true);
      setError(null);
      window.setTimeout(() => {
        setMode(nextState);
        setLeavingCredentials(false);
        setError(nextError);
        if (isCodeError(errorKey)) {
          setCode('');
          setCodeAttempt((attempt) => attempt + 1);
        }
      }, 180);
      return;
    }

    setMode(nextState);
    setError(nextError);
    if (isCodeError(errorKey)) {
      setCode('');
      setCodeAttempt((attempt) => attempt + 1);
    }
  }

  async function submitAuth(formData: FormData) {
    setSubmitState('loading');
    setError(null);

    try {
      const response = await fetch('/api/auth/login', {
        method: 'POST',
        body: formData,
        credentials: 'same-origin',
      });

      if (!response.redirected) {
        setSubmitState('idle');
        setError('Không thể hoàn tất đăng nhập. Vui lòng thử lại.');
        return;
      }

      const target = new URL(response.url, window.location.origin);
      if (target.pathname === '/login' || target.pathname.endsWith('/login')) {
        const nextState = parseVerificationState(target.searchParams.get('state'));
        const errorKey = target.searchParams.get('error');
        setSubmitState('idle');

        if (nextState) {
          enterVerification(nextState, errorKey);
          return;
        }

        setMode('credentials');
        setError(errorMessage(errorKey));
        return;
      }

      setSubmitState('success');
      window.setTimeout(() => window.location.assign(response.url || returnTo), 260);
    } catch {
      setSubmitState('idle');
      setError('Không thể kết nối hệ thống xác thực. Vui lòng thử lại.');
    }
  }

  async function handleCredentialsSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const formData = new FormData();
    formData.set('username', username.trim());
    formData.set('password', password);
    formData.set('returnTo', returnTo);
    await submitAuth(formData);
  }

  async function handleVerificationSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();

    if (mode === 'machine_code_required') {
      setError('Hệ thống chưa hỗ trợ phương thức xác minh này. Vui lòng liên hệ quản trị tài khoản.');
      return;
    }

    const formData = new FormData();
    formData.set('username', username.trim());
    formData.set('password', password);
    formData.set('ownerCode', code.trim());
    formData.set('returnTo', returnTo);
    await submitAuth(formData);
  }

  function changeAccount() {
    setMode('credentials');
    setUsername('');
    setPassword('');
    setCode('');
    setError(null);
    setSubmitState('idle');
    setLeavingCredentials(false);
    const search = new URLSearchParams();
    if (returnTo !== '/') search.set('returnTo', returnTo);
    window.history.replaceState(null, '', search.size ? `/login?${search.toString()}` : '/login');
  }

  const busy = submitState !== 'idle';

  return (
    <main className={styles.page}>
      <section className={styles.card} aria-labelledby="npp-login-title">
        <div className={styles.brand}>
          <span className={styles.logoFrame}>
            <img className={styles.logo} src={appLogoUrl} alt="Logo Hưng Phát" />
          </span>
          <div className={styles.brandText}>
            <strong>Hưng Phát</strong>
            <span>Hệ thống điều hành Công Ty</span>
          </div>
        </div>

        <div className={styles.content}>
          {mode === 'credentials' ? (
            <div className={`${styles.loginStage} ${leavingCredentials ? styles.loginStageExit : ''}`}>
              <p className={styles.eyebrow}>Chào mừng đến hệ thống điều hành Hưng Phát.</p>
              <h1 className={styles.title} id="npp-login-title">Đăng nhập hệ thống</h1>
              <p>Nhân viên dùng tên đăng nhập được cấp. Tài khoản quản trị hệ thống có thể dùng email đã đăng ký.</p>
              {error ? <p className={styles.error} role="alert">{error}</p> : null}

              <form className={styles.form} action="/api/auth/login" method="post" onSubmit={handleCredentialsSubmit}>
                <input type="hidden" name="returnTo" value={returnTo} />
                <label className={styles.field}>
                  <span>Tên đăng nhập hoặc email quản trị</span>
                  <input
                    name="username"
                    autoComplete="username"
                    required
                    maxLength={256}
                    value={username}
                    onChange={(event) => setUsername(event.currentTarget.value)}
                    disabled={busy}
                  />
                </label>
                <label className={styles.field}>
                  <span>Mật khẩu</span>
                  <input
                    name="password"
                    type="password"
                    autoComplete="current-password"
                    required
                    value={password}
                    onChange={(event) => setPassword(event.currentTarget.value)}
                    disabled={busy}
                  />
                </label>
                <button className={styles.submit} type="submit" disabled={busy} aria-busy={submitState === 'loading'}>
                  {submitState === 'loading' ? <><span className={styles.spinner} aria-hidden="true" />Đang đăng nhập...</> : null}
                  {submitState === 'success' ? <><span className={styles.successMark} aria-hidden="true">✓</span>Đã xác thực</> : null}
                  {submitState === 'idle' ? 'Đăng nhập' : null}
                </button>
              </form>
            </div>
          ) : (
            <div className={styles.verificationStage}>
              <span className={styles.verifyIcon} aria-hidden="true">
                <svg viewBox="0 0 24 24" focusable="false">
                  <path d="M12 3 19 6v5c0 4.6-2.7 8.3-7 10-4.3-1.7-7-5.4-7-10V6l7-3Zm0 4.2a2.3 2.3 0 0 0-2.3 2.3v1H9v5h6v-5h-.7v-1A2.3 2.3 0 0 0 12 7.2Zm0 1.4c.5 0 .9.4.9.9v1h-1.8v-1c0-.5.4-.9.9-.9Z" />
                </svg>
              </span>
              <h1 className={styles.title} id="npp-login-title">Xác minh thiết bị</h1>
              <p>Mã xác minh đã được gửi tới email của chính tài khoản. Nhập mã để hoàn tất đăng nhập.</p>
              {error ? <p className={styles.error} role="alert">{error}</p> : null}

              <form className={styles.form} action="/api/auth/login" method="post" onSubmit={handleVerificationSubmit}>
                <input type="hidden" name="returnTo" value={returnTo} />
                <label key={codeAttempt} className={`${styles.field} ${isCodeError(searchParams?.error) || codeAttempt > 0 ? styles.codeError : ''}`}>
                  <span>Mã xác minh</span>
                  <input
                    name="ownerCode"
                    inputMode="numeric"
                    autoComplete="one-time-code"
                    maxLength={6}
                    required
                    autoFocus
                    value={code}
                    onChange={(event) => setCode(event.currentTarget.value)}
                    disabled={busy}
                  />
                </label>
                <button className={styles.submit} type="submit" disabled={busy} aria-busy={submitState === 'loading'}>
                  {submitState === 'loading' ? <><span className={styles.spinner} aria-hidden="true" />Đang xác minh...</> : null}
                  {submitState === 'success' ? <><span className={styles.successMark} aria-hidden="true">✓</span>Đã xác minh</> : null}
                  {submitState === 'idle' ? 'Xác minh' : null}
                </button>
                <button className={styles.secondary} type="button" onClick={changeAccount} disabled={busy}>Đổi tài khoản</button>
              </form>
            </div>
          )}
          <p className={styles.note}>Phiên đăng nhập gắn với đúng nhân viên, vai trò, quyền và phạm vi hiện tại trong Công Ty. Không truy cập được hệ thống? Vui lòng liên hệ người quản trị tài khoản nội bộ.</p>
        </div>
      </section>
    </main>
  );
}
