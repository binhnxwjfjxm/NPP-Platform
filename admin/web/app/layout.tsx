import type { Metadata } from 'next';
import type { ReactNode } from 'react';
import './globals.css';

export const metadata: Metadata = {
  title: 'Admin MCP/NPP — Hưng Phát',
  description: 'Trung tâm điều hành dành cho chủ và quản lý Hưng Phát',
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="vi">
      <body>{children}</body>
    </html>
  );
}
