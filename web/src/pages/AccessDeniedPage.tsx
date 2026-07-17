import { ShieldX } from 'lucide-react';

export function AccessDeniedPage() {
  return (
    <section className="empty-state">
      <ShieldX aria-hidden="true" />
      <h1>Access denied</h1>
      <p>Your current role does not allow this action.</p>
    </section>
  );
}

