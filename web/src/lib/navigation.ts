import {
  BarChart3,
  ClipboardList,
  FileArchive,
  FileText,
  Gauge,
  Images,
  LayoutDashboard,
  MapPinned,
  Settings,
  ShieldCheck,
  SlidersHorizontal,
  Users,
  Wrench,
  type LucideIcon,
} from 'lucide-react';
import type { AppId, Role } from './types';

export interface AppMeta {
  id: AppId;
  label: string;
  shortLabel: string;
  accent: string;
  description: string;
}

export interface NavItem {
  label: string;
  path: string;
  icon: LucideIcon;
  adminOnly?: boolean;
}

export const apps: Record<AppId, AppMeta> = {
  solarsense: {
    id: 'solarsense',
    label: 'SolarSense',
    shortLabel: 'SS',
    accent: '#0f766e',
    description: 'Solar site packs and rooftop assessments',
  },
  ecoaudit: {
    id: 'ecoaudit',
    label: 'EcoAudit Pro',
    shortLabel: 'EA',
    accent: '#2563eb',
    description: 'Audits, zones, equipment, photos, and reports',
  },
};

export const appOrder: AppId[] = ['solarsense', 'ecoaudit'];

export const appNav: Record<AppId, NavItem[]> = {
  solarsense: [
    { label: 'Overview', path: '/solarsense', icon: LayoutDashboard },
    { label: 'Sites', path: '/solarsense/sites', icon: MapPinned },
    { label: 'Assessments', path: '/solarsense/assessments', icon: ClipboardList },
    { label: 'Photos', path: '/solarsense/photos', icon: Images },
    { label: 'PDFs', path: '/solarsense/reports', icon: FileText },
    { label: 'ZIP Downloads', path: '/solarsense/exports', icon: FileArchive },
    { label: 'Admin', path: '/solarsense/admin', icon: Users, adminOnly: true },
  ],
  ecoaudit: [
    { label: 'Overview', path: '/ecoaudit', icon: LayoutDashboard },
    { label: 'Audits', path: '/ecoaudit/audits', icon: ClipboardList },
    { label: 'Zones', path: '/ecoaudit/zones', icon: MapPinned },
    { label: 'Equipment', path: '/ecoaudit/equipment', icon: Wrench },
    { label: 'Photos', path: '/ecoaudit/photos', icon: Images },
    { label: 'PDFs', path: '/ecoaudit/reports', icon: FileText },
    { label: 'ZIP Downloads', path: '/ecoaudit/exports', icon: FileArchive },
    { label: 'Admin', path: '/ecoaudit/admin', icon: Users, adminOnly: true },
  ],
};

export const utilityNav: NavItem[] = [
  { label: 'Settings', path: '/settings', icon: Settings },
  { label: 'Diagnostics', path: '/diagnostics', icon: Gauge },
  { label: 'API Keys', path: '/api-keys', icon: ShieldCheck, adminOnly: true },
  { label: 'System', path: '/system', icon: SlidersHorizontal, adminOnly: true },
  { label: 'Backlog', path: '/backlog', icon: BarChart3 },
];

export function isAdmin(role: Role): boolean {
  return role === 'admin';
}

export function appForPath(pathname: string): AppId | null {
  if (pathname.startsWith('/solarsense')) return 'solarsense';
  if (pathname.startsWith('/ecoaudit')) return 'ecoaudit';
  return null;
}

export function pathRequiresAdmin(pathname: string): boolean {
  return pathname.endsWith('/admin') || pathname === '/api-keys' || pathname === '/system';
}

export function defaultPathForApp(app: AppId): string {
  return `/${app}`;
}

export function navigate(path: string): void {
  window.history.pushState({}, '', path);
  window.dispatchEvent(new PopStateEvent('popstate'));
}

