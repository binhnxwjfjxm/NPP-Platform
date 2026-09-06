type Props = {
  known: boolean;
  hasImage: boolean;
};

export default function ProductImageStatusIcon({ known, hasImage }: Props) {
  const state = !known ? 'unknown' : hasImage ? 'present' : 'missing';
  const label = state === 'unknown' ? 'Chưa kiểm tra ảnh' : state === 'present' ? 'Có ảnh' : 'Thiếu ảnh';
  const color = state === 'present'
    ? 'var(--hp-primary-strong, #205f3d)'
    : state === 'missing'
      ? 'var(--hp-danger, #b54747)'
      : 'var(--hp-muted, #66746b)';

  return (
    <span
      title={label}
      aria-label={label}
      data-image-status={state}
      style={{ display: 'inline-grid', placeItems: 'center', width: 24, height: 24, color }}
    >
      {state === 'present' ? (
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" aria-hidden="true">
          <rect x="2.8" y="4" width="18.4" height="16" rx="3" stroke="currentColor" strokeWidth="1.8" />
          <circle cx="8.4" cy="9" r="1.6" fill="currentColor" />
          <path d="M5.3 16.7l4-4 2.8 2.8 2.1-2.1 2.3 2.2" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" />
          <circle cx="18" cy="7" r="4" fill="var(--hp-surface, #fff)" stroke="currentColor" strokeWidth="1.7" />
          <path d="M16.2 7l1.2 1.2 2.4-2.5" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      ) : state === 'missing' ? (
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" aria-hidden="true">
          <rect x="2.8" y="4" width="18.4" height="16" rx="3" stroke="currentColor" strokeWidth="1.8" strokeDasharray="3 2" />
          <path d="M6 8l12 8M18 8L6 16" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
        </svg>
      ) : (
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" aria-hidden="true">
          <circle cx="12" cy="12" r="9" stroke="currentColor" strokeWidth="1.8" />
          <path d="M9.6 9.3c.3-1.8 1.5-2.8 3.3-2.8 1.9 0 3.2 1.1 3.2 2.8 0 1.4-.8 2.2-2.1 2.9-1 .5-1.5 1-1.5 2.2" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
          <circle cx="12.5" cy="17.7" r="1" fill="currentColor" />
        </svg>
      )}
    </span>
  );
}
