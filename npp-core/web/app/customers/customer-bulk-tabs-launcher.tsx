'use client';

import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import CustomerBulkWorkspace from './customer-bulk-workspace';

type BulkMode = 'import' | 'update' | null;

export default function CustomerBulkTabsLauncher() {
  const [mode, setMode] = useState<BulkMode>(null);
  const [tabHost, setTabHost] = useState<HTMLElement | null>(null);
  const [contentHost, setContentHost] = useState<HTMLElement | null>(null);
  const modeRef = useRef<BulkMode>(null);

  useEffect(() => {
    modeRef.current = mode;
  }, [mode]);

  useEffect(() => {
    const root = document.querySelector('[data-testid="customers-page"]');
    if (!(root instanceof HTMLElement)) return undefined;
    const tabs = root.querySelector('[aria-label="Khu vực quản lý"]');
    if (!(tabs instanceof HTMLElement)) return undefined;
    const existingButtons = Array.from(tabs.querySelectorAll(':scope > button'));
    if (existingButtons.length < 2) return undefined;

    const nextTabHost = document.createElement('span');
    nextTabHost.dataset.customerBulkTabHost = 'true';
    nextTabHost.style.display = 'contents';
    tabs.insertBefore(nextTabHost, existingButtons[1]);

    const nextContentHost = document.createElement('div');
    nextContentHost.dataset.customerBulkHost = 'true';
    tabs.insertAdjacentElement('afterend', nextContentHost);

    const clearBulk = () => {
      if (modeRef.current !== null) {
        window.location.reload();
        return;
      }
      setMode(null);
    };
    existingButtons[0].addEventListener('click', clearBulk);
    existingButtons[1].addEventListener('click', clearBulk);
    setTabHost(nextTabHost);
    setContentHost(nextContentHost);

    return () => {
      existingButtons[0].removeEventListener('click', clearBulk);
      existingButtons[1].removeEventListener('click', clearBulk);
      nextTabHost.remove();
      nextContentHost.remove();
      setTabHost(null);
      setContentHost(null);
    };
  }, []);

  useEffect(() => {
    const root = document.querySelector('[data-testid="customers-page"]');
    if (!(root instanceof HTMLElement)) return;
    const tabs = root.querySelector('[aria-label="Khu vực quản lý"]');
    const bulkHost = root.querySelector('[data-customer-bulk-host="true"]');
    if (mode && tabs instanceof HTMLElement) {
      for (const button of Array.from(tabs.querySelectorAll(':scope > button'))) {
        button.setAttribute('aria-pressed', 'false');
      }
    }
    for (const child of Array.from(root.children)) {
      if (!(child instanceof HTMLElement)) continue;
      if (child === tabs || child === bulkHost || child.getAttribute('role') === 'status') continue;
      child.style.display = mode ? 'none' : '';
    }
    const createCustomer = document.querySelector('[data-testid="customers-topbar-create-button"]');
    const createGroup = document.querySelector('[data-testid="customer-groups-topbar-create-button"]');
    for (const button of [createCustomer, createGroup]) {
      if (!(button instanceof HTMLElement)) continue;
      button.style.display = mode ? 'none' : '';
    }
  }, [mode]);

  const tabs = tabHost ? createPortal(
    <>
      <button type="button" aria-pressed={mode === 'import'} onClick={() => setMode('import')} data-testid="customers-import-tab">Nhập KH</button>
      <button type="button" aria-pressed={mode === 'update'} onClick={() => setMode('update')} data-testid="customers-update-tab">Cập nhật KH</button>
    </>,
    tabHost,
  ) : null;

  const workspace = contentHost && mode ? createPortal(
    <div data-customer-bulk-content="true">
      <CustomerBulkWorkspace key={mode} mode={mode} />
    </div>,
    contentHost,
  ) : null;

  return <>{tabs}{workspace}</>;
}
