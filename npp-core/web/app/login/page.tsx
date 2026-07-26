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

        <p className={styles.eyebrow}>NPP Core</p>
        <h1 className={styles.title}>Đăng nhập để vào không gian quản trị</h1>
        <p className={styles.lead}>
          Khu vực làm việc dành cho công tác quản trị tổ chức, chi nhánh, kho hàng và vị trí lưu trữ.
        </p>

        <div className={styles.panel}>
          <p className={styles.hint}>Xác thực truy cập</p>
          <p className={styles.note}>
            Trình duyệt sẽ hiển thị hộp thoại xác thực trước khi mở bảng điều hành và các danh mục quản trị.
          </p>
        </div>

        <p className={styles.footer}>
          Dữ liệu nghiệp vụ và thông tin kết nối hệ thống không được công khai trên giao diện.
        </p>
      </section>
    </main>
  );
}
