import type { IconName } from '@/components/ui/Icon';

export type SchedulerTab =
  | 'overview'
  | 'calendar'
  | 'my-route'
  | 'deadlines'
  | 'inventory'
  | 'meter-register'
  | 'finance-analytics'
  | 'financial-summary'
  | 'bills'
  | 'invoices';

export type SchedulerNavigationItem = {
  id: SchedulerTab;
  label: string;
  icon: IconName;
};

export type SchedulerNavigationGroup = {
  id: 'planning' | 'finance' | 'inventory';
  label: string;
  icon: IconName;
  adminOnly: boolean;
  items: SchedulerNavigationItem[];
};

export const SCHEDULER_NAVIGATION_GROUPS: SchedulerNavigationGroup[] = [
  {
    id: 'planning',
    label: 'Planning',
    icon: 'calendar',
    adminOnly: false,
    items: [
      { id: 'overview', label: 'Overview', icon: 'gauge' },
      { id: 'calendar', label: 'Calendar', icon: 'calendar' },
      { id: 'my-route', label: 'My route', icon: 'map-pin' },
      { id: 'deadlines', label: 'Deadlines', icon: 'clipboard' },
    ],
  },
  {
    id: 'finance',
    label: 'Finance',
    icon: 'file-text',
    adminOnly: true,
    items: [
      { id: 'finance-analytics', label: 'Analytics', icon: 'activity' },
      { id: 'financial-summary', label: 'Summary', icon: 'gauge' },
      { id: 'bills', label: 'Bills & expenses', icon: 'file-text' },
      { id: 'invoices', label: 'Invoices', icon: 'file-text' },
    ],
  },
  {
    id: 'inventory',
    label: 'Inventory',
    icon: 'clipboard',
    adminOnly: true,
    items: [
      { id: 'inventory', label: 'Dashboard', icon: 'grid' },
      { id: 'meter-register', label: 'Meter Register', icon: 'gauge' },
    ],
  },
];

export function schedulerTabFromQuery(
  tabValue: string | null | undefined,
  invoiceId?: string | null,
): SchedulerTab {
  const direct = SCHEDULER_NAVIGATION_GROUPS
    .flatMap((group) => group.items)
    .find((item) => item.id === tabValue)?.id;
  if (direct) return direct;
  if (tabValue === 'finance') return invoiceId ? 'invoices' : 'financial-summary';
  return 'calendar';
}

export function schedulerTabIsAdminOnly(tab: SchedulerTab): boolean {
  return SCHEDULER_NAVIGATION_GROUPS.some(
    (group) => group.adminOnly && group.items.some((item) => item.id === tab),
  );
}

export function schedulerTabHref(tab: SchedulerTab): string {
  return `/scheduler?tab=${encodeURIComponent(tab)}`;
}
