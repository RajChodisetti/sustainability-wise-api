import Link from 'next/link';
import { Card, PageHeader } from '@/components/ui/Card';

const apps = [
  {
    href: '/ecoaudit/dashboard',
    title: 'Eco Audit',
    description: 'Site energy audits, zones, equipment, photos, and PDF reports.',
  },
  {
    href: '/solar/dashboard',
    title: 'Solar Sense',
    description: 'Solar sites, assessments, photo packs, and cloud backup.',
  },
  {
    href: '/field',
    title: 'Field App',
    description: 'Mobile field workflows — coming soon.',
    soon: true,
  },
];

export default function PortalHomePage() {
  return (
    <div>
      <PageHeader title="EcoSense Portal" subtitle="Choose an app to get started" />
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {apps.map((app) => (
          <Link key={app.href} href={app.href} className="block">
            <Card className="h-full transition hover:border-[var(--primary)]">
              <div className="mb-1 flex items-center gap-2">
                <h2 className="font-semibold">{app.title}</h2>
                {app.soon ? (
                  <span className="rounded bg-[var(--surface2)] px-1.5 py-0.5 text-[10px] uppercase tracking-wide text-[var(--text-sub)]">
                    Coming soon
                  </span>
                ) : null}
              </div>
              <p className="text-sm text-[var(--text-sub)]">{app.description}</p>
            </Card>
          </Link>
        ))}
      </div>
      <div className="mt-6">
        <Link href="/scheduler" className="text-sm font-medium text-[var(--primary)] hover:underline">
          Open Scheduler →
        </Link>
      </div>
    </div>
  );
}
