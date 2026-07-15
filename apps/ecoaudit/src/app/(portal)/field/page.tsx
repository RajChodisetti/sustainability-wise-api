import { Card, PageHeader } from '@/components/ui/Card';

export default function FieldComingSoonPage() {
  return (
    <div>
      <PageHeader title="Field App" subtitle="Mobile field workflows" />
      <Card className="max-w-lg">
        <p className="text-lg font-semibold">Coming Soon</p>
        <p className="mt-2 text-sm text-[var(--text-sub)]">
          The Field App will live here. Eco Audit and Solar Sense are available now from the Apps menu.
        </p>
      </Card>
    </div>
  );
}
