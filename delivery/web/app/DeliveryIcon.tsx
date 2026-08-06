import type { ReactNode, SVGProps } from 'react';

export type DeliveryIconName =
  | 'back'
  | 'guide'
  | 'home'
  | 'route'
  | 'sync'
  | 'truck'
  | 'wallet';

type DeliveryIconProps = Readonly<{
  name: DeliveryIconName;
  size?: number;
}> & Omit<SVGProps<SVGSVGElement>, 'name'>;

export function DeliveryIcon({ name, size = 22, ...props }: DeliveryIconProps) {
  const common = {
    fill: 'none',
    stroke: 'currentColor',
    strokeLinecap: 'round' as const,
    strokeLinejoin: 'round' as const,
    strokeWidth: 1.8,
  };

  const paths = {
    back: (
      <>
        <path d="m15 18-6-6 6-6" />
        <path d="M9 12h10" />
      </>
    ),
    guide: (
      <>
        <path d="M5 4.5h10.5A2.5 2.5 0 0 1 18 7v12H7.5A2.5 2.5 0 0 1 5 16.5z" />
        <path d="M7.5 19A2.5 2.5 0 0 1 5 16.5 2.5 2.5 0 0 1 7.5 14H18" />
        <path d="M9 8h5" />
      </>
    ),
    home: (
      <>
        <path d="m3.5 10 8.5-7 8.5 7" />
        <path d="M5.5 9v11h13V9" />
        <path d="M9.5 20v-6h5v6" />
      </>
    ),
    route: (
      <>
        <circle cx="6" cy="18" r="2.25" />
        <circle cx="18" cy="6" r="2.25" />
        <path d="M8.25 18h2.25a3.5 3.5 0 0 0 3.5-3.5v-5A3.5 3.5 0 0 1 17.5 6" />
      </>
    ),
    sync: (
      <>
        <path d="M20 7v5h-5" />
        <path d="M4 17v-5h5" />
        <path d="M6.1 8.2A7 7 0 0 1 18.5 7L20 12" />
        <path d="M17.9 15.8A7 7 0 0 1 5.5 17L4 12" />
      </>
    ),
    truck: (
      <>
        <path d="M3 6h11v10H3z" />
        <path d="M14 9h3.5l3 3.5V16H14z" />
        <circle cx="7" cy="17.5" r="1.75" />
        <circle cx="17.5" cy="17.5" r="1.75" />
      </>
    ),
    wallet: (
      <>
        <path d="M4 6.5A2.5 2.5 0 0 1 6.5 4H18v16H6.5A2.5 2.5 0 0 1 4 17.5z" />
        <path d="M4 8h14" />
        <path d="M14 12h6v4h-6a2 2 0 1 1 0-4Z" />
      </>
    ),
  } satisfies Record<DeliveryIconName, ReactNode>;

  return (
    <svg
      aria-hidden="true"
      focusable="false"
      height={size}
      viewBox="0 0 24 24"
      width={size}
      {...common}
      {...props}
    >
      {paths[name]}
    </svg>
  );
}
