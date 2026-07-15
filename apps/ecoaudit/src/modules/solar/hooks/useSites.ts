import { useQuery } from '@tanstack/react-query';
import { listAllAssessments } from '@solar/api/assessments';
import { listSites } from '@solar/api/sites';

export function useSites() {
  return useQuery({
    queryKey: ['sites'],
    queryFn: listSites,
  });
}

export function useAllAssessments() {
  const sitesQuery = useSites();
  return useQuery({
    queryKey: ['assessments', 'all', sitesQuery.data?.map((s) => s.id).join(',')],
    queryFn: () => listAllAssessments((sitesQuery.data ?? []).map((s) => ({ id: s.id, siteName: s.siteName }))),
    enabled: Boolean(sitesQuery.data),
  });
}
