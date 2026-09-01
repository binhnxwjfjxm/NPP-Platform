'use client';

import { useEffect, useState } from 'react';
import { AppShell } from '../../components/app-shell-core';
import {
  APPEARANCE_CHANGE_EVENT,
  APPEARANCE_SCALE_LEVELS,
  APPEARANCE_SCALE_STORAGE_KEY,
  APPEARANCE_THEME_STORAGE_KEY,
  APPEARANCE_THEMES,
  applyAppearance,
  normalizeAppearanceScale,
  normalizeAppearanceTheme,
  type AppearanceScale,
  type AppearanceTheme,
} from '../../appearance-preferences';
import SettingsTabs from '../settings-tabs';
import styles from './appearance.module.css';

function scaleLabel(scale: AppearanceScale) {
  if (scale === 0) return 'Mặc định';
  return scale > 0 ? `Lớn hơn ${scale} cấp` : `Nhỏ hơn ${Math.abs(scale)} cấp`;
}

function saveAppearance(theme: AppearanceTheme, scale: AppearanceScale) {
  applyAppearance(theme, scale, document.documentElement);
  try {
    window.localStorage.setItem(APPEARANCE_THEME_STORAGE_KEY, theme);
    window.localStorage.setItem(APPEARANCE_SCALE_STORAGE_KEY, String(scale));
  } catch {
    // Giao diện vẫn đổi trong phiên hiện tại nếu trình duyệt chặn lưu cục bộ.
  }
  window.dispatchEvent(new Event(APPEARANCE_CHANGE_EVENT));
}

export default function AppearanceWorkspace() {
  const [theme, setTheme] = useState<AppearanceTheme>('default');
  const [scale, setScale] = useState<AppearanceScale>(0);

  useEffect(() => {
    const readPreference = () => {
      let nextTheme = normalizeAppearanceTheme(document.documentElement.dataset.hpTheme);
      let nextScale = normalizeAppearanceScale(document.documentElement.dataset.hpScale);

      try {
        nextTheme = normalizeAppearanceTheme(window.localStorage.getItem(APPEARANCE_THEME_STORAGE_KEY));
        nextScale = normalizeAppearanceScale(window.localStorage.getItem(APPEARANCE_SCALE_STORAGE_KEY));
      } catch {
        // Dùng giá trị đã được bootstrap trên thẻ html.
      }

      applyAppearance(nextTheme, nextScale, document.documentElement);
      setTheme(nextTheme);
      setScale(nextScale);
    };

    readPreference();
    window.addEventListener('storage', readPreference);
    return () => window.removeEventListener('storage', readPreference);
  }, []);

  function chooseTheme(nextTheme: AppearanceTheme) {
    setTheme(nextTheme);
    saveAppearance(nextTheme, scale);
  }

  function chooseScale(nextScale: AppearanceScale) {
    setScale(nextScale);
    saveAppearance(theme, nextScale);
  }

  return (
    <AppShell
      title="Giao diện"
      subtitle="Chọn màu sắc và kích thước hiển thị phù hợp với từng người dùng trên trình duyệt này."
    >
      <SettingsTabs active="appearance" />

      <div className={styles.workspace}>
        <section className={styles.section} aria-labelledby="appearance-theme-title">
          <div className={styles.sectionHeading}>
            <div>
              <p className={styles.eyebrow}>MÀU SẮC</p>
              <h2 id="appearance-theme-title">Chọn giao diện</h2>
              <p>Đổi màu toàn bộ Công Ty ngay khi chọn. Bố cục và nghiệp vụ không thay đổi.</p>
            </div>
            <span className={styles.currentBadge}>Đang dùng: {APPEARANCE_THEMES.find((item) => item.key === theme)?.label}</span>
          </div>

          <div className={styles.themeGrid} role="radiogroup" aria-label="Giao diện màu sắc">
            {APPEARANCE_THEMES.map((item) => {
              const active = item.key === theme;
              return (
                <button
                  key={item.key}
                  type="button"
                  role="radio"
                  aria-checked={active}
                  className={`${styles.themeCard} ${active ? styles.themeCardActive : ''}`}
                  data-preview-theme={item.key}
                  onClick={() => chooseTheme(item.key)}
                >
                  <span className={styles.preview} aria-hidden="true">
                    <span className={styles.previewSidebar}>
                      <span className={styles.previewLogo} />
                      <span className={styles.previewNavActive} />
                      <span className={styles.previewNav} />
                      <span className={styles.previewNav} />
                    </span>
                    <span className={styles.previewMain}>
                      <span className={styles.previewTopbar} />
                      <span className={styles.previewCards}>
                        <span />
                        <span />
                      </span>
                      <span className={styles.previewTable} />
                    </span>
                  </span>
                  <span className={styles.themeCopy}>
                    <strong>{item.label}</strong>
                    <small>{item.description}</small>
                  </span>
                  <span className={styles.check} aria-hidden="true">{active ? '✓' : ''}</span>
                </button>
              );
            })}
          </div>

          <p className={styles.referenceNote}>
            Màu được khóa theo ảnh tham chiếu trong repo: THEM-XANH-LA.png, THEME-XANH-NHAT.png và THEME-TOI.png.
          </p>
        </section>

        <section className={styles.section} aria-labelledby="appearance-size-title">
          <div className={styles.sectionHeading}>
            <div>
              <p className={styles.eyebrow}>KÍCH THƯỚC HIỂN THỊ</p>
              <h2 id="appearance-size-title">Tăng hoặc giảm kích thước</h2>
              <p>Bốn cấp nhỏ, mức mặc định và bốn cấp lớn. Thiết lập áp dụng đồng bộ cho chữ và các thành phần dùng kích thước theo giao diện.</p>
            </div>
            <span className={styles.currentBadge}>{scaleLabel(scale)}</span>
          </div>

          <div className={styles.scalePanel}>
            <div className={styles.scaleLabels} aria-hidden="true">
              <span>Nhỏ</span>
              <span>Mặc định</span>
              <span>Lớn</span>
            </div>
            <input
              className={styles.scaleRange}
              type="range"
              min={-4}
              max={4}
              step={1}
              value={scale}
              aria-label="Kích thước hiển thị"
              aria-valuetext={scaleLabel(scale)}
              onChange={(event) => chooseScale(normalizeAppearanceScale(event.currentTarget.value))}
            />
            <div className={styles.scaleTicks} aria-hidden="true">
              {APPEARANCE_SCALE_LEVELS.map((level) => (
                <span key={level} className={level === scale ? styles.scaleTickActive : ''}>
                  {level > 0 ? `+${level}` : level}
                </span>
              ))}
            </div>
            <div className={styles.scaleActions}>
              <strong>{scaleLabel(scale)}</strong>
              <button type="button" onClick={() => chooseScale(0)} disabled={scale === 0}>Về mặc định</button>
            </div>
          </div>
        </section>

        <p className={styles.storageNote}>Lựa chọn được lưu trên trình duyệt này và giữ nguyên khi tải lại hoặc mở lại Công Ty.</p>
      </div>
    </AppShell>
  );
}
