'use client';

import { useEffect } from 'react';
import { useRouter } from 'next/navigation';

type Props = {
  enabled: boolean;
  retryKey: string;
  delayMs?: number;
};

export default function InitialLoadRetry({ enabled, retryKey, delayMs = 500 }: Props) {
  const router = useRouter();

  useEffect(() => {
    const storageKey = `npp-core-initial-retry:${retryKey}`;
    if (!enabled) {
      window.sessionStorage.removeItem(storageKey);
      return;
    }

    if (window.sessionStorage.getItem(storageKey) === '1') return;
    window.sessionStorage.setItem(storageKey, '1');

    const timer = window.setTimeout(() => router.refresh(), delayMs);
    return () => window.clearTimeout(timer);
  }, [delayMs, enabled, retryKey, router]);

  return null;
}
