import Link from 'next/link';
import styles from './settings.module.css';

type SettingsTab = 'data-backup' | 'print-templates' | 'desktop-app';

const tabs: ReadonlyArray<{ key: SettingsTab; href: string; label: string }> = [
  { key: 'data-backup', href: '/settings/data-backup', label: 'Dữ liệu & sao lưu' },
  { key: 'print-templates', href: '/settings/print-templates', label: 'Mẫu in' },
  { key: 'desktop-app', href: '/settings/desktop-app', label: 'Ứng dụng máy tính' },
];

export default function SettingsTabs({ active }: { active: SettingsTab }) {
  return (
    <nav className={styles.settingsTabs} aria-label="Mục cài đặt">
      {tabs.map((tab) => (
        <Link
          key={tab.key}
          href={tab.href}
          className={`${styles.settingsTab} ${active === tab.key ? styles.settingsTabActive : ''}`}
          aria-current={active === tab.key ? 'page' : undefined}
        >
          {tab.label}
        </Link>
      ))}
    </nav>
  );
}
