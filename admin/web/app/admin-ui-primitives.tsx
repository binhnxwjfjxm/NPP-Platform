import Link from 'next/link';
import type { ReactNode } from 'react';
import { AdminIcon, type AdminIconName } from './admin-icons';

export type AdminStatusTone = 'neutral' | 'info' | 'success' | 'attention' | 'danger';
export type AdminStateTone = 'loading' | 'empty' | 'partial' | 'error' | 'forbidden' | 'ok';
export type AdminKpiTone = 'neutral' | 'success' | 'attention' | 'danger';

function classNames(...values: Array<string | false | null | undefined>) {
  return values.filter(Boolean).join(' ');
}

export function AdminToolbar({
  label,
  children,
  actions,
  className,
}: {
  label: string;
  children: ReactNode;
  actions?: ReactNode;
  className?: string;
}) {
  return (
    <section className={classNames('adminToolbar', className)} aria-label={label}>
      <div className="adminToolbarControls">{children}</div>
      {actions ? <div className="adminToolbarActions">{actions}</div> : null}
    </section>
  );
}

export function AdminFilterChip({
  href,
  label,
  active = false,
  icon,
  badge,
}: {
  href: string;
  label: string;
  active?: boolean;
  icon?: AdminIconName;
  badge?: ReactNode;
}) {
  return (
    <Link className={active ? 'adminFilterChip isActive' : 'adminFilterChip'} href={href} aria-current={active ? 'page' : undefined}>
      {icon ? <AdminIcon name={icon} size={16} /> : null}
      <span>{label}</span>
      {badge !== undefined && badge !== null ? <small>{badge}</small> : null}
    </Link>
  );
}

export function AdminStatusBadge({
  children,
  tone = 'neutral',
  className,
}: {
  children: ReactNode;
  tone?: AdminStatusTone;
  className?: string;
}) {
  return <span className={classNames('adminStatusBadge', `is-${tone}`, className)}>{children}</span>;
}

export function AdminKpiGrid({ label, children, className }: { label: string; children: ReactNode; className?: string }) {
  return <section className={classNames('adminKpiGrid', className)} aria-label={label}>{children}</section>;
}

export function AdminKpiCard({
  label,
  value,
  note,
  icon,
  href,
  tone = 'neutral',
}: {
  label: ReactNode;
  value: ReactNode;
  note?: ReactNode;
  icon?: AdminIconName;
  href?: string;
  tone?: AdminKpiTone;
}) {
  const content = (
    <>
      {icon ? <span className="adminKpiIcon"><AdminIcon name={icon} size={19} /></span> : null}
      <span className="adminKpiCopy">
        <span>{label}</span>
        <strong>{value}</strong>
        {note ? <small>{note}</small> : null}
      </span>
    </>
  );
  const className = classNames('adminKpiCard', `is-${tone}`, href && 'isInteractive');
  return href ? <Link className={className} href={href}>{content}</Link> : <div className={className}>{content}</div>;
}

export function AdminStatePanel({
  title,
  message,
  tone = 'empty',
  icon,
  actions,
  className,
}: {
  title: ReactNode;
  message?: ReactNode;
  tone?: AdminStateTone;
  icon?: AdminIconName;
  actions?: ReactNode;
  className?: string;
}) {
  const role = tone === 'error' || tone === 'forbidden' ? 'alert' : 'status';
  return (
    <section className={classNames('adminStatePanel', `is-${tone}`, className)} role={role}>
      {icon ? <span className="adminStateIcon"><AdminIcon name={icon} size={20} /></span> : null}
      <span className="adminStateCopy"><strong>{title}</strong>{message ? <span>{message}</span> : null}</span>
      {actions ? <div className="adminStateActions">{actions}</div> : null}
    </section>
  );
}

export function AdminActionBar({
  label,
  children,
  note,
  className,
}: {
  label: string;
  children: ReactNode;
  note?: ReactNode;
  className?: string;
}) {
  return (
    <section className={classNames('adminActionBar', className)} aria-label={label}>
      <div className="adminActionBarActions">{children}</div>
      {note ? <small className="adminActionBarNote">{note}</small> : null}
    </section>
  );
}
