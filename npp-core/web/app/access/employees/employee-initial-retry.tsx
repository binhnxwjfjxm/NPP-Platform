'use client';

import { useEffect } from 'react';
import { useRouter } from 'next/navigation';

const RETRY_KEY = 'npp-core-employees-initial-retry';

export default function EmployeeInitialRetry({ enabled }: { enabled: boolean }) {
  const router = useRouter();

  useEffect(() => {
    if (!enabled) {
      window.sessionStorage.removeItem(RETRY_KEY);
      return;
    }

    if (window.sessionStorage.getItem(RETRY_KEY) === '1') return;
    window.sessionStorage.setItem(RETRY_KEY, '1');

    const timer = window.setTimeout(() => {
      router.refresh();
    }, 500);

    return () => window.clearTimeout(timer);
  }, [enabled, router]);

  return null;
}
