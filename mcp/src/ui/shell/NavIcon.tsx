import type { ReactNode, SVGProps } from "react";

export type NavIconName = "⌂" | "◇" | "◎" | "◉" | "▤" | "□" | "+" | "▣" | "◈" | "✓" | "⚙";

type NavIconProps = SVGProps<SVGSVGElement> & { name: NavIconName };

const paths: Record<NavIconName, ReactNode> = {
  "⌂": <><path d="M3 10.5 12 3l9 7.5"/><path d="M5.5 9.5V21h13V9.5"/><path d="M9.5 21v-7h5v7"/></>,
  "◇": <><path d="M12 3 4.5 7.5v9L12 21l7.5-4.5v-9L12 3Z"/><path d="m4.5 7.5 7.5 4.5 7.5-4.5M12 12v9"/></>,
  "◎": <><circle cx="6" cy="18" r="2"/><circle cx="18" cy="6" r="2"/><path d="M8 18h2.5a3.5 3.5 0 0 0 0-7H9a3 3 0 0 1 0-6h7"/></>,
  "◉": <><path d="M12 21s6-5.2 6-11a6 6 0 1 0-12 0c0 5.8 6 11 6 11Z"/><circle cx="12" cy="10" r="2"/></>,
  "▤": <><path d="M3 12a9 9 0 1 0 3-6.7L3 8"/><path d="M3 3v5h5M12 7v5l3 2"/></>,
  "□": <><circle cx="12" cy="8" r="3"/><path d="M5 21a7 7 0 0 1 14 0"/></>,
  "+": <><path d="M6 3h12v18H6z"/><path d="M9 7h6M9 11h6M9 15h4"/></>,
  "▣": <><path d="M4 20V10M10 20V4M16 20v-7M22 20H2"/></>,
  "◈": <><path d="M4 5h16v14H4z"/><path d="m8 12 2.5 2.5L16 9"/></>,
  "✓": <><path d="M9 5h11M9 12h11M9 19h11"/><path d="m3 5 1.5 1.5L7 4M3 12l1.5 1.5L7 11M3 19l1.5 1.5L7 18"/></>,
  "⚙": <><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.7 1.7 0 0 0 .3 1.9l.1.1-2.8 2.8-.1-.1a1.7 1.7 0 0 0-1.9-.3 1.7 1.7 0 0 0-1 1.6v.2h-4V21a1.7 1.7 0 0 0-1-1.6 1.7 1.7 0 0 0-1.9.3l-.1.1L4.2 17l.1-.1a1.7 1.7 0 0 0 .3-1.9A1.7 1.7 0 0 0 3 14H2.8v-4H3a1.7 1.7 0 0 0 1.6-1 1.7 1.7 0 0 0-.3-1.9L4.2 7 7 4.2l.1.1a1.7 1.7 0 0 0 1.9.3A1.7 1.7 0 0 0 10 3V2.8h4V3a1.7 1.7 0 0 0 1 1.6 1.7 1.7 0 0 0 1.9-.3l.1-.1L19.8 7l-.1.1a1.7 1.7 0 0 0-.3 1.9 1.7 1.7 0 0 0 1.6 1h.2v4H21a1.7 1.7 0 0 0-1.6 1Z"/></>
};

export function NavIcon({ name, ...props }: NavIconProps) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" focusable="false" {...props}>
      {paths[name]}
    </svg>
  );
}
