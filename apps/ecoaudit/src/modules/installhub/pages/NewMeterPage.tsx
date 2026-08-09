'use client';

import { InstallHubMeterPage } from '@/modules/installhub/pages/MeterPage';

/**
 * The add-meter route opens the adaptive editor directly. Device family is
 * selected inside the form, so users do not have to choose a workflow first.
 */
export function InstallHubNewMeterPage() {
  return <InstallHubMeterPage mode="new" />;
}
