import type { IconName } from '@/components/ui/Icon';

export type PortalApplicationAccess =
  | 'ecoaudit'
  | 'solarsense'
  | 'installhub'
  | 'wattwatchers';

export type PortalApplication = {
  href: string;
  title: string;
  eyebrow: string;
  description: string;
  icon: IconName;
  tone: string;
  access: PortalApplicationAccess;
};

export type PortalApplicationSessions = Record<PortalApplicationAccess, boolean>;

export const PORTAL_APPLICATIONS: readonly PortalApplication[] = [
  {
    href: '/ecoaudit/dashboard',
    title: 'EcoAudit Pro',
    eyebrow: 'Energy operations',
    description: 'Site energy audits, zones, equipment, photos, and PDF reports.',
    icon: 'leaf',
    tone: 'bg-emerald-500/10 text-emerald-700 dark:text-emerald-300',
    access: 'ecoaudit',
  },
  {
    href: '/solar/dashboard',
    title: 'Solar Sense',
    eyebrow: 'Solar assessment',
    description: 'Solar sites, assessments, photo packs, and cloud backup.',
    icon: 'sun',
    tone: 'bg-amber-500/12 text-amber-700 dark:text-amber-300',
    access: 'solarsense',
  },
  {
    href: '/fleet/dashboard',
    title: 'Wattwatchers Fleet',
    eyebrow: 'Device operations',
    description: 'Fleet connectivity, offline devices, client performance, reports, and collection health.',
    icon: 'activity',
    tone: 'bg-blue-500/10 text-blue-700 dark:text-blue-300',
    access: 'wattwatchers',
  },
  {
    href: '/field',
    title: 'Field App Complete',
    eyebrow: 'Mobile operations',
    description: 'Open Field App Complete for installations, field forms, evidence capture, and report packs.',
    icon: 'clipboard',
    tone: 'bg-cyan-500/10 text-cyan-700 dark:text-cyan-300',
    access: 'installhub',
  },
];

export function isPortalApplicationListed(access: PortalApplicationAccess): boolean {
  return PORTAL_APPLICATIONS.some((application) => application.access === access);
}

export function portalApplicationIsVisible(
  access: PortalApplicationAccess,
  sessions: PortalApplicationSessions,
  solarSenseVisible: boolean,
): boolean {
  if (access === 'solarsense') {
    return solarSenseVisible && sessions.solarsense;
  }
  return true;
}

export function visiblePortalApplications(
  sessions: PortalApplicationSessions,
  solarSenseVisible: boolean,
): readonly PortalApplication[] {
  return PORTAL_APPLICATIONS.filter((application) => portalApplicationIsVisible(
    application.access,
    sessions,
    solarSenseVisible,
  ));
}
