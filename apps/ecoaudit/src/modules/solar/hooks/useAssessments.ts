import { useQuery } from '@tanstack/react-query';
import { getAssessment, listAssessments } from '@solar/api/assessments';

export function useAssessmentsForSite(siteId: string | undefined) {
  return useQuery({
    queryKey: ['assessments', siteId],
    queryFn: () => listAssessments(siteId!),
    enabled: Boolean(siteId),
  });
}

export function useAssessment(siteId: string | undefined, assessmentId: string | undefined) {
  return useQuery({
    queryKey: ['assessment', siteId, assessmentId],
    queryFn: () => getAssessment(siteId!, assessmentId!),
    enabled: Boolean(siteId && assessmentId),
  });
}
