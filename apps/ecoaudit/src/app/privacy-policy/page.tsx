import type { Metadata } from 'next';
import Link from 'next/link';
import { BrandMark, Icon, type IconName } from '@/components/ui/Icon';

export const metadata: Metadata = {
  title: 'Privacy Policy | Field App Complete',
  description:
    'How Sustainability Wise handles information in the Field App Complete application.',
};

const policySections = [
  { id: 'scope', label: 'Scope' },
  { id: 'information', label: 'Information handled' },
  { id: 'use', label: 'How information is used' },
  { id: 'permissions', label: 'Device permissions' },
  { id: 'storage', label: 'Storage and disclosure' },
  { id: 'retention', label: 'Retention and your choices' },
  { id: 'security', label: 'Security' },
  { id: 'children', label: 'Children' },
  { id: 'changes', label: 'Changes' },
  { id: 'contact', label: 'Contact' },
] as const;

function PolicySection({
  id,
  title,
  children,
}: {
  id: string;
  title: string;
  children: React.ReactNode;
}) {
  return (
    <section
      id={id}
      aria-labelledby={`${id}-heading`}
      className="scroll-mt-24 border-b border-[var(--border)] py-8 first:pt-0 last:border-0 last:pb-0 sm:py-10"
    >
      <h2
        id={`${id}-heading`}
        className="text-xl font-extrabold tracking-[-0.025em] text-[var(--text)] sm:text-2xl"
      >
        {title}
      </h2>
      <div className="mt-4 space-y-4 text-[0.9375rem] leading-7 text-[var(--text-sub)] sm:text-base sm:leading-8">
        {children}
      </div>
    </section>
  );
}

function PermissionCard({
  icon,
  title,
  children,
}: {
  icon: IconName;
  title: string;
  children: React.ReactNode;
}) {
  return (
    <li className="rounded-[var(--radius-md)] border border-[var(--border)] bg-[var(--surface2)] p-4 sm:p-5">
      <span className="flex h-10 w-10 items-center justify-center rounded-xl bg-[var(--primary-soft)] text-[var(--primary)]">
        <Icon name={icon} size={20} />
      </span>
      <h3 className="mt-4 text-sm font-extrabold text-[var(--text)] sm:text-base">{title}</h3>
      <p className="mt-2 text-sm leading-6 text-[var(--text-sub)]">{children}</p>
    </li>
  );
}

export default function PrivacyPolicyPage() {
  return (
    <div className="min-h-screen bg-[var(--bg)]">
      <a href="#privacy-policy" className="skip-link">
        Skip to privacy policy
      </a>

      <header className="border-b border-[var(--border)] bg-[var(--surface)]/95 shadow-[var(--shadow-xs)] backdrop-blur-md">
        <div className="mx-auto flex min-h-18 w-full max-w-[1200px] items-center justify-between gap-4 px-4 py-3 sm:px-6 lg:px-8">
          <Link
            href="/"
            className="flex min-w-0 items-center gap-3 rounded-xl focus-visible:outline-none"
            aria-label="Sustainability Wise portal home"
          >
            <BrandMark />
            <span className="min-w-0">
              <span className="block truncate text-sm font-extrabold tracking-[-0.02em] text-[var(--text)] sm:text-base">
                Sustainability Wise
              </span>
              <span className="block truncate text-[10px] font-bold uppercase tracking-[0.12em] text-[var(--muted)] sm:text-[11px]">
                Field App Complete
              </span>
            </span>
          </Link>

          <Link
            href="/login"
            className="inline-flex min-h-11 shrink-0 items-center gap-2 rounded-[var(--radius-sm)] border border-[var(--border)] bg-[var(--surface)] px-3.5 text-sm font-bold text-[var(--text)] shadow-[var(--shadow-xs)] hover:border-[var(--border-strong)] hover:bg-[var(--surface2)] sm:px-4"
          >
            <span className="hidden sm:inline">Sign in</span>
            <Icon name="arrow-right" size={17} />
          </Link>
        </div>
      </header>

      <main id="privacy-policy" tabIndex={-1}>
        <section className="relative overflow-hidden border-b border-[var(--border)] bg-[var(--surface)]">
          <div
            className="pointer-events-none absolute -right-24 -top-36 h-96 w-96 rounded-full bg-blue-500/10 blur-3xl"
            aria-hidden="true"
          />
          <div
            className="pointer-events-none absolute -bottom-40 left-1/4 h-80 w-80 rounded-full bg-teal-500/10 blur-3xl"
            aria-hidden="true"
          />

          <div className="relative mx-auto w-full max-w-[1200px] px-4 py-14 sm:px-6 sm:py-18 lg:px-8 lg:py-22">
            <div className="max-w-3xl">
              <div className="inline-flex items-center gap-2 rounded-full border border-[var(--border)] bg-[var(--surface2)] px-3 py-1.5 text-xs font-extrabold uppercase tracking-[0.1em] text-[var(--primary)]">
                <Icon name="shield" size={15} />
                Privacy policy
              </div>
              <h1 className="mt-6 text-4xl font-extrabold leading-[1.08] tracking-[-0.05em] text-[var(--text)] sm:text-5xl lg:text-6xl">
                Your information, handled with care.
              </h1>
              <p className="mt-6 max-w-2xl text-base leading-8 text-[var(--text-sub)] sm:text-lg">
                This policy explains how Sustainability Wise handles information when authorised field workers use Field App Complete.
              </p>
              <div className="mt-8 flex flex-wrap gap-x-8 gap-y-3 text-sm text-[var(--text-sub)]">
                <p>
                  <span className="font-extrabold text-[var(--text)]">Effective:</span>{' '}
                  6 August 2026
                </p>
                <p>
                  <span className="font-extrabold text-[var(--text)]">Operator:</span>{' '}
                  Sustainability Wise
                </p>
              </div>
            </div>
          </div>
        </section>

        <div className="mx-auto grid w-full max-w-[1200px] gap-8 px-4 py-10 sm:px-6 sm:py-14 lg:grid-cols-[16rem_minmax(0,1fr)] lg:gap-12 lg:px-8 lg:py-18">
          <aside className="lg:sticky lg:top-8 lg:self-start" aria-label="Privacy policy navigation">
            <nav className="rounded-[var(--radius-md)] border border-[var(--border)] bg-[var(--surface)] p-4 shadow-[var(--shadow-xs)] sm:p-5">
              <p className="text-xs font-extrabold uppercase tracking-[0.12em] text-[var(--muted)]">
                On this page
              </p>
              <ol className="mt-3 space-y-1">
                {policySections.map((section, index) => (
                  <li key={section.id}>
                    <a
                      href={`#${section.id}`}
                      className="flex min-h-10 items-center gap-3 rounded-lg px-2 text-sm font-semibold text-[var(--text-sub)] hover:bg-[var(--surface2)] hover:text-[var(--primary)]"
                    >
                      <span className="w-5 text-[11px] font-extrabold tabular-nums text-[var(--muted)]">
                        {String(index + 1).padStart(2, '0')}
                      </span>
                      {section.label}
                    </a>
                  </li>
                ))}
              </ol>
            </nav>

            <div className="mt-4 rounded-[var(--radius-md)] border border-[var(--border)] bg-[var(--primary-soft)] p-5">
              <Icon name="lock" size={21} className="text-[var(--primary)]" />
              <p className="mt-3 text-sm font-extrabold text-[var(--text)]">Privacy at a glance</p>
              <p className="mt-2 text-sm leading-6 text-[var(--text-sub)]">
                No advertising SDKs, no sale of personal information and no cross-app tracking.
              </p>
            </div>
          </aside>

          <article className="min-w-0 rounded-[var(--radius-lg)] border border-[var(--border)] bg-[var(--surface)] px-5 py-8 shadow-[var(--shadow-xs)] sm:px-8 sm:py-10 lg:px-10">
            <PolicySection id="scope" title="Scope">
              <p>
                This policy describes how Field App Complete handles information when authorised field workers use the app to document and commission installations. The current beta connects to a non-production quality-assurance environment and must be used only with approved test or synthetic data.
              </p>
            </PolicySection>

            <PolicySection id="information" title="Information handled by the app">
              <p>Depending on the workflow used, the app may handle:</p>
              <ul className="list-disc space-y-2 pl-6 marker:text-[var(--primary)]">
                <li>account identifiers, including username, name, email address and internal user ID;</li>
                <li>client, site and installation information, including addresses and audit details;</li>
                <li>zones, switchboards, energy assets, meters, devices, channel mappings and equipment identifiers;</li>
                <li>field-form responses, notes and status information;</li>
                <li>photos selected or captured as installation evidence;</li>
                <li>precise location only when a user explicitly captures installation coordinates;</li>
                <li>cloud-backup, synchronisation and report-generation status; and</li>
                <li>limited operational diagnostics needed to troubleshoot app functionality.</li>
              </ul>
              <div className="rounded-[var(--radius-md)] border border-[var(--border)] bg-[var(--green-soft)] p-4 text-sm leading-6 text-[var(--text)] sm:p-5">
                The app does not use advertising SDKs, sell personal information or perform cross-app tracking. The current app does not request contacts or microphone access and does not process payments or health information.
              </div>
            </PolicySection>

            <PolicySection id="use" title="How information is used">
              <p>Information is used to:</p>
              <ul className="list-disc space-y-2 pl-6 marker:text-[var(--primary)]">
                <li>authenticate authorised users;</li>
                <li>create, edit, validate and reconcile field-installation records;</li>
                <li>store work offline on the device;</li>
                <li>synchronise or back up installations when an authorised user enables those functions;</li>
                <li>generate installation reports and supporting evidence; and</li>
                <li>maintain security, diagnose faults and provide support.</li>
              </ul>
            </PolicySection>

            <PolicySection id="permissions" title="Device permissions">
              <ul className="grid list-none gap-3 p-0 md:grid-cols-3">
                <PermissionCard icon="camera" title="Camera">
                  Barcode or QR scanning and installation evidence photos.
                </PermissionCard>
                <PermissionCard icon="file-text" title="Photo Library">
                  Attaching existing evidence photos.
                </PermissionCard>
                <PermissionCard icon="map-pin" title="Location While Using the App">
                  Capturing installation coordinates when requested by the user.
                </PermissionCard>
              </ul>
              <p>
                Manual entry remains available for scanner and coordinate workflows when permission is not granted. Permissions can be changed in iOS Settings.
              </p>
            </PolicySection>

            <PolicySection id="storage" title="Storage and disclosure">
              <p>
                Information may be stored on the device and, when cloud features are used, on systems and service providers used on Sustainability Wise&apos;s behalf. It may be disclosed to authorised customer or project personnel and to service providers that host or operate the app, solely as needed to provide the service, maintain security or comply with law.
              </p>
            </PolicySection>

            <PolicySection id="retention" title="Retention, access and deletion">
              <p>
                Information is retained only while required for authorised project, operational, contractual or legal purposes. An authorised user or organisation administrator may request access, correction or deletion by emailing{' '}
                <a
                  href="mailto:rajchodisetti@icloud.com"
                  className="font-bold text-[var(--primary)] underline decoration-[var(--border-strong)] underline-offset-4 hover:text-[var(--primary-hover)]"
                >
                  rajchodisetti@icloud.com
                </a>
                . Some records may need to be retained where required by contract or law.
              </p>
            </PolicySection>

            <PolicySection id="security" title="Security">
              <p>
                Reasonable technical and organisational measures are used to protect information. No electronic storage or transmission method can be guaranteed completely secure.
              </p>
            </PolicySection>

            <PolicySection id="children" title="Children">
              <p>
                Field App Complete is a business field-work application and is not directed to children.
              </p>
            </PolicySection>

            <PolicySection id="changes" title="Changes to this policy">
              <p>
                This policy may be updated when the app or its data-handling practices change. The effective date above will be updated when a revised policy takes effect.
              </p>
            </PolicySection>

            <PolicySection id="contact" title="Contact">
              <p>Questions or privacy requests may be sent to:</p>
              <address className="not-italic">
                <strong className="text-[var(--text)]">Sustainability Wise</strong>
                <br />
                <a
                  href="mailto:rajchodisetti@icloud.com"
                  className="break-all font-bold text-[var(--primary)] underline decoration-[var(--border-strong)] underline-offset-4 hover:text-[var(--primary-hover)]"
                >
                  rajchodisetti@icloud.com
                </a>
              </address>
            </PolicySection>
          </article>
        </div>
      </main>

      <footer className="border-t border-[var(--border)] bg-[var(--surface)]">
        <div className="mx-auto flex w-full max-w-[1200px] flex-col gap-3 px-4 py-7 text-sm text-[var(--muted)] sm:flex-row sm:items-center sm:justify-between sm:px-6 lg:px-8">
          <p>© 2026 Sustainability Wise. All rights reserved.</p>
          <Link
            href="/login"
            className="w-fit font-bold text-[var(--primary)] hover:text-[var(--primary-hover)]"
          >
            Field App Complete sign in
          </Link>
        </div>
      </footer>
    </div>
  );
}
