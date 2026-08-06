import type { ReactNode, SVGProps } from 'react';

type AdminIconName =
  | 'overview'
  | 'exception'
  | 'menu'
  | 'branch'
  | 'warehouse'
  | 'location'
  | 'clipboard'
  | 'tag'
  | 'user'
  | 'coin'
  | 'operations'
  | 'mobile'
  | 'truck'
  | 'document'
  | 'userPlus'
  | 'info'
  | 'chevronRight'
  | 'chevronDown'
  | 'external'
  | 'back'
  | 'lock'
  | 'check';

function glyph(name: AdminIconName): ReactNode {
  switch (name) {
    case 'overview':
      return <><path d="M4 20V10" /><path d="M10 20V4" /><path d="M16 20v-7" /><path d="M22 20H2" /></>;
    case 'exception':
      return <><path d="M12 3 4 6v5c0 5.2 3.4 8.8 8 10 4.6-1.2 8-4.8 8-10V6l-8-3Z" /><path d="M12 8v5" /><path d="M12 17h.01" /></>;
    case 'menu':
      return <><rect x="3" y="3" width="6" height="6" rx="1" /><rect x="15" y="3" width="6" height="6" rx="1" /><rect x="3" y="15" width="6" height="6" rx="1" /><rect x="15" y="15" width="6" height="6" rx="1" /></>;
    case 'branch':
      return <><path d="M4 21V8l8-4 8 4v13" /><path d="M8 21v-5h8v5" /><path d="M8 10h.01M12 10h.01M16 10h.01M8 13h.01M12 13h.01M16 13h.01" /></>;
    case 'warehouse':
      return <><path d="m3 10 9-7 9 7" /><path d="M5 9v12h14V9" /><path d="M9 21v-7h6v7" /></>;
    case 'location':
      return <><path d="M20 10c0 5-8 11-8 11S4 15 4 10a8 8 0 1 1 16 0Z" /><circle cx="12" cy="10" r="2.5" /></>;
    case 'clipboard':
      return <><rect x="5" y="4" width="14" height="17" rx="2" /><path d="M9 4.5V3h6v1.5" /><path d="M9 9h6M9 13h6M9 17h4" /></>;
    case 'tag':
      return <><path d="M20 13 13 20 4 11V4h7l9 9Z" /><circle cx="8.5" cy="8.5" r="1" /></>;
    case 'user':
      return <><circle cx="12" cy="8" r="4" /><path d="M4.5 21a7.5 7.5 0 0 1 15 0" /></>;
    case 'coin':
      return <><circle cx="12" cy="12" r="9" /><path d="M15 8.5c-.7-.8-1.6-1.2-3-1.2-1.8 0-3 .9-3 2.2 0 3.4 6 1.7 6 5 0 1.4-1.3 2.4-3.2 2.4-1.5 0-2.6-.5-3.4-1.4" /><path d="M12 5.5v13" /></>;
    case 'operations':
      return <><rect x="3" y="7" width="18" height="12" rx="2" /><path d="M8 7V5h8v2M3 12h18M10 12v2h4v-2" /></>;
    case 'mobile':
      return <><rect x="7" y="2" width="10" height="20" rx="2" /><path d="M11 18h2" /></>;
    case 'truck':
      return <><path d="M3 6h11v10H3z" /><path d="M14 10h4l3 3v3h-7z" /><circle cx="7" cy="18" r="2" /><circle cx="18" cy="18" r="2" /></>;
    case 'document':
      return <><path d="M6 3h8l4 4v14H6z" /><path d="M14 3v5h5M9 12h6M9 16h6" /></>;
    case 'userPlus':
      return <><circle cx="9" cy="8" r="4" /><path d="M2 21a7 7 0 0 1 14 0M19 8v6M16 11h6" /></>;
    case 'info':
      return <><circle cx="12" cy="12" r="9" /><path d="M12 11v6M12 7h.01" /></>;
    case 'chevronRight':
      return <path d="m9 18 6-6-6-6" />;
    case 'chevronDown':
      return <path d="m6 9 6 6 6-6" />;
    case 'external':
      return <><path d="M14 4h6v6" /><path d="m10 14 10-10" /><path d="M20 14v5a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2h5" /></>;
    case 'back':
      return <><path d="m15 18-6-6 6-6" /><path d="M9 12h11" /></>;
    case 'lock':
      return <><rect x="5" y="10" width="14" height="11" rx="2" /><path d="M8 10V7a4 4 0 0 1 8 0v3" /></>;
    case 'check':
      return <path d="m5 12 4 4L19 6" />;
  }
}

export function AdminIcon({
  name,
  size = 24,
  ...props
}: SVGProps<SVGSVGElement> & { name: AdminIconName; size?: number }) {
  return (
    <svg
      aria-hidden="true"
      fill="none"
      height={size}
      viewBox="0 0 24 24"
      width={size}
      stroke="currentColor"
      strokeLinecap="round"
      strokeLinejoin="round"
      strokeWidth="1.8"
      {...props}
    >
      {glyph(name)}
    </svg>
  );
}
