import { CheckCircle2, CircleDashed } from 'lucide-react';

const completed = [
  'Frontend app shell',
  'Login with app selector',
  'Stored sessions per app',
  'Token refresh on bootstrap',
  'Protected routes',
  'Admin-only navigation',
  'API health diagnostics',
  'Shared CRUD workflow panel',
  'Shared form controls',
  'Shared confirmation dialog',
  'Stored file/photo browser',
  'Photo ZIP download panel',
  'PDF job panel',
  'SolarSense live site CRUD',
  'SolarSense live assessment CRUD',
  'EcoAudit live audit CRUD',
  'EcoAudit live zone CRUD',
  'EcoAudit live equipment CRUD for all categories',
];

const next = [
  'Schema-specific photo upload wiring',
  'Top-level copy naming verification',
  'Specialized repeated-section editors',
  'User management screens',
];

export function BacklogPage() {
  return (
    <section className="page-stack">
      <header className="page-header">
        <div>
          <p className="eyebrow">Delivery</p>
          <h1>Backlog</h1>
        </div>
      </header>

      <div className="settings-grid">
        <article className="feature-panel">
          <h2>Delivered</h2>
          <ul className="check-list">
            {completed.map((item) => (
              <li key={item}>
                <CheckCircle2 aria-hidden="true" />
                {item}
              </li>
            ))}
          </ul>
        </article>

        <article className="feature-panel">
          <h2>Next Phases</h2>
          <ul className="check-list muted">
            {next.map((item) => (
              <li key={item}>
                <CircleDashed aria-hidden="true" />
                {item}
              </li>
            ))}
          </ul>
        </article>
      </div>
    </section>
  );
}
