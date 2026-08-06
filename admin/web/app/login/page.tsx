import { safeAdminReturnTo } from '../../lib/admin-session';
import styles from './login.module.css';

type LoginPageProps = Readonly<{
  searchParams?: Readonly<{ error?: string; returnTo?: string }>;
}>;

export default function AdminLoginPage({ searchParams }: LoginPageProps) {
  const returnTo = safeAdminReturnTo(searchParams?.returnTo);
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
          <p>Đăng nhập một lần để tiếp tục sử dụng ứng dụng khi tải lại hoặc mở từ màn hình chính.</p>
          {searchParams?.error ? (
            <p className={styles.error} role="alert">Tên đăng nhập hoặc mật khẩu chưa đúng.</p>
          ) : null}

          <form className={styles.form} action="/api/auth/login" method="post">
            <input type="hidden" name="returnTo" value={returnTo} />
            <label className={styles.field}>
              <span>Tên đăng nhập</span>
              <input name="username" autoComplete="username" required maxLength={80} />
            </label>
            <label className={styles.field}>
              <span>Mật khẩu</span>
              <input name="password" type="password" autoComplete="current-password" required />
            </label>
            <button className={styles.submit} type="submit">Vào ứng dụng</button>
          </form>
          <p className={styles.note}>Phiên đăng nhập được giữ an toàn trên thiết bị này.</p>
        </div>
      </section>
    </main>
  );
}
