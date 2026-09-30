import type {
  ButtonHTMLAttributes,
  InputHTMLAttributes,
  ReactNode,
  SelectHTMLAttributes,
  TextareaHTMLAttributes
} from "react";
import styles from "./McpFoundation.module.css";

function cx(...values: Array<string | undefined | false>) {
  return values.filter(Boolean).join(" ");
}

export function McpScreen({ children, className }: { children: ReactNode; className?: string }) {
  return <div className={cx(styles.screen, className)}>{children}</div>;
}

export function McpStack({ children, className }: { children: ReactNode; className?: string }) {
  return <div className={cx(styles.stack, className)}>{children}</div>;
}

export function McpCard({ children, className }: { children: ReactNode; className?: string }) {
  return <section className={cx(styles.card, className)}>{children}</section>;
}

type McpButtonVariant = "primary" | "secondary" | "danger";

type McpButtonProps = ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: McpButtonVariant;
};

const buttonVariantClass: Record<McpButtonVariant, string> = {
  primary: styles.buttonPrimary,
  secondary: styles.buttonSecondary,
  danger: styles.buttonDanger
};

export function McpButton({ variant = "primary", className, type = "button", ...props }: McpButtonProps) {
  return <button {...props} className={cx(styles.button, buttonVariantClass[variant], className)} type={type} />;
}

type FieldFrameProps = {
  label: string;
  hint?: string;
  error?: string;
  children: ReactNode;
};

function FieldFrame({ label, hint, error, children }: FieldFrameProps) {
  return (
    <label className={styles.field}>
      <span className={styles.fieldLabel}>{label}</span>
      {children}
      {error ? <span className={styles.fieldError}>{error}</span> : hint ? <span className={styles.fieldHint}>{hint}</span> : null}
    </label>
  );
}

type McpInputProps = InputHTMLAttributes<HTMLInputElement> & {
  label: string;
  hint?: string;
  error?: string;
};

export function McpInput({ label, hint, error, className, ...props }: McpInputProps) {
  return (
    <FieldFrame label={label} hint={hint} error={error}>
      <input {...props} aria-invalid={error ? true : props["aria-invalid"]} className={cx(styles.input, className)} />
    </FieldFrame>
  );
}

type McpSelectProps = SelectHTMLAttributes<HTMLSelectElement> & {
  label: string;
  hint?: string;
  error?: string;
};

export function McpSelect({ label, hint, error, className, children, ...props }: McpSelectProps) {
  return (
    <FieldFrame label={label} hint={hint} error={error}>
      <select {...props} aria-invalid={error ? true : props["aria-invalid"]} className={cx(styles.select, className)}>
        {children}
      </select>
    </FieldFrame>
  );
}

type McpTextareaProps = TextareaHTMLAttributes<HTMLTextAreaElement> & {
  label: string;
  hint?: string;
  error?: string;
};

export function McpTextarea({ label, hint, error, className, ...props }: McpTextareaProps) {
  return (
    <FieldFrame label={label} hint={hint} error={error}>
      <textarea {...props} aria-invalid={error ? true : props["aria-invalid"]} className={cx(styles.textarea, className)} />
    </FieldFrame>
  );
}

export function McpSearchField({ className, ...props }: InputHTMLAttributes<HTMLInputElement>) {
  const accessibleLabel = props["aria-label"] || "Tìm kiếm";
  return (
    <label className={styles.search}>
      <span aria-hidden="true" className={styles.searchIcon}>⌕</span>
      <input
        {...props}
        aria-label={accessibleLabel}
        className={cx(styles.searchInput, className)}
        type="search"
      />
    </label>
  );
}

type StatusTone = "neutral" | "primary" | "success" | "warning" | "danger";

const statusToneClass: Record<StatusTone, string> = {
  neutral: styles.statusNeutral,
  primary: styles.statusPrimary,
  success: styles.statusSuccess,
  warning: styles.statusWarning,
  danger: styles.statusDanger
};

export function McpStatusPill({ children, tone = "neutral" }: { children: ReactNode; tone?: StatusTone }) {
  return <span className={cx(styles.statusPill, statusToneClass[tone])}>{children}</span>;
}

type McpPageHeaderProps = {
  title: string;
  description?: string;
  eyebrow?: string;
  actions?: ReactNode;
  className?: string;
};

export function McpPageHeader({ title, description, eyebrow, actions, className }: McpPageHeaderProps) {
  return (
    <header className={cx(styles.pageHeader, className)}>
      <div className={styles.pageHeaderCopy}>
        {eyebrow ? <p className={styles.eyebrow}>{eyebrow}</p> : null}
        <h1 className={styles.title}>{title}</h1>
        {description ? <p className={styles.description}>{description}</p> : null}
      </div>
      {actions ? <div className={styles.pageHeaderActions}>{actions}</div> : null}
    </header>
  );
}

type McpFilterChipProps = ButtonHTMLAttributes<HTMLButtonElement> & {
  active?: boolean;
};

export function McpFilterChip({ active = false, className, children, type = "button", ...props }: McpFilterChipProps) {
  return (
    <button
      {...props}
      aria-pressed={active}
      className={cx(styles.filterChip, active && styles.filterChipActive, className)}
      type={type}
    >
      {children}
    </button>
  );
}

export function McpFilterRow({ children, className }: { children: ReactNode; className?: string }) {
  return <div className={cx(styles.filterRow, className)}>{children}</div>;
}

type McpListRowProps = {
  leading?: ReactNode;
  title: ReactNode;
  description?: ReactNode;
  trailing?: ReactNode;
  onClick?: () => void;
  className?: string;
};

export function McpListRow({ leading, title, description, trailing, onClick, className }: McpListRowProps) {
  const content = (
    <>
      <div className={styles.listLeading}>{leading}</div>
      <div className={styles.listBody}>
        <div className={styles.listTitle}>{title}</div>
        {description ? <div className={styles.listDescription}>{description}</div> : null}
      </div>
      <div className={styles.listTrailing}>{trailing}</div>
    </>
  );

  if (onClick) {
    return (
      <button className={cx(styles.listRowInteractive, className)} onClick={onClick} type="button">
        {content}
      </button>
    );
  }

  return <article className={cx(styles.listRow, className)}>{content}</article>;
}

export function McpList({ children, className }: { children: ReactNode; className?: string }) {
  return <div className={cx(styles.list, className)}>{children}</div>;
}

type McpStatePanelProps = {
  title: string;
  description?: string;
  icon?: ReactNode;
  action?: ReactNode;
  className?: string;
};

export function McpStatePanel({ title, description, icon = "·", action, className }: McpStatePanelProps) {
  return (
    <section className={cx(styles.statePanel, className)}>
      <div className={styles.stateContent}>
        <span aria-hidden="true" className={styles.stateIcon}>{icon}</span>
        <h2 className={styles.stateTitle}>{title}</h2>
        {description ? <p className={styles.stateDescription}>{description}</p> : null}
        {action}
      </div>
    </section>
  );
}

export function McpSkeleton({ className, style }: { className?: string; style?: React.CSSProperties }) {
  return <span aria-hidden="true" className={cx(styles.skeleton, className)} style={style} />;
}
