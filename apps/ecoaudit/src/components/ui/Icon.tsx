import type { SVGProps } from 'react';

export type IconName =
  | 'activity'
  | 'apps'
  | 'arrow-right'
  | 'battery'
  | 'building'
  | 'calendar'
  | 'camera'
  | 'check'
  | 'chevron-down'
  | 'chevron-right'
  | 'clipboard'
  | 'close'
  | 'cloud'
  | 'droplet'
  | 'file-text'
  | 'gauge'
  | 'grid'
  | 'leaf'
  | 'lightbulb'
  | 'lock'
  | 'log-out'
  | 'menu'
  | 'moon'
  | 'plug'
  | 'plus'
  | 'search'
  | 'settings'
  | 'shield'
  | 'snowflake'
  | 'sun'
  | 'user'
  | 'users'
  | 'wifi'
  | 'wifi-off'
  | 'zap';

type IconProps = SVGProps<SVGSVGElement> & {
  name: IconName;
  size?: number;
};

export function Icon({ name, size = 20, className = '', ...props }: IconProps) {
  const paths: Record<IconName, React.ReactNode> = {
    activity: <><path d="M3 12h4l2.5-7 5 14 2.5-7h4" /></>,
    apps: <><rect x="3" y="3" width="7" height="7" rx="1" /><rect x="14" y="3" width="7" height="7" rx="1" /><rect x="3" y="14" width="7" height="7" rx="1" /><rect x="14" y="14" width="7" height="7" rx="1" /></>,
    'arrow-right': <><path d="M5 12h14" /><path d="m13 6 6 6-6 6" /></>,
    battery: <><rect x="3" y="6" width="17" height="12" rx="2" /><path d="M20 10h2v4h-2" /><path d="m11 9-2 4h3l-1 3 4-5h-3l1-2" /></>,
    building: <><path d="M4 21V4a1 1 0 0 1 1-1h10a1 1 0 0 1 1 1v17" /><path d="M16 9h3a1 1 0 0 1 1 1v11" /><path d="M8 7h4M8 11h4M8 15h4M2 21h20" /></>,
    calendar: <><rect x="3" y="5" width="18" height="16" rx="2" /><path d="M16 3v4M8 3v4M3 10h18" /></>,
    camera: <><path d="M14.5 4 16 7h3a2 2 0 0 1 2 2v9a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V9a2 2 0 0 1 2-2h3l1.5-3z" /><circle cx="12" cy="13" r="3" /></>,
    check: <path d="m5 12 4 4L19 6" />,
    'chevron-down': <path d="m7 10 5 5 5-5" />,
    'chevron-right': <path d="m9 18 6-6-6-6" />,
    clipboard: <><rect x="5" y="4" width="14" height="17" rx="2" /><path d="M9 4.5V3h6v1.5M9 9h6M9 13h6M9 17h4" /></>,
    close: <><path d="m6 6 12 12M18 6 6 18" /></>,
    cloud: <path d="M17.5 19H7a5 5 0 0 1-.6-9.96A7 7 0 0 1 20 11.5 3.5 3.5 0 0 1 17.5 19Z" />,
    droplet: <path d="M12 3s6 6.2 6 11a6 6 0 0 1-12 0c0-4.8 6-11 6-11Z" />,
    'file-text': <><path d="M6 2h8l4 4v16H6z" /><path d="M14 2v5h5M9 13h6M9 17h6M9 9h2" /></>,
    gauge: <><path d="M4.9 19a9 9 0 1 1 14.2 0" /><path d="m12 13 4-4" /><circle cx="12" cy="13" r="1" /></>,
    grid: <><rect x="3" y="3" width="7" height="7" rx="1" /><rect x="14" y="3" width="7" height="7" rx="1" /><rect x="3" y="14" width="7" height="7" rx="1" /><rect x="14" y="14" width="7" height="7" rx="1" /></>,
    leaf: <><path d="M20 4c-8 0-14 4-14 10a6 6 0 0 0 6 6c6 0 8-7 8-16Z" /><path d="M4 21c2-6 7-10 13-13" /></>,
    lightbulb: <><path d="M9 18h6M10 22h4" /><path d="M8.5 15.5A7 7 0 1 1 15.5 15.5c-.9.7-1.5 1.5-1.5 2.5h-4c0-1-.6-1.8-1.5-2.5Z" /></>,
    lock: <><rect x="5" y="10" width="14" height="11" rx="2" /><path d="M8 10V7a4 4 0 0 1 8 0v3" /></>,
    'log-out': <><path d="M10 17l5-5-5-5M15 12H3" /><path d="M14 3h5a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2h-5" /></>,
    menu: <><path d="M4 7h16M4 12h16M4 17h16" /></>,
    moon: <path d="M20.5 14.5A8 8 0 0 1 9.5 3.5 8.5 8.5 0 1 0 20.5 14.5Z" />,
    plug: <><path d="M8 3v5M16 3v5M7 8h10v3a5 5 0 0 1-10 0zM12 16v5" /></>,
    plus: <><path d="M12 5v14M5 12h14" /></>,
    search: <><circle cx="11" cy="11" r="7" /><path d="m20 20-4-4" /></>,
    settings: <><circle cx="12" cy="12" r="3" /><path d="M19.4 15a1.7 1.7 0 0 0 .3 1.9l.1.1-2.8 2.8-.1-.1a1.7 1.7 0 0 0-1.9-.3 1.7 1.7 0 0 0-1 1.6v.2h-4V21a1.7 1.7 0 0 0-1-1.6 1.7 1.7 0 0 0-1.9.3l-.1.1L4.2 17l.1-.1a1.7 1.7 0 0 0 .3-1.9A1.7 1.7 0 0 0 3 14H2.8v-4H3a1.7 1.7 0 0 0 1.6-1 1.7 1.7 0 0 0-.3-1.9L4.2 7 7 4.2l.1.1A1.7 1.7 0 0 0 9 4.6a1.7 1.7 0 0 0 1-1.6v-.2h4V3a1.7 1.7 0 0 0 1 1.6 1.7 1.7 0 0 0 1.9-.3l.1-.1L19.8 7l-.1.1a1.7 1.7 0 0 0-.3 1.9 1.7 1.7 0 0 0 1.6 1h.2v4H21a1.7 1.7 0 0 0-1.6 1Z" /></>,
    shield: <><path d="M12 3 20 6v6c0 5-3.4 8-8 10-4.6-2-8-5-8-10V6z" /><path d="m9 12 2 2 4-4" /></>,
    snowflake: <><path d="M12 2v20M4.2 6.5l15.6 11M4.2 17.5l15.6-11" /><path d="m9 4 3 2 3-2M9 20l3-2 3 2M4.5 10l3 .2.5-3M20 14l-3-.2-.5 3" /></>,
    sun: <><circle cx="12" cy="12" r="4" /><path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4" /></>,
    user: <><circle cx="12" cy="8" r="4" /><path d="M4 21a8 8 0 0 1 16 0" /></>,
    users: <><circle cx="9" cy="8" r="3" /><path d="M3 20a6 6 0 0 1 12 0M16 4a3 3 0 0 1 0 6M17 14a5 5 0 0 1 4 5" /></>,
    wifi: <><path d="M5 12.6a10 10 0 0 1 14 0M8.5 16a5 5 0 0 1 7 0" /><circle cx="12" cy="20" r="1" /></>,
    'wifi-off': <><path d="m3 3 18 18M8.5 16a5 5 0 0 1 3.5-1.4M5 12.6a10 10 0 0 1 4.2-2.3M14.2 10.2a10 10 0 0 1 4.8 2.4" /><circle cx="12" cy="20" r="1" /></>,
    zap: <path d="m13 2-9 12h7l-1 8 9-12h-7z" />,
  };

  return (
    <svg
      aria-hidden="true"
      className={className}
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
      {paths[name]}
    </svg>
  );
}

export function BrandMark({ className = '' }: { className?: string }) {
  return (
    <span className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-[linear-gradient(135deg,#2563eb,#0f766e)] text-white shadow-[var(--shadow-brand)] ${className}`}>
      <Icon name="leaf" size={22} />
    </span>
  );
}

export function EquipmentIcon({ slug, className = '' }: { slug: string; className?: string }) {
  const icons: Record<string, IconName> = {
    'main-switchboards': 'zap',
    'additional-switchboards': 'plug',
    'hvac-units': 'snowflake',
    'lighting-systems': 'lightbulb',
    'solar-pv': 'sun',
    'forklift-chargers': 'battery',
    'hot-water-systems': 'droplet',
    'general-water': 'droplet',
    'general-electricity': 'gauge',
  };

  return <Icon name={icons[slug] ?? 'activity'} size={20} className={className} />;
}
