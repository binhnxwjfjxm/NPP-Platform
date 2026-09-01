import type { Metadata } from 'next';
import { Be_Vietnam_Pro, IBM_Plex_Mono } from 'next/font/google';
import { GlobalQuickActions } from './components/global-quick-actions';
import {
  APPEARANCE_SCALE_STORAGE_KEY,
  APPEARANCE_THEME_STORAGE_KEY,
} from './appearance-preferences';
import './globals.css';
import './ui-polish.css';
import './components/lot3-ui-overrides.css';
import './issue-107-purchase-order-layout.css';
import './hung-phat-warm-gold.css';
import './core-office-density.css';
import './sales-order-entry-polish.css';
import './appearance-theme.css';

const beVietnamPro = Be_Vietnam_Pro({
  subsets: ['latin', 'vietnamese'],
  variable: '--font-sans',
  display: 'swap',
  weight: ['400', '500', '600', '700', '800'],
});

const ibmPlexMono = IBM_Plex_Mono({
  subsets: ['latin'],
  variable: '--font-mono',
  display: 'swap',
  weight: ['400', '500', '600', '700'],
});

export const metadata: Metadata = {
  title: {
    default: 'Hưng Phát Company',
    template: '%s · Hưng Phát Company',
  },
  description: 'Hệ thống quản trị nội bộ Hưng Phát Company',
};

const appearanceBootstrap = `(() => {
  try {
    const themes = new Set(['default', 'green', 'dark']);
    const themeValue = localStorage.getItem(${JSON.stringify(APPEARANCE_THEME_STORAGE_KEY)});
    const theme = themes.has(themeValue) ? themeValue : 'default';
    const rawScale = Number(localStorage.getItem(${JSON.stringify(APPEARANCE_SCALE_STORAGE_KEY)}));
    const scale = Number.isInteger(rawScale) && rawScale >= -4 && rawScale <= 4 ? rawScale : 0;
    document.documentElement.dataset.hpTheme = theme;
    document.documentElement.dataset.hpScale = String(scale);
  } catch {
    document.documentElement.dataset.hpTheme = 'default';
    document.documentElement.dataset.hpScale = '0';
  }
})();`;

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html
      lang="vi"
      className={`${beVietnamPro.variable} ${ibmPlexMono.variable}`}
      data-hp-theme="default"
      data-hp-scale="0"
      suppressHydrationWarning
    >
      <head>
        <script dangerouslySetInnerHTML={{ __html: appearanceBootstrap }} />
      </head>
      <body>
        {children}
        <GlobalQuickActions />
      </body>
    </html>
  );
}
