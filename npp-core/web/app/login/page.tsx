import styles from './login.module.css';

export default function LoginPage() {
  return (
    <main className={styles.page}>
      <section className={styles.card}>
        <div className={styles.brand}>
          <div className={styles.brandMark} aria-hidden="true">N</div>
          <div className={styles.brandText}>
            <strong>NPP Core</strong>
            <span>Quản trị nội bộ</span>
          </div>
        </div>

        <h1 className={styles.title}>Đăng nhập để vào không gian quản trị</h1>
        <p className={styles.lead}>
          Hệ thống này dùng xác thực trình duyệt để bảo vệ dữ liệu tổ chức, chi nhánh, kho hàng và vị trí kho.
        </p>

        <div className={styles.panel}>
          <p className={styles.hint}>Lưu ý</p>
          <p className={styles.note}>
            Nếu Sếp chưa được cấp quyền, trình duyệt sẽ tự hiện hộp thoại xác thực trước khi vào dashboard hoặc các màn quản trị.
          </p>
        </div>

        <p className={styles.footer}>
          Không có form đăng nhập giả, không có dữ liệu mẫu, không có secret lộ ra giao diện.
        </p>
      </section>
    </main>
  );
}

