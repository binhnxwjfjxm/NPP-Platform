import styles from './login.module.css';

export default function LoginPage() {
  const logoUrl = process.env.NEXT_PUBLIC_APP_LOGO_URL?.trim() || '/logo-transparent.png';

  return (
    <main className={styles.page}>
      <section className={styles.card}>
        <div className={styles.brand}>
          <span className={styles.logoFrame}>
            <img src={logoUrl} alt="Logo Hưng Phát Company" className={styles.logo} />
          </span>
          <div className={styles.brandText}>
            <strong>Hưng Phát Company</strong>
            <span>Hệ thống quản trị nội bộ</span>
          </div>
        </div>

        <p className={styles.eyebrow}>Cổng quản trị</p>
        <h1 className={styles.title}>Đăng nhập hệ thống</h1>
        <p className={styles.lead}>
          Đăng nhập để sử dụng các chức năng quản lý tổ chức, hàng hóa, giá bán, tồn kho và phân quyền.
        </p>

        <div className={styles.panel}>
          <p className={styles.hint}>Hướng dẫn truy cập</p>
          <p className={styles.note}>
            Sử dụng tài khoản được cấp để tiếp tục vào khu vực làm việc.
          </p>
        </div>

        <p className={styles.footer}>
          Không truy cập được hệ thống? Vui lòng liên hệ bộ phận quản trị để được hỗ trợ.
        </p>
      </section>
    </main>
  );
}
