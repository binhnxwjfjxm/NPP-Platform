import type { Metadata } from 'next';
import { Be_Vietnam_Pro, IBM_Plex_Mono } from 'next/font/google';
import './globals.css';

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
  title: 'NPP Core',
  description: 'Bảng điều khiển quản trị NPP Core',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="vi" className={`${beVietnamPro.variable} ${ibmPlexMono.variable}`}>
      <body>{children}</body>
    </html>
  );
}
