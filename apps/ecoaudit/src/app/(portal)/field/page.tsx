import { Card, PageHeader } from '@/components/ui/Card';
import { Icon } from '@/components/ui/Icon';

export default function FieldComingSoonPage() {
  return (
    <div>
      <PageHeader title="Field App" subtitle="Mobile field workflows" />
      <Card className="max-w-xl text-center">
        <span className="mx-auto mb-4 flex h-14 w-14 items-center justify-center rounded-2xl bg-[var(--primary-soft)] text-[var(--primary)]"><Icon name="clipboard" size={27} /></span>
        <p className="text-2xl font-extrabold tracking-[-0.03em] text-[var(--text)]">Coming soon</p>
        <p className="mx-auto mt-2 max-w-md text-sm leading-6 text-[var(--text-sub)]">
          The Field App will live here. Open your available workspace from the Apps menu.
        </p>
      </Card>
    </div>
  );
}
