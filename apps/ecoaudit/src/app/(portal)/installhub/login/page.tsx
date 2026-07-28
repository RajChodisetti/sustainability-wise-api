import { redirect } from 'next/navigation';
import { portalLoginRedirectPath } from '@/lib/portalNavigation';

export default async function InstallHubLoginRedirect({
  searchParams,
}: {
  searchParams: Promise<{ next?: string | string[] }>;
}) {
  const { next } = await searchParams;
  redirect(portalLoginRedirectPath(next, '/installhub'));
}
