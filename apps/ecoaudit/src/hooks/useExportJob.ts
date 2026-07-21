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
};

export function useExportJob({
  scopeKey,
  loadLatest,
  getStatus,
  downloadJob,
  fallbackFilename,
}: UseExportJobOptions) {
  const queryClient = useQueryClient();
  const [selectedJobId, setSelectedJobId] = useState<string | null>(null);
  const [starting, setStarting] = useState(false);
  const [downloading, setDownloading] = useState(false);
  const [actionError, setActionError] = useState<unknown>(null);
  const queryKey = ['export-job', ...scopeKey, selectedJobId ?? 'latest'] as const;

  const jobQuery = useQuery({
    queryKey,
    queryFn: () => selectedJobId ? getStatus(selectedJobId) : loadLatest(),
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
      setSelectedJobId(jobId);
      const nextKey = ['export-job', ...scopeKey, jobId] as const;
      return await queryClient.fetchQuery({ queryKey: nextKey, queryFn: () => getStatus(jobId) });
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
      const blob = await downloadJob(job);
      downloadBlob(blob, job.filename || fallbackFilename);
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
