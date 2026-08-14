import type { ReactElement, ReactNode, SVGProps } from "react";

type IconProps = SVGProps<SVGSVGElement>;

function Icon({ children, ...props }: IconProps & { children: ReactNode }) {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" {...props}>
      {children}
    </svg>
  );
}

export const NAV_ICONS: Record<string, (props: IconProps) => ReactElement> = {
  dashboard: (p) => <Icon {...p}><rect x="3" y="3" width="7" height="9" rx="1.5" /><rect x="14" y="3" width="7" height="5" rx="1.5" /><rect x="14" y="12" width="7" height="9" rx="1.5" /><rect x="3" y="16" width="7" height="5" rx="1.5" /></Icon>,
  plusCircle: (p) => <Icon {...p}><circle cx="12" cy="12" r="9" /><path d="M12 8v8M8 12h8" /></Icon>,
  list: (p) => <Icon {...p}><path d="M8 6h13M8 12h13M8 18h13" /><circle cx="3.5" cy="6" r="1" fill="currentColor" stroke="none" /><circle cx="3.5" cy="12" r="1" fill="currentColor" stroke="none" /><circle cx="3.5" cy="18" r="1" fill="currentColor" stroke="none" /></Icon>,
  fileText: (p) => <Icon {...p}><path d="M6 3h9l5 5v13a1 1 0 0 1-1 1H6a1 1 0 0 1-1-1V4a1 1 0 0 1 1-1z" /><path d="M9 12h6M9 16h6" /></Icon>,
  inbox: (p) => <Icon {...p}><path d="M3 12h4l2 3h6l2-3h4" /><path d="M5 12 3 5h18l-2 7" strokeLinejoin="round" /><path d="M3 12v6a1 1 0 0 0 1 1h16a1 1 0 0 0 1-1v-6" /></Icon>,
  tag: (p) => <Icon {...p}><path d="M12 2l3 6 7 1-5 5 1 7-6-3-6 3 1-7-5-5 7-1z" strokeLinejoin="round" /></Icon>,
  users: (p) => <Icon {...p}><circle cx="9" cy="8" r="3.5" /><path d="M2 20c0-4 3-6.5 7-6.5s7 2.5 7 6.5" /><path d="M16 4.5a3.5 3.5 0 0 1 0 7" /><path d="M22 20c0-3-1.8-5.3-4.5-6.2" /></Icon>,
  bell: (p) => <Icon {...p}><path d="M6 10a6 6 0 1 1 12 0c0 5 2 6 2 6H4s2-1 2-6z" /><path d="M10 20a2 2 0 0 0 4 0" /></Icon>,
  settings: (p) => <Icon {...p}><circle cx="12" cy="12" r="3" /><path d="M19.4 15a1.7 1.7 0 0 0 .3 1.9l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.9-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1-1.6 1.7 1.7 0 0 0-1.9.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.9 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.6-1 1.7 1.7 0 0 0-.3-1.9l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.9.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.9-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.9V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1z" /></Icon>,
  building: (p) => <Icon {...p}><rect x="4" y="3" width="10" height="18" rx="1" /><rect x="14" y="8" width="6" height="13" rx="1" /><path d="M7 7h1M7 11h1M7 15h1M10 7h1M10 11h1M10 15h1" /></Icon>,
  mail: (p) => <Icon {...p}><rect x="3" y="5" width="18" height="14" rx="2" /><path d="m3 7 9 6 9-6" /></Icon>,
  history: (p) => <Icon {...p}><path d="M3 12a9 9 0 1 0 3-6.7" /><path d="M3 4v5h5" /><path d="M12 8v4l3 2" /></Icon>,
  briefcase: (p) => <Icon {...p}><rect x="3" y="7" width="18" height="13" rx="2" /><path d="M8 7V5a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" /><path d="M3 12h18" /></Icon>,
  userCircle: (p) => <Icon {...p}><circle cx="12" cy="12" r="9" /><circle cx="12" cy="10" r="3" /><path d="M6.5 19a6 6 0 0 1 11 0" /></Icon>,
  trendingUp: (p) => <Icon {...p}><path d="m3 17 6-6 4 4 8-8" /><path d="M15 7h6v6" /></Icon>,
  fileSignature: (p) => <Icon {...p}><path d="M14 3H6a1 1 0 0 0-1 1v16a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1V9z" /><path d="M14 3v6h6" /><path d="M8 16s1-1 2-1 1.5 1 2.5 1 1.5-2 1.5-2" /></Icon>,
  receipt: (p) => <Icon {...p}><path d="M6 2h12v19l-3-2-3 2-3-2-3 2z" strokeLinejoin="round" /><path d="M9 8h6M9 12h6" /></Icon>,
  creditCard: (p) => <Icon {...p}><rect x="2" y="5" width="20" height="14" rx="2" /><path d="M2 10h20" /><path d="M6 15h4" /></Icon>,
  lifeBuoy: (p) => <Icon {...p}><circle cx="12" cy="12" r="9" /><circle cx="12" cy="12" r="3.5" /><path d="m7.5 7.5 2.6 2.6M16.5 7.5l-2.6 2.6M7.5 16.5l2.6-2.6M16.5 16.5l-2.6-2.6" /></Icon>,
  checkSquare: (p) => <Icon {...p}><rect x="3" y="3" width="18" height="18" rx="2" /><path d="m8 12 3 3 6-6" /></Icon>,
  calendar: (p) => <Icon {...p}><rect x="3" y="4" width="18" height="17" rx="2" /><path d="M3 9h18M8 2v4M16 2v4" /></Icon>,
  folder: (p) => <Icon {...p}><path d="M3 6a1 1 0 0 1 1-1h5l2 2h9a1 1 0 0 1 1 1v11a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1z" strokeLinejoin="round" /></Icon>,
  zap: (p) => <Icon {...p}><path d="M13 2 4 14h7l-1 8 9-12h-7z" strokeLinejoin="round" /></Icon>,
  chevronDown: (p) => <Icon {...p}><path d="m6 9 6 6 6-6" /></Icon>,
  menu: (p) => <Icon {...p}><path d="M3 6h18M3 12h18M3 18h18" /></Icon>,
  x: (p) => <Icon {...p}><path d="M6 6l12 12M18 6 6 18" /></Icon>,
  panelLeft: (p) => <Icon {...p}><rect x="3" y="4" width="18" height="16" rx="2" /><path d="M9 4v16" /></Icon>,
  clock: (p) => <Icon {...p}><circle cx="12" cy="12" r="9" /><path d="M12 7v5l3 3" /></Icon>,
  gauge: (p) => <Icon {...p}><path d="M4 13a8 8 0 1 1 16 0" /><path d="M12 13l4-4" /><circle cx="12" cy="13" r="1" fill="currentColor" stroke="none" /></Icon>,
  alertTriangle: (p) => <Icon {...p}><path d="M12 3 2.8 20h18.4L12 3z" /><path d="M12 9v4" /><circle cx="12" cy="16.5" r=".8" fill="currentColor" stroke="none" /></Icon>,
  info: (p) => <Icon {...p}><circle cx="12" cy="12" r="9" /><path d="M12 11v5" /><circle cx="12" cy="8" r="1" fill="currentColor" stroke="none" /></Icon>,
  phone: (p) => <Icon {...p}><path d="M4 4h4l2 5-2.5 1.5a11 11 0 0 0 5 5L14 13l5 2v4a2 2 0 0 1-2 2A15 15 0 0 1 4 6a2 2 0 0 1 0-2z" strokeLinejoin="round" /></Icon>,
  star: (p) => <Icon {...p}><path d="M12 2.5l2.9 6 6.6.9-4.8 4.6 1.1 6.5L12 17.3 6.2 20.5l1.1-6.5-4.8-4.6 6.6-.9z" strokeLinejoin="round" /></Icon>,
  eye: (p) => <Icon {...p}><path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7-10-7-10-7z" /><circle cx="12" cy="12" r="3" /></Icon>,
  mapPin: (p) => <Icon {...p}><path d="M12 21s7-6.5 7-12a7 7 0 1 0-14 0c0 5.5 7 12 7 12z" strokeLinejoin="round" /><circle cx="12" cy="9" r="2.5" /></Icon>,
  search: (p) => <Icon {...p}><circle cx="11" cy="11" r="7" /><path d="m20 20-3.5-3.5" /></Icon>,
  barChart: (p) => <Icon {...p}><path d="M4 20V10M12 20V4M20 20v-7" /></Icon>,
  upload: (p) => <Icon {...p}><path d="M12 16V4M7 9l5-5 5 5" /><path d="M4 20h16" /></Icon>,
  megaphone: (p) => <Icon {...p}><path d="m3 11 18-5v12L3 13v-2z" strokeLinejoin="round" /><path d="M11.6 16.8a3 3 0 1 1-5.8-1.6" /></Icon>,
};

export type NavIconName = keyof typeof NAV_ICONS;
