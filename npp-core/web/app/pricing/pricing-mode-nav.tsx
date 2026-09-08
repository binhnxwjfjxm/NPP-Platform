import Link from 'next/link';
import styles from './pricing-mode-nav.module.css';

export default function PricingModeNav({ active }: { active: 'manage' | 'all' }) {
  return (
    <nav className={styles.nav} aria-label="Khu vực Giá bán">
      <Link className={active === 'manage' ? styles.active : styles.link} href="/pricing">Thiết lập giá</Link>
      <Link className={active === 'all' ? styles.active : styles.link} href="/pricing?view=all">Toàn bộ bảng giá</Link>
    </nav>
  );
}
