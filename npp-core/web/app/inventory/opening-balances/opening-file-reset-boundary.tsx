'use client';

import type { ReactNode } from 'react';

export default function OpeningFileResetBoundary({ children }: { children: ReactNode }) {
  return <div data-opening-file-reset-boundary>{children}</div>;
}
