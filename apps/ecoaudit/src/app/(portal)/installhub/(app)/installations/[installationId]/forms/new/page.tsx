import { Suspense } from 'react';
import { Spinner } from '@/components/ui/Card';
import { InstallHubNewFormPage } from '@/modules/installhub/pages/FormsPage';

export default function NewInstallHubFormRoute() {
  return (
    <Suspense fallback={<Spinner />}>
      <InstallHubNewFormPage />
    </Suspense>
  );
}
