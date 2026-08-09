import { safeAdminReturnTo } from '../../lib/admin-session';
import styles from './login.module.css';

type LoginPageProps = Readonly<{
  searchParams?: Readonly<{ error?: string; challenge?: string; returnTo?: string }>;
}>;

function errorMessage(error?: string): string | null {
  if (!error) return null;
  if (error === 'invalid_owner_code') return 'Mã xác minh chủ sở hữu chưa đúng.';
  if (error === 'owner_challenge_required') return 'Tài khoản này yêu cầu mã xác minh từ chủ sở hữu để đăng nhập Web/PWA.';
  if (error === 'owner_challenge_unavailable') return 'Xác minh chủ sở hữu chưa sẵn sàng trên môi trường này.';
  if (error === 'core_unavailable' || error === 'core_response_invalid') return 'NPP Core tạm thời chưa sẵn sàng. Vui lòng thử lại.';
  return 'Tên đăng nhập/email hoặc mật khẩu chưa đúng.';
}

export default function AdminLoginPage({ searchParams }: LoginPageProps) {
  const returnTo = safeAdminReturnTo(searchParams?.returnTo);
  const ownerChallenge = searchParams?.challenge === 'owner';
  const message = errorMessage(searchParams?.error);
  const appLogoUrl = process.env.NEXT_PUBLIC_APP_LOGO_URL?.trim()
    || 'https://office.nguyenlieuhungphat.com/logo-transparent.png';

  return (
    <main className={styles.page}>
      <section className={styles.card} aria-labelledby="admin-login-title">
        <header className={styles.brand}>
          <span className={styles.logoFrame}>
            <img className={styles.logo} src={appLogoUrl} alt="Logo Hưng Phát Company" />
          </span>
          <span>
            <strong>Admin MCP/NPP</strong>
            <span>Ứng dụng quản lý Hưng Phát</span>
          </span>
        </header>

        <div className={styles.content}>
          <h1 id="admin-login-title">Đăng nhập</h1>
          <p>Đăng nhập bằng tài khoản nhân viên được cấp. Security/Implementation Owner có thể dùng email Owner đã đăng ký.</p>
          {message ? <p className={styles.error} role="alert">{message}</p> : null}

          <form className={styles.form} action="/api/auth/login" method="post">
            <input type="hidden" name="returnTo" value={returnTo} />
            <label className={styles.field}>
              <span>Tên đăng nhập hoặc email Owner</span>
              <input name="username" autoComplete="username" required maxLength={256} />
            </label>
            <label className={styles.field}>
              <span>Mật khẩu</span>
              <input name="password" type="password" autoComplete="current-password" required />
            </label>
            {ownerChallenge ? (
              <label className={styles.field}>
                <span>Mã xác minh chủ sở hữu</span>
                <input name="ownerCode" inputMode="numeric" autoComplete="one-time-code" maxLength={6} required />
              </label>
            ) : null}
            <button className={styles.submit} type="submit">Vào ứng dụng</button>
          </form>
          <p className={styles.note}>Phiên đăng nhập được giữ bằng cookie HttpOnly và được NPP Core xác minh lại.</p>
        </div>
      </section>
    </main>
  );
}
