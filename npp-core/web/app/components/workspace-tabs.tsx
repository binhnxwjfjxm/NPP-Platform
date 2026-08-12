'use client';

import type { ReactNode } from 'react';
import styles from './inventory-reporting-workspace.module.css';

export type WorkspaceTabOption<T extends string> = Readonly<{
  id: T;
  label: string;
  count?: number;
}>;

type WorkspaceTabsProps<T extends string> = Readonly<{
  tabs: readonly WorkspaceTabOption<T>[];
  activeTab: T;
  onChange: (tabId: T) => void;
  idPrefix: string;
  label: string;
}>;

type WorkspaceTabPanelProps<T extends string> = Readonly<{
  tabId: T;
  activeTab: T;
  idPrefix: string;
  children: ReactNode;
}>;

export function WorkspaceTabs<T extends string>({
  tabs,
  activeTab,
  onChange,
  idPrefix,
  label,
}: WorkspaceTabsProps<T>) {
  return (
    <div className={styles.tabList} role="tablist" aria-label={label} aria-orientation="horizontal">
      {tabs.map((tab) => {
        const selected = tab.id === activeTab;
        const tabElementId = `${idPrefix}-tab-${tab.id}`;
        const panelElementId = `${idPrefix}-panel-${tab.id}`;

        return (
          <button
            key={tab.id}
            id={tabElementId}
            type="button"
            role="tab"
            aria-selected={selected}
            aria-controls={panelElementId}
            tabIndex={selected ? 0 : -1}
            className={`${styles.tabButton}${selected ? ` ${styles.tabButtonActive}` : ''}`}
            onClick={() => onChange(tab.id)}
            data-testid={tabElementId}
          >
            <span>{tab.label}</span>
            {typeof tab.count === 'number' ? <span className={styles.tabCount}>{tab.count}</span> : null}
          </button>
        );
      })}
    </div>
  );
}

export function WorkspaceTabPanel<T extends string>({
  tabId,
  activeTab,
  idPrefix,
  children,
}: WorkspaceTabPanelProps<T>) {
  if (activeTab !== tabId) return null;

  return (
    <div
      id={`${idPrefix}-panel-${tabId}`}
      role="tabpanel"
      aria-labelledby={`${idPrefix}-tab-${tabId}`}
      className={styles.tabPanel}
      data-testid={`${idPrefix}-panel-${tabId}`}
    >
      {children}
    </div>
  );
}
