import { Suspense } from 'react';
import { Spinner } from '@/components/ui/Card';
import DevicesPage from '@/modules/fleet/pages/DevicesPage';

export default function FleetDevicesPage() {
  return (
    <Suspense fallback={<Spinner label="Loading device filters…" />}>
      <DevicesPage />
    </Suspense>
  );
}
