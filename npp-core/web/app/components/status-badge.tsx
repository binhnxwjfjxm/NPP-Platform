import styles from './status-badge.module.css';

export type StatusTone = 'neutral' | 'info' | 'progress' | 'warning' | 'success' | 'danger';

type StatusBadgeProps = Readonly<{
  status: string;
  label: string;
  tone?: StatusTone;
  className?: string;
}>;

const TONES: Readonly<Record<string, StatusTone>> = {
  draft: 'neutral',
  inactive: 'neutral',
  pending: 'neutral',
  new: 'neutral',
  ready: 'info',
  ready_to_dispatch: 'info',
  open: 'info',
  queued: 'info',
  planned: 'progress',
  dispatched: 'progress',
  processing: 'progress',
  in_progress: 'progress',
  locked: 'warning',
  partial: 'warning',
  overdue: 'warning',
  blocked: 'warning',
  handed_over: 'success',
  received: 'success',
  completed: 'success',
  posted: 'success',
  active: 'success',
  paid: 'success',
  reconciled: 'success',
  cancelled: 'danger',
  canceled: 'danger',
  failed: 'danger',
  rejected: 'danger',
  void: 'danger',
  error: 'danger',
};

export function statusToneFor(status: string): StatusTone {
  return TONES[status.trim().toLowerCase().replace(/-/g, '_')] ?? 'neutral';
}

export function StatusBadge({ status, label, tone = statusToneFor(status), className }: StatusBadgeProps) {
  return (
    <span
      className={`${styles.badge} ${styles[tone]}${className ? ` ${className}` : ''}`}
      data-status={status}
      data-tone={tone}
    >
      {label}
    </span>
  );
}
