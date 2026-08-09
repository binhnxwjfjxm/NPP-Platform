import { safeDeliveryReturnTo } from '../../lib/delivery-session';
import styles from './login.module.css';

type LoginPageProps = Readonly<{
  searchParams?: Readonly<{ error?: string; returnTo?: string }>;
}>;

function errorMessage(error?: string) {
  if (error === 'owner_code_invalid') return 'Mã bảo mật chủ sở hữu chưa đúng.';
  if (error === 'owner_challenge_unavailable') return 'Xác minh chủ sở hữu chưa sẵn sàng trên môi trường này.';
  if (error === 'auth_unavailable') return 'Hệ thống xác thực đang tạm thời chưa sẵn sàng.';
  return error ? 'Tên đăng nhập hoặc mật khẩu chưa đúng.' : null;
}

export default function DeliveryLoginPage({ searchParams }: LoginPageProps) {
  const returnTo = safeDeliveryReturnTo(searchParams?.returnTo);
  const appLogoUrl = process.env.NEXT_PUBLIC_APP_LOGO_URL?.trim() || '/logo-transparent.png';
  const error = errorMessage(searchParams?.error);

  return (
    <main className={styles.page}>
      <section className={styles.card} aria-labelledby="delivery-login-title">
        <header className={styles.brand}>
          <span className={styles.logoFrame}>
            <img className={styles.logo} src={appLogoUrl} alt="Logo Hưng Phát Company" />
          </span>
          <span>
            <strong>HƯNG PHÁT DELIVERY</strong>
            <span>Ứng dụng dành cho tài xế và giao nhận</span>
          </span>
        </header>

        <div className={styles.content}>
          <p>Welcome to Hung Phat Operations.</p>
          <h1 id="delivery-login-title">Đăng nhập</h1>
          <p>Dùng tài khoản nhân viên được cấp trong NPP Core để tiếp tục.</p>
          {error ? <p className={styles.error} role="alert">{error}</p> : null}

          <form className={styles.form} action="/api/auth/login" method="post">
            <input type="hidden" name="returnTo" value={returnTo} />
            <label className={styles.field}>
              <span>Tên đăng nhập</span>
              <input name="username" autoComplete="username" required maxLength={128} />
            </label>
            <label className={styles.field}>
              <span>Mật khẩu</span>
              <input name="password" type="password" autoComplete="current-password" required />
            </label>
            <label className={styles.field}>
              <span>Mã bảo mật chủ sở hữu (nếu có)</span>
              <input name="ownerCode" inputMode="numeric" autoComplete="one-time-code" maxLength={32} />
            </label>
            <button className={styles.submit} type="submit">Vào ứng dụng</button>
          </form>
          <p className={styles.note}>Phiên được xác thực trực tiếp bởi NPP Core và có thể bị thu hồi ngay khi tài khoản bị khóa.</p>
        </div>
      </section>
    </main>
  );
}
