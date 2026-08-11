import { safeDeliveryReturnTo } from '../../lib/delivery-session';
import styles from './login.module.css';

type LoginPageProps = Readonly<{
  searchParams?: Readonly<{ error?: string; challenge?: string; returnTo?: string }>;
}>;

function errorMessage(error?: string) {
  if (error === 'owner_code_invalid') return 'Mã xác nhận đăng nhập chưa đúng.';
  if (error === 'owner_challenge_required') return 'Mã xác nhận đã được gửi tới email của tài khoản. Nhập mã để hoàn tất đăng nhập.';
  if (error === 'owner_challenge_unavailable') return 'Xác minh đăng nhập chưa sẵn sàng cho tài khoản này. Vui lòng kiểm tra email nhân viên đã được cấu hình.';
  if (error === 'auth_unavailable') return 'Hệ thống xác thực đang tạm thời chưa sẵn sàng.';
  return error ? 'Tên đăng nhập/email hoặc mật khẩu chưa đúng.' : null;
}

export default function DeliveryLoginPage({ searchParams }: LoginPageProps) {
  const returnTo = safeDeliveryReturnTo(searchParams?.returnTo);
  const ownerChallenge = searchParams?.challenge === 'owner';
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
          <p>Nhân viên dùng tên đăng nhập được cấp. Owner có thể dùng email Owner đã đăng ký.</p>
          {error ? <p className={styles.error} role="alert">{error}</p> : null}

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
                <span>Mã xác nhận đăng nhập</span>
                <input name="ownerCode" inputMode="numeric" autoComplete="one-time-code" maxLength={6} required />
              </label>
            ) : null}
            <button className={styles.submit} type="submit">Vào ứng dụng</button>
          </form>
          <p className={styles.note}>Nếu tài khoản yêu cầu xác minh bổ sung, mã được gửi tới email của chính tài khoản. Phiên được xác thực trực tiếp bởi NPP Core và có thể bị thu hồi ngay khi tài khoản bị khóa.</p>
        </div>
      </section>
    </main>
  );
}
