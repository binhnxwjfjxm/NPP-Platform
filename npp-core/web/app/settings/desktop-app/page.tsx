import { AppShell } from '../../components/app-shell-core';
import SettingsTabs from '../settings-tabs';
import styles from '../settings.module.css';

export const dynamic = 'force-dynamic';

const WINDOWS_RELEASE = Object.freeze({
  version: '0.1.3',
  downloadUrl: 'https://pub-53ec351640ea49ff8d5f5105c98006b4.r2.dev/core/windows/stable/Hung-Phat-Desktop-0.1.3-Setup.exe',
});

export default function DesktopAppPage() {
  return (
    <AppShell
      title="Ứng dụng máy tính"
      subtitle="Tải bản cài đặt Hưng Phát dành cho máy tính Windows."
    >
      <SettingsTabs active="desktop-app" />

      <div className={styles.appSurface}>
        <section className={styles.appCard} aria-labelledby="desktop-app-title">
          <div className={styles.appIcon} aria-hidden="true">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round">
              <rect x="3" y="4" width="18" height="12" rx="2" />
              <path d="M8 20h8M12 16v4" />
            </svg>
          </div>

          <div className={styles.appCopy}>
            <p className={styles.eyebrow}>ỨNG DỤNG WINDOWS</p>
            <h2 id="desktop-app-title">Hưng Phát trên máy tính</h2>
            <p className={styles.appDescription}>
              Dùng bản cài đặt riêng trên Windows để mở Hưng Phát như một ứng dụng máy tính. Trang này chỉ dùng để tải bản cài đặt lần đầu.
            </p>
            <div className={styles.releaseMeta} aria-label="Thông tin bản cài đặt">
              <span>Phiên bản {WINDOWS_RELEASE.version}</span>
              <span>Windows</span>
            </div>
          </div>

          <a className={styles.downloadButton} href={WINDOWS_RELEASE.downloadUrl}>
            Tải ứng dụng Windows
          </a>
        </section>

        <div className={styles.noteCard}>
          <strong>Cập nhật phiên bản:</strong> thực hiện trực tiếp bên trong ứng dụng máy tính. Trang web này không có nút kiểm tra hoặc cài đặt bản cập nhật.
        </div>
      </div>
    </AppShell>
  );
}
