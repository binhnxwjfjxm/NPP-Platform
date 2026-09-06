type Props = {
  known: boolean;
  hasImage: boolean;
};

export default function ProductImageStatusIcon({ known, hasImage }: Props) {
  const label = !known ? 'Chưa kiểm tra ảnh' : hasImage ? 'Có ảnh' : 'Thiếu ảnh';
  return (
    <span
      title={label}
      aria-label={label}
      data-image-status={!known ? 'unknown' : hasImage ? 'present' : 'missing'}
      style={{ display: 'inline-grid', placeItems: 'center', width: 24, height: 24 }}
    >
      <svg width="17" height="17" viewBox="0 0 24 24" fill="none" aria-hidden="true">
        <rect x="3" y="4" width="18" height="16" rx="3" stroke="currentColor" strokeWidth="1.8" />
        <circle cx="9" cy="9" r="1.7" fill="currentColor" />
        <path d="M5.5 17l4.2-4.2 3 3 2.2-2.2 3.6 3.4" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
        {known && hasImage ? <path d="M15.5 7.5l1.4 1.4 2.8-3" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" /> : null}
        {known && !hasImage ? <path d="M6 6l12 12" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" /> : null}
        {!known ? <path d="M12 7.1c1.8 0 3 1 3 2.5 0 1.2-.7 1.9-1.8 2.5-.8.4-1.2.8-1.2 1.6" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" /> : null}
      </svg>
    </span>
  );
}
