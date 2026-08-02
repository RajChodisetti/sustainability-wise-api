'use client';

import { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import type { ExportJobStatus } from '@/types/domain';
import { downloadBlob } from '@/lib/download';

type UseExportJobOptions = {
  scopeKey: readonly string[];
  loadLatest: () => Promise<ExportJobStatus | null>;
  getStatus: (jobId: string) => Promise<ExportJobStatus>;
  downloadJob: (job: ExportJobStatus) => Promise<Blob>;
  fallbackFilename: string;
  matchesJob?: (job: ExportJobStatus) => boolean;
};

export function useExportJob({
  scopeKey,
  loadLatest,
  getStatus,
  downloadJob,
  fallbackFilename,
  matchesJob,
}: UseExportJobOptions) {
  const queryClient = useQueryClient();
  const scopeIdentity = JSON.stringify(scopeKey);
  const [selectedJob, setSelectedJob] = useState<{
    scopeIdentity: string;
    jobId: string;
  } | null>(null);
  const selectedJobId = selectedJob?.scopeIdentity === scopeIdentity
    ? selectedJob.jobId
    : null;
  const [starting, setStarting] = useState(false);
  const [downloading, setDownloading] = useState(false);
  const [actionError, setActionError] = useState<unknown>(null);
  const queryKey = ['export-job', ...scopeKey, selectedJobId ?? 'latest'] as const;

  function requireMatchedJob(job: ExportJobStatus): ExportJobStatus {
    if (matchesJob && !matchesJob(job)) {
      throw new Error('The export job does not match the expected report version.');
    }
    return job;
  }

  const jobQuery = useQuery({
    queryKey,
    queryFn: async () => {
      if (selectedJobId) return requireMatchedJob(await getStatus(selectedJobId));
      const latest = await loadLatest();
      return latest && (!matchesJob || matchesJob(latest)) ? latest : null;
    },
    refetchInterval: (query) => {
      const status = query.state.data?.status;
      return status === 'queued' || status === 'running' ? 2_000 : false;
    },
    refetchIntervalInBackground: false,
    retry: 2,
  });

  const job = jobQuery.data ?? null;
  const active = job?.status === 'queued' || job?.status === 'running';

  async function start(startJob: () => Promise<{ jobId: string }>): Promise<ExportJobStatus | null> {
    if (starting || active) return job;
    setStarting(true);
    setActionError(null);
    try {
      const { jobId } = await startJob();
      setSelectedJob({ scopeIdentity, jobId });
      const nextKey = ['export-job', ...scopeKey, jobId] as const;
      return await queryClient.fetchQuery({
        queryKey: nextKey,
        queryFn: async () => requireMatchedJob(await getStatus(jobId)),
      });
    } catch (error) {
      setActionError(error);
      throw error;
    } finally {
      setStarting(false);
    }
  }

  async function download(): Promise<void> {
    if (!job || job.status !== 'complete' || downloading) return;
    setDownloading(true);
    setActionError(null);
    try {
      const fresh = requireMatchedJob(await getStatus(job.id));
      if (fresh.status !== 'complete') {
        throw new Error('The export is no longer ready to download.');
      }
      queryClient.setQueryData(queryKey, fresh);
      const blob = await downloadJob(fresh);
      downloadBlob(blob, fresh.filename || fallbackFilename);
    } catch (error) {
      setActionError(error);
      throw error;
    } finally {
      setDownloading(false);
    }
  }

  return {
    job,
    active,
    starting,
    downloading,
    error: actionError ?? jobQuery.error,
    start,
    download,
  };
}
