'use client';

import { useEffect, type ReactNode } from 'react';

export default function OpeningFileResetBoundary({ children }: { children: ReactNode }) {
  useEffect(() => {
    const handler = (event: Event) => {
      const target = event.target;
      if (!(target instanceof HTMLInputElement) || target.type !== 'file') return;
      const rows = document.querySelector<HTMLTextAreaElement>('[data-testid="inventory-opening-rows-input"]');
      const metadata = document.querySelector<HTMLTextAreaElement>('[data-testid="inventory-opening-metadata-input"]');
      const filename = document.querySelector<HTMLInputElement>('[data-testid="inventory-opening-source-filename-input"]');
      for (const field of [rows, metadata, filename]) {
        if (!field) continue;
        field.value = field === rows ? '[]' : field === metadata ? '{}' : '';
        field.dispatchEvent(new Event('input', { bubbles: true }));
        field.dispatchEvent(new Event('change', { bubbles: true }));
      }
    };
    document.addEventListener('change', handler, true);
    return () => document.removeEventListener('change', handler, true);
  }, []);

  return <div data-opening-file-reset-boundary>{children}</div>;
}
