import {
  ClipboardCheck,
  ClipboardList,
  FileArchive,
  FileText,
  Images,
  MapPinned,
  ShieldCheck,
  Users,
  Wrench,
  type LucideIcon,
} from 'lucide-react';
import { apps } from '../lib/navigation';
import type { AppId } from '../lib/types';
import { BusinessWorkflowPanels } from '../components/BusinessWorkflowPanels';

interface ModulePageProps {
  app: AppId;
  pathname: string;
}

interface Surface {
  path: string;
  title: string;
  icon: LucideIcon;
  items: string[];
}

const surfaces: Record<AppId, Surface[]> = {
  solarsense: [
    {
      path: '/solarsense',
      title: 'SolarSense Overview',
      icon: ClipboardCheck,
      items: ['Site packs', 'Rooftop assessments', 'Photos', 'PDFs', 'ZIP exports'],
    },
    {
      path: '/solarsense/sites',
      title: 'Sites',
      icon: MapPinned,
      items: ['Create', 'View', 'Copy', 'Edit', 'Delete', 'Complete'],
    },
    {
      path: '/solarsense/assessments',
      title: 'Assessments',
      icon: ClipboardList,
      items: ['Roof data', 'Electrical data', 'Switchboards', 'Other considerations'],
    },
    {
      path: '/solarsense/photos',
      title: 'Photos',
      icon: Images,
      items: ['Aerial photos', 'MSB photos', 'Additional photos', 'Appendix files'],
    },
    {
      path: '/solarsense/reports',
      title: 'PDFs',
      icon: FileText,
      items: ['Site pack generation', 'Job progress', 'Download', 'Regenerate'],
    },
    {
      path: '/solarsense/exports',
      title: 'ZIP Downloads',
      icon: FileArchive,
      items: ['Photo selection', 'All-photo export', 'Download status'],
    },
    {
      path: '/solarsense/admin',
      title: 'SolarSense Admin',
      icon: Users,
      items: ['Users', 'Inspectors', 'Roles', 'Access'],
    },
  ],
  ecoaudit: [
    {
      path: '/ecoaudit',
      title: 'EcoAudit Pro Overview',
      icon: ClipboardCheck,
      items: ['Audits', 'Zones', 'Equipment', 'Photos', 'PDFs', 'ZIP exports'],
    },
    {
      path: '/ecoaudit/audits',
      title: 'Audits',
      icon: ClipboardList,
      items: ['Create', 'View', 'Copy', 'Edit', 'Delete', 'Complete'],
    },
    {
      path: '/ecoaudit/zones',
      title: 'Zones',
      icon: MapPinned,
      items: ['Zone details', 'Zone photos', 'Photo descriptions', 'Equipment grouping'],
    },
    {
      path: '/ecoaudit/equipment',
      title: 'Equipment',
      icon: Wrench,
      items: ['Switchboards', 'HVAC', 'Lighting', 'Solar PV', 'Water', 'Electricity'],
    },
    {
      path: '/ecoaudit/photos',
      title: 'Photos',
      icon: Images,
      items: ['Zone photos', 'Equipment photos', 'Photo descriptions', 'Backup status'],
    },
    {
      path: '/ecoaudit/reports',
      title: 'PDFs',
      icon: FileText,
      items: ['Audit report generation', 'Job progress', 'Download', 'Regenerate'],
    },
    {
      path: '/ecoaudit/exports',
      title: 'ZIP Downloads',
      icon: FileArchive,
      items: ['Photo selection', 'All-photo export', 'Download status'],
    },
    {
      path: '/ecoaudit/admin',
      title: 'EcoAudit Pro Admin',
      icon: Users,
      items: ['Users', 'Inspectors', 'Roles', 'Access'],
    },
  ],
};

function findSurface(app: AppId, pathname: string): Surface {
  return surfaces[app].find((surface) => surface.path === pathname) ?? surfaces[app][0];
}

export function ModulePage({ app, pathname }: ModulePageProps) {
  const surface = findSurface(app, pathname);
  const Icon = surface.icon;
  const appMeta = apps[app];

  return (
    <section className="page-stack">
      <header className="page-header">
        <div>
          <p className="eyebrow">{appMeta.label}</p>
          <h1>{surface.title}</h1>
        </div>
        <span className="status-pill">
          <ShieldCheck aria-hidden="true" />
          Phase 2 workflow
        </span>
      </header>

      <div className="overview-grid">
        <article className="feature-panel primary-panel">
          <div className="panel-icon" style={{ color: appMeta.accent }}>
            <Icon aria-hidden="true" />
          </div>
          <div>
            <h2>{surface.title}</h2>
            <p>{appMeta.description}</p>
          </div>
        </article>

        <article className="feature-panel">
          <h2>Access Model</h2>
          <ul className="check-list">
            <li>JWT session</li>
            <li>App namespace isolation</li>
            <li>Admin-only navigation</li>
            <li>Inspector/user navigation</li>
          </ul>
        </article>
      </div>

      <section className="surface-list" aria-label={`${surface.title} scope`}>
        {surface.items.map((item) => (
          <article className="surface-item" key={item}>
            <span className="surface-dot" style={{ background: appMeta.accent }} />
            <strong>{item}</strong>
          </article>
        ))}
      </section>

      <BusinessWorkflowPanels app={app} surfacePath={surface.path} surfaceTitle={surface.title} />
    </section>
  );
}
