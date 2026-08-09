import { safeNppReturnTo } from '../../lib/workforce-session';
import styles from './login.module.css';

type LoginPageProps = Readonly<{ searchParams?: Readonly<{ error?: string; returnTo?: string; challenge?: string }> }>;
function errorMessage(error?: string) {
  if (error === 'invalid_owner_code') return 'Mã xác nhận chủ sở hữu chưa đúng.';
  if (error === 'owner_challenge_required') return 'Tài khoản này yêu cầu mã xác nhận từ chủ sở hữu để đăng nhập Web/PWA.';
  if (error === 'owner_challenge_unavailable') return 'Xác minh chủ sở hữu chưa sẵn sàng trên môi trường này.';
  if (error === 'core_unavailable') return 'Hệ thống xác thực đang tạm thời chưa sẵn sàng.';
  if (error === 'core_response_invalid') return 'Phản hồi xác thực chưa hợp lệ. Vui lòng thử lại.';
  return error ? 'Tên đăng nhập/email hoặc mật khẩu chưa đúng.' : null;
}
export default function LoginPage({ searchParams }: LoginPageProps) {
  const logoUrl = process.env.NEXT_PUBLIC_APP_LOGO_URL?.trim() || '/logo-transparent.png';
  const returnTo = safeNppReturnTo(searchParams?.returnTo);
  const error = errorMessage(searchParams?.error);
  const showOwnerCode = searchParams?.challenge === 'owner';
  return <main className={styles.page}><section className={styles.card} aria-labelledby="npp-login-title">
    <div className={styles.brand}><span className={styles.logoFrame}><img src={logoUrl} alt="Logo Hưng Phát Company" className={styles.logo} /></span><div className={styles.brandText}><strong>Hưng Phát Company</strong><span>NPP Operations</span></div></div>
    <p className={styles.eyebrow}>Welcome to Hung Phat Operations.</p><h1 className={styles.title} id="npp-login-title">Đăng nhập hệ thống</h1><p className={styles.lead}>Nhân viên dùng tên đăng nhập được cấp. Security/Implementation Owner có thể dùng email Owner đã đăng ký.</p>
    {error ? <p className={styles.error} role="alert">{error}</p> : null}
    <form className={styles.form} action="/api/auth/login" method="post"><input type="hidden" name="returnTo" value={returnTo} /><label className={styles.field}><span>Tên đăng nhập hoặc email Owner</span><input name="username" autoComplete="username" required maxLength={256} autoFocus /></label><label className={styles.field}><span>Mật khẩu</span><input name="password" type="password" autoComplete="current-password" required /></label>{showOwnerCode ? <label className={styles.field}><span>Mã xác nhận chủ sở hữu</span><input name="ownerCode" inputMode="numeric" autoComplete="one-time-code" maxLength={6} /></label> : null}<button className={styles.submit} type="submit">Đăng nhập</button></form>
    <div className={styles.panel}><p className={styles.hint}>Bảo mật nội bộ</p><p className={styles.note}>Phiên đăng nhập gắn với đúng nhân viên, vai trò, quyền và phạm vi hiện tại trong NPP Core. Role nhạy cảm có thể yêu cầu mã xác nhận khi dùng Web/PWA.</p></div><p className={styles.footer}>Không truy cập được hệ thống? Vui lòng liên hệ người quản trị tài khoản nội bộ.</p>
  </section></main>;
}
